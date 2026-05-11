import { NotaFiscalLoteEnvio } from './NotaFiscalEnvio';
export interface PreVisualizarNotaFiscalEnvio {
    notaFiscal?: NotaFiscalLoteEnvio;
    Base64Xml?: string;
    /**
     * Tipo do arquivo que deseja pré-visualizar (Padrão - 0)
     * 0 - XML
     * 1 - PDF
     */
    TipoArquivo?: number;
    /**
     * Tipo do envio no qual será convertido para o tipo do arquivo informado (Padrão - 0)
     * 0 - Base64 contendo as informações do XML
     * 1 - Objeto contendo as informações das notas fiscais
     */
    TipoEnvio?: number;
    /**
     * Mostrar tarja "SEM VALOR FISCAL - PRÉ-VISUALIZAÇÃO" (Padrão - Verdadeiro)
     * Somente para o tipo de arquivo 1 - PDF
     */
    mostrarTarjaPreVisualizacao?: boolean;
}
