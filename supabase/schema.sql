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

create table if not exists public.mambo_products (
 id uuid primary key, store_id uuid not null references public.mambo_stores(id) on delete cascade,
 sku text not null, name text not null, barcode text, category_id uuid, stock numeric(18,3) not null default 0,
 cost numeric(18,2) not null default 0, price numeric(18,2) not null default 0, min_stock numeric(18,3) not null default 0,
 payload jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(),
 unique(store_id,sku)
);
create table if not exists public.mambo_suppliers (
 id uuid primary key, store_id uuid not null references public.mambo_stores(id) on delete cascade,
 name text not null, phone text, address text, payload jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);
create table if not exists public.mambo_stock_movements (
 id uuid primary key, store_id uuid not null references public.mambo_stores(id) on delete cascade,
 product_id uuid, movement_type text not null, quantity numeric(18,3) not null,
 reference_id uuid, note text, occurred_at timestamptz not null default now(), payload jsonb not null default '{}'::jsonb
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
-- Outbox cloud generik menyimpan entitas lokal lain (kategori, pelanggan, pembelian,
-- utang, retur, pengaturan) tanpa kehilangan field yang belum dinormalisasi.
create table if not exists public.mambo_sync_records (
 store_id uuid not null references public.mambo_stores(id) on delete cascade,
 entity text not null check (entity in ('products','suppliers','movements','transactions','shifts','auditLogs','categories','customers','opnames','settings','receivables','promos','returns','purchases','payables','supplierPayments')),
 record_id text not null, payload jsonb not null, updated_at timestamptz not null default now(),
 deleted boolean not null default false, primary key(store_id,entity,record_id)
);
create index if not exists mambo_transactions_store_time on public.mambo_transactions(store_id,occurred_at desc);
create index if not exists mambo_stock_store_time on public.mambo_stock_movements(store_id,occurred_at desc);
create index if not exists mambo_sync_store_entity on public.mambo_sync_records(store_id,entity);

alter table public.mambo_stores enable row level security;
alter table public.mambo_store_members enable row level security;
alter table public.mambo_products enable row level security;
alter table public.mambo_suppliers enable row level security;
alter table public.mambo_stock_movements enable row level security;
alter table public.mambo_transactions enable row level security;
alter table public.mambo_shifts enable row level security;
alter table public.mambo_audit_logs enable row level security;
alter table public.mambo_sync_records enable row level security;

drop policy if exists store_read_member on public.mambo_stores;
create policy store_read_member on public.mambo_stores for select using (public.mambo_is_member(id));
drop policy if exists member_read_membership on public.mambo_store_members;
create policy member_read_membership on public.mambo_store_members for select using (public.mambo_is_member(store_id));
drop policy if exists products_member_all on public.mambo_products;
create policy products_member_all on public.mambo_products for all using (public.mambo_is_member(store_id)) with check (public.mambo_is_member(store_id));
drop policy if exists suppliers_member_all on public.mambo_suppliers;
create policy suppliers_member_all on public.mambo_suppliers for all using (public.mambo_is_member(store_id)) with check (public.mambo_is_member(store_id));
drop policy if exists stock_member_all on public.mambo_stock_movements;
create policy stock_member_all on public.mambo_stock_movements for all using (public.mambo_is_member(store_id)) with check (public.mambo_is_member(store_id));
drop policy if exists transactions_member_all on public.mambo_transactions;
create policy transactions_member_all on public.mambo_transactions for all using (public.mambo_is_member(store_id)) with check (public.mambo_is_member(store_id));
drop policy if exists shifts_member_all on public.mambo_shifts;
create policy shifts_member_all on public.mambo_shifts for all using (public.mambo_is_member(store_id)) with check (public.mambo_is_member(store_id));
drop policy if exists audit_member_read on public.mambo_audit_logs;
create policy audit_member_read on public.mambo_audit_logs for select using (public.mambo_is_member(store_id));
drop policy if exists audit_member_insert on public.mambo_audit_logs;
create policy audit_member_insert on public.mambo_audit_logs for insert with check (public.mambo_is_member(store_id));
drop policy if exists sync_records_member_all on public.mambo_sync_records;
create policy sync_records_member_all on public.mambo_sync_records for all using (public.mambo_is_member(store_id)) with check (public.mambo_is_member(store_id));

-- Buat store + kaitkan akun Supabase Auth owner secara manual setelah owner mendaftar.
-- insert into public.mambo_stores(id,store_name) values ('STORE-UUID','Nama Toko');
-- insert into public.mambo_store_members(store_id,user_id,app_role)
-- values ('STORE-UUID','AUTH-USER-UUID','owner');
