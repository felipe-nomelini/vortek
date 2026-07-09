with latest_label_event as (
  select distinct on (pedido_id)
    pedido_id,
    case
      when evento = 'placeholder_label_send_success' then 'placeholder_release_window'
      when evento = 'ml_label_send_success' then 'mercado_livre'
      else null
    end as dslite_label_source,
    created_at
  from public.nf_auditoria_eventos
  where pedido_id is not null
    and evento in ('placeholder_label_send_success', 'ml_label_send_success')
  order by pedido_id, created_at desc, id desc
)
update public.pedidos p
set dslite_label_source = lle.dslite_label_source
from latest_label_event lle
where p.id = lle.pedido_id
  and lle.dslite_label_source is not null
  and p.dslite_etiqueta_enviada = true;

update public.pedidos
set dslite_label_source = 'mercado_livre'
where dslite_etiqueta_enviada = true
  and dslite_label_source is null;
