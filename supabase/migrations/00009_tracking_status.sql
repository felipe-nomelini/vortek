-- Adicionar novos status de pedido para rastreamento ML
ALTER TYPE pedido_status ADD VALUE IF NOT EXISTS 'pendente';
ALTER TYPE pedido_status ADD VALUE IF NOT EXISTS 'preparando';
ALTER TYPE pedido_status ADD VALUE IF NOT EXISTS 'etiqueta_impressa';
ALTER TYPE pedido_status ADD VALUE IF NOT EXISTS 'coletado';
ALTER TYPE pedido_status ADD VALUE IF NOT EXISTS 'em_transito';
ALTER TYPE pedido_status ADD VALUE IF NOT EXISTS 'saiu_entrega';
ALTER TYPE pedido_status ADD VALUE IF NOT EXISTS 'dest_ausente';
ALTER TYPE pedido_status ADD VALUE IF NOT EXISTS 'recusado';

-- Adicionar colunas para rastreamento e reclamacoes ML
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS ml_shipment_id TEXT,
  ADD COLUMN IF NOT EXISTS ml_claim_id TEXT,
  ADD COLUMN IF NOT EXISTS ml_claim_status TEXT;

-- Criar indice para busca rapida por shipment_id
CREATE INDEX IF NOT EXISTS idx_pedidos_ml_shipment_id ON public.pedidos(ml_shipment_id);

-- Criar indice para busca rapida por claim_id
CREATE INDEX IF NOT EXISTS idx_pedidos_ml_claim_id ON public.pedidos(ml_claim_id);
