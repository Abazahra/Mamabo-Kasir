-- MAMBO KASIR · Supabase schema v1
-- Jalankan seluruh skrip ini di Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.mambo_stores (
  id uuid primary key default gen_random_uuid(),
  store_name text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.mambo_store_members (
  store_id uuid not null references public.mambo_stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  app_role text not null check (app_role in ('owner','supervisor','cashier')),
  created_at timestamptz not null default now(),
  primary key(store_id,user_id)
);

create or replace function public.mambo_is_member(target_store uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.mambo_store_members m where m.store_id=target_store and m.user_id=auth.uid()) $$;
create or replace function public.mambo_is_owner(target_store uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.mambo_store_members m where m.store_id=target_store and m.user_id=auth.uid() and m.app_role='owner') $$;
create or replace function public.mambo_has_role(target_store uuid, allowed text[])
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.mambo_store_members m where m.store_id=target_store and m.user_id=auth.uid() and m.app_role=any(allowed)) $$;

create table if not exists public.mambo_products (
 id uuid primary key, store_id uuid not null references public.mambo_stores(id) on delete cascade,
 sku text not null, name text not null, barcode text, category_id uuid,
 stock numeric(18,3) not null default 0, cost numeric(18,2) not null default 0,
 price numeric(18,2) not null default 0, min_stock numeric(18,3) not null default 0,
 payload jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(),
 unique(store_id,sku)
);
create table if not exists public.mambo_suppliers (
 id uuid primary key, store_id uuid not null references public.mambo_stores(id) on delete cascade,
 name text not null, phone text, address text, payload jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now()
);
create table if not exists public.mambo_stock_movements (
 id uuid primary key, store_id uuid not null references public.mambo_stores(id) on delete cascade,
 product_id uuid, movement_type text not null, quantity numeric(18,3) not null,
 reference_id uuid, note text, occurred_at timestamptz not null default now(),
 payload jsonb not null default '{}'::jsonb
);
create table if not exists public.mambo_transactions (
 id uuid primary key, store_id uuid not null references public.mambo_stores(id) on delete cascade,
 receipt_no text, cashier_user_id uuid, total numeric(18,2) not null default 0,
 status text not null default 'paid', occurred_at timestamptz not null default now(),
 payload jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);
create table if not exists public.mambo_shifts (
 id uuid primary key, store_id uuid not null references public.mambo_stores(id) on delete cascade,
 cashier_user_id uuid, status text not null, opened_at timestamptz, closed_at timestamptz,
 payload jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);
create table if not exists public.mambo_audit_logs (
 id uuid primary key, store_id uuid not null references public.mambo_stores(id) on delete cascade,
 actor_user_id uuid, actor_name text, action text not null, detail text,
 occurred_at timestamptz not null default now(), payload jsonb not null default '{}'::jsonb
);
create table if not exists public.mambo_sync_records (
 store_id uuid not null references public.mambo_stores(id) on delete cascade,
 entity text not null check (entity in ('products','suppliers','movements','transactions','shifts','auditLogs','categories','customers','opnames','settings','receivables','promos','returns','purchases','payables','supplierPayments','operationalExpenses')),
 record_id text not null, payload jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(), deleted boolean not null default false,
 primary key(store_id,entity,record_id)
);

create index if not exists mambo_transactions_store_time on public.mambo_transactions(store_id,occurred_at desc);
create index if not exists mambo_stock_store_time on public.mambo_stock_movements(store_id,occurred_at desc);
create index if not exists mambo_sync_store_entity on public.mambo_sync_records(store_id,entity);

-- Project synced records into normalized tables for reporting.
create or replace function public.mambo_project_sync_record()
returns trigger language plpgsql security definer set search_path=public
as $$
declare p jsonb; rid uuid;
begin
 if new.deleted then
   if new.entity='products' then delete from public.mambo_products where id=new.record_id::uuid and store_id=new.store_id;
   elsif new.entity='suppliers' then delete from public.mambo_suppliers where id=new.record_id::uuid and store_id=new.store_id;
   elsif new.entity='movements' then delete from public.mambo_stock_movements where id=new.record_id::uuid and store_id=new.store_id;
   elsif new.entity='transactions' then delete from public.mambo_transactions where id=new.record_id::uuid and store_id=new.store_id;
   elsif new.entity='shifts' then delete from public.mambo_shifts where id=new.record_id::uuid and store_id=new.store_id;
   elsif new.entity='auditLogs' then delete from public.mambo_audit_logs where id=new.record_id::uuid and store_id=new.store_id;
   end if;
   return new;
 end if;
 p=new.payload;
 if new.record_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then rid=new.record_id::uuid; else return new; end if;
 if new.entity='products' then
  insert into public.mambo_products(id,store_id,sku,name,barcode,stock,cost,price,min_stock,payload,updated_at)
  values(rid,new.store_id,coalesce(p->>'sku',''),coalesce(p->>'name',''),p->>'barcode',coalesce(nullif(p->>'stock','')::numeric,0),coalesce(nullif(p->>'cost','')::numeric,0),coalesce(nullif(p->>'price','')::numeric,0),coalesce(nullif(p->>'minStock','')::numeric,0),p,new.updated_at)
  on conflict(id) do update set sku=excluded.sku,name=excluded.name,barcode=excluded.barcode,stock=excluded.stock,cost=excluded.cost,price=excluded.price,min_stock=excluded.min_stock,payload=excluded.payload,updated_at=excluded.updated_at;
 elsif new.entity='suppliers' then
  insert into public.mambo_suppliers(id,store_id,name,phone,address,payload,updated_at)
  values(rid,new.store_id,coalesce(p->>'name',''),p->>'phone',p->>'address',p,new.updated_at)
  on conflict(id) do update set name=excluded.name,phone=excluded.phone,address=excluded.address,payload=excluded.payload,updated_at=excluded.updated_at;
 elsif new.entity='movements' then
  insert into public.mambo_stock_movements(id,store_id,movement_type,quantity,note,payload)
  values(rid,new.store_id,coalesce(p->>'type','unknown'),coalesce(nullif(p->>'delta','')::numeric,0),p->>'note',p)
  on conflict(id) do update set movement_type=excluded.movement_type,quantity=excluded.quantity,note=excluded.note,payload=excluded.payload;
 elsif new.entity='transactions' then
  insert into public.mambo_transactions(id,store_id,receipt_no,total,status,payload,updated_at)
  values(rid,new.store_id,p->>'receipt',coalesce(nullif(p->>'total','')::numeric,0),coalesce(p->>'status','paid'),p,new.updated_at)
  on conflict(id) do update set receipt_no=excluded.receipt_no,total=excluded.total,status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at;
 elsif new.entity='shifts' then
  insert into public.mambo_shifts(id,store_id,status,payload,updated_at)
  values(rid,new.store_id,coalesce(p->>'status','open'),p,new.updated_at)
  on conflict(id) do update set status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at;
 elsif new.entity='auditLogs' then
  insert into public.mambo_audit_logs(id,store_id,actor_name,action,detail,payload)
  values(rid,new.store_id,p->>'userName',coalesce(p->>'action','unknown'),p->>'detail',p)
  on conflict(id) do update set actor_name=excluded.actor_name,action=excluded.action,detail=excluded.detail,payload=excluded.payload;
 end if;
 return new;
end $$;
drop trigger if exists mambo_sync_record_project on public.mambo_sync_records;
create trigger mambo_sync_record_project after insert or update on public.mambo_sync_records
for each row execute function public.mambo_project_sync_record();

-- Enable RLS on every exposed table.
alter table public.mambo_stores enable row level security;
alter table public.mambo_store_members enable row level security;
alter table public.mambo_products enable row level security;
alter table public.mambo_suppliers enable row level security;
alter table public.mambo_stock_movements enable row level security;
alter table public.mambo_transactions enable row level security;
alter table public.mambo_shifts enable row level security;
alter table public.mambo_audit_logs enable row level security;
alter table public.mambo_sync_records enable row level security;

-- Policies are dropped/recreated so the script can be rerun safely.
drop policy if exists store_read_member on public.mambo_stores;
create policy store_read_member on public.mambo_stores for select using (public.mambo_is_member(id));
drop policy if exists member_read_membership on public.mambo_store_members;
create policy member_read_membership on public.mambo_store_members for select using (public.mambo_is_member(store_id));

drop policy if exists products_read_member on public.mambo_products;
drop policy if exists products_write_manager on public.mambo_products;
drop policy if exists products_update_manager on public.mambo_products;
drop policy if exists products_delete_owner on public.mambo_products;
create policy products_read_member on public.mambo_products for select using (public.mambo_is_member(store_id));
create policy products_write_manager on public.mambo_products for insert with check (public.mambo_has_role(store_id,array['owner','supervisor']));
create policy products_update_manager on public.mambo_products for update using (public.mambo_has_role(store_id,array['owner','supervisor'])) with check (public.mambo_has_role(store_id,array['owner','supervisor']));
create policy products_delete_owner on public.mambo_products for delete using (public.mambo_is_owner(store_id));

drop policy if exists suppliers_read_member on public.mambo_suppliers;
drop policy if exists suppliers_write_manager on public.mambo_suppliers;
drop policy if exists suppliers_update_manager on public.mambo_suppliers;
drop policy if exists suppliers_delete_owner on public.mambo_suppliers;
create policy suppliers_read_member on public.mambo_suppliers for select using (public.mambo_is_member(store_id));
create policy suppliers_write_manager on public.mambo_suppliers for insert with check (public.mambo_has_role(store_id,array['owner','supervisor']));
create policy suppliers_update_manager on public.mambo_suppliers for update using (public.mambo_has_role(store_id,array['owner','supervisor'])) with check (public.mambo_has_role(store_id,array['owner','supervisor']));
create policy suppliers_delete_owner on public.mambo_suppliers for delete using (public.mambo_is_owner(store_id));

drop policy if exists stock_read_member on public.mambo_stock_movements;
drop policy if exists stock_insert_member on public.mambo_stock_movements;
drop policy if exists stock_update_manager on public.mambo_stock_movements;
drop policy if exists stock_delete_owner on public.mambo_stock_movements;
create policy stock_read_member on public.mambo_stock_movements for select using (public.mambo_is_member(store_id));
create policy stock_insert_member on public.mambo_stock_movements for insert with check (public.mambo_is_member(store_id));
create policy stock_update_manager on public.mambo_stock_movements for update using (public.mambo_has_role(store_id,array['owner','supervisor'])) with check (public.mambo_has_role(store_id,array['owner','supervisor']));
create policy stock_delete_owner on public.mambo_stock_movements for delete using (public.mambo_is_owner(store_id));

drop policy if exists transactions_read_member on public.mambo_transactions;
drop policy if exists transactions_insert_member on public.mambo_transactions;
drop policy if exists transactions_update_manager on public.mambo_transactions;
drop policy if exists transactions_delete_owner on public.mambo_transactions;
create policy transactions_read_member on public.mambo_transactions for select using (public.mambo_is_member(store_id));
create policy transactions_insert_member on public.mambo_transactions for insert with check (public.mambo_is_member(store_id));
create policy transactions_update_manager on public.mambo_transactions for update using (public.mambo_has_role(store_id,array['owner','supervisor'])) with check (public.mambo_has_role(store_id,array['owner','supervisor']));
create policy transactions_delete_owner on public.mambo_transactions for delete using (public.mambo_is_owner(store_id));

drop policy if exists shifts_read_member on public.mambo_shifts;
drop policy if exists shifts_insert_member on public.mambo_shifts;
drop policy if exists shifts_update_member on public.mambo_shifts;
drop policy if exists shifts_delete_owner on public.mambo_shifts;
create policy shifts_read_member on public.mambo_shifts for select using (public.mambo_is_member(store_id));
create policy shifts_insert_member on public.mambo_shifts for insert with check (public.mambo_is_member(store_id));
create policy shifts_update_member on public.mambo_shifts for update using (public.mambo_is_member(store_id)) with check (public.mambo_is_member(store_id));
create policy shifts_delete_owner on public.mambo_shifts for delete using (public.mambo_is_owner(store_id));

drop policy if exists audit_read_manager on public.mambo_audit_logs;
drop policy if exists audit_insert_member on public.mambo_audit_logs;
create policy audit_read_manager on public.mambo_audit_logs for select using (public.mambo_has_role(store_id,array['owner','supervisor']));
create policy audit_insert_member on public.mambo_audit_logs for insert with check (public.mambo_is_member(store_id));

drop policy if exists sync_records_read_member on public.mambo_sync_records;
drop policy if exists sync_records_insert_member on public.mambo_sync_records;
drop policy if exists sync_records_update_member on public.mambo_sync_records;
drop policy if exists sync_records_delete_owner on public.mambo_sync_records;
create policy sync_records_read_member on public.mambo_sync_records for select using (public.mambo_is_member(store_id));
create policy sync_records_insert_member on public.mambo_sync_records for insert with check (
 public.mambo_is_member(store_id) and (
  (entity in ('products','suppliers','categories','customers','promos','purchases','payables','settings') and public.mambo_has_role(store_id,array['owner','supervisor']))
  or (entity in ('transactions','shifts','movements','auditLogs','opnames','receivables','returns','supplierPayments','operationalExpenses') and public.mambo_is_member(store_id))
 ));
create policy sync_records_update_member on public.mambo_sync_records for update using (
 public.mambo_is_member(store_id) and (
  (entity in ('products','suppliers','categories','customers','promos','purchases','payables','settings') and public.mambo_has_role(store_id,array['owner','supervisor']))
  or (entity in ('transactions','shifts','movements','auditLogs','opnames','receivables','returns','supplierPayments','operationalExpenses') and public.mambo_is_member(store_id))
 )) with check (
 public.mambo_is_member(store_id) and (
  (entity in ('products','suppliers','categories','customers','promos','purchases','payables','settings') and public.mambo_has_role(store_id,array['owner','supervisor']))
  or (entity in ('transactions','shifts','movements','auditLogs','opnames','receivables','returns','supplierPayments','operationalExpenses') and public.mambo_is_member(store_id))
 ));
create policy sync_records_delete_owner on public.mambo_sync_records for delete using (public.mambo_is_owner(store_id));

-- Setelah membuat user melalui Supabase Auth, buat store dan membership owner:
-- insert into public.mambo_stores(id,store_name) values ('UUID-STORE','MAMBO KASIR');
-- insert into public.mambo_store_members(store_id,user_id,app_role)
-- values ('UUID-STORE','UUID-AUTH-USER','owner');
