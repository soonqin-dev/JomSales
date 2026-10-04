-- Run once as postgres AFTER all three earlier migrations. Existing sales
-- members keep read-only access; companies/products/images are not deleted.
begin;

alter table public.company_members
  add column can_manage_products boolean not null default false;
-- Membership table remains SELECT-only to authenticated callers. The column
-- cannot be self-edited; only this narrowly scoped administrator RPC changes it.
create function public.set_employee_product_permission(target_company uuid, employee_id uuid, enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.salesgo_require_admin(target_company);
  if enabled is null then raise exception 'Invalid permission setting.' using errcode='22023'; end if;
  update public.company_members m set can_manage_products=enabled
    where m.company_id=target_company and m.user_id=employee_id and m.role='sales';
  if not found then raise exception 'Sales employee not found. Administrator accounts are protected.' using errcode='22023'; end if;
end;
$$;

-- A new roster RPC keeps the previous RPC's return signature and old clients
-- intact while the database is deployed before the new UI.
create function public.get_company_team_permissions(target_company uuid)
returns table(user_id uuid, email text, role text, active boolean, joined_at timestamptz, can_manage_products boolean)
language plpgsql security definer set search_path = '' as $$
begin
  perform public.salesgo_require_admin(target_company);
  return query select m.user_id, u.email::text, m.role, m.active, m.created_at, m.can_manage_products
    from public.company_members m join auth.users u on u.id=m.user_id
    where m.company_id=target_company order by m.created_at, m.user_id;
end;
$$;
revoke all on function public.set_employee_product_permission(uuid,uuid,boolean),
  public.get_company_team_permissions(uuid) from public, anon, authenticated;
grant execute on function public.set_employee_product_permission(uuid,uuid,boolean),
  public.get_company_team_permissions(uuid) to authenticated;

-- Retain existing policy names for upgrade compatibility. The active-member
-- check is mandatory regardless of role or permission flag. Admin-only imports
-- use source_key; ordinary sales CRUD must not insert import identities.
alter policy admins_insert_company_products on public.products
with check (exists (select 1 from public.company_members m
  where m.company_id=products.company_id and m.user_id=(select auth.uid()) and m.active
    and (m.role='admin' or (m.role='sales' and m.can_manage_products and products.source_key is null))));
alter policy admins_update_company_products on public.products
using (exists (select 1 from public.company_members m
  where m.company_id=products.company_id and m.user_id=(select auth.uid()) and m.active
    and (m.role='admin' or (m.role='sales' and m.can_manage_products))))
with check (exists (select 1 from public.company_members m
  where m.company_id=products.company_id and m.user_id=(select auth.uid()) and m.active
    and (m.role='admin' or (m.role='sales' and m.can_manage_products))));

alter policy salesgo_admins_upload_images on storage.objects
with check (bucket_id='salesgo-products'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$'
  and exists (select 1 from public.company_members m
    where m.company_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid()) and m.active
      and (m.role='admin' or (m.role='sales' and m.can_manage_products))));
-- No overwrite policy. Cleanup still cannot delete a live product's image.
alter policy salesgo_admins_remove_unused_images on storage.objects
using (bucket_id='salesgo-products' and exists (select 1 from public.company_members m
  where m.company_id::text=(storage.foldername(name))[1] and m.user_id=(select auth.uid()) and m.active
    and (m.role='admin' or (m.role='sales' and m.can_manage_products)))
  and not exists (select 1 from public.products p where p.image_path=storage.objects.name and p.deleted_at is null));

commit;
select column_name, data_type, column_default, is_nullable
from information_schema.columns where table_schema='public' and table_name='company_members'
  and column_name='can_manage_products';
