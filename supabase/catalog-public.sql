-- MAMBO KASIR: katalog publik dan gambar produk
-- Jalankan di Supabase SQL Editor setelah schema.sql utama.
create table if not exists public.mambo_public_catalog_settings (
 store_id uuid primary key references public.mambo_stores(id) on delete cascade,
 store_name text not null default 'MAMBO KASIR',
 whatsapp text not null default '',
 tagline text not null default 'Pesan produk favorit Anda',
 updated_at timestamptz not null default now()
);
create table if not exists public.mambo_public_catalog_products (
 store_id uuid not null references public.mambo_stores(id) on delete cascade,
 product_id text not null,
 sku text not null default '',
 name text not null,
 category_name text not null default 'Lainnya',
 price numeric(18,2) not null default 0 check(price>=0),
 image_url text,
 updated_at timestamptz not null default now(),
 primary key(store_id,product_id)
);
alter table public.mambo_public_catalog_settings enable row level security;
alter table public.mambo_public_catalog_products enable row level security;
drop policy if exists public_catalog_settings_read on public.mambo_public_catalog_settings;
create policy public_catalog_settings_read on public.mambo_public_catalog_settings for select to anon,authenticated using (true);
drop policy if exists public_catalog_settings_write_owner on public.mambo_public_catalog_settings;
create policy public_catalog_settings_write_owner on public.mambo_public_catalog_settings for all to authenticated using (public.mambo_is_owner(store_id)) with check (public.mambo_is_owner(store_id));
drop policy if exists public_catalog_products_read on public.mambo_public_catalog_products;
create policy public_catalog_products_read on public.mambo_public_catalog_products for select to anon,authenticated using (true);
drop policy if exists public_catalog_products_write_owner on public.mambo_public_catalog_products;
create policy public_catalog_products_write_owner on public.mambo_public_catalog_products for all to authenticated using (public.mambo_is_owner(store_id)) with check (public.mambo_is_owner(store_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('mambo-product-images','mambo-product-images',true,2097152,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update set public=true,file_size_limit=2097152,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists mambo_catalog_images_public_read on storage.objects;
create policy mambo_catalog_images_public_read on storage.objects for select to anon,authenticated using (bucket_id='mambo-product-images');
drop policy if exists mambo_catalog_images_owner_insert on storage.objects;
create policy mambo_catalog_images_owner_insert on storage.objects for insert to authenticated with check (bucket_id='mambo-product-images' and public.mambo_is_owner((storage.foldername(name))[1]::uuid));
drop policy if exists mambo_catalog_images_owner_update on storage.objects;
create policy mambo_catalog_images_owner_update on storage.objects for update to authenticated using (bucket_id='mambo-product-images' and public.mambo_is_owner((storage.foldername(name))[1]::uuid)) with check (bucket_id='mambo-product-images' and public.mambo_is_owner((storage.foldername(name))[1]::uuid));
drop policy if exists mambo_catalog_images_owner_delete on storage.objects;
create policy mambo_catalog_images_owner_delete on storage.objects for delete to authenticated using (bucket_id='mambo-product-images' and public.mambo_is_owner((storage.foldername(name))[1]::uuid));
