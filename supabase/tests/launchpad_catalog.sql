-- Read-only structural verification; no test accounts/products or file writes.
begin;
do $$ declare t text; begin
  foreach t in array array['product_number_settings','product_number_reservations','product_import_rows'] loop
    if not exists(select 1 from pg_tables where schemaname='public' and tablename=t and rowsecurity) then raise exception 'RLS missing: %',t; end if;
  end loop;
  if has_table_privilege('authenticated','public.product_number_settings','update')
    or has_table_privilege('authenticated','public.product_import_rows','insert')
    or has_function_privilege('anon','public.search_company_products(uuid,text,timestamptz,uuid)','execute')
    or has_function_privilege('anon','public.import_products_batch(uuid,uuid,jsonb)','execute') then
    raise exception 'Unexpected catalog API access.';
  end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='products_search_trgm_idx') then raise exception 'Search index missing.'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='thumbnail_path') then raise exception 'Thumbnail column missing.'; end if;
  if public.quote_subtotal_cents('[{"product":{"id":"check","serial":"check","name":"check","unit":"米"},"quantity":1.005,"unitPrice":1}]'::jsonb)<>101 then
    raise exception 'Decimal line rounding mismatch.';
  end if;
end; $$;
select 'PASS: Launchpad catalog search/index, numbering/import RLS, private thumbnails and decimal quotation calculation' as result;
rollback;
