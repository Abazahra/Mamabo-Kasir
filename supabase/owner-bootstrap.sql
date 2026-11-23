-- MAMBO KASIR · Bootstrap akun Owner pertama untuk satu toko terpusat
-- Aman dijalankan setelah schema.sql. Tidak menghapus atau mengubah transaksi/data operasional.
-- Owner pertama dapat membuat toko baru, atau mengambil satu toko yatim (belum memiliki Owner).
create or replace function public.mambo_owner_bootstrap(p_store_name text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
 v_user uuid:=auth.uid();
 v_store uuid;
 v_count integer;
 v_name text;
begin
 if v_user is null then
   raise exception 'Silakan login menggunakan akun Supabase Auth terlebih dahulu.';
 end if;
 v_name:=nullif(trim(coalesce(p_store_name,'')),'');
 if v_name is null or length(v_name)>120 then
   raise exception 'Nama toko wajib diisi (maksimal 120 karakter).';
 end if;

 -- Jika user ini sudah menjadi anggota toko, kembalikan toko tersebut.
 select store_id into v_store
 from public.mambo_store_members
 where user_id=v_user and app_role='owner'
 order by created_at
 limit 1;
 if v_store is not null then
   return jsonb_build_object('store_id',v_store,'store_name',(select store_name from public.mambo_stores where id=v_store),'existing',true);
 end if;

 -- Jangan mengizinkan akun kedua mengklaim toko yang sudah dimiliki.
 select count(*) into v_count from public.mambo_stores;
 if v_count=0 then
   insert into public.mambo_stores(store_name) values(v_name) returning id into v_store;
 elsif v_count=1 then
   select id into v_store from public.mambo_stores limit 1;
   if exists(select 1 from public.mambo_store_members where store_id=v_store and app_role='owner') then
     raise exception 'Toko sudah memiliki Owner. Gunakan akun Owner yang terdaftar.';
   end if;
   update public.mambo_stores set store_name=v_name where id=v_store;
 else
   raise exception 'Ditemukan lebih dari satu toko. Perlu pemeriksaan Admin sebelum bootstrap Owner.';
 end if;

 insert into public.mambo_store_members(store_id,user_id,app_role)
 values(v_store,v_user,'owner')
 on conflict(store_id,user_id) do update set app_role='owner';

 return jsonb_build_object('store_id',v_store,'store_name',v_name,'existing',false);
end;
$$;

revoke all on function public.mambo_owner_bootstrap(text) from public, anon;
grant execute on function public.mambo_owner_bootstrap(text) to authenticated;
notify pgrst, 'reload schema';
