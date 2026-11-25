-- MAMBO KASIR: shared cash drawer foundation (additive migration)
-- Apply only after schema.sql, device-pairing.sql, and staff-accounts.sql.
-- Does not rewrite or delete legacy shifts, transactions, or production records.
-- Shared cash movements are append-only and idempotent by event_id.

create table if not exists public.mambo_device_staff_sessions (
  token_hash text primary key,
  store_id uuid not null references public.mambo_stores(id) on delete cascade,
  device_id uuid not null references public.mambo_cashier_devices(id) on delete cascade,
  staff_id uuid not null references public.mambo_staff_accounts(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.mambo_device_staff_sessions enable row level security;
revoke all on public.mambo_device_staff_sessions from public, anon, authenticated;

create table if not exists public.mambo_shared_drawers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.mambo_stores(id) on delete cascade,
  status text not null check (status in ('open','closed')),
  opening_cash numeric(18,2) not null check (opening_cash >= 0),
  opened_by uuid not null,
  opened_by_name text not null,
  opened_at timestamptz not null default now(),
  closed_by uuid,
  closed_by_name text,
  closed_at timestamptz,
  counted_cash numeric(18,2),
  expected_cash numeric(18,2),
  difference numeric(18,2),
  created_at timestamptz not null default now()
);
create unique index if not exists mambo_one_open_shared_drawer_per_store
  on public.mambo_shared_drawers(store_id) where status = 'open';

create table if not exists public.mambo_shared_drawer_events (
  event_id uuid primary key,
  store_id uuid not null references public.mambo_stores(id) on delete cascade,
  drawer_id uuid not null references public.mambo_shared_drawers(id) on delete restrict,
  event_type text not null check (event_type in ('cash_sale','cash_in','cash_out','cash_expense','refund','adjustment')),
  amount numeric(18,2) not null check (amount > 0),
  source_record_id text,
  actor_id uuid not null,
  actor_name text not null,
  device_id uuid,
  note text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists mambo_drawer_events_store_time
  on public.mambo_shared_drawer_events(store_id, occurred_at);
create index if not exists mambo_drawer_events_drawer
  on public.mambo_shared_drawer_events(drawer_id, occurred_at);
alter table public.mambo_shared_drawers enable row level security;
alter table public.mambo_shared_drawer_events enable row level security;
revoke all on public.mambo_shared_drawers from public, anon, authenticated;
revoke all on public.mambo_shared_drawer_events from public, anon, authenticated;

-- Keep device sync aligned with the JS entity list. Legacy shift records may be imported
-- insert-only, but paired devices may no longer overwrite or close shift rows.
create or replace function public.mambo_device_sync_push(
 p_device_token text,p_records jsonb,p_insert_only boolean default false
) returns integer language plpgsql security definer set search_path=public,extensions
as $$
declare v_store uuid; v_row jsonb; v_count integer:=0; v_entity text; v_id text;
begin
 select store_id into v_store from public.mambo_cashier_devices
 where token_hash=encode(digest(coalesce(p_device_token,''),'sha256'),'hex') and revoked_at is null;
 if v_store is null then raise exception 'Perangkat tidak valid atau telah dicabut.'; end if;
 if jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>500 then
   raise exception 'Paket sinkronisasi tidak valid atau terlalu besar (maksimal 500 record).';
 end if;
 for v_row in select value from jsonb_array_elements(p_records) loop
  v_entity:=v_row->>'entity';v_id:=v_row->>'record_id';
  if v_entity not in ('transactions','shifts','movements','receivables','returns','auditLogs','opnames','purchases','payables','supplierPayments','promos','customers','suppliers','settings','operationalExpenses') then
   raise exception 'Jenis data tidak diizinkan: %',coalesce(v_entity,'(kosong)');
  end if;
  if v_entity='shifts' and not p_insert_only then
   raise exception 'Perubahan shift melalui sinkronisasi perangkat dinonaktifkan. Gunakan laci kas bersama.';
  end if;
  if coalesce(v_id,'')='' or jsonb_typeof(v_row->'payload')<>'object' then raise exception 'Record sinkronisasi tidak lengkap.'; end if;
  if p_insert_only then
   insert into public.mambo_sync_records(store_id,entity,record_id,payload,deleted,updated_at)
   values(v_store,v_entity,v_id,v_row->'payload',false,now())
   on conflict(store_id,entity,record_id) do nothing;
  else
   insert into public.mambo_sync_records(store_id,entity,record_id,payload,deleted,updated_at)
   values(v_store,v_entity,v_id,v_row->'payload',coalesce((v_row->>'deleted')::boolean,false),now())
   on conflict(store_id,entity,record_id) do update set payload=excluded.payload,deleted=excluded.deleted,updated_at=now();
  end if;
  v_count:=v_count+1;
 end loop;
 update public.mambo_cashier_devices set last_seen_at=now()
 where token_hash=encode(digest(p_device_token,'sha256'),'hex');
 return v_count;
end $$;

create or replace function public.mambo_device_sync_pull(p_device_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_store uuid;v_result jsonb;
begin
 select store_id into v_store from public.mambo_cashier_devices
 where token_hash=encode(digest(coalesce(p_device_token,''),'sha256'),'hex') and revoked_at is null;
 if v_store is null then raise exception 'Perangkat tidak valid atau telah dicabut.'; end if;
 update public.mambo_cashier_devices set last_seen_at=now()
 where token_hash=encode(digest(p_device_token,'sha256'),'hex');
 select coalesce(jsonb_agg(jsonb_build_object('entity',entity,'record_id',record_id,'payload',payload,'deleted',deleted)),'[]'::jsonb)
 into v_result from public.mambo_sync_records
 where store_id=v_store and entity in ('transactions','shifts','movements','receivables','returns','auditLogs','opnames','purchases','payables','supplierPayments','promos','customers','suppliers','settings','operationalExpenses');
 return v_result;
end $$;

-- Upgrade device PIN login to issue a short-lived staff session bound to the paired device.
create or replace function public.mambo_device_staff_login(p_device_token text,p_username text,p_pin text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_device public.mambo_cashier_devices%rowtype; a public.mambo_staff_accounts%rowtype;
  v_session text;
begin
 select * into v_device from public.mambo_cashier_devices
 where token_hash=encode(digest(coalesce(p_device_token,''),'sha256'),'hex') and revoked_at is null;
 if not found then raise exception 'Perangkat tidak valid atau telah dicabut.'; end if;
 select * into a from public.mambo_staff_accounts
 where store_id=v_device.store_id and lower(username)=lower(trim(coalesce(p_username,''))) and active=true;
 if not found or a.pin_hash<>crypt(coalesce(p_pin,''),a.pin_hash) then
   raise exception 'Akun atau PIN tidak sesuai.';
 end if;
 v_session:=encode(gen_random_bytes(32),'hex');
 insert into public.mambo_device_staff_sessions(token_hash,store_id,device_id,staff_id,expires_at)
 values(encode(digest(v_session,'sha256'),'hex'),v_device.store_id,v_device.id,a.id,now()+interval '12 hours');
 update public.mambo_cashier_devices set last_seen_at=now() where id=v_device.id;
 return jsonb_build_object('id',a.id,'username',a.username,'name',a.display_name,'role',a.app_role,
   'active',true,'staff_session_token',v_session,'staff_session_expires_at',now()+interval '12 hours',
   'device_id',v_device.id,'store_id',v_device.store_id);
end $$;

create or replace function public.mambo_device_staff_session_check(p_device_token text,p_staff_session_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v jsonb;
begin
 select jsonb_build_object('id',a.id,'username',a.username,'name',a.display_name,'role',a.app_role,
   'active',a.active,'device_id',d.id,'store_id',d.store_id)
 into v
 from public.mambo_device_staff_sessions s
 join public.mambo_cashier_devices d on d.id=s.device_id
 join public.mambo_staff_accounts a on a.id=s.staff_id
 where s.token_hash=encode(digest(coalesce(p_staff_session_token,''),'sha256'),'hex')
   and d.token_hash=encode(digest(coalesce(p_device_token,''),'sha256'),'hex')
   and d.revoked_at is null and s.revoked_at is null and s.expires_at>now() and a.active=true;
 if v is null then raise exception 'Sesi kasir tidak berlaku. Silakan login ulang.'; end if;
 return v;
end $$;

create or replace function public.mambo_device_staff_logout(p_device_token text,p_staff_session_token text)
returns boolean language plpgsql security definer set search_path=public,extensions
as $$
begin
 update public.mambo_device_staff_sessions s set revoked_at=now()
 from public.mambo_cashier_devices d
 where s.device_id=d.id
   and d.token_hash=encode(digest(coalesce(p_device_token,''),'sha256'),'hex')
   and s.token_hash=encode(digest(coalesce(p_staff_session_token,''),'sha256'),'hex')
   and s.revoked_at is null;
 return true;
end $$;

create or replace function public.mambo_shared_drawer_open(p_store_id uuid,p_opening_cash numeric,p_actor_name text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_id uuid;
begin
 if auth.uid() is null or not public.mambo_is_owner(p_store_id) then
   raise exception 'Hanya Owner yang dapat membuka laci kas bersama.';
 end if;
 if p_opening_cash is null or p_opening_cash<0 then raise exception 'Modal awal tidak valid.'; end if;
 insert into public.mambo_shared_drawers(store_id,status,opening_cash,opened_by,opened_by_name)
 values(p_store_id,'open',p_opening_cash,auth.uid(),coalesce(nullif(trim(p_actor_name),''),'Owner'))
 returning id into v_id;
 return public.mambo_shared_drawer_snapshot(p_store_id);
exception when unique_violation then
 raise exception 'Laci kas bersama toko sudah terbuka.';
end $$;

create or replace function public.mambo_shared_drawer_event(
 p_device_token text,p_staff_session_token text,p_event_id uuid,p_event_type text,p_amount numeric,
 p_source_record_id text default null,p_note text default null
) returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_staff jsonb; v_drawer public.mambo_shared_drawers%rowtype;
begin
 v_staff:=public.mambo_device_staff_session_check(p_device_token,p_staff_session_token);
 if p_event_id is null or p_amount is null or p_amount<=0 then raise exception 'Data pergerakan kas tidak valid.'; end if;
 if p_event_type not in ('cash_sale','cash_in','cash_out','cash_expense','refund','adjustment') then
   raise exception 'Jenis pergerakan kas tidak diizinkan.';
 end if;
 select * into v_drawer from public.mambo_shared_drawers
 where store_id=(v_staff->>'store_id')::uuid and status='open' for update;
 if not found then raise exception 'Laci kas bersama belum dibuka oleh Owner.'; end if;
 insert into public.mambo_shared_drawer_events(event_id,store_id,drawer_id,event_type,amount,
   source_record_id,actor_id,actor_name,device_id,note)
 values(p_event_id,(v_staff->>'store_id')::uuid,v_drawer.id,p_event_type,p_amount,
   p_source_record_id,(v_staff->>'id')::uuid,v_staff->>'name',(v_staff->>'device_id')::uuid,p_note)
 on conflict(event_id) do nothing;
 return public.mambo_shared_drawer_snapshot_internal((v_staff->>'store_id')::uuid);
end $$;

create or replace function public.mambo_shared_drawer_snapshot_internal(p_store_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_drawer public.mambo_shared_drawers%rowtype; v_sales numeric(18,2); v_in numeric(18,2);
 v_out numeric(18,2); v_refund numeric(18,2); v_events jsonb;
begin
 select * into v_drawer from public.mambo_shared_drawers
 where store_id=p_store_id and status='open' order by opened_at desc limit 1;
 if not found then return jsonb_build_object('open',false,'store_id',p_store_id); end if;
 select
  coalesce(sum(amount) filter(where event_type='cash_sale'),0),
  coalesce(sum(amount) filter(where event_type='cash_in'),0),
  coalesce(sum(amount) filter(where event_type in ('cash_out','cash_expense')),0),
  coalesce(sum(amount) filter(where event_type='refund'),0),
  coalesce(jsonb_agg(jsonb_build_object('event_id',event_id,'event_type',event_type,'amount',amount,
    'actor_id',actor_id,'actor_name',actor_name,'device_id',device_id,'note',note,'occurred_at',occurred_at)
    order by occurred_at),'[]'::jsonb)
 into v_sales,v_in,v_out,v_refund,v_events
 from public.mambo_shared_drawer_events where drawer_id=v_drawer.id;
 return jsonb_build_object('open',true,'drawer_id',v_drawer.id,'opening_cash',v_drawer.opening_cash,
   'cash_sales',v_sales,'cash_in',v_in,'cash_out',v_out,'refund',v_refund,
   'expected_cash',v_drawer.opening_cash+v_sales+v_in-v_out-v_refund,
   'opened_at',v_drawer.opened_at,'opened_by',v_drawer.opened_by_name,'events',v_events);
end $$;

create or replace function public.mambo_shared_drawer_snapshot(
 p_store_id uuid,p_device_token text default null,p_staff_session_token text default null
) returns jsonb language plpgsql security definer set search_path=public
as $$
begin
 if auth.uid() is not null then
   if not public.mambo_is_member(p_store_id) then raise exception 'Akses toko ditolak.'; end if;
 elsif p_device_token is not null and p_staff_session_token is not null then
   perform public.mambo_device_staff_session_check(p_device_token,p_staff_session_token);
   if not exists(select 1 from public.mambo_device_staff_sessions s
      join public.mambo_cashier_devices d on d.id=s.device_id
      where s.token_hash=encode(digest(p_staff_session_token,'sha256'),'hex')
        and d.token_hash=encode(digest(p_device_token,'sha256'),'hex') and s.store_id=p_store_id) then
     raise exception 'Sesi kasir tidak memiliki akses ke toko ini.';
   end if;
 else
   raise exception 'Autentikasi diperlukan.';
 end if;
 return public.mambo_shared_drawer_snapshot_internal(p_store_id);
end $$;

create or replace function public.mambo_shared_drawer_owner_event(
 p_store_id uuid,p_event_id uuid,p_event_type text,p_amount numeric,
 p_source_record_id text default null,p_note text default null,p_actor_name text default 'Owner'
) returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_drawer public.mambo_shared_drawers%rowtype;
begin
 if auth.uid() is null or not public.mambo_is_owner(p_store_id) then
   raise exception 'Hanya Owner toko yang dapat mencatat aktivitas laci ini.';
 end if;
 if p_event_id is null or p_amount is null or p_amount<=0 then raise exception 'Data pergerakan kas tidak valid.'; end if;
 if p_event_type not in ('cash_sale','cash_in','cash_out','cash_expense','refund','adjustment') then raise exception 'Jenis pergerakan kas tidak diizinkan.'; end if;
 select * into v_drawer from public.mambo_shared_drawers where store_id=p_store_id and status='open' for update;
 if not found then raise exception 'Laci kas bersama belum dibuka.'; end if;
 insert into public.mambo_shared_drawer_events(event_id,store_id,drawer_id,event_type,amount,
   source_record_id,actor_id,actor_name,device_id,note)
 values(p_event_id,p_store_id,v_drawer.id,p_event_type,p_amount,p_source_record_id,auth.uid(),
   coalesce(nullif(trim(p_actor_name),''),'Owner'),null,p_note)
 on conflict(event_id) do nothing;
 return public.mambo_shared_drawer_snapshot_internal(p_store_id);
end $$;

create or replace function public.mambo_shared_drawer_close(p_store_id uuid,p_counted_cash numeric,p_actor_name text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_drawer public.mambo_shared_drawers%rowtype; v_snapshot jsonb; v_expected numeric(18,2);
begin
 if auth.uid() is null or not public.mambo_is_owner(p_store_id) then
   raise exception 'Hanya Owner yang dapat menutup laci kas bersama.';
 end if;
 if p_counted_cash is null or p_counted_cash<0 then raise exception 'Uang fisik tidak valid.'; end if;
 select * into v_drawer from public.mambo_shared_drawers
 where store_id=p_store_id and status='open' for update;
 if not found then raise exception 'Tidak ada laci kas bersama yang terbuka.'; end if;
 v_snapshot:=public.mambo_shared_drawer_snapshot_internal(p_store_id);
 v_expected:=(v_snapshot->>'expected_cash')::numeric;
 update public.mambo_shared_drawers set status='closed',closed_by=auth.uid(),
   closed_by_name=coalesce(nullif(trim(p_actor_name),''),'Owner'),closed_at=now(),
   counted_cash=p_counted_cash,expected_cash=v_expected,difference=p_counted_cash-v_expected
 where id=v_drawer.id;
 return jsonb_build_object('drawer_id',v_drawer.id,'expected_cash',v_expected,
   'counted_cash',p_counted_cash,'difference',p_counted_cash-v_expected,'closed_at',now());
end $$;


-- Owner-controlled supervisor permission. Missing setting means disabled.
create table if not exists public.mambo_shared_drawer_settings (
 store_id uuid primary key references public.mambo_stores(id) on delete cascade,
 supervisor_control boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table public.mambo_shared_drawer_settings enable row level security;
revoke all on public.mambo_shared_drawer_settings from public,anon,authenticated;

create or replace function public.mambo_shared_drawer_supervisor_status(p_store_id uuid)
returns boolean language plpgsql security definer set search_path=public
as $$
begin
 if auth.uid() is null or not public.mambo_is_member(p_store_id) then raise exception 'Akses toko ditolak.'; end if;
 return coalesce((select supervisor_control from public.mambo_shared_drawer_settings where store_id=p_store_id),false);
end $$;

create or replace function public.mambo_shared_drawer_supervisor_setting(p_store_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public
as $$
begin
 if auth.uid() is null or not public.mambo_is_owner(p_store_id) then
  raise exception 'Hanya Owner yang dapat mengubah izin Supervisor.';
 end if;
 insert into public.mambo_shared_drawer_settings(store_id,supervisor_control,updated_at)
 values(p_store_id,coalesce(p_enabled,false),now())
 on conflict(store_id) do update set supervisor_control=excluded.supervisor_control,updated_at=now();
 return coalesce(p_enabled,false);
end $$;

create or replace function public.mambo_shared_drawer_supervisor_control(
 p_device_token text,p_staff_session_token text,p_action text,
 p_opening_cash numeric default null,p_counted_cash numeric default null,p_actor_name text default 'Supervisor'
) returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_staff jsonb;v_store uuid;v_drawer public.mambo_shared_drawers%rowtype;v_snapshot jsonb;v_expected numeric(18,2);
begin
 v_staff:=public.mambo_device_staff_session_check(p_device_token,p_staff_session_token);
 v_store:=(v_staff->>'store_id')::uuid;
 if coalesce(v_staff->>'role','')<>'supervisor' then raise exception 'Aksi ini hanya untuk Supervisor.'; end if;
 if not exists(select 1 from public.mambo_shared_drawer_settings where store_id=v_store and supervisor_control=true) then
  raise exception 'Izin Supervisor belum diaktifkan oleh Owner.';
 end if;
 if p_action='open' then
  if p_opening_cash is null or p_opening_cash<0 then raise exception 'Modal awal tidak valid.'; end if;
  insert into public.mambo_shared_drawers(store_id,status,opening_cash,opened_by,opened_by_name)
  values(v_store,'open',p_opening_cash,(v_staff->>'id')::uuid,coalesce(nullif(trim(p_actor_name),''),'Supervisor'));
  return public.mambo_shared_drawer_snapshot_internal(v_store);
 elsif p_action='close' then
  if p_counted_cash is null or p_counted_cash<0 then raise exception 'Uang fisik tidak valid.'; end if;
  select * into v_drawer from public.mambo_shared_drawers where store_id=v_store and status='open' for update;
  if not found then raise exception 'Tidak ada laci kas yang terbuka.'; end if;
  v_snapshot:=public.mambo_shared_drawer_snapshot_internal(v_store);
  v_expected:=(v_snapshot->>'expected_cash')::numeric;
  update public.mambo_shared_drawers set status='closed',closed_by=(v_staff->>'id')::uuid,
   closed_by_name=coalesce(nullif(trim(p_actor_name),''),'Supervisor'),closed_at=now(),
   counted_cash=p_counted_cash,expected_cash=v_expected,difference=p_counted_cash-v_expected
  where id=v_drawer.id;
  return jsonb_build_object('drawer_id',v_drawer.id,'expected_cash',v_expected,'counted_cash',p_counted_cash,
   'difference',p_counted_cash-v_expected,'closed_at',now());
 else raise exception 'Aksi Supervisor tidak dikenal.'; end if;
exception when unique_violation then raise exception 'Laci kas bersama toko sudah terbuka.';
end $$;

revoke all on function public.mambo_device_staff_login(text,text,text) from public;
revoke all on function public.mambo_device_staff_session_check(text,text) from public;
revoke all on function public.mambo_device_staff_logout(text,text) from public;
revoke all on function public.mambo_shared_drawer_open(uuid,numeric,text) from public,anon;
revoke all on function public.mambo_shared_drawer_event(text,text,uuid,text,numeric,text,text) from public;
revoke all on function public.mambo_shared_drawer_snapshot(uuid,text,text) from public;
revoke all on function public.mambo_shared_drawer_snapshot_internal(uuid) from public,anon,authenticated;
revoke all on function public.mambo_shared_drawer_owner_event(uuid,uuid,text,numeric,text,text,text) from public,anon;
revoke all on function public.mambo_shared_drawer_close(uuid,numeric,text) from public,anon;
revoke all on function public.mambo_shared_drawer_supervisor_setting(uuid,boolean) from public,anon;
revoke all on function public.mambo_shared_drawer_supervisor_status(uuid) from public,anon;
revoke all on function public.mambo_shared_drawer_supervisor_control(text,text,text,numeric,numeric,text) from public;
grant execute on function public.mambo_device_staff_login(text,text,text) to anon,authenticated;
grant execute on function public.mambo_device_staff_session_check(text,text) to anon,authenticated;
grant execute on function public.mambo_device_staff_logout(text,text) to anon,authenticated;
grant execute on function public.mambo_shared_drawer_open(uuid,numeric,text) to authenticated;
grant execute on function public.mambo_shared_drawer_event(text,text,uuid,text,numeric,text,text) to anon,authenticated;
grant execute on function public.mambo_shared_drawer_snapshot(uuid,text,text) to anon,authenticated;
grant execute on function public.mambo_shared_drawer_owner_event(uuid,uuid,text,numeric,text,text,text) to authenticated;
grant execute on function public.mambo_shared_drawer_close(uuid,numeric,text) to authenticated;
grant execute on function public.mambo_shared_drawer_supervisor_setting(uuid,boolean) to authenticated;
grant execute on function public.mambo_shared_drawer_supervisor_status(uuid) to authenticated;
grant execute on function public.mambo_shared_drawer_supervisor_control(text,text,text,numeric,numeric,text) to anon,authenticated;

notify pgrst, 'reload schema';
