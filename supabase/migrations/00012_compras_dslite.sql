create table if not exists public.compras (
  id uuid primary key default gen_random_uuid(),
  dsid text unique not null,
  status text,
  status_dslite text,
  nf_chave text,
  nf_numero text,
  nf_serie text,
  valor_total numeric default 0,
  valor_frete numeric default 0,
  data_criacao timestamptz,
  rastreio text,
  fornecedor_id text,
  fornecedor_nome text,
  destinatario_nome text,
  destinatario_documento text,
  produto_descricao text,
  produto_sku text,
  quantidade integer default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_compras_dsid on public.compras(dsid);
create index if not exists idx_compras_status on public.compras(status);
create index if not exists idx_compras_data on public.compras(data_criacao);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_compras_updated_at
  BEFORE UPDATE ON public.compras
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
