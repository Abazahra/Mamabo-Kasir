-- MAMBO KASIR: Owner-managed job positions and staff invitations
-- Additive only. Existing staff, devices, sessions, and operational records are retained.
create table if not exists public.mambo_staff_roles (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.mambo_stores(id) on delete cascade,
 title text not null,
 permission_role text not null check (permission_role in ('supervisor','cashier')),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 unique(store_id,id)
);
create unique index if not exists mambo_staff_roles_title_unique
 on public.mambo_staff_roles(store_id,lower(title));
alter table public.mambo_staff_accounts
 add column if not exists staff_role_id uuid,
 add column if not exists password_hash text,
 add column if not exists must_change_password boolean not null default true,
 add column if not exists invite_token_hash text,
 add column if not exists invite_expires_at timestamptz,
 add column if not exists last_login_at timestamptz;
alter table public.mambo_staff_accounts
 add constraint mambo_staff_accounts_role_fk
 foreign key(store_id,staff_role_id) references public.mambo_staff_roles(store_id,id);
alter table public.mambo_staff_roles enable row level security;
revoke all on public.mambo_staff_roles from public,anon,authenticated;

-- Preserve current Kasir/Supervisor accounts by mapping their existing permission class.
insert into public.mambo_staff_roles(store_id,title,permission_role)
select distinct store_id,case when app_role='cashier' then 'Kasir' else 'Supervisor' end,app_role
from public.mambo_staff_accounts
on conflict(store_id,lower(title)) do nothing;
update public.mambo_staff_accounts a
set staff_role_id=r.id
from public.mambo_staff_roles r
where a.staff_role_id is null and r.store_id=a.store_id and r.permission_role=a.app_role
 and lower(r.title)=lower(case when a.app_role='cashier' then 'Kasir' else 'Supervisor' end);

create or replace function public.mambo_owner_staff_roles(p_store_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v jsonb;
begin
 if auth.uid() is null or not public.mambo_is_owner(p_store_id) then raise exception 'Akses hanya untuk Owner toko.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'permission_role',permission_role,'active',active) order by title),'[]'::jsonb)
 into v from public.mambo_staff_roles where store_id=p_store_id;
 return v;
end $$;

create or replace function public.mambo_owner_staff_role_save(p_store_id uuid,p_role_id uuid,p_title text,p_permission_role text,p_active boolean default true)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_id uuid;
begin
 if auth.uid() is null or not public.mambo_is_owner(p_store_id) then raise exception 'Akses hanya untuk Owner toko.'; end if;
 if length(trim(coalesce(p_title,'')))<2 or length(trim(p_title))>40 then raise exception 'Nama jabatan harus 2–40 karakter.'; end if;
 if p_permission_role not in ('supervisor','cashier') then raise exception 'Pola akses harus Supervisor atau Kasir.'; end if;
 if p_role_id is null then
  insert into public.mambo_staff_roles(store_id,title,permission_role,active)
  values(p_store_id,trim(p_title),p_permission_role,coalesce(p_active,true)) returning id into v_id;
 else
  update public.mambo_staff_roles set title=trim(p_title),permission_role=p_permission_role,active=coalesce(p_active,false)
  where id=p_role_id and store_id=p_store_id returning id into v_id;
  if v_id is null then raise exception 'Jabatan tidak ditemukan.'; end if;
 end if;
 return jsonb_build_object('id',v_id);
end $$;

create or replace function public.mambo_owner_staff_invite(p_store_id uuid,p_username text,p_display_name text,p_role_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_role public.mambo_staff_roles%rowtype; v_id uuid; v_token text;
begin
 if auth.uid() is null or not public.mambo_is_owner(p_store_id) then raise exception 'Akses hanya untuk Owner toko.'; end if;
 if coalesce(p_username,'') !~ '^[A-Za-z0-9._-]{3,32}$' then raise exception 'Username harus 3–32 karakter.'; end if;
 if length(trim(coalesce(p_display_name,'')))<2 or length(trim(p_display_name))>80 then raise exception 'Nama karyawan harus 2–80 karakter.'; end if;
 select * into v_role from public.mambo_staff_roles where id=p_role_id and store_id=p_store_id and active=true;
 if not found then raise exception 'Jabatan belum dibuat atau sedang nonaktif.'; end if;
 v_token:=encode(gen_random_bytes(32),'hex');
 insert into public.mambo_staff_accounts(store_id,username,display_name,app_role,staff_role_id,pin_salt,pin_hash,active,invite_token_hash,invite_expires_at,password_hash,must_change_password)
 values(p_store_id,trim(p_username),trim(p_display_name),v_role.permission_role,p_role_id,gen_random_uuid()::text,crypt(encode(gen_random_bytes(16),'hex'),gen_salt('bf',10)),true,encode(digest(v_token,'sha256'),'hex'),now()+interval '7 days',null,true)
 returning id into v_id;
 return jsonb_build_object('id',v_id,'invite_token',v_token,'expires_at',now()+interval '7 days','username',trim(p_username),'job_title',v_role.title);
end $$;

create or replace function public.mambo_device_staff_list(p_device_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_store uuid; v_result jsonb;
begin
 select store_id into v_store from public.mambo_cashier_devices
 where token_hash=encode(digest(coalesce(p_device_token,''),'sha256'),'hex') and revoked_at is null;
 if v_store is null then raise exception 'Perangkat tidak valid atau telah dicabut.'; end if;
 update public.mambo_cashier_devices set last_seen_at=now()
 where token_hash=encode(digest(p_device_token,'sha256'),'hex');
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'username',a.username,'display_name',a.display_name,
  'app_role',a.app_role,'job_title',r.title,'credential_ready',a.password_hash is not null)
  order by r.title,a.display_name),'[]'::jsonb)
 into v_result from public.mambo_staff_accounts a
 join public.mambo_staff_roles r on r.id=a.staff_role_id and r.store_id=a.store_id
 where a.store_id=v_store and a.active=true and r.active=true;
 return v_result;
end $$;

create or replace function public.mambo_staff_invitation_info(p_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v jsonb;
begin
 select jsonb_build_object('username',a.username,'display_name',a.display_name,'job_title',r.title,'store_name',s.store_name,'expires_at',a.invite_expires_at)
 into v
 from public.mambo_staff_accounts a join public.mambo_staff_roles r on r.id=a.staff_role_id
 join public.mambo_stores s on s.id=a.store_id
 where a.invite_token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
 and a.active=true and r.active=true and a.invite_expires_at>now();
 if v is null then raise exception 'Undangan tidak valid, sudah digunakan, atau kedaluwarsa.'; end if;
 return v;
end $$;

create or replace function public.mambo_staff_invitation_accept(p_token text,p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_id uuid;
begin
 if length(coalesce(p_password,''))<8 or length(p_password)>128 then raise exception 'Password harus 8–128 karakter.'; end if;
 update public.mambo_staff_accounts set password_hash=crypt(p_password,gen_salt('bf',10)),must_change_password=false,
  invite_token_hash=null,invite_expires_at=null,updated_at=now()
 where invite_token_hash=encode(digest(coalesce(p_token,''),'sha256'),'hex')
 and active=true and invite_expires_at>now()
 returning id into v_id;
 if v_id is null then raise exception 'Undangan tidak valid, sudah digunakan, atau kedaluwarsa.'; end if;
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.mambo_device_staff_login(p_device_token text,p_username text,p_pin text)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_device public.mambo_cashier_devices%rowtype; a public.mambo_staff_accounts%rowtype; v_session text; v_role public.mambo_staff_roles%rowtype;
begin
 select * into v_device from public.mambo_cashier_devices
 where token_hash=encode(digest(coalesce(p_device_token,''),'sha256'),'hex') and revoked_at is null;
 if not found then raise exception 'Perangkat tidak valid atau telah dicabut.'; end if;
 select * into a from public.mambo_staff_accounts where store_id=v_device.store_id
 and lower(username)=lower(trim(coalesce(p_username,''))) and active=true;
 if not found or (a.password_hash is null and a.pin_hash<>crypt(coalesce(p_pin,''),a.pin_hash))
   or (a.password_hash is not null and a.password_hash<>crypt(coalesce(p_pin,''),a.password_hash)) then
  raise exception 'Username atau password/PIN tidak sesuai.';
 end if;
 select * into v_role from public.mambo_staff_roles where id=a.staff_role_id and store_id=a.store_id and active=true;
 if not found then raise exception 'Jabatan akun ini sudah tidak aktif. Hubungi Owner.'; end if;
 v_session:=encode(gen_random_bytes(32),'hex');
 insert into public.mambo_device_staff_sessions(token_hash,store_id,device_id,staff_id,expires_at)
 values(encode(digest(v_session,'sha256'),'hex'),v_device.store_id,v_device.id,a.id,now()+interval '12 hours');
 update public.mambo_cashier_devices set last_seen_at=now() where id=v_device.id;
 update public.mambo_staff_accounts set last_login_at=now() where id=a.id;
 return jsonb_build_object('id',a.id,'username',a.username,'name',a.display_name,'role',v_role.permission_role,
  'job_title',v_role.title,'active',true,'staff_session_token',v_session,'staff_session_expires_at',now()+interval '12 hours',
  'device_id',v_device.id,'store_id',v_device.store_id);
end $$;

create or replace function public.mambo_owner_staff_list(p_store_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v jsonb;
begin
 if auth.uid() is null or not public.mambo_is_owner(p_store_id) then raise exception 'Akses hanya untuk Owner toko.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'username',a.username,'display_name',a.display_name,
  'app_role',a.app_role,'job_title',r.title,'staff_role_id',a.staff_role_id,'active',a.active,
  'credential_ready',a.password_hash is not null,'last_login_at',a.last_login_at) order by a.created_at),'[]'::jsonb)
 into v from public.mambo_staff_accounts a left join public.mambo_staff_roles r on r.id=a.staff_role_id
 where a.store_id=p_store_id;
 return v;
end $$;

create or replace function public.mambo_owner_staff_invite_reset(p_store_id uuid,p_staff_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_token text; v_username text; v_title text;
begin
 if auth.uid() is null or not public.mambo_is_owner(p_store_id) then raise exception 'Akses hanya untuk Owner toko.'; end if;
 v_token:=encode(gen_random_bytes(32),'hex');
 update public.mambo_staff_accounts a set invite_token_hash=encode(digest(v_token,'sha256'),'hex'),
  invite_expires_at=now()+interval '7 days',password_hash=null,must_change_password=true,updated_at=now()
 from public.mambo_staff_roles r where a.id=p_staff_id and a.store_id=p_store_id and r.id=a.staff_role_id
 returning a.username,r.title into v_username,v_title;
 if v_username is null then raise exception 'Akun karyawan tidak ditemukan.'; end if;
 return jsonb_build_object('invite_token',v_token,'expires_at',now()+interval '7 days','username',v_username,'job_title',v_title);
end $$;

create or replace function public.mambo_owner_staff_update(p_store_id uuid,p_staff_id uuid,p_username text,p_display_name text,p_role_id uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_role public.mambo_staff_roles%rowtype;
begin
 if auth.uid() is null or not public.mambo_is_owner(p_store_id) then raise exception 'Akses hanya untuk Owner toko.'; end if;
 select * into v_role from public.mambo_staff_roles where id=p_role_id and store_id=p_store_id and active=true;
 if not found then raise exception 'Jabatan belum dibuat atau sedang nonaktif.'; end if;
 if p_username !~ '^[A-Za-z0-9._-]{3,32}$' then raise exception 'Format username tidak valid.'; end if;
 if length(trim(coalesce(p_display_name,'')))<2 or length(trim(p_display_name))>80 then raise exception 'Nama karyawan harus 2–80 karakter.'; end if;
 update public.mambo_staff_accounts set username=trim(p_username),display_name=trim(p_display_name),
  app_role=v_role.permission_role,staff_role_id=p_role_id,active=coalesce(p_active,false),updated_at=now()
 where id=p_staff_id and store_id=p_store_id;
 if not found then raise exception 'Akun karyawan tidak ditemukan.'; end if;
 return jsonb_build_object('ok',true);
end $$;

revoke all on function public.mambo_owner_staff_roles(uuid) from public;
revoke all on function public.mambo_owner_staff_role_save(uuid,uuid,text,text,boolean) from public;
revoke all on function public.mambo_owner_staff_invite(uuid,text,text,uuid) from public;
revoke all on function public.mambo_owner_staff_invite_reset(uuid,uuid) from public;
revoke all on function public.mambo_owner_staff_list(uuid) from public;
revoke all on function public.mambo_owner_staff_update(uuid,uuid,text,text,uuid,boolean) from public;
revoke all on function public.mambo_staff_invitation_info(text) from public;
revoke all on function public.mambo_staff_invitation_accept(text,text) from public;
revoke all on function public.mambo_device_staff_list(text) from public;
revoke all on function public.mambo_device_staff_login(text,text,text) from public;
grant execute on function public.mambo_owner_staff_roles(uuid) to authenticated;
grant execute on function public.mambo_owner_staff_role_save(uuid,uuid,text,text,boolean) to authenticated;
grant execute on function public.mambo_owner_staff_invite(uuid,text,text,uuid) to authenticated;
grant execute on function public.mambo_owner_staff_invite_reset(uuid,uuid) to authenticated;
grant execute on function public.mambo_owner_staff_list(uuid) to authenticated;
grant execute on function public.mambo_owner_staff_update(uuid,uuid,text,text,uuid,boolean) to authenticated;
grant execute on function public.mambo_staff_invitation_info(text) to anon,authenticated;
grant execute on function public.mambo_staff_invitation_accept(text,text) to anon,authenticated;
grant execute on function public.mambo_device_staff_list(text) to anon,authenticated;
grant execute on function public.mambo_device_staff_login(text,text,text) to anon,authenticated;
notify pgrst,'reload schema';

create or replace function public.mambo_device_staff_roles(p_device_token text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_store uuid; v_result jsonb;
begin
 select store_id into v_store from public.mambo_cashier_devices
 where token_hash=encode(digest(coalesce(p_device_token,''),'sha256'),'hex') and revoked_at is null;
 if v_store is null then raise exception 'Perangkat tidak valid atau telah dicabut.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title) order by title),'[]'::jsonb)
 into v_result from public.mambo_staff_roles where store_id=v_store and active=true;
 return v_result;
end $$;

create or replace function public.mambo_device_staff_login(p_device_token text,p_username text,p_pin text,p_role_id uuid)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare v_device public.mambo_cashier_devices%rowtype; a public.mambo_staff_accounts%rowtype;
 v_session text; v_role public.mambo_staff_roles%rowtype;
begin
 select * into v_device from public.mambo_cashier_devices
 where token_hash=encode(digest(coalesce(p_device_token,''),'sha256'),'hex') and revoked_at is null;
 if not found then raise exception 'Perangkat tidak valid atau telah dicabut.'; end if;
 select * into a from public.mambo_staff_accounts where store_id=v_device.store_id
 and lower(username)=lower(trim(coalesce(p_username,''))) and active=true;
 if not found or a.staff_role_id is distinct from p_role_id
   or (a.password_hash is null and a.pin_hash<>crypt(coalesce(p_pin,''),a.pin_hash))
   or (a.password_hash is not null and a.password_hash<>crypt(coalesce(p_pin,''),a.password_hash)) then
  raise exception 'Jabatan, username, atau password tidak sesuai.';
 end if;
 select * into v_role from public.mambo_staff_roles where id=a.staff_role_id and store_id=a.store_id and active=true;
 if not found then raise exception 'Jabatan akun ini sudah tidak aktif. Hubungi Owner.'; end if;
 v_session:=encode(gen_random_bytes(32),'hex');
 insert into public.mambo_device_staff_sessions(token_hash,store_id,device_id,staff_id,expires_at)
 values(encode(digest(v_session,'sha256'),'hex'),v_device.store_id,v_device.id,a.id,now()+interval '12 hours');
 update public.mambo_cashier_devices set last_seen_at=now() where id=v_device.id;
 update public.mambo_staff_accounts set last_login_at=now() where id=a.id;
 return jsonb_build_object('id',a.id,'username',a.username,'name',a.display_name,'role',v_role.permission_role,
  'job_title',v_role.title,'active',true,'staff_session_token',v_session,'staff_session_expires_at',now()+interval '12 hours',
  'device_id',v_device.id,'store_id',v_device.store_id);
end $$;
revoke all on function public.mambo_device_staff_roles(text) from public;
grant execute on function public.mambo_device_staff_roles(text) to anon,authenticated;
revoke all on function public.mambo_device_staff_login(text,text,text,uuid) from public;
grant execute on function public.mambo_device_staff_login(text,text,text,uuid) to anon,authenticated;

create or replace function public.mambo_device_staff_session_check(p_device_token text,p_staff_session_token text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v jsonb;
begin
 select jsonb_build_object('id',a.id,'username',a.username,'name',a.display_name,
  'role',r.permission_role,'job_title',r.title,'active',a.active,'device_id',d.id,'store_id',d.store_id)
 into v
 from public.mambo_device_staff_sessions s
 join public.mambo_cashier_devices d on d.id=s.device_id
 join public.mambo_staff_accounts a on a.id=s.staff_id
 join public.mambo_staff_roles r on r.id=a.staff_role_id and r.store_id=a.store_id
 where s.token_hash=encode(digest(coalesce(p_staff_session_token,''),'sha256'),'hex')
 and d.token_hash=encode(digest(coalesce(p_device_token,''),'sha256'),'hex')
 and d.revoked_at is null and s.revoked_at is null and s.expires_at>now()
 and a.active=true and r.active=true;
 if v is null then raise exception 'Sesi karyawan tidak berlaku atau jabatan sudah dinonaktifkan. Silakan login ulang.'; end if;
 return v;
end $$;
revoke all on function public.mambo_device_staff_login(text,text,text) from public,anon,authenticated;
revoke all on function public.mambo_device_staff_session_check(text,text) from public;
grant execute on function public.mambo_device_staff_session_check(text,text) to anon,authenticated;
