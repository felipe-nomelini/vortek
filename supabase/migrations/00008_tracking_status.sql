-- Adicionar novos status de pedido para rastreamento ML
ALTER TYPE pedido_status ADD VALUE 'pendente';
ALTER TYPE pedido_status ADD VALUE 'preparando';
ALTER TYPE pedido_status ADD VALUE 'etiqueta_impressa';
ALTER TYPE pedido_status ADD VALUE 'coletado';
ALTER TYPE pedido_status ADD VALUE 'em_transito';
ALTER TYPE pedido_status ADD VALUE 'saiu_entrega';
ALTER TYPE pedido_status ADD VALUE 'dest_ausente';
ALTER TYPE pedido_status ADD VALUE 'recusado';

-- Adicionar colunas para rastreamento e reclamacoes ML
ALTER TABLE public.pedidos
  ADD COLUMN ml_shipment_id TEXT,
  ADD COLUMN ml_claim_id TEXT,
  ADD COLUMN ml_claim_status TEXT;

-- Criar indice para busca rapida por shipment_id
CREATE INDEX idx_pedidos_ml_shipment_id ON public.pedidos(ml_shipment_id);

-- Criar indice para busca rapida por claim_id
CREATE INDEX idx_pedidos_ml_claim_id ON public.pedidos(ml_claim_id);
