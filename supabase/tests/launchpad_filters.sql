begin;
do $$ declare signature text;definition text;begin
  foreach signature in array array['public.search_company_products(uuid,text,timestamp with time zone,uuid,text)','public.read_public_catalog(text,text,timestamp with time zone,uuid,text)','public.search_catalog_share_products(uuid,text,timestamp with time zone,uuid)'] loop
    definition:=pg_get_functiondef(signature::regprocedure);if strpos(definition,'limit 31')=0 or strpos(definition,'limit 30')=0 then raise exception 'Missing 30-item page: %',signature;end if;
  end loop;
  if has_function_privilege('anon','public.search_company_quotations(uuid,text,text,boolean,timestamptz,uuid,uuid,text,date,date)','EXECUTE')
    or has_function_privilege('anon','public.quotation_customer_options(uuid,uuid,text,integer)','EXECUTE')
    or has_function_privilege('anon','public.search_company_customers(uuid,text,boolean,integer,uuid)','EXECUTE') then raise exception 'Visitor business filtering access';end if;
end $$;
select 'PASS: Launchpad 30-item pages and protected employee/customer/date filters' as result;
rollback;
