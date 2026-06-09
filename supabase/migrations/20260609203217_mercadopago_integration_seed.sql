insert into public.integracoes (tipo, conectado)
values ('mercadopago', false)
on conflict (tipo) do nothing;
