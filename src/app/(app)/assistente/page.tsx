'use client';

import { userSafeMessage } from '@/lib/user-feedback';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Input, Modal, Space, Spin, Tooltip, Typography, message } from 'antd';
import { DeleteOutlined, EditOutlined, MenuFoldOutlined, MenuUnfoldOutlined, PlusOutlined, SendOutlined, StopOutlined, LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import Image from 'next/image';
import Link from 'next/link';
import { chatStateLabels, safeAssistantLink, type ChatConversation, type ChatEvent, type ChatMessage, type ChatState } from '@/lib/assistant-chat';
import styles from './page.module.css';

const { Text, Title, Paragraph }=Typography;
const suggestions=['Como foram as vendas nos últimos 7 dias?','Como funciona o preço sugerido?','Como consultar a etapa de uma venda?','Qual a diferença entre estoque físico e disponível?'];
const date=(value:string)=>new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
async function api(path:string, init?:RequestInit){
  const response=await fetch(`/api/assistente/${path}`,{cache:'no-store',...init,headers:{'Content-Type':'application/json',...init?.headers}});
  const data=await response.json(); if(!response.ok)throw new Error(userSafeMessage(data.error,'Não foi possível acessar o Assistente. Tente novamente.')); return data;
}
export default function AssistantPage(){
  const [toast,context]=message.useMessage();
  const [allowed,setAllowed]=useState<boolean|null>(null),[runtime,setRuntime]=useState<ChatState|null>(null);
  const [conversations,setConversations]=useState<ChatConversation[]>([]),[selected,setSelected]=useState<ChatConversation|null>(null);
  const [messages,setMessages]=useState<ChatMessage[]>([]),[search,setSearch]=useState(''),[nextOffset,setNextOffset]=useState<number|null>(null),[nextBefore,setNextBefore]=useState<string|null>(null);
  const [draft,setDraft]=useState(''),[collapsed,setCollapsed]=useState(false),[loading,setLoading]=useState(false),[phase,setPhase]=useState('');
  const [running,setRunning]=useState<{conversationId:string;requestId:string}|null>(null);
  const [sourceMessage,setSourceMessage]=useState<ChatMessage|null>(null),[rename,setRename]=useState<ChatConversation|null>(null),[title,setTitle]=useState('');
  const abort=useRef<AbortController|null>(null),requestSequence=useRef(0),bottom=useRef<HTMLDivElement>(null);
  const reload=useCallback(async()=>{try{const status=await api('status');setAllowed(status.allowed===true);setRuntime(status.state);}catch{setAllowed(false);}},[]);
  const loadList=useCallback(async(offset=0,term=search)=>{
    const data=await api(`conversas?offset=${offset}&search=${encodeURIComponent(term)}`);
    setConversations(old=>offset?[...old,...data.conversations]:data.conversations);setNextOffset(data.nextOffset);
  },[search]);
  useEffect(()=>{void reload();return()=>{abort.current?.abort();};},[reload]);
  useEffect(()=>{if(allowed)void api('conversas').then(data=>{setConversations(data.conversations);setNextOffset(data.nextOffset);}).catch(error=>toast.error(userSafeMessage(error.message,'Não foi possível carregar as conversas. Tente novamente.')));},[allowed,toast]);
  useEffect(()=>{bottom.current?.scrollIntoView({block:'nearest'});},[messages,phase]);
  const openConversation=async(conversation:ChatConversation,older=false)=>{
    if(running&&!older)return;
    const sequence=++requestSequence.current;setLoading(true);
    try{
      const data=await api(`conversas/${conversation.id}${older&&nextBefore?`?before=${encodeURIComponent(nextBefore)}`:''}`);
      if(sequence!==requestSequence.current)return;
      setSelected(data.conversation);setMessages(old=>older?[...data.messages,...old]:data.messages);setNextBefore(data.nextBefore);
    }catch(error){toast.error(userSafeMessage((error as Error).message,'Não foi possível abrir a conversa. Tente novamente.'));}finally{if(sequence===requestSequence.current)setLoading(false);}
  };
  const fresh=()=>{if(running)return;requestSequence.current++;setSelected(null);setMessages([]);setNextBefore(null);setDraft('');};
  const upsert=(entry:ChatMessage)=>setMessages(old=>old.some(item=>item.id===entry.id)?old.map(item=>item.id===entry.id?entry:item):[...old,entry]);
  const send=async()=>{
    if(running||!draft.trim()||runtime)return;
    const question=draft.trim();let conversation=selected,accepted=false;
    const controller=new AbortController();abort.current=controller;setPhase('Abrindo conversa');
    // Disable immediately, including the initial create request.
    const requestId=crypto.randomUUID();setRunning({conversationId:conversation?.id||'',requestId});
    try{
      if(!conversation){const data=await api('conversas',{method:'POST',body:'{}'});conversation=data.conversation;setSelected(conversation);}
      if(!conversation)return;
      setRunning({conversationId:conversation.id,requestId});setDraft('');
      const optimistic:ChatMessage={id:`user-${requestId}`,conversation_id:conversation.id,request_id:requestId,role:'user',content:question,state:'concluido',answer:null,created_at:new Date().toISOString(),deadline_at:null};
      upsert(optimistic);
      const response=await fetch('/api/assistente/mensagens',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
        body:JSON.stringify({conversationId:conversation.id,requestId,question})});
      if(!response.ok){const data=await response.json();throw new Error(data.error||'Falha ao enviar a pergunta.');}
      accepted=true;
      if(response.headers.get('content-type')?.includes('application/json')){const data=await response.json();upsert(data.message);}
      else {
        const reader=response.body?.getReader();if(!reader)throw new Error('Resposta indisponível.');const decoder=new TextDecoder();let buffer='';
        try {while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});
          let line:number;while((line=buffer.indexOf('\n'))>=0){const raw=buffer.slice(0,line);buffer=buffer.slice(line+1);if(!raw)continue;
            const event=JSON.parse(raw) as ChatEvent;
            if(event.type==='phase')setPhase(event.phase);
            if(event.type==='message')upsert(event.message);
            if(event.type==='error')toast.warning(chatStateLabels[event.state]);
          }
        }}finally{reader.releaseLock();}
      }
    }catch(error){if(!accepted)setDraft(question);if(!controller.signal.aborted)toast.error(userSafeMessage((error as Error).message,'Não foi possível enviar a pergunta. Tente novamente.'));}
    finally{
      abort.current=null;setRunning(null);setPhase('');
      if(conversation){try{const data=await api(`conversas/${conversation.id}`);setMessages(data.messages);setSelected(data.conversation);setNextBefore(data.nextBefore);}catch{toast.warning('Não foi possível atualizar o histórico. Use Atualizar; o envio não será repetido.');}}
      void loadList().catch(()=>{});
    }
  };
  const stop=async(request=running)=>{
    if(!request?.conversationId)return;
    try{await api('cancelar',{method:'POST',body:JSON.stringify(request)});setPhase('Interrompendo resposta');
      if(!running&&selected)await openConversation(selected);
    }
    catch(error){toast.error(userSafeMessage((error as Error).message,'Não foi possível interromper a resposta. Tente novamente.'));}
  };
  const remove=(conversation:ChatConversation)=>Modal.confirm({title:'Excluir esta conversa?',content:'As mensagens serão removidas do histórico do ERP. Esta ação não apaga eventuais backups nem dados retidos pelo provedor.',okText:'Excluir',cancelText:'Voltar',okButtonProps:{danger:true},
    onOk:async()=>{await api(`conversas/${conversation.id}`,{method:'DELETE',body:'{}'});if(selected?.id===conversation.id)fresh();await loadList();}});

  if(allowed===null)return <Spin tip="Carregando Assistente"><div style={{height:200}}/></Spin>;
  if(!allowed)return <Alert type="info" showIcon message="Assistente ainda não liberado" description="Esta função será disponibilizada depois da validação operacional." action={<Button onClick={reload}>Atualizar</Button>}/>;
  const activeStored=messages.find(item=>item.role==='assistant'&&['running','cancel_requested'].includes(item.state));
  return <section className={styles.page}>
    {context}
    <header className={styles.header}>
      <div><Title level={2} className={styles.title}>Assistente Bentevi</Title><Text type="secondary">Entenda os resultados e consulte as operações, com fontes.</Text></div>
      <Space><Text className={styles.mode}>Somente consulta</Text><Tooltip title="Atualizar disponibilidade e histórico"><Button icon={<ReloadOutlined/>} disabled={!!running} onClick={()=>{void reload();if(selected)void openConversation(selected);void loadList();}}/></Tooltip></Space>
    </header>
    {runtime&&<Alert type="info" showIcon message={chatStateLabels[runtime]} description="O histórico continua acessível. Conexão e habilitação serão verificadas antes do teste operacional."/>}
    <div className={`${styles.workspace} ${collapsed?styles.collapsed:''}`}>
      {!collapsed&&<aside className={styles.history} aria-label="Histórico de conversas">
        <Button type="primary" icon={<PlusOutlined/>} block disabled={!!running} onClick={fresh}>Nova conversa</Button>
        <Input.Search aria-label="Buscar conversas pelo título" placeholder="Buscar conversas" value={search} onChange={event=>setSearch(event.target.value)} onSearch={()=>void loadList().catch(error=>toast.error(userSafeMessage(error.message,'Não foi possível buscar as conversas. Tente novamente.')))} allowClear/>
        <div className={styles.conversations}>
          {!conversations.length&&<Text type="secondary">Suas conversas aparecerão aqui.</Text>}
          {conversations.map(conversation=><div key={conversation.id} className={`${styles.conversation} ${selected?.id===conversation.id?styles.selected:''}`}>
            <button className={styles.conversationTitle} disabled={!!running} onClick={()=>void openConversation(conversation)}><span>{conversation.title}</span><small>{date(conversation.updated_at)}</small></button>
            <div className={styles.conversationActions}><Button type="text" size="small" aria-label="Renomear conversa" icon={<EditOutlined/>} disabled={!!running} onClick={()=>{setRename(conversation);setTitle(conversation.title);}}/><Button type="text" size="small" aria-label="Excluir conversa" icon={<DeleteOutlined/>} disabled={!!running} onClick={()=>remove(conversation)}/></div>
          </div>)}
          {nextOffset!==null&&<Button type="link" onClick={()=>void loadList(nextOffset)}>Carregar mais conversas</Button>}
        </div>
        <Text type="secondary" className={styles.retention}>Histórico privado, mantido até você excluir.</Text>
      </aside>}
      <main className={styles.chat}>
        <div className={styles.chatHeader}><Button type="text" aria-label={collapsed?'Mostrar histórico':'Recolher histórico'} icon={collapsed?<MenuUnfoldOutlined/>:<MenuFoldOutlined/>} onClick={()=>setCollapsed(!collapsed)}/><Text ellipsis>{selected?.title||'Nova conversa'}</Text><Text type="secondary" className={styles.model}>gpt-6-astra</Text></div>
        <div className={styles.messages} aria-live="polite" aria-busy={!!running}>
          {loading?<Spin/>:!messages.length?<div className={styles.welcome}>
            <Image src="/branding/bentevi/bentevi-mark.png" alt="" width={64} height={64} style={{objectFit:'contain'}}/>
            <Title level={3}>O que você quer entender hoje?</Title>
            <Paragraph type="secondary">Pergunte sobre vendas, estoque, preços e regras da Bentevi.<br/>Para consultar um registro, informe o SKU, ID da venda, Pack ou pedido DSLite.</Paragraph>
            <div className={styles.suggestions}>{suggestions.map(question=><button key={question} onClick={()=>setDraft(question)}>{question}<span>↗</span></button>)}</div>
          </div>:<>
            {nextBefore&&<Button type="link" onClick={()=>selected&&void openConversation(selected,true)}>Carregar mensagens anteriores</Button>}
            {messages.map(item=><article key={item.id} className={item.role==='user'?styles.userMessage:styles.assistantMessage}>
              <div className={styles.messageAuthor}>{item.role==='user'?'Você':'Bentevi'}<time>{date(item.created_at)}</time></div>
              {item.content?<Paragraph className={styles.messageContent}>{item.content}</Paragraph>:<Text type="secondary">{chatStateLabels[item.state]}</Text>}
              {item.answer&&<Space wrap className={styles.answerMeta}>
                {!!item.answer.sources.length&&<Button type="link" size="small" icon={<LinkOutlined/>} onClick={()=>setSourceMessage(item)}>Fontes e detalhes ({item.answer.sources.length})</Button>}
                {item.answer.evidence.some(e=>e.includesFixtures)&&<Text type="warning">Contém dados de exemplo</Text>}
                {item.answer.evidence.some(e=>e.coverage!=='completa')&&<Text type="secondary">Cobertura limitada — veja as fontes</Text>}
              </Space>}
              {item.role==='assistant'&&['running','cancel_requested'].includes(item.state)&&!running&&<Button size="small" icon={<StopOutlined/>} onClick={()=>void stop({conversationId:item.conversation_id,requestId:item.request_id})}>Interromper</Button>}
            </article>)}
          </>}
          {running&&<div className={styles.progress}><Spin size="small"/><Text type="secondary">{phase}</Text></div>}
          <div ref={bottom}/>
        </div>
        <form className={styles.composer} onSubmit={event=>{event.preventDefault();void send();}}>
          <Input.TextArea aria-label="Sua pergunta" placeholder="Pergunte sobre a Bentevi…" value={draft} maxLength={4000} autoSize={{minRows:2,maxRows:6}}
            disabled={!!running||!!runtime||!!activeStored} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}}/>
          <div className={styles.composerFooter}><Text type="secondary">Somente leitura. Não envie senhas ou dados pessoais.</Text>{running?<Button icon={<StopOutlined/>} onClick={()=>void stop()}>Parar</Button>:<Button type="primary" htmlType="submit" icon={<SendOutlined/>} disabled={!draft.trim()||!!runtime||!!activeStored}>Enviar</Button>}</div>
        </form>
      </main>
    </div>
    <Modal title="Renomear conversa" open={!!rename} onCancel={()=>setRename(null)} okText="Salvar" cancelText="Voltar" onOk={async()=>{if(rename){await api(`conversas/${rename.id}`,{method:'PATCH',body:JSON.stringify({title})});if(selected?.id===rename.id)setSelected({...selected,title});setRename(null);await loadList();}}}><Input aria-label="Título da conversa" value={title} maxLength={100} onChange={event=>setTitle(event.target.value)}/></Modal>
    <Drawer title="Fontes e contexto da resposta" open={!!sourceMessage} onClose={()=>setSourceMessage(null)} width={650}>
      <Paragraph type="secondary">Fotografia da consulta original. Abrir o registro mostra seu estado atual; o histórico não é recalculado.</Paragraph>
      {sourceMessage?.answer?.evidence.map((e,index)=><section key={index} className={styles.source}>
        <Text strong>Consulta {index+1} · {e.query?.kind}</Text><Paragraph>Consultado em {date(e.queriedAt)}<br/>Atualização da fonte: {e.sourceUpdatedAt?date(e.sourceUpdatedAt):'não comprovada'}<br/>Cobertura: {e.coverage}</Paragraph>
        {e.period&&<Paragraph>Período: {date(e.period.start)} a {date(e.period.end)} · {e.period.timezone}</Paragraph>}
        {e.warnings.map(warning=><Paragraph key={warning} type="secondary">{warning}</Paragraph>)}
      </section>)}
      {sourceMessage?.answer?.sources.map(source=><section key={source.id} className={styles.source}><Title level={5}>{source.label}</Title>
        {safeAssistantLink(source.path)&&<Link href={source.path}>Abrir registro no ERP ↗</Link>}
        {source.excerpt&&<><Paragraph type="secondary">Autoridade: {source.authority} · versão {source.version?.slice(0,12)}</Paragraph><pre className={styles.excerpt}>{source.excerpt}</pre></>}
      </section>)}
    </Drawer>
  </section>;
}
