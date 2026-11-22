# MAMBO KASIR — Tahap 1

Prototype POS Offline-First berbasis HTML/CSS/JavaScript ES Modules dan IndexedDB.

## Akses demo
- Owner — PIN `123456`
- Supervisor — PIN `2222`
- Kasir 1 — PIN `1111`

Data demo dibuat otomatis pada pembukaan pertama ketika database masih kosong.

## Modul Tahap 1
- Login PIN dan pembatasan menu berbasis role.
- Dashboard inventaris.
- CRUD produk, kategori, SKU, validasi EAN-13, HPP khusus Owner, harga jual, stok minimum, tanggal kedaluwarsa, foto.
- Definisi satuan bertingkat, harga grosir, dan komponen bundling pada master produk.
- Kartu stok dan penyesuaian stock opname.
- Data pelanggan dan supplier.
- Impor/ekspor CSV dan cetak label produk.
- Tema terang/gelap, layout responsif, format Rupiah, waktu WIB.

## Catatan
- Database IndexedDB terpisah pada setiap browser/perangkat; belum ada sinkronisasi antarkasir.
- PIN di-hash dengan Web Crypto. Autentikasi lokal bukan pengganti keamanan server untuk penggunaan jaringan/produksi.
- Satuan bertingkat, harga grosir, dan komponen bundling tersimpan pada master produk. Pemotongan stok saat transaksi, kalkulasi harga otomatis, dan alur kasir/shift masuk Tahap 2.
- Buat ekspor cadangan berkala. Menghapus data situs dapat menghapus database lokal.


Deployment target: GitHub Pages (GitHub Actions).