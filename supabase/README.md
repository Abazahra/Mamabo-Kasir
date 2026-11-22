# MAMBO KASIR — Supabase Cloud Setup

## Arsitektur saat ini
- Transaksi dan perubahan data ditulis ke IndexedDB terlebih dahulu.
- Setiap `put`, `bulkPut`, dan `atomic` write pada tabel bisnis membuat antrean `syncQueue` dalam transaksi IndexedDB yang sama.
- Worker mencoba mengirim antrean ke `public.mambo_sync_records` saat browser online, setiap 20 detik, dan saat tab kembali aktif.
- Record yang gagal tetap berada di antrean lokal. Data lokal tidak dihapus setelah berhasil dikirim.
- `users` (PIN hash lokal) dan `heldCarts` tidak dikirim ke cloud.
- Saat ini sinkronisasi yang diaktifkan adalah **push lokal → cloud**. Penarikan data cloud ke perangkat lain belum diaktifkan karena perlu strategi konflik dan pemetaan akun kasir cloud yang sesuai.

## Langkah pemasangan
1. Buat proyek Supabase.
2. Buka SQL Editor dan jalankan seluruh isi `supabase/schema.sql`.
3. Daftarkan pengguna di Supabase Authentication (email/password).
4. Buat satu record toko di `mambo_stores`, lalu tambahkan keanggotaan owner pada `mambo_store_members` dengan UUID Auth pengguna. Contoh SQL tersedia di bagian akhir schema.
5. Di MAMBO KASIR, masuk menggunakan akun lokal Owner → Pengaturan & Backup → Integrasi Supabase Cloud.
6. Isi Project URL, anon/publishable key, Store ID, lalu email/password Supabase Auth. Jangan pernah menggunakan `service_role` key di browser.
7. Tekan Login Cloud & Sinkronkan. Indikator kanan atas menampilkan status dan antrean mulai dikirim.

## Catatan penting keamanan dan operasi
- RLS membatasi akses berdasarkan keanggotaan `mambo_store_members`. Jangan memberikan akses ke Store ID milik toko lain.
- Akun login lokal MAMBO berbeda dari akun Supabase Auth. Buat akun cloud terpisah untuk setiap staf yang akan memiliki akses cloud.
- Jangan menghapus data browser sebelum antrean sinkronisasi menunjukkan 0 dan backup JSON lokal sudah dibuat.
- Perangkat baru belum otomatis mengunduh data cloud. Jangan gunakan perangkat baru sebagai kasir produksi sampai fitur pull/snapshot multi-perangkat diaktifkan dan diuji.
- Foto produk yang disimpan sebagai data biner lokal perlu strategi object storage (Supabase Storage atau Google Drive); tabel JSON tidak ideal untuk menyimpan foto.
- Untuk lingkungan produksi, batasi role per tabel lebih lanjut dan gunakan kebijakan organisasi yang sudah diuji. Jangan menonaktifkan RLS.
