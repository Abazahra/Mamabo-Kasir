-- MAMBO KASIR · Pengelolaan akun karyawan terpusat
-- Jalankan satu kali di Supabase SQL Editor SETELAH schema.sql dan device-pairing.sql.
-- Tidak menghapus atau mengubah data transaksi, produk, stok, atau akun lokal yang sudah ada.

create table if not exists public.mambo_staff_accounts (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.mambo_stores(id) on delete cascade,
 username text not null,
 display_name text not null,
 app_role text not null check (app_role in ('supervisor','cashier')),
 pin_salt text not null,
 pin_hash text not null,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists mambo_staff_username_unique
 on public.mambo_staff_accounts(store_id,lower(username));
alter table public.mambo_staff_accounts enable row level security;
revoke all on public.mambo_staff_accounts from anon, authenticated;

create or replace function public.mambo_owner_staff_list(p_store_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.mambo_is_owner(p_store_id) then raise exception 'Akses hanya untuk Owner toko.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'username',username,'display_name',display_name,'app_role',app_role,'active',active,'created_at',created_at) order by created_at), '[]'::jsonb)
 into result from public.mambo_staff_accounts where store_id=p_store_id;
 return result;
end $$;

create or replace function public.mambo_owner_staff_create(p_store_id uuid,p_username text,p_display_name text,p_app_role text,p_pin text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare new_id uuid; salt text;
begin
 if auth.uid() is null or not public.mambo_is_owner(p_store_id) then raise exception 'Akses hanya untuk Owner toko.'; end if;
 if coalesce(p_username,'') !~ '^[A-Za-z0-9._-]{3,32}$' then raise exception 'Username harus 3–32 karakter: huruf, angka, titik, garis, atau strip.'; end if;
 if length(trim(coalesce(p_display_name,'')))<2 or length(trim(p_display_name))>80 then raise exception 'Nama karyawan harus 2–80 karakter.'; end if;
 if p_app_role not in ('supervisor','cashier') then raise exception 'Peran hanya Supervisor atau Kasir.'; end if;
 if p_pin !~ '^\d{4,6}$' then raise exception 'PIN harus 4–6 angka.'; end if;
 salt:=gen_random_uuid()::text;
 insert into public.mambo_staff_accounts(store_id,username,display_name,app_role,pin_salt,pin_hash)
 values(p_store_id,trim(p_username),trim(p_display_name),p_app_role,salt,crypt(p_pin,gen_salt('bf',10)))
 returning id into new_id;
 return jsonb_build_object('id',new_id);
end $$;

create or replace function public.mambo_owner_staff_update(p_store_id uuid,p_staff_id uuid,p_username text,p_display_name text,p_app_role text,p_active boolean)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
begin
 if auth.uid() is null or not public.mambo_is_owner(p_store_id) then raise exception 'Akses hanya untuk Owner toko.'; end if;
 if p_username !~ '^[A-Za-z0-9._-]{3,32}$' then raise exception 'Format username tidak valid.'; end if;
 if length(trim(coalesce(p_display_name,'')))<2 or length(trim(p_display_name))>80 then raise exception 'Nama karyawan harus 2–80 karakter.'; end if;
 if p_app_role not in ('supervisor','cashier') then raise exception 'Peran hanya Supervisor atau Kasir.'; end if;
 update public.mambo_staff_accounts set username=trim(p_username),display_name=trim(p_display_name),app_role=p_app_role,active=coalesce(p_active,false),updated_at=now()
 where id=p_staff_id and store_id=p_store_id;
 if not found then raise exception 'Akun karyawan tidak ditemukan.'; end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.mambo_owner_staff_reset_pin(p_store_id uuid,p_staff_id uuid,p_pin text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare salt text;
begin
 if auth.uid() is null or not public.mambo_is_owner(p_store_id) then raise exception 'Akses hanya untuk Owner toko.'; end if;
 if p_pin !~ '^\d{4,6}$' then raise exception 'PIN harus 4–6 angka.'; end if;
 salt:=gen_random_uuid()::text;
 update public.mambo_staff_accounts set pin_salt=salt,pin_hash=crypt(p_pin,gen_salt('bf',10)),updated_at=now()
 where id=p_staff_id and store_id=p_store_id;
 if not found then raise exception 'Akun karyawan tidak ditemukan.'; end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.mambo_device_staff_list(p_device_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_store uuid; result jsonb;
begin
 select store_id into v_store from public.mambo_cashier_devices
 where token_hash=encode(digest(coalesce(p_device_token,''),'sha256'),'hex') and revoked_at is null;
 if v_store is null then raise exception 'Perangkat tidak valid atau telah dicabut.'; end if;
 update public.mambo_cashier_devices set last_seen_at=now()
 where token_hash=encode(digest(p_device_token,'sha256'),'hex');
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'username',username,'display_name',display_name,'app_role',app_role) order by display_name),'[]'::jsonb)
 into result from public.mambo_staff_accounts where store_id=v_store and active=true;
 return result;
end $$;

create or replace function public.mambo_device_staff_login(p_device_token text,p_username text,p_pin text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_store uuid; a public.mambo_staff_accounts%rowtype;
begin
 select store_id into v_store from public.mambo_cashier_devices
 where token_hash=encode(digest(coalesce(p_device_token,''),'sha256'),'hex') and revoked_at is null;
 if v_store is null then raise exception 'Perangkat tidak valid atau telah dicabut.'; end if;
 select * into a from public.mambo_staff_accounts
 where store_id=v_store and lower(username)=lower(trim(coalesce(p_username,''))) and active=true;
 if not found or a.pin_hash<>crypt(coalesce(p_pin,''),a.pin_hash) then
  raise exception 'Akun atau PIN tidak sesuai.';
 end if;
 update public.mambo_cashier_devices set last_seen_at=now()
 where token_hash=encode(digest(p_device_token,'sha256'),'hex');
 return jsonb_build_object('id',a.id,'username',a.username,'name',a.display_name,'role',a.app_role,'active',true);
end $$;

revoke all on function public.mambo_owner_staff_list(uuid) from public;
revoke all on function public.mambo_owner_staff_create(uuid,text,text,text,text) from public;
revoke all on function public.mambo_owner_staff_update(uuid,uuid,text,text,text,boolean) from public;
revoke all on function public.mambo_owner_staff_reset_pin(uuid,uuid,text) from public;
revoke all on function public.mambo_device_staff_list(text) from public;
revoke all on function public.mambo_device_staff_login(text,text,text) from public;
grant execute on function public.mambo_owner_staff_list(uuid) to authenticated;
grant execute on function public.mambo_owner_staff_create(uuid,text,text,text,text) to authenticated;
grant execute on function public.mambo_owner_staff_update(uuid,uuid,text,text,text,boolean) to authenticated;
grant execute on function public.mambo_owner_staff_reset_pin(uuid,uuid,text) to authenticated;
grant execute on function public.mambo_device_staff_list(text) to anon,authenticated;
grant execute on function public.mambo_device_staff_login(text,text,text) to anon,authenticated;
