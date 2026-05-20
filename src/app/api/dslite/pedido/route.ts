import { NextResponse } from 'next/server';
import {
  criarPedidoDropshipping,
  buscarProdutoPorSku,
  informarFornecedorPedido,
  consultarPedidoPorChaveAcesso,
  definirTransportadoraPedido,
  enviarEtiqueta,
} from '@/services/dslite';
import { buscarXmlDaNF, baixarEtiquetaML } from '@/services/integration';
import { createServiceClient } from '@/lib/supabase';

const TRANSPORTADORA_PADRAO_CORREIOS = 31;

function extrairSkuDoXml(xml: string): string | null {
  try {
    // Extrai cProd do XML (SKU com prefixo, ex: HYX84825)
    const match = xml.match(/<cProd>([^<]+)<\/cProd>/);
    if (match) {
      const sku = match[1].trim();
      console.log(`[dslite-pedido] SKU extraído do XML: ${sku}`);
      return sku;
    }
  } catch (e) {}
  return null;
}

function removerPrefixoSku(sku: string): string {
  // Remove prefixo alfabético (ex: HYX84825 → 84825)
  const semPrefixo = sku.replace(/^[A-Za-z]+/, '');
  console.log(`[dslite-pedido] SKU sem prefixo: ${semPrefixo}`);
  return semPrefixo;
}

function extrairChaveAcessoDoXml(xml: string): string | null {
  try {
    const match = xml.match(/<chNFe>([^<]+)<\/chNFe>/);
    if (match) {
      const chave = match[1].trim();
      console.log(`[dslite-pedido] Chave de acesso extraída do XML: ${chave}`);
      return chave;
    }
  } catch (e) {}
  return null;
}

export async function POST(req: Request) {
  try {
    const { pedidoId, mlOrderId } = await req.json();

    if (!pedidoId) {
      return NextResponse.json({ error: 'pedidoId é obrigatório' }, { status: 400 });
    }

    const client = createServiceClient();
    let xml: string | null = null;

    // 1. Busca XML no banco
    if (mlOrderId) {
      const { data: pedido } = await client
        .from('pedidos')
        .select('nfe_xml')
        .eq('ml_order_id', String(mlOrderId))
        .maybeSingle();
      if (pedido?.nfe_xml) xml = pedido.nfe_xml;
    }

    if (!xml && pedidoId) {
      const { data: pedido } = await client
        .from('pedidos')
        .select('nfe_xml')
        .eq('id', pedidoId)
        .maybeSingle();
      if (pedido?.nfe_xml) xml = pedido.nfe_xml;
    }

    // 2. Se não encontrou no banco, busca no ML
    if (!xml && mlOrderId) {
      const result = await buscarXmlDaNF(String(mlOrderId));
      if (result.xml) {
        xml = result.xml;
        await client
          .from('pedidos')
          .update({ nfe_xml: result.xml })
          .eq('ml_order_id', String(mlOrderId));
      } else {
        return NextResponse.json({ error: result.error || 'XML da NF-e não encontrado' }, { status: 400 });
      }
    }

    if (!xml) {
      return NextResponse.json({ error: 'XML da NF-e não encontrado. Emita a NF no ML primeiro.' }, { status: 400 });
    }

    // 3. Extrai chave de acesso e verifica duplicidade
    const chaveAcesso = extrairChaveAcessoDoXml(xml);
    if (chaveAcesso) {
      const existente = await consultarPedidoPorChaveAcesso(chaveAcesso);
      if (existente) {
        const statusMsg = existente.cancelado ? 'cancelado' : 'ativo';
        return NextResponse.json({
          error: `Já existe pedido DSLite ${statusMsg} para esta nota fiscal (dsid: ${existente.dsid}). A DSLite não permite criar outro pedido para a mesma NF-e. Cancele a NF-e atual no ML e emita uma nova.`,
          data: { dsid: existente.dsid, status: existente.status },
        }, { status: 409 });
      }
    }

    // 4. Extrai SKU do XML
    const skuComPrefixo = extrairSkuDoXml(xml);
    if (!skuComPrefixo) {
      return NextResponse.json({ error: 'Não foi possível extrair o SKU do XML da NF-e' }, { status: 400 });
    }

    // 5. Busca produto no banco local para obter fornecedor correto
    console.log(`[dslite-pedido] Buscando produto no banco local (sku=${skuComPrefixo})`);
    const { data: produtoLocal } = await client
      .from('produtos')
      .select('dslite_fornecedor_id, dslite_produto_id')
      .eq('sku', skuComPrefixo)
      .maybeSingle();

    if (!produtoLocal?.dslite_fornecedor_id) {
      return NextResponse.json({
        error: `Produto com SKU ${skuComPrefixo} não encontrado no banco local ou não mapeado para fornecedor DSLite. Sincronize o catálogo DSLite primeiro.`,
      }, { status: 400 });
    }

    const fornecedorId = produtoLocal.dslite_fornecedor_id;
    console.log(`[dslite-pedido] Fornecedor identificado pelo banco local: ${fornecedorId}`);

    // 6. Busca produto no catálogo DSLite
    const skuSemPrefixo = removerPrefixoSku(skuComPrefixo);
    console.log(`[dslite-pedido] Buscando produto no catálogo DSLite (fornecedor=${fornecedorId}, sku=${skuSemPrefixo})`);
    const produto = await buscarProdutoPorSku(fornecedorId, skuSemPrefixo);

    if (!produto) {
      return NextResponse.json({
        error: `Produto não encontrado no catálogo DSLite. SKU: ${skuSemPrefixo} (extraído do XML: ${skuComPrefixo}). Verifique se o produto está cadastrado no fornecedor ${fornecedorId}.`
      }, { status: 400 });
    }

    console.log(`[dslite-pedido] Produto encontrado: produtoid=${produto.produtoid}, produtoid_empresa=${produto.produtoid_empresa}, titulo=${produto.titulo}`);

    // 6. Cria pedido DSLite
    console.log(`[dslite-pedido] Criando pedido DSLite via XML da NF-e`);
    const pedidoResult = await criarPedidoDropshipping(xml);

    if (!pedidoResult) {
      return NextResponse.json({ error: 'Falha ao criar pedido na DSLite' }, { status: 502 });
    }

    console.log(`[dslite-pedido] Pedido criado:`, JSON.stringify(pedidoResult, null, 2));

    const dsid = pedidoResult.dsid;
    if (!dsid) {
      return NextResponse.json({ error: 'Pedido criado mas sem ID (dsid) retornado', data: pedidoResult }, { status: 502 });
    }

    // Valida se o pedido não veio cancelado
    if (pedidoResult.status?.toLowerCase().includes('cancelado')) {
      return NextResponse.json({
        error: `O DSLite retornou um pedido com status Cancelado (dsid: ${dsid}). A DSLite não permite criar outro pedido para esta nota fiscal. Cancele a NF-e atual no ML e emita uma nova.`,
        data: { dsid, status: pedidoResult.status },
      }, { status: 409 });
    }

    // 7. Informa fornecedor para o pedido
    const pendencias: string[] = [];

    console.log(`[dslite-pedido] Informando fornecedor ${fornecedorId} para o pedido ${dsid}`);
    const fornecedorResult = await informarFornecedorPedido(dsid, fornecedorId);
    const fornecedorStepStatus: 'success' | 'warning' = fornecedorResult?.success ? 'success' : 'warning';
    const fornecedorStepMessage = fornecedorResult?.success
      ? 'Fornecedor vinculado com sucesso'
      : (fornecedorResult?.message || 'Falha ao informar fornecedor');

    if (!fornecedorResult?.success) {
      console.error(`[dslite-pedido] Erro ao informar fornecedor:`, fornecedorResult?.message);
      pendencias.push(`Fornecedor: ${fornecedorStepMessage}`);
    } else {
      console.log(`[dslite-pedido] Fornecedor informado com sucesso:`, JSON.stringify(fornecedorResult.data, null, 2));
    }

    // 8. Define transportadora padrão
    let transportadoraStatus: 'success' | 'error' = 'success';
    let transportadoraMessage = 'Transportadora Correios definida com sucesso';
    console.log(`[dslite-pedido] Definindo transportadora padrão ${TRANSPORTADORA_PADRAO_CORREIOS} para pedido ${dsid}`);
    const transportadoraResult = await definirTransportadoraPedido(dsid, TRANSPORTADORA_PADRAO_CORREIOS);

    if (!transportadoraResult?.success) {
      transportadoraStatus = 'error';
      transportadoraMessage = transportadoraResult?.message || 'Falha ao definir transportadora';
      pendencias.push(`Transportadora: ${transportadoraMessage}`);
      console.error(`[dslite-pedido] Erro ao definir transportadora:`, transportadoraMessage);
    } else {
      console.log(`[dslite-pedido] Transportadora definida com sucesso`);
    }

    // 9. Baixa etiqueta do ML e envia para DSLite (automatizado)
    let etiquetaStatus: 'enviada' | 'nao_disponivel' | 'erro' = 'nao_disponivel';
    let etiquetaError: string | undefined;
    let etiquetaStepMessage = 'Pedido sem envio no ML';

    const { data: pedidoInfo } = await client
      .from('pedidos')
      .select('ml_shipment_id')
      .eq('id', pedidoId)
      .maybeSingle();

    if (pedidoInfo?.ml_shipment_id) {
      console.log(`[dslite-pedido] Baixando etiqueta do ML (shipment=${pedidoInfo.ml_shipment_id})`);
      const etiquetaResult = await baixarEtiquetaML(String(pedidoInfo.ml_shipment_id));

      if (etiquetaResult.pdf) {
        if (transportadoraStatus !== 'success') {
          etiquetaStatus = 'erro';
          etiquetaError = 'Transportadora não definida. Execute "Enviar Etiqueta DSLite" após corrigir.';
          etiquetaStepMessage = etiquetaError;
          pendencias.push(`Etiqueta: ${etiquetaError}`);
          console.error(`[dslite-pedido] Etiqueta não enviada por falta de transportadora definida`);
        } else {
          console.log(`[dslite-pedido] Etiqueta baixada (${etiquetaResult.pdf.length} bytes), enviando para DSLite`);
          const envioEtiqueta = await enviarEtiqueta(dsid, etiquetaResult.pdf, 'etiqueta_ml.pdf');

          if (envioEtiqueta?.success) {
            etiquetaStatus = 'enviada';
            etiquetaStepMessage = 'Etiqueta enviada com sucesso para DSLite';
            console.log(`[dslite-pedido] Etiqueta enviada com sucesso para DSLite`);
          } else {
            etiquetaStatus = 'erro';
            etiquetaError = envioEtiqueta?.message || 'Falha ao enviar etiqueta para DSLite';
            etiquetaStepMessage = etiquetaError;
            pendencias.push(`Etiqueta: ${etiquetaError}`);
            console.error(`[dslite-pedido] Erro ao enviar etiqueta:`, etiquetaError);
          }
        }
      } else {
        etiquetaStatus = 'erro';
        etiquetaError = etiquetaResult.error || 'Etiqueta não disponível no ML';
        etiquetaStepMessage = etiquetaError;
        pendencias.push(`Etiqueta: ${etiquetaError}`);
        console.error(`[dslite-pedido] Não foi possível baixar etiqueta:`, etiquetaError);
      }
    } else {
      console.log(`[dslite-pedido] Pedido sem ml_shipment_id, pulando etiqueta`);
      pendencias.push('Etiqueta: pedido sem ml_shipment_id no Mercado Livre');
    }

    // 10. Atualiza banco
    await client
      .from('pedidos')
      .update({
        dslite_id: String(dsid),
        dslite_status: pedidoResult.status || 'criado',
        nfe_chave: chaveAcesso || undefined,
        dslite_etiqueta_enviada: etiquetaStatus === 'enviada',
      })
      .eq('id', pedidoId);

    return NextResponse.json({
      success: true,
      data: {
        dsid,
        status: pedidoResult.status,
        produto: {
          produtoid: produto.produtoid,
          produtoid_empresa: produto.produtoid_empresa,
          titulo: produto.titulo,
        },
        fornecedorStatus: fornecedorResult?.success ? 'vinculado' : 'pendente',
        fornecedorMessage: fornecedorResult?.message,
        transportadoraStatus,
        transportadoraMessage,
        etiquetaStatus,
        etiquetaError,
        steps: {
          fornecedor: {
            status: fornecedorStepStatus,
            message: fornecedorStepMessage,
          },
          transportadora: {
            status: transportadoraStatus,
            message: transportadoraMessage,
          },
          etiqueta: {
            status: etiquetaStatus === 'enviada' ? 'success' : etiquetaStatus === 'erro' ? 'warning' : 'warning',
            message: etiquetaStepMessage,
          },
        },
        pendencias,
      }
    });
  } catch (err: any) {
    console.error(`[dslite-pedido] Erro inesperado:`, err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
