// Isolated browser smoke: real component, synthetic transport, no database/ML.
// Use existing development tooling via ESBUILD_MODULE / PLAYWRIGHT_MODULE.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { build } = require(process.env.ESBUILD_MODULE || 'esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const id = '00000000-0000-4000-8000-000000000013';
  const now = new Date().toISOString();
  const memory = { revenueCents: 11000, resultCents: 1100, margin: .1,
    cost: { amountCents: 7000 }, fee: { amountCents: 1650, source: 'ml_live' },
    shipping: { amountCents: 810, source: 'ml_live' }, tax: { amountCents: 440, status: 'estimated' },
    band: { floor: .05, target: .07, limit: .1 } };
  const pricing = { currentPriceCents: 11000, costCents: 7000, current: { status: 'estimated', memory, reasons: [] },
    ...Object.fromEntries(['target','floor','breakEven'].map(k=>[k,{ok:true,evaluation:{memory}}])),
    revalidation: { status: 'queried', evaluatedAt: now } };
  const decision = { id, state: 'pending', created_at: now, expires_at: new Date(Date.now()+900000).toISOString(), deferred_until: null,
    context: { previousPriceCents: 10000, priceCents: 11000, executable: true, reasons: [], groupId: id }, reason: 'Cenário sintético' };
  const alert = { id, produto_id: id, title: 'Proposta de preço aguardando decisão', reason: 'Recomposição — exemplo sintético',
    severity:'P1', state:'open', item_id:'MLB990130001', group_id:id, created_at:now,
    product:{nome:'Produto demonstrativo — não comercial',sku:'TEST-V2-13'}, decisions:[decision] };
  let canManage = true;
  const commands = [];
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader:'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {App,ConfigProvider,theme} from 'antd';
    import Center from './src/components/products/PricingDecisionCenter';
    createRoot(document.getElementById('root')!).render(<ConfigProvider theme={{algorithm:theme.darkAlgorithm,token:{colorPrimary:'#ffc400'}}}><App><h2>Cenário sintético · V2-13</h2><Center/></App></ConfigProvider>);
  ` }, bundle:true, write:false, platform:'browser', format:'iife', define:{'process.env.NODE_ENV':'"production"'}, tsconfig:path.resolve('tsconfig.json') });
  const server = http.createServer(async (req,res) => {
    if(req.url==='/bundle.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].text);return;}
    if(req.url.startsWith('/api/')) {
      res.setHeader('Content-Type','application/json');
      if(req.method==='POST') {
        const chunks=[];for await(const chunk of req) chunks.push(chunk);
        const body=JSON.parse(Buffer.concat(chunks));commands.push(body);
        if(body.command) decision.state={approve:'approved',reject:'rejected',defer:'deferred'}[body.command.action];
        res.end(JSON.stringify({state:decision.state,executionBlocked:true}));return;
      }
      res.end(JSON.stringify(req.url.includes('alertId=')?{ alert, evaluation:{result:pricing}, history:[{id:1,kind:'decision_created',actorName:'Operador de teste',reason:'Cenário sintético',created_at:now}],hasMore:false,canManage }
        :{data:[alert],total:1,pendingCount:1,canManage}));return;
    }
    res.setHeader('Content-Type','text/html');res.end('<html lang="pt-BR"><meta charset="utf-8"><body style="background:#111;color:white;padding:24px"><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    await page.goto(origin);
    await page.getByRole('button',{name:/Alertas e decisões/}).click();
    await page.getByRole('button',{name:'Ver decisão'}).click();
    await page.getByRole('button',{name:'Aprovar proposta',exact:true}).waitFor();
    await page.screenshot({path:'/tmp/bnt-v2-13-decision.png',fullPage:true});
    await page.getByRole('button',{name:'Aprovar proposta',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Registrar decisão'}).isDisabled(),true);
    await page.getByRole('textbox',{name:'Motivo da decisão'}).fill('Teste de confirmação humana');
    await page.getByRole('button',{name:'Registrar decisão'}).click();
    await page.getByText('Aprovado — aplicação bloqueada pelo gate',{exact:true}).first().waitFor();
    assert.equal(commands.length,1);assert.equal(commands[0].command.action,'approve');
    assert.match(commands[0].command.commandId,/^[0-9a-f-]{36}$/);
    assert.equal(await page.getByRole('button',{name:'Aprovar proposta',exact:true}).count(),0);
    await page.screenshot({path:'/tmp/bnt-v2-13-approved.png',fullPage:true});
    canManage=false;decision.state='pending';await page.reload();
    await page.getByRole('button',{name:/Alertas e decisões/}).click();await page.getByRole('button',{name:'Ver decisão'}).click();
    await page.getByText('Seu perfil permite consultar; decisões exigem administrador ou gerente.').waitFor();
    assert.equal(await page.getByRole('button',{name:'Aprovar proposta',exact:true}).count(),0);
    assert.deepEqual(errors,[]);console.log('Browser: leitura, detalhe, motivo obrigatório, aprovação bloqueada, comando único e perfil somente leitura passaram. Rede externa bloqueada.');
  } finally { await browser?.close();await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
