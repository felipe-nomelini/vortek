-- Prevent duplicate products for the same DSLite identity
-- Precondition: run dedupe script before applying this migration.

create unique index if not exists produtos_dslite_identity_unique
on public.produtos (dslite_fornecedor_id, dslite_produto_id)
where dslite_fornecedor_id is not null
  and dslite_produto_id is not null;

