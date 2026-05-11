import { BrasilNFe } from 'brasilnfe';
import { createServiceClient } from '@/lib/supabase';

interface NFeConfig {
  token: string;
  ambiente: number;
}

async function getConfig(): Promise<NFeConfig | null> {
  const client = createServiceClient();
  const { data } = await client
    .from('integracoes')
    .select('access_token, client_id')
    .eq('tipo', 'brasilnfe')
    .single();
  if (!data?.access_token) return null;
  return { token: data.access_token, ambiente: data.client_id === 'producao' ? 1 : 2 };
}

function getApi(token: string) {
  return new BrasilNFe(token);
}

export interface EmitirNFeInput {
  cliente: {
    cpfCnpj: string;
    nome: string;
    ie?: string;
    endereco?: {
      logradouro: string;
      numero: string;
      complemento?: string;
      bairro: string;
      municipio: string;
      uf: string;
      cep: string;
    };
    telefone?: string;
    email?: string;
  };
  naturezaOperacao?: string;
  produtos: Array<{
    nome: string;
    ncm: string;
    cfop: number;
    quantidade: number;
    valorUnitario: number;
    gtin?: string;
    unidade?: string;
  }>;
  frete?: number;
  tipoDocumento?: number;
  finalidade?: number;
}

export interface NFeRetorno {
  success: boolean;
  chave?: string;
  numero?: number;
  serie?: number;
  xml?: string;
  danfe?: string;
  protocolo?: string;
  mensagem?: string;
  codStatus?: number;
}

export async function emitirNFe(input: EmitirNFeInput): Promise<NFeRetorno> {
  const cfg = await getConfig();
  if (!cfg) return { success: false, mensagem: 'Brasil NFe não configurado' };

  try {
    const api = getApi(cfg.token);
    const result = await api.notaFiscal.enviarNotaFiscal({
      ModeloDocumento: input.tipoDocumento || 55,
      NaturezaOperacao: input.naturezaOperacao || 'Venda de Mercadoria',
      TipoAmbiente: cfg.ambiente,
      Finalidade: input.finalidade || 1,
      Cliente: {
        CpfCnpj: input.cliente.cpfCnpj,
        NmCliente: input.cliente.nome,
        Ie: input.cliente.ie || '',
        Endereco: input.cliente.endereco
          ? {
              Logradouro: input.cliente.endereco.logradouro,
              Numero: input.cliente.endereco.numero,
              Complemento: input.cliente.endereco.complemento,
              Bairro: input.cliente.endereco.bairro,
              Municipio: input.cliente.endereco.municipio,
              Uf: input.cliente.endereco.uf,
              Cep: input.cliente.endereco.cep,
            }
          : undefined,
        Contato: {
          Telefone: input.cliente.telefone,
          Email: input.cliente.email,
        },
      },
      Produtos: input.produtos.map((p) => ({
        NmProduto: p.nome,
        NCM: p.ncm,
        CFOP: p.cfop,
        Quantidade: p.quantidade,
        ValorUnitario: p.valorUnitario,
        EAN: p.gtin || '',
        UnidadeComercial: p.unidade || 'UN',
      })),
      Transporte: input.frete
        ? { ModalidadeFrete: input.frete > 0 ? 0 : 9 }
        : undefined,
    });

    const retorno = result.ReturnNF;
    if (retorno?.Ok) {
      return {
        success: true,
        chave: retorno.ChaveNF,
        numero: retorno.Numero,
        serie: retorno.Serie,
        xml: result.Base64Xml,
        danfe: result.Base64File,
        protocolo: String(retorno.CodStatusRespostaSefaz),
        codStatus: retorno.CodStatusRespostaSefaz,
      };
    }

    return {
      success: false,
      mensagem: retorno?.DsStatusRespostaSefaz || 'Erro desconhecido',
      codStatus: retorno?.CodStatusRespostaSefaz,
    };
  } catch (err: any) {
    return { success: false, mensagem: err?.message || 'Erro ao emitir NF-e' };
  }
}

export interface CancelarNFeInput {
  chave: string;
  motivo: string;
}

export async function cancelarNFe(input: CancelarNFeInput): Promise<NFeRetorno> {
  const cfg = await getConfig();
  if (!cfg) return { success: false, mensagem: 'Brasil NFe não configurado' };

  try {
    const api = getApi(cfg.token);
    const result = await api.eventos.cancelarNotaFiscal({
      ChaveNF: input.chave,
      Justificativa: input.motivo,
      TipoDocumento: 0,
    });

    if (result?.DsEvento) {
      return {
        success: true,
        protocolo: result.NuProtocolo,
        mensagem: result.DsEvento,
      };
    }

    return { success: false, mensagem: result?.DsMotivo || 'Erro ao cancelar NF-e' };
  } catch (err: any) {
    return { success: false, mensagem: err?.message || 'Erro ao cancelar NF-e' };
  }
}

export interface ConsultarNFeInput {
  chave: string;
}

export async function consultarNFe(input: ConsultarNFeInput): Promise<NFeRetorno & { status?: string }> {
  const cfg = await getConfig();
  if (!cfg) return { success: false, mensagem: 'Brasil NFe não configurado' };

  try {
    const api = getApi(cfg.token);
    const result = await api.consultas.buscarNotaFiscal({
      TipoDocumentoFiscal: 1,
    } as any);

    return { success: false, mensagem: 'consultaNFe retornou sem resultado específico' };
  } catch (err: any) {
    return { success: false, mensagem: err?.message || 'Erro ao consultar NF-e' };
  }
}

export async function statusSEFAZ(): Promise<{ online: boolean; mensagem?: string }> {
  const cfg = await getConfig();
  if (!cfg) return { online: false, mensagem: 'Brasil NFe não configurado' };

  try {
    const api = getApi(cfg.token);
    const result = await api.consultas.consultarStatusSefaz({
      TipoAmbiente: cfg.ambiente,
    });

    return {
      online: result?.StatusSefaz?.CodStatusRespostaSefaz === 100,
      mensagem: result?.StatusSefaz?.DsStatusRespostaSefaz || 'Indisponível',
    };
  } catch (err: any) {
    return { online: false, mensagem: err?.message };
  }
}
