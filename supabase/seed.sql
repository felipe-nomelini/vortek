-- Dados mínimos e inteiramente sintéticos para o Bentevi DEV local.
-- Este arquivo nunca deve receber cópia, credencial ou identificador de produção.

-- Identidade neutra para telas locais; somente a UF sintética obrigatória é preenchida.
insert into public.empresa (id, nome, nickname, cnpj, endereco, email, telefone, uf_fiscal)
values (
  '00000000-0000-0000-0000-000000000002',
  'Bentevi DEV Local',
  'BENTEVI_DEV_LOCAL',
  '',
  '',
  '',
  '',
  'SP'
)
on conflict do nothing;

-- Integrações locais começam desconectadas e sem configuração externa.
insert into public.integracoes (tipo, conectado) values
  ('mercadolivre', false),
  ('dslite', false),
  ('brasilnfe', false)
on conflict do nothing;
