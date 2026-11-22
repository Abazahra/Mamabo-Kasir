-- MAMBO KASIR: pairing perangkat kasir tanpa login Supabase
-- Jalankan SEKALI di Supabase SQL Editor setelah schema.sql utama.
-- Tidak mengubah atau menghapus data bisnis yang sudah ada.

create table if not exists public.mambo_device_pair_codes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.mambo_stores(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.mambo_cashier_devices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.mambo_stores(id) on delete cascade,
  label text not null default 'Perangkat Kasir',
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

alter table public.mambo_device_pair_codes enable row level security;
alter table public.mambo_cashier_devices enable row level security;
revoke all on public.mambo_device_pair_codes from anon, authenticated;
revoke all on public.mambo_cashier_devices from anon, authenticated;

create or replace function public.mambo_owner_create_pair_code(p_store_id uuid, p_label text default 'Perangkat Kasir')
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code text;
begin
  if auth.uid() is null or not public.mambo_is_owner(p_store_id) then
    raise exception 'Hanya Owner toko yang dapat membuat kode pemasangan.';
  end if;
  v_code := upper(encode(gen_random_bytes(4), 'hex'));
  insert into public.mambo_device_pair_codes(store_id, code_hash, expires_at, created_by)
  values (p_store_id, encode(digest(v_code, 'sha256'), 'hex'), now() + interval '15 minutes', auth.uid());
  return v_code;
end;
$$;

create or replace function public.mambo_device_redeem_pair_code(p_code text, p_label text default 'Perangkat Kasir')
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_pair public.mambo_device_pair_codes%rowtype;
  v_token text;
  v_device_id uuid;
begin
  if p_code is null or length(trim(p_code)) < 6 then
    raise exception 'Kode pemasangan tidak valid.';
  end if;

  select * into v_pair
  from public.mambo_device_pair_codes
  where code_hash = encode(digest(upper(trim(p_code)), 'sha256'), 'hex')
    and used_at is null and expires_at > now()
  for update;

  if not found then
    raise exception 'Kode salah, sudah digunakan, atau kedaluwarsa.';
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_device_id := gen_random_uuid();

  insert into public.mambo_cashier_devices(id, store_id, label, token_hash)
  values (v_device_id, v_pair.store_id, coalesce(nullif(trim(p_label), ''), 'Perangkat Kasir'),
          encode(digest(v_token, 'sha256'), 'hex'));

  update public.mambo_device_pair_codes set used_at = now() where id = v_pair.id;

  return jsonb_build_object('device_id', v_device_id, 'store_id', v_pair.store_id, 'device_token', v_token);
end;
$$;

create or replace function public.mambo_device_catalog_snapshot(p_device_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_device public.mambo_cashier_devices%rowtype;
  v_products jsonb;
  v_categories jsonb;
begin
  if p_device_token is null or length(p_device_token) < 32 then
    raise exception 'Perangkat belum terdaftar.';
  end if;

  select * into v_device
  from public.mambo_cashier_devices
  where token_hash = encode(digest(p_device_token, 'sha256'), 'hex')
    and revoked_at is null;

  if not found then
    raise exception 'Akses perangkat dicabut atau token tidak valid.';
  end if;

  update public.mambo_cashier_devices set last_seen_at = now() where id = v_device.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', record_id,
    'sku', coalesce(payload->>'sku',''),
    'name', coalesce(payload->>'name',''),
    'barcode', coalesce(payload->>'barcode',''),
    'categoryId', coalesce(payload->>'categoryId',''),
    'stock', coalesce(nullif(payload->>'stock','')::numeric,0),
    'price', coalesce(nullif(payload->>'price','')::numeric,0),
    'minStock', coalesce(nullif(payload->>'minStock','')::numeric,0),
    'bundle', coalesce(payload->'bundle','[]'::jsonb),
    'updatedAt', coalesce(payload->>'updatedAt', updated_at::text)
  ) order by coalesce(payload->>'name','')), '[]'::jsonb)
  into v_products
  from public.mambo_sync_records
  where store_id = v_device.store_id and entity = 'products' and deleted = false
    and lower(trim(coalesce(payload->>'name',''))) not in ('detergen 800 g','gula pasir');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', record_id,
    'name', coalesce(payload->>'name','')
  ) order by coalesce(payload->>'name','')), '[]'::jsonb)
  into v_categories
  from public.mambo_sync_records
  where store_id = v_device.store_id and entity = 'categories' and deleted = false;

  return jsonb_build_object('store_id', v_device.store_id, 'products', v_products, 'categories', v_categories);
end;
$$;

revoke all on function public.mambo_owner_create_pair_code(uuid, text) from public, anon;
grant execute on function public.mambo_owner_create_pair_code(uuid, text) to authenticated;

revoke all on function public.mambo_device_redeem_pair_code(text, text) from public;
grant execute on function public.mambo_device_redeem_pair_code(text, text) to anon, authenticated;

revoke all on function public.mambo_device_catalog_snapshot(text) from public;
grant execute on function public.mambo_device_catalog_snapshot(text) to anon, authenticated;

-- Opsional: Owner dapat mencabut perangkat tertentu dengan SQL:
-- update public.mambo_cashier_devices set revoked_at = now()
-- where id = 'UUID-PERANGKAT' and store_id = 'UUID-TOKO';
