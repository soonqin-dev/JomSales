-- Run as postgres AFTER migration 005. Enables the expiry worker, hourly.
-- Deletes ONLY quotation rows already in trash for at least 15 days.
-- Live quotations, product images and company branding files are not deleted.
begin;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('salesgo-quotation-trash-retention','0 * * * *',
  $$select public.purge_expired_quotations();$$);
commit;
select jobname,schedule,active,command from cron.job where jobname='salesgo-quotation-trash-retention';
