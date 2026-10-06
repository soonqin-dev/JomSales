begin;
do $$ begin
  if not exists(select 1 from pg_tables where schemaname='public' and tablename='catalog_links' and rowsecurity) then raise exception 'Missing catalog link RLS'; end if;
  if has_table_privilege('anon','public.catalog_links','SELECT') or has_table_privilege('anon','public.products','SELECT')
    or has_table_privilege('authenticated','public.catalog_links','INSERT') or has_table_privilege('authenticated','public.catalog_links','UPDATE')
    or has_column_privilege('authenticated','public.products','catalog_public','UPDATE') then raise exception 'Unexpected direct catalog permissions'; end if;
  if has_function_privilege('anon','public.create_catalog_link(uuid,uuid,text,text,uuid[])','EXECUTE')
    or has_function_privilege('anon','public.set_catalog_visibility_batch(uuid,text,integer,boolean)','EXECUTE')
    or has_function_privilege('anon','public.jomsales_live_catalog(text)','EXECUTE') then raise exception 'Unexpected visitor management access'; end if;
  if not has_function_privilege('anon','public.read_public_catalog(text,text,timestamptz,uuid)','EXECUTE') then raise exception 'Missing price-free reader'; end if;
  if exists(select 1 from storage.buckets where id in('salesgo-products','salesgo-branding') and public) then raise exception 'Storage must stay private'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='catalog_public' and column_default='false') then raise exception 'Products must default private'; end if;
end $$;
select 'PASS: Launchpad private catalog links, price-free public API, fixed expiry and revocation structure' as result;
rollback;
