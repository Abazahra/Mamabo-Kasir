-- MAMBO KASIR: tambah entitas biaya operasional ke sinkronisasi multi-perangkat.
-- Jalankan sekali di Supabase SQL Editor. Tidak menghapus atau mengubah record lama.
alter table public.mambo_sync_records drop constraint if exists mambo_sync_records_entity_check;
alter table public.mambo_sync_records add constraint mambo_sync_records_entity_check
 check (entity in ('products','suppliers','movements','transactions','shifts','auditLogs','categories','customers','opnames','settings','receivables','promos','returns','purchases','payables','supplierPayments','operationalExpenses'));
create or replace function public.mambo_device_sync_push(p_device_token text,p_records jsonb,p_insert_only boolean default false)
returns integer language plpgsql security definer set search_path=public,extensions as $$
declare v_store uuid;v_row jsonb;v_count integer:=0;v_entity text;v_id text;
begin
 select store_id into v_store from public.mambo_cashier_devices where token_hash=encode(digest(coalesce(p_device_token,''),'sha256'),'hex') and revoked_at is null;
 if v_store is null then raise exception 'Perangkat tidak valid atau telah dicabut.'; end if;
 if jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)>500 then raise exception 'Paket sinkronisasi tidak valid atau terlalu besar (maksimal 500 record).'; end if;
 for v_row in select value from jsonb_array_elements(p_records) loop
  v_entity:=v_row->>'entity';v_id:=v_row->>'record_id';
  if v_entity not in ('transactions','shifts','movements','receivables','returns','auditLogs','opnames','purchases','payables','supplierPayments','promos','customers','suppliers','settings','operationalExpenses') then raise exception 'Jenis data tidak diizinkan: %',coalesce(v_entity,'(kosong)'); end if;
  if coalesce(v_id,'')='' or jsonb_typeof(v_row->'payload')<>'object' then raise exception 'Record sinkronisasi tidak lengkap.'; end if;
  if p_insert_only then
   insert into public.mambo_sync_records(store_id,entity,record_id,payload,deleted,updated_at) values(v_store,v_entity,v_id,v_row->'payload',false,now()) on conflict(store_id,entity,record_id) do nothing;
  else
   insert into public.mambo_sync_records(store_id,entity,record_id,payload,deleted,updated_at) values(v_store,v_entity,v_id,v_row->'payload',coalesce((v_row->>'deleted')::boolean,false),now()) on conflict(store_id,entity,record_id) do update set payload=excluded.payload,deleted=excluded.deleted,updated_at=now();
  end if;
  v_count:=v_count+1;
 end loop;
 update public.mambo_cashier_devices set last_seen_at=now() where token_hash=encode(digest(p_device_token,'sha256'),'hex');
 return v_count;
end $$;
create or replace function public.mambo_device_sync_pull(p_device_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_store uuid;v_result jsonb;
begin
 select store_id into v_store from public.mambo_cashier_devices where token_hash=encode(digest(coalesce(p_device_token,''),'sha256'),'hex') and revoked_at is null;
 if v_store is null then raise exception 'Perangkat tidak valid atau telah dicabut.'; end if;
 update public.mambo_cashier_devices set last_seen_at=now() where token_hash=encode(digest(p_device_token,'sha256'),'hex');
 select coalesce(jsonb_agg(jsonb_build_object('entity',entity,'record_id',record_id,'payload',payload,'deleted',deleted)),'[]'::jsonb)
 into v_result from public.mambo_sync_records where store_id=v_store and entity in ('transactions','shifts','movements','receivables','returns','auditLogs','opnames','purchases','payables','supplierPayments','promos','customers','suppliers','settings','operationalExpenses');
 return v_result;
end $$;
revoke all on function public.mambo_device_sync_push(text,jsonb,boolean) from public;
revoke all on function public.mambo_device_sync_pull(text) from public;
grant execute on function public.mambo_device_sync_push(text,jsonb,boolean) to anon,authenticated;
grant execute on function public.mambo_device_sync_pull(text) to anon,authenticated;
-- Izinkan entitas biaya operasional melalui jalur Cloud Owner dan perangkat kasir.
drop policy if exists sync_records_insert_member on public.mambo_sync_records;
create policy sync_records_insert_member on public.mambo_sync_records for insert with check (
 public.mambo_is_member(store_id) and (
  (entity in ('products','suppliers','categories','customers','promos','purchases','payables','settings') and public.mambo_has_role(store_id,array['owner','supervisor']))
  or (entity in ('transactions','shifts','movements','auditLogs','opnames','receivables','returns','supplierPayments','operationalExpenses') and public.mambo_is_member(store_id))
 ));
drop policy if exists sync_records_update_member on public.mambo_sync_records;
create policy sync_records_update_member on public.mambo_sync_records for update using (
 public.mambo_is_member(store_id) and (
  (entity in ('products','suppliers','categories','customers','promos','purchases','payables','settings') and public.mambo_has_role(store_id,array['owner','supervisor']))
  or (entity in ('transactions','shifts','movements','auditLogs','opnames','receivables','returns','supplierPayments','operationalExpenses') and public.mambo_is_member(store_id))
 )) with check (
 public.mambo_is_member(store_id) and (
  (entity in ('products','suppliers','categories','customers','promos','purchases','payables','settings') and public.mambo_has_role(store_id,array['owner','supervisor']))
  or (entity in ('transactions','shifts','movements','auditLogs','opnames','receivables','returns','supplierPayments','operationalExpenses') and public.mambo_is_member(store_id))
 ));
notify pgrst,'reload schema';
