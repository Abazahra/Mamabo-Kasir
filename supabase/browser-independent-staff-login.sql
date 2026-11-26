-- MAMBO KASIR: browser-independent staff login
-- The browser is registered automatically only after valid staff credentials.
-- Existing devices, accounts, shifts, transactions, products and stock are retained.

create or replace function public.mambo_staff_login_auto(
  p_username text,
  p_password text,
  p_device_label text default 'Browser otomatis',
  p_existing_device_token text default null
)
returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare
  v_matches integer;
  v_staff public.mambo_staff_accounts%rowtype;
  v_role public.mambo_staff_roles%rowtype;
  v_device_id uuid;
  v_device_token text;
  v_session_token text;
  v_label text;
begin
  if length(trim(coalesce(p_username,''))) < 3 or length(coalesce(p_password,'')) < 4 then
    raise exception 'Username atau password/PIN belum lengkap.';
  end if;
  select count(*) into v_matches
  from public.mambo_staff_accounts sa
  join public.mambo_staff_roles sr on sr.id=sa.staff_role_id and sr.store_id=sa.store_id
  where lower(sa.username)=lower(trim(p_username)) and sa.active=true and sr.active=true;
  if v_matches=0 then
    raise exception 'Username atau password/PIN tidak sesuai, atau akun tidak aktif.';
  elsif v_matches>1 then
    raise exception 'Username ini terdaftar pada lebih dari satu toko. Hubungi Owner.';
  end if;
  select sa.* into v_staff
  from public.mambo_staff_accounts sa
  join public.mambo_staff_roles sr on sr.id=sa.staff_role_id and sr.store_id=sa.store_id
  where lower(sa.username)=lower(trim(p_username)) and sa.active=true and sr.active=true
  limit 1;
  if v_staff.password_hash is not null then
    if v_staff.password_hash <> crypt(coalesce(p_password,''),v_staff.password_hash) then
      raise exception 'Username atau password/PIN tidak sesuai, atau akun tidak aktif.';
    end if;
  elsif v_staff.pin_hash <> crypt(coalesce(p_password,''),v_staff.pin_hash) then
    raise exception 'Username atau password/PIN tidak sesuai, atau akun tidak aktif.';
  end if;
  select * into v_role from public.mambo_staff_roles
  where id=v_staff.staff_role_id and store_id=v_staff.store_id and active=true;
  if not found then raise exception 'Jabatan akun ini tidak aktif. Hubungi Owner.'; end if;
  v_label:=left(coalesce(nullif(trim(p_device_label),''),'Browser otomatis'),80);
  v_device_token:=nullif(trim(coalesce(p_existing_device_token,'')),'');
  if v_device_token is not null then
    select id into v_device_id from public.mambo_cashier_devices
    where token_hash=encode(digest(v_device_token,'sha256'),'hex')
      and store_id=v_staff.store_id and revoked_at is null limit 1;
  end if;
  if v_device_id is null then
    v_device_token:=encode(gen_random_bytes(32),'hex');
    insert into public.mambo_cashier_devices(store_id,label,token_hash)
    values(v_staff.store_id,v_label,encode(digest(v_device_token,'sha256'),'hex'))
    returning id into v_device_id;
  else
    update public.mambo_cashier_devices set last_seen_at=now(),label=v_label where id=v_device_id;
  end if;
  update public.mambo_device_staff_sessions set revoked_at=now()
  where device_id=v_device_id and staff_id=v_staff.id and revoked_at is null;
  v_session_token:=encode(gen_random_bytes(32),'hex');
  insert into public.mambo_device_staff_sessions(token_hash,store_id,device_id,staff_id,expires_at)
  values(encode(digest(v_session_token,'sha256'),'hex'),v_staff.store_id,v_device_id,v_staff.id,now()+interval '12 hours');
  update public.mambo_staff_accounts set last_login_at=now(),updated_at=now() where id=v_staff.id;
  return jsonb_build_object('id',v_staff.id,'username',v_staff.username,'name',v_staff.display_name,
    'role',v_role.permission_role,'job_title',v_role.title,'active',true,
    'device_token',v_device_token,'staff_session_token',v_session_token,
    'staff_session_expires_at',now()+interval '12 hours','device_id',v_device_id,'store_id',v_staff.store_id);
end;
$$;
revoke all on function public.mambo_staff_login_auto(text,text,text,text) from public;
grant execute on function public.mambo_staff_login_auto(text,text,text,text) to anon,authenticated;
