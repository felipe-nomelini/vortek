'use client';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, InputNumber, Select, Space, Typography, message } from 'antd';
export default function CommercialPolicyControls({productId,itemId}:{productId:string;itemId?:string|null}) {
  const [strategies,setStrategies]=useState<any[]>([]),[warranty,setWarranty]=useState<any>(null),[identity,setIdentity]=useState<any>(null);
  const [reason,setReason]=useState(''),[source,setSource]=useState(''),[origin,setOrigin]=useState('FABRICANTE');
  const [duration,setDuration]=useState<number|null>(null),[unit,setUnit]=useState('meses'),[durability,setDurability]=useState('');
  const [untilRevoked,setUntilRevoked]=useState(true),[validUntil,setValidUntil]=useState(''),[minimumPrice,setMinimumPrice]=useState<number|null>(null),[minimumMargin,setMinimumMargin]=useState<number|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function refresh() {
    const p=await fetch(`/api/produtos/${productId}`).then(r=>r.json());
    if(p.error) throw Error(p.error);
    setWarranty(p.data.warranty);setIdentity(p.data);
    const r=await fetch(`/api/pricing/strategy?productId=${productId}`),d=await r.json();
    if(r.ok)setStrategies(d.strategies);else setError(d.error || 'A gestão comercial exige acesso administrativo.');
  }
  useEffect(()=>{void refresh().catch(e=>setError(e.message));},[productId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function write(url:string,method:string,body:any) {
    setBusy(true);setError('');
    try {const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw Error(d.error);await refresh();message.success('Decisão registrada. Nenhum anúncio foi alterado.');}
    catch(e:any){setError(e.message);}finally{setBusy(false);}
  }
  const effectiveItemId=itemId || identity?.ml_item_id_operacional || identity?.ml_item_id;
  function strategy(kind:string,action='register',strategyId?:string) {
    return write('/api/pricing/strategy','POST',{productId,itemId:effectiveItemId,reason,kind,action,strategyId,untilRevoked,validUntil:untilRevoked?null:(validUntil?new Date(validUntil).toISOString():null),minimumPrice,minimumMargin:minimumMargin===null?null:minimumMargin/100});
  }
  const protection=strategies.find(s=>s.payload.kind==='manual_pricing_override');
  function saveWarranty() {
    const subject={productId,gtin:identity?.gtin || null,source,observedAt:new Date().toISOString()};
    const evidence=origin==='GARANTIA_LEGAL'?[]:[{...subject,origin,duration,unit,offerId:origin==='GARANTIA_FORNECEDOR'?identity?.warrantyOfferId:null}];
    const classification=origin==='GARANTIA_LEGAL'?{...subject,kind:durability}:null;
    return write(`/api/produtos/${productId}`,'PATCH',{reason,warrantyEvidence:{evidence,durability:classification}});
  }
  return <Card title="Políticas comerciais" style={{marginBottom:16}}><Space direction="vertical" style={{width:'100%'}}>
    {error&&<Alert type="error" message={error}/>}
    <Input.TextArea value={reason} onChange={e=>setReason(e.target.value)} placeholder="Motivo / autorização da decisão"/>
    <Typography.Text>Não alterar meu preço automaticamente: {protection?'proteção ligada até revogação':'proteção desligada'}. Editar o preço não liga esta proteção.</Typography.Text>
    <Button loading={busy} disabled={!effectiveItemId||!reason.trim()} onClick={()=>strategy('manual_pricing_override',protection?'revoke':'register',protection?.id)}>{protection?'Desligar proteção':'Ligar proteção'}</Button>
    <Typography.Text strong>Liquidação autorizada</Typography.Text>
    <Space wrap><Select value={untilRevoked} onChange={setUntilRevoked} options={[{value:true,label:'Até revogação'},{value:false,label:'Até a data autorizada'}]}/>{!untilRevoked&&<Input type="datetime-local" value={validUntil} onChange={e=>setValidUntil(e.target.value)}/>}<InputNumber placeholder="Preço mínimo R$" value={minimumPrice} onChange={setMinimumPrice}/><InputNumber placeholder="Margem mínima %" value={minimumMargin} onChange={setMinimumMargin}/><Button disabled={!effectiveItemId||!reason.trim()||busy} onClick={()=>strategy('clearance')}>Registrar autorização</Button></Space>
    {strategies.filter(s=>s.payload.kind!=='manual_pricing_override').map(s=><Space key={s.id}><Typography.Text>{s.payload.kind==='clearance'?'Liquidação':'Estratégia'}: {s.payload.untilRevoked?'até revogação':s.payload.validUntil}</Typography.Text><Button disabled={!reason.trim()||busy} onClick={()=>strategy(s.payload.kind,'revoke',s.id)}>Revogar</Button></Space>)}
    <Typography.Text strong>Garantia do produto</Typography.Text>
    <Typography.Text>{warranty?.resolution?.status==='resolved'?`${warranty.resolution.origin}: ${warranty.resolution.duration} ${warranty.resolution.unit}. Fonte: ${warranty.resolution.source}`:'Pendente: registrar evidência de garantia ou classificação para garantia legal.'}</Typography.Text>
    <Select value={origin} onChange={setOrigin} options={[{value:'FABRICANTE',label:'Fabricante comprovado'},{value:'GARANTIA_FORNECEDOR',label:'Fornecedor comprovado'},{value:'GARANTIA_LEGAL',label:'Garantia legal (sem evidência contratual)'}]}/>
    {origin==='GARANTIA_LEGAL'?<Select placeholder="Classificação comprovada" value={durability || undefined} onChange={setDurability} options={[{value:'durable',label:'Produto durável — 90 dias'},{value:'non_durable',label:'Produto não durável — 30 dias'}]}/>:<Space><InputNumber min={1} precision={0} value={duration} onChange={setDuration} placeholder="Prazo comprovado"/><Select value={unit} onChange={setUnit} options={['dias','meses','anos'].map(v=>({value:v,label:v}))}/></Space>}
    <Input value={source} onChange={e=>setSource(e.target.value)} placeholder="Fonte / documento e evidência específica deste produto"/>
    <Button disabled={busy||!reason.trim()||!source.trim()||(origin!=='GARANTIA_LEGAL'&&!duration)||(origin==='GARANTIA_LEGAL'&&!durability)} onClick={saveWarranty}>Registrar evidência revisada</Button>
  </Space></Card>;
}
