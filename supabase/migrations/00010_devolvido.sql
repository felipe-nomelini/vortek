-- Adicionar status 'devolvido' ao enum de pedidos
ALTER TYPE pedido_status ADD VALUE IF NOT EXISTS 'devolvido';
