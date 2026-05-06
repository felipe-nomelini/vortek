-- Seed data for Vortek

-- Configurações padrão
insert into public.configuracoes (id, margem_lucro, notificacoes_email, notificacoes_push)
values ('00000000-0000-0000-0000-000000000001', 30, true, false)
on conflict (id) do nothing;

-- Empresa padrão
insert into public.empresa (id, nome, nickname, cnpj, endereco, email, telefone)
values (uuid_generate_v4(), 'VORTEKTECNOLOGIA', 'VORTEKTECNOLOGIA', '00.000.000/0001-00', 'Rua Exemplo, 123 - São Paulo, SP', 'contato@vortek.shop', '(11) 99999-0000')
on conflict do nothing;

-- Integrações (placeholder)
insert into public.integracoes (tipo, conectado) values
  ('mercadolivre', false),
  ('bling', false),
  ('dslite', false)
on conflict do nothing;

-- Produtos (mock inicial)
insert into public.produtos (sku, nome, marca, estoque, custo, preco_bling, ml_fee, ml_shipping, peso_liq, peso_bruto, largura, altura, profundidade, gtin, descricao, categoria, bling_status)
values
  ('FONE-001', 'Fone Bluetooth X1', 'TechSound', 45, 22.50, 59.90, 0.15, 8.50, 0.150, 0.220, 8, 5, 3, '7891234560010', 'Fone Bluetooth com drivers de 40mm e bateria 20h.', 'Eletrônicos > Áudio > Fones de Ouvido', 'ativo'),
  ('CAPA-002', 'Capa Silicone iPhone 15', 'TechSound', 120, 8.30, 29.90, 0.13, 5.00, 0.035, 0.060, 16, 8, 1, '7891234560027', 'Capa de silicone flexível para iPhone 15.', 'Celulares > Capas > iPhone 15', 'ativo'),
  ('CAR-003', 'Carregador USB-C 20W', 'VoltPower', 78, 14.90, 39.90, 0.14, 6.50, 0.060, 0.100, 6, 6, 3, '7891234560034', 'Carregador USB-C com tecnologia GaN 20W.', 'Eletrônicos > Carregadores > USB-C', 'ativo'),
  ('MOUSE-005', 'Mouse Gamer RGB', 'GameX', 0, 35.00, 89.90, 0.14, 10.00, 0.100, 0.180, 12, 6, 4, '7891234560058', 'Mouse gamer com sensor de 6400DPI.', null, 'inativo')
on conflict (sku) do nothing;
