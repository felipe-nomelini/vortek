import 'server-only';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase';
import { authorizeApiRequest } from '@/lib/api-request-auth';
import { resolveSupabaseServiceUrl } from '@/lib/supabase-url';
import { assertAssistantDestination } from './assistant-read-transport';
import { CHAT_MODEL, type ChatAnswer, type ChatConversation, type ChatMessage, type ChatState } from '@/lib/assistant-chat';
import type { Json } from '@/types/database';

export class ChatError extends Error {
  constructor(public state: ChatState, public status = 400) { super(state); }
}
export async function authorizeAssistant(request: Request) {
  try { assertAssistantDestination(resolveSupabaseServiceUrl()); }
  catch { throw new ChatError('ambiente_bloqueado',403); }
  if (process.env.BENTEVI_ASSISTANT_ENABLED !== '1') throw new ChatError('ambiente_bloqueado',403);
  const pilot = process.env.BENTEVI_ASSISTANT_PILOT_USER_ID;
  if (!z.string().uuid().safeParse(pilot).success) throw new ChatError('acesso_negado',403);
  const auth = await authorizeApiRequest(request,'sales.read');
  if (!auth.ok || auth.userId !== pilot) throw new ChatError('acesso_negado',403);
  const db = historyDb();
  const profile = await db.from('profiles').select('cargo').eq('id',auth.userId).maybeSingle();
  if (profile.error || profile.data?.cargo !== 'admin') throw new ChatError('acesso_negado',403);
  return auth.userId;
}

/** This client owns only chat persistence. Never pass it to the model or AI-01. */
function historyDb() {
  const origin=resolveSupabaseServiceUrl();
  assertAssistantDestination(origin);
  return createServiceClient({fetch:async(url,init)=>{
    if(new URL(url instanceof Request ? url.url : String(url)).origin!==new URL(origin).origin)throw new ChatError('ambiente_bloqueado',403);
    return fetch(url,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.any([
      ...(init?.signal?[init.signal]:[]),AbortSignal.timeout(10000),
    ])});
  }});
}
const MESSAGE_COLUMNS = 'id,conversation_id,request_id,role,content,state,answer,created_at,deadline_at';
const CONVERSATION_COLUMNS = 'id,title,created_at,updated_at';
function check(error: { message: string } | null) {
  if (!error) return;
  if (error.message.includes('assistant_busy')) throw new ChatError('ocupado',409);
  if (error.message.includes('assistant_not_found')) throw new ChatError('acesso_negado',404);
  if (error.message.includes('assistant_idempotency_conflict')) throw new ChatError('entrada_invalida',409);
  throw new ChatError('fonte_indisponivel',503);
}
export async function ownConversation(user: string,id: string) {
  const {data,error}=await historyDb().from('assistant_conversations').select(CONVERSATION_COLUMNS).eq('user_id',user).eq('id',id).maybeSingle();
  check(error); if (!data) throw new ChatError('acesso_negado',404);
  return data as ChatConversation;
}
export async function listConversations(user: string, search: string, offset: number) {
  let query=historyDb().from('assistant_conversations').select(CONVERSATION_COLUMNS).eq('user_id',user);
  if (search) query=query.ilike('title',`%${search.replace(/[\\%_]/g,'\\$&')}%`);
  const {data,error}=await query.order('updated_at',{ascending:false}).order('id').range(offset,offset+29);
  check(error); return data as ChatConversation[];
}
export async function newConversation(user: string) {
  const {data,error}=await historyDb().from('assistant_conversations').insert({user_id:user}).select(CONVERSATION_COLUMNS).single();
  check(error); return data as ChatConversation;
}
export async function renameConversation(user: string,id: string,title: string) {
  await ownConversation(user,id);
  const {error}=await historyDb().from('assistant_conversations').update({title}).eq('id',id).eq('user_id',user); check(error);
}
export async function getMessages(user: string,id: string, before?: string) {
  await ownConversation(user,id);
  let query=historyDb().from('assistant_messages').select(MESSAGE_COLUMNS).eq('user_id',user).eq('conversation_id',id);
  if (before) query=query.lt('created_at',before);
  const {data,error}=await query.order('created_at',{ascending:false}).order('role').limit(50); check(error);
  return (data || []).reverse().map(row => ({...row, state: ['running','cancel_requested'].includes(row.state) && row.deadline_at && Date.parse(row.deadline_at)<=Date.now()
    ? row.state==='cancel_requested' ? 'cancelado' : 'tempo_esgotado' : row.state })) as ChatMessage[];
}
export async function beginMessage(user: string,conversation: string,request: string,question: string) {
  const {data,error}=await historyDb().rpc('begin_assistant_message', {p_user:user,p_conversation:conversation,p_request:request,p_question:question}); check(error);
  return data as unknown as {created:boolean;message:ChatMessage};
}
export async function finishMessage(user: string,id: string,state: ChatState,answer: ChatAnswer|null) {
  const {data,error}=await historyDb().rpc('finish_assistant_message', {
    p_user:user,p_message:id,p_state:state,p_content:answer?.text||'',p_answer:answer as unknown as Json,
  }); check(error); return data as unknown as ChatMessage|null;
}
export async function assertMessageRunning(user: string,id: string) {
  const {data,error}=await historyDb().from('assistant_messages').select('state,deadline_at').eq('id',id).eq('user_id',user).maybeSingle();
  check(error);
  if (!data || data.state!=='running') throw new ChatError('cancelado');
  if (!data.deadline_at || Date.parse(data.deadline_at)<=Date.now()) throw new ChatError('tempo_esgotado');
}
export async function cancelMessage(user: string,conversation: string,request: string) {
  await ownConversation(user,conversation);
  const {error}=await historyDb().from('assistant_messages').update({state:'cancel_requested'})
    .eq('conversation_id',conversation).eq('user_id',user).eq('request_id',request).eq('role','assistant').eq('state','running'); check(error);
}
export async function deleteConversation(user: string,id: string) {
  await ownConversation(user,id);
  // An in-flight lease must not disappear while the provider is still running.
  const {data,error}=await historyDb().from('assistant_messages').select('id').eq('conversation_id',id).eq('user_id',user)
    .in('state',['running','cancel_requested']).gt('deadline_at',new Date().toISOString()).limit(1); check(error);
  if (data?.length) throw new ChatError('ocupado',409);
  const result=await historyDb().rpc('delete_assistant_conversation',{p_user:user,p_conversation:id}); check(result.error);
}
export async function conversationContext(user: string,id: string,currentRequest: string) {
  const messages=await getMessages(user,id);
  const pairs: {question:string;answer:string}[]=[];
  for (const item of messages) {
    if (item.role!=='user' || item.request_id===currentRequest) continue;
    const reply=messages.find(row => row.request_id===item.request_id && row.role==='assistant');
    if (reply && ['concluido','sem_dados','esclarecimento_necessario'].includes(reply.state)) pairs.push({question:item.content,answer:reply.content});
  }
  const recent=pairs.slice(-8);
  while (JSON.stringify(recent).length>24000) recent.shift();
  return recent;
}
export const emptyChatAnswer=(text: string): ChatAnswer => ({text,sources:[],evidence:[],model:CHAT_MODEL});
