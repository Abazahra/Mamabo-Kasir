-- MAMBO KASIR: focused follow-up patch for shared drawer confirmation integrity.
-- Run only after shared-cash-drawer.sql has already been applied.
-- This patch replaces one function only; it does not alter tables or production records.

create or replace function public.mambo_shared_drawer_event_resolve(
 p_store_id uuid,p_event_id uuid,p_resolution text,
 p_device_token text default null,p_staff_session_token text default null
) returns jsonb language plpgsql security definer set search_path=public,extensions
as $$
declare
 v_event public.mambo_shared_drawer_events%rowtype;
 v_staff jsonb;
 v_payload jsonb;
 v_cash_paid numeric(18,2);
 v_expected numeric(18,2);
 v_source_amount numeric(18,2);
begin
 if p_resolution not in ('confirmed','reversed') then raise exception 'Status penyelesaian tidak valid.'; end if;
 select * into v_event from public.mambo_shared_drawer_events
 where event_id=p_event_id and store_id=p_store_id for update;
 if not found then raise exception 'Pergerakan kas tidak ditemukan.'; end if;
 if p_device_token is not null and p_staff_session_token is not null then
  v_staff:=public.mambo_device_staff_session_check(p_device_token,p_staff_session_token);
  if (v_staff->>'store_id')::uuid<>p_store_id or (v_staff->>'id')::uuid<>v_event.actor_id
     or (v_staff->>'device_id')::uuid is distinct from v_event.device_id then
   raise exception 'Sesi perangkat tidak berhak menyelesaikan pergerakan ini.';
  end if;
 elsif auth.uid() is null or not public.mambo_is_owner(p_store_id) then
  raise exception 'Hanya pembuat pergerakan melalui sesi perangkat atau Owner toko yang berwenang.';
 end if;
 if v_event.resolution_status=p_resolution then return public.mambo_shared_drawer_snapshot_internal(p_store_id); end if;
 if v_event.resolution_status<>'pending' then raise exception 'Pergerakan kas sudah diselesaikan dan tidak dapat diubah.'; end if;

 -- Confirm only when the matching source record is already persisted in this store.
 if p_resolution='confirmed' and v_event.event_type in ('cash_sale','cash_expense') then
  if coalesce(v_event.source_record_id,'')='' then
   raise exception 'Bukti transaksi untuk pergerakan kas belum tersedia.';
  end if;
  select payload into v_payload
  from public.mambo_sync_records
  where store_id=p_store_id
    and entity=case when v_event.event_type='cash_sale' then 'transactions' else 'operationalExpenses' end
    and record_id=v_event.source_record_id and deleted=false
  for update;
  if not found or jsonb_typeof(v_payload)<>'object'
     or v_payload->>'id' is distinct from v_event.source_record_id then
   raise exception 'Bukti transaksi belum tersimpan atau identitas record tidak cocok.';
  end if;
  if v_event.device_id is not null and (
    v_payload->>'userId' is distinct from v_event.actor_id::text
    or v_payload->>'deviceId' is distinct from v_event.device_id::text
  ) then
   raise exception 'Kasir atau perangkat pada bukti transaksi tidak cocok dengan pembuat pergerakan.';
  end if;
  if v_event.event_type='cash_sale' then
   if v_payload->>'status'<>'paid'
      or coalesce(v_payload->>'total','') !~ '^[0-9]+([.][0-9]+)?$' then
    raise exception 'Status atau total penjualan tidak valid untuk konfirmasi laci.';
   end if;
   select coalesce(sum(
     case when lower(trim(coalesce(payment.value->>'method','')))='tunai'
       and coalesce(payment.value->>'amount','') ~ '^[0-9]+([.][0-9]+)?$'
       then (payment.value->>'amount')::numeric else 0 end
   ),0) into v_cash_paid
   from jsonb_array_elements(
     case when jsonb_typeof(v_payload->'payments')='array'
       then v_payload->'payments' else '[]'::jsonb end
   ) as payment(value);
   v_expected:=least((v_payload->>'total')::numeric,v_cash_paid);
   if v_expected<=0 or abs(v_expected-v_event.amount)>0.01 then
    raise exception 'Nominal tunai pada bukti penjualan tidak cocok dengan pergerakan laci.';
   end if;
  else
   if v_payload->>'source'<>'cash'
      or coalesce(v_payload->>'amount','') !~ '^[0-9]+([.][0-9]+)?$' then
    raise exception 'Bukti pengeluaran bukan pengeluaran tunai yang valid.';
   end if;
   v_source_amount:=(v_payload->>'amount')::numeric;
   if abs(v_source_amount-v_event.amount)>0.01 then
    raise exception 'Nominal bukti pengeluaran tidak cocok dengan pergerakan laci.';
   end if;
  end if;
 end if;

 update public.mambo_shared_drawer_events set resolution_status=p_resolution where event_id=p_event_id;
 return public.mambo_shared_drawer_snapshot_internal(p_store_id);
end $$;

notify pgrst, 'reload schema';
