begin;
do $$ begin
  if has_function_privilege('anon','public.search_company_quotations(uuid,text,text,boolean,timestamptz,uuid)','EXECUTE')
    or has_function_privilege('anon','public.search_company_customers(uuid,text,boolean,integer)','EXECUTE') then raise exception 'Visitor business access';end if;
  if not has_function_privilege('authenticated','public.search_company_quotations(uuid,text,text,boolean,timestamptz,uuid)','EXECUTE') then raise exception 'Missing quotation search';end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='quotations_history_cursor_idx') then raise exception 'Missing history index';end if;
  if not exists(select 1 from pg_tables where schemaname='public' and tablename='customers' and rowsecurity) then raise exception 'Missing customer RLS';end if;
  if not exists(select 1 from pg_tables where schemaname='public' and tablename='company_categories' and rowsecurity) or has_table_privilege('anon','public.company_categories','SELECT')
    or has_table_privilege('authenticated','public.company_categories','UPDATE') then raise exception 'Invalid category permissions';end if;
  if has_function_privilege('anon','public.manage_company_category(uuid,uuid,text,integer,text)','EXECUTE') then raise exception 'Visitor category mutation';end if;
end $$;
select 'PASS: Launchpad paged quotations, scoped customer owners and company category permissions' as result;
rollback;
