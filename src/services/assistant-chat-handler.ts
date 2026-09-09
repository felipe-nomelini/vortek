import 'server-only';
import { z } from 'zod';
import { CHAT_TIMEOUT_MS, chatInputSchema, chatStateLabels, conversationTitleSchema, type ChatEvent, type ChatState } from '@/lib/assistant-chat';
import { queryAssistantKnowledge } from './assistant-knowledge';
import { assistantRuntimeState, composeAssistantAnswer, evidenceAnswer, modelErrorState, planAssistantQueries, validateQuestionPrivacy } from './assistant-chat-model';
import { ChatError, assertMessageRunning, authorizeAssistant, beginMessage, cancelMessage, conversationContext,
  deleteConversation, emptyChatAnswer, finishMessage, getMessages, listConversations, newConversation, ownConversation, renameConversation } from './assistant-history';

const active = new Map<string,{requestId:string;controller:AbortController}>();
const idSchema=z.string().uuid();
const headers={'Cache-Control':'no-store'};
async function abortable<T>(operation:Promise<T>,signal:AbortSignal):Promise<T>{
  let abort:()=>void=()=>{};
  try{return await Promise.race([operation,new Promise<never>((_,reject)=>{
    abort=()=>reject(new ChatError('cancelado'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  })]);}finally{signal.removeEventListener('abort',abort);}
}
function failure(error: unknown) {
  const known=error instanceof ChatError;
  const state=known ? error.state : error instanceof z.ZodError ? 'entrada_invalida' : 'fonte_indisponivel';
  return Response.json({state,error:chatStateLabels[state]},{status:known?error.status:400,headers});
}
async function input(request: Request) {
  const origin=request.headers.get('origin');
  if(origin){
    const incoming=new URL(request.url),supplied=new URL(origin);
    // Next may construct request.url with its internal bind host behind the proxy.
    const local=supplied.protocol==='http:'&&['127.0.0.1','localhost'].includes(supplied.hostname)
      &&['127.0.0.1','localhost','0.0.0.0'].includes(incoming.hostname)&&supplied.host===request.headers.get('host');
    if(origin!=='https://dev.bentevi.shop'&&!local)throw new ChatError('acesso_negado',403);
  }
  if (Number(request.headers.get('content-length')||0)>20000) throw new ChatError('entrada_invalida',413);
  const reader=request.body?.getReader();
  if (!reader) throw new ChatError('entrada_invalida');
  const chunks:Uint8Array[]=[]; let bytes=0;
  try { while (true) {const {done,value}=await reader.read(); if (done) break; bytes+=value.byteLength;
    if(bytes>20000){await reader.cancel();throw new ChatError('entrada_invalida',413);} chunks.push(value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {reader.releaseLock();}
}
export async function assistantStatus(request:Request) {
  try {await authorizeAssistant(request); const state=assistantRuntimeState(); return Response.json({allowed:true,state,model:'gpt-6-astra',effort:'low',mode:'chatgpt'}, {headers});}
  catch(error){return failure(error);}
}
export async function conversationsHandler(request:Request) {
  try {
    const user=await authorizeAssistant(request);
    if(request.method==='POST'){await input(request);return Response.json({conversation:await newConversation(user)},{status:201,headers});}
    const url=new URL(request.url);const search=z.string().max(100).parse(url.searchParams.get('search')||'');
    const offset=z.coerce.number().int().min(0).max(100000).parse(url.searchParams.get('offset')||0);
    const conversations=await listConversations(user,search,offset);
    return Response.json({conversations,nextOffset:conversations.length===30?offset+30:null},{headers});
  }catch(error){return failure(error);}
}
export async function conversationHandler(request:Request,id:string) {
  try {
    const user=await authorizeAssistant(request);idSchema.parse(id);
    if(request.method==='PATCH'){const {title}=conversationTitleSchema.parse(await input(request));validateQuestionPrivacy(title);await renameConversation(user,id,title);return Response.json({ok:true},{headers});}
    if(request.method==='DELETE'){await input(request);await deleteConversation(user,id);return Response.json({ok:true},{headers});}
    const before=new URL(request.url).searchParams.get('before')||undefined;
    if(before) z.string().datetime({offset:true}).parse(before);
    const conversation=await ownConversation(user,id);const messages=await getMessages(user,id,before);
    await authorizeAssistant(request);
    return Response.json({conversation,messages,nextBefore:messages.length===50?messages[0].created_at:null},{headers});
  }catch(error){return failure(error);}
}
export async function cancelHandler(request:Request) {
  try {
    const user=await authorizeAssistant(request);
    const body=z.object({conversationId:idSchema,requestId:idSchema}).strict().parse(await input(request));
    await cancelMessage(user,body.conversationId,body.requestId);
    const current=active.get(user);
    if(current?.requestId===body.requestId) current.controller.abort();
    return Response.json({ok:true},{headers});
  }catch(error){return failure(error);}
}
export async function sendHandler(request:Request) {
  try {
    const user=await authorizeAssistant(request);const body=chatInputSchema.parse(await input(request));
    try {validateQuestionPrivacy(body.question);}catch{throw new ChatError('entrada_invalida');}
    const unavailable=assistantRuntimeState(); if(unavailable) throw new ChatError(unavailable,503);
    const begun=await beginMessage(user,body.conversationId,body.requestId,body.question);
    if(!begun.created) return Response.json({message:begun.message},{headers});
    const controller=new AbortController();const timeout=AbortSignal.timeout(CHAT_TIMEOUT_MS);
    const signal=AbortSignal.any([controller.signal,request.signal,timeout]);
    const previous=active.get(user);
    if(previous){await finishMessage(user,begun.message.id,'ocupado',null);throw new ChatError('ocupado',409);}
    active.set(user,{requestId:body.requestId,controller});
    const encoder=new TextEncoder();
    const stream=new ReadableStream<Uint8Array>({
      start(sink){
        let connected=true;
        const emit=(event:ChatEvent)=>{if(!connected||signal.aborted)return;try{sink.enqueue(encoder.encode(JSON.stringify(event)+'\n'));}catch{connected=false;controller.abort();}};
        async function checkpoint(){
          signal.throwIfAborted();if(await abortable(authorizeAssistant(request),signal)!==user) throw new ChatError('acesso_negado',403);
          await abortable(assertMessageRunning(user,begun.message.id),signal);signal.throwIfAborted();
        }
        void (async()=>{
          try {
            await checkpoint();emit({type:'message',message:begun.message});emit({type:'phase',phase:'Interpretando a pergunta'});
            const history=await abortable(conversationContext(user,body.conversationId,body.requestId),signal);
            const plan=await abortable(planAssistantQueries(body.question,history,signal),signal);
            await checkpoint();
            let answer; let state:ChatState='concluido';
            if(!plan.queries.length){state='esclarecimento_necessario';answer=emptyChatAnswer(plan.clarification);}
            else {
              emit({type:'phase',phase:'Consultando as fontes do ERP'});
              const results=[];
              for(const query of plan.queries){
                await checkpoint();
                results.push(await queryAssistantKnowledge(new Request(request.url,{headers:request.headers,signal}),query));
              }
              await checkpoint();
              const rejected=results.find(result=>!['concluido','sem_dados','esclarecimento_necessario'].includes(result.state));
              if(rejected) throw new ChatError(rejected.state);
              if(results.every(result=>result.state==='sem_dados')){
                state='sem_dados';
                const text=results.map(result=>{
                  if(result.facts?.kind!=='sales'||!result.period)return chatStateLabels.sem_dados;
                  const date=new Intl.DateTimeFormat('pt-BR',{timeZone:result.period.timezone});
                  const facts=result.facts;
                  return [
                    `Não há vendas registradas no DEV entre ${date.format(new Date(result.period.start))} e ${date.format(new Date(result.period.end))} (horário de São Paulo).`,
                    facts.latestAvailableSaleAt
                      ? `O registro de venda mais recente disponível é de ${date.format(new Date(facts.latestAvailableSaleAt))}.`
                      : 'Não há registros de vendas com data válida disponíveis nesta base até o momento da consulta.',
                    result.includesFixtures ? 'Os dados disponíveis são amostras de homologação.' : '',
                    'Isso não comprova ausência de vendas na operação real.',
                    facts.suggestedPeriod==='30d' ? 'Para analisar os dados disponíveis, pergunte: “Como foram as vendas nos últimos 30 dias?”' : '',
                  ].filter(Boolean).join(' ');
                }).join('\n\n');
                answer=evidenceAnswer(text,results);
              }
              else {emit({type:'phase',phase:'Preparando a resposta com as fontes'});answer=await abortable(composeAssistantAnswer(body.question,results,signal),signal);
                if(results.some(result=>result.state==='esclarecimento_necessario'))state='esclarecimento_necessario';}
            }
            await checkpoint();
            const final=await finishMessage(user,begun.message.id,state,answer);
            await abortable(authorizeAssistant(request),signal);signal.throwIfAborted();
            if(final)emit({type:'message',message:final});
          } catch(error){
            const state:ChatState=timeout.aborted?'tempo_esgotado':signal.aborted?'cancelado':error instanceof ChatError?error.state
              :error instanceof z.ZodError?'resposta_invalida':modelErrorState(error);
            let historyPersisted=true;
            try {await finishMessage(user,begun.message.id,state,null);}catch{historyPersisted=false;}
            emit({type:'error',state});
            console.info('[assistant_chat]',{requestId:body.requestId,state,model:'gpt-6-astra',historyPersisted});
          } finally {
            if(active.get(user)?.controller===controller)active.delete(user);
            try{sink.close();}catch{/* Client disconnected. */}
          }
        })();
      },
      cancel(){controller.abort();},
    });
    return new Response(stream,{headers:{...headers,'Content-Type':'application/x-ndjson; charset=utf-8','X-Accel-Buffering':'no'}});
  }catch(error){return failure(error);}
}
