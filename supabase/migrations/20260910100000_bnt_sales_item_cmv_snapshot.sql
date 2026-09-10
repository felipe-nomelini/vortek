alter table public.pedido_itens
  add column if not exists cmv_unitario_snapshot numeric(14,2) null,
  add column if not exists cmv_total_snapshot numeric(14,2) null,
  add column if not exists cmv_fonte text null,
  add column if not exists cmv_evidencia_id text null,
  add column if not exists cmv_fonte_observada_em timestamptz null,
  add column if not exists cmv_capturado_em timestamptz null,
  add column if not exists cmv_composicao jsonb null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pedido_itens_cmv_snapshot_complete_check'
      and conrelid = 'public.pedido_itens'::regclass
  ) then
    alter table public.pedido_itens
      add constraint pedido_itens_cmv_snapshot_complete_check
      check (
        (
          cmv_unitario_snapshot is null
          and cmv_total_snapshot is null
          and cmv_fonte is null
          and cmv_evidencia_id is null
          and cmv_fonte_observada_em is null
          and cmv_capturado_em is null
          and cmv_composicao is null
        )
        or (
          cmv_unitario_snapshot > 0
          and cmv_total_snapshot = round(cmv_unitario_snapshot * quantidade, 2)
          and cmv_fonte in ('preferred_offer', 'kit_product')
          and nullif(trim(cmv_evidencia_id), '') is not null
          and cmv_fonte_observada_em is not null
          and cmv_capturado_em is not null
        )
      );
  end if;
end;
$$;

comment on column public.pedido_itens.cmv_unitario_snapshot is
  'CMV unitário congelado na primeira hidratação válida da venda.';
comment on column public.pedido_itens.cmv_total_snapshot is
  'CMV total histórico do item, já multiplicado pela quantidade vendida.';
comment on column public.pedido_itens.cmv_evidencia_id is
  'Identidade determinística da fonte econômica usada no snapshot.';

notify pgrst, 'reload schema';
