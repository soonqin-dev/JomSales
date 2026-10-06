begin;
do $$ declare t text;begin
  foreach t in array array['product_price_jobs','product_price_changes'] loop
    if not exists(select 1 from pg_tables where schemaname='public' and tablename=t and rowsecurity) then raise exception 'Missing price update RLS: %',t;end if;
    if has_table_privilege('anon','public.'||t,'SELECT') or has_table_privilege('authenticated','public.'||t,'INSERT')
      or has_table_privilege('authenticated','public.'||t,'UPDATE') or has_table_privilege('authenticated','public.'||t,'DELETE') then raise exception 'Unexpected price history write grants';end if;
  end loop;
  if has_function_privilege('anon','public.apply_product_prices(uuid,uuid,jsonb)','EXECUTE') or has_function_privilege('anon','public.preview_product_prices(uuid,text[])','EXECUTE') then raise exception 'Visitor price access';end if;
  if not has_function_privilege('authenticated','public.apply_product_prices(uuid,uuid,jsonb)','EXECUTE') then raise exception 'Missing price update RPC';end if;
end $$;
select 'PASS: Launchpad price-only updates, private audit history and restricted preview/apply RPCs' as result;
rollback;
