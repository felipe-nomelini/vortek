# Pacote de auditoria do Cânon Comercial

Comece por 00_RESUMO_EXECUTIVO.md. Filas CSV usam UTF-8 com BOM e podem ser abertas no Excel. 04/05 são garantia/atacado; 06 é rastreabilidade de preço; 11 contém economia e pendências após a migração.

Evidências volumosas estão em JSON.gz, sem perda de dados. archives.json registra os hashes do conteúdo original; manifest.json registra os arquivos entregues. Para repetir o reprocessamento pontual a partir deste universo, extraia audit-existing.json.gz para audit-existing.json antes de executar o script. O script exige --apply para persistir memórias; nunca altera anúncio remoto.

Nenhuma fila deste pacote constitui autorização remota. A próxima etapa exige autorização específica sobre os itens revisados.

Valores monetários estão em reais. Margens e alíquotas nos CSVs são frações: 0,05 representa 5%. Uma economia estimada conserva o status fiscal estimated; não equivale a confirmação tributária.
