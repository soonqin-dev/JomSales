-- Run as postgres AFTER migration 202610080001_platform_deletion.sql.
-- Hourly: companies/accounts that have been in the platform recycle bin for 30 days
-- are permanently deleted (companies keep a tombstone; accounts keep an empty shell).
-- Product/branding image FILES are not removed by SQL: the platform page shows
-- "图片文件待清理" for purged companies and removes them through the Storage API.
begin;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('jomsales-platform-recycle-bin','15 * * * *',
  $$select public.purge_expired_platform_deletions();$$);
commit;
select jobname,schedule,active,command from cron.job where jobname='jomsales-platform-recycle-bin';
