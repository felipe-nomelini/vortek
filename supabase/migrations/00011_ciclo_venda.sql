-- Adicionar colunas para ciclo de venda completo (NF → ML → DSLite → Etiqueta)

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS ml_invoice_reported boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ml_invoice_id text,
  ADD COLUMN IF NOT EXISTS dslite_etiqueta_enviada boolean DEFAULT false;
