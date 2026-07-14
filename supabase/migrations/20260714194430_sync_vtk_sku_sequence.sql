select setval(
  'public.produtos_vtk_sku_seq',
  greatest(
    coalesce((
      select max((substring(sku from 4))::bigint)
      from public.produtos
      where sku ~ '^VTK[0-9]{6}$'
    ), 0),
    1
  ),
  true
);
