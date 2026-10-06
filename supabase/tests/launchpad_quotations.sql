-- Read-only verification. No account/customer/quotation fixtures or mutations.
begin;
do $$ declare t text; begin
  foreach t in array array['customers','quotation_defaults','quotation_sequences','quotation_number_reservations','quotation_events'] loop
    if not exists(select 1 from pg_tables where schemaname='public' and tablename=t and rowsecurity) then raise exception 'RLS missing: %',t;end if;
  end loop;
  if has_table_privilege('authenticated','public.quotation_sequences','update')
    or has_table_privilege('authenticated','public.quotation_events','insert')
    or has_column_privilege('authenticated','public.customers','created_by','update')
    or has_column_privilege('authenticated','public.quotations','paid_at','update')
    or has_function_privilege('anon','public.create_quotation(uuid,uuid,jsonb)','execute')
    or has_function_privilege('anon','public.company_sales_report(uuid,date,date)','execute') then raise exception 'Unexpected quotation API access.';end if;
  if not exists(select 1 from pg_constraint where conrelid='public.quotations'::regclass and conname='quotations_status_check' and pg_get_constraintdef(oid) like '%paid%') then raise exception 'Paid status missing.';end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='quotations' and column_name='total_amount' and is_generated='ALWAYS') then raise exception 'Generated quotation total missing.';end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='quotation_number_reserved_unique') then raise exception 'Number uniqueness missing.';end if;
end; $$;
select 'PASS: Launchpad quotation defaults/numbers, private customers, Paid/audit permissions and generated totals' as result;
rollback;
