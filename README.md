# Stella Studio

Aplikasi web berbahasa Indonesia untuk menyusun tim Stella Sora, memilih build berdasarkan posisi Trekker, dan merekomendasikan Disc. Mendukung **Koleksiku** dan **Eksplorasi**, dengan alasan kecocokan serta referensi komunitas yang dapat ditelusuri.

## Menjalankan

Memerlukan **Node.js 22 atau lebih baru**. Tidak ada dependency runtime atau proses instalasi paket.

```powershell
cd 'C:\Program Codding\stella-sora-builder'
npm.cmd start
```

Buka **http://localhost:4317**. Pada macOS/Linux gunakan `npm start`.

Salin `.env.example` ke `.env` jika perlu mengatur port, jadwal, atau API key. `.env` tidak masuk Git. Untuk menjalankan di server/container, atur `HOST=0.0.0.0`; gunakan reverse proxy HTTPS. Koleksi dan build pemain disimpan pada browser masing-masing, bukan di database akun.

## Yang sudah tersedia

- Pilih Trekker dan Disc milik sendiri, atau eksplorasi seluruh katalog.
- Filter elemen, kunci Main, dan pilih target boss, wave, survival, atau seimbang.
- Rekomendasi 1 Main + 2 Support, hingga 3 Main Disc + 3 Support Disc unik.
- Build Main/Support yang berbeda, prioritas stat, skill, dan Potential.
- Simpan build, bagikan konfigurasi, serta ekspor/impor koleksi JSON.
- Skor kecocokan transparan. Referensi komunitas memberi sinyal ranking terpisah dan memiliki tautan sumber.
- Halaman **Sumber & pembaruan** menampilkan revisi, waktu pemeriksaan, status konektor, dan penemuan komunitas.
- Snapshot live pertama berhasil memuat **39 Trekker dan 100 Disc** pada 11 September 2026. Seed offline berisi 24 Trekker dan 30 Disc terkurasi.

## Pembaruan otomatis

```sh
npm run sync
```

Saat server aktif, data diperiksa setiap 6 jam; `AUTO_SYNC=false` menonaktifkannya. Browser memeriksa revisi snapshot setiap 60 detik. GitHub Actions juga menyediakan workflow pembaruan pada menit 23 setiap 6 jam dan tombol **Run workflow**. Jadwal GitHub baru berlaku setelah workflow berada di default branch dan Actions aktif; eksekusi dapat terlambat sesuai ketersediaan runner.

1. Ambil daftar serta detail kit dari API publik StellaBase dan pengumuman dari API situs resmi.
2. Validasi ID, elemen, role, rarity, schema, dan kelengkapan katalog. Respons sebagian atau gagal tidak menghapus katalog terakhir.
3. Bandingkan fingerprint kit, termasuk parameter angka, skill, Potential, Talent, dan stat. Cerita, gambar, atau jumlah view tidak memengaruhi fingerprint balance.
4. Karakter/Disc baru memperoleh analisis awal berdasarkan tipe efek yang terbaca. Kit yang berubah membatalkan kurasi lama kecuali fingerprint-nya cocok dengan kurasi yang diperiksa ulang.
5. Rekomendasi dihitung ulang. Klaim komunitas yang berbeda revisi, kedaluwarsa, atau sumbernya berubah tidak meningkatkan ranking.
6. Snapshot ditulis secara atomik. Kesehatan sumber dan waktu sukses terakhir tetap terlihat bila pengambilan berikutnya gagal.

Katalog tersinkron adalah data **database komunitas**, bukan API resmi game. Berita resmi menjadi sumber pengumuman; metadata berita saja tidak membuktikan apakah suatu tim lebih kuat. Deteksi kata terkait balance digunakan sebagai tanda perlunya pemeriksaan, bukan penetapan otomatis bahwa semua perubahan adalah buff/nerf.

## Referensi komunitas dan konektor

Konfigurasi berada di `data/sources.json`.

| Sumber | Status awal / kebutuhan | Dipakai untuk |
| --- | --- | --- |
| StellaBase | Terhubung, tanpa key | Identitas dan perubahan kit |
| Situs resmi Stella Sora | Terhubung, API berita publik | Pengumuman serta indikasi perubahan balance |
| Mobi.gg / panduan Maygii | Referensi nyata yang diperiksa | Provenance dan pemantauan perubahan panduan |
| r/StellaSora RSS | Terhubung; dapat dibatasi upstream | Penemuan kiriman baru |
| YouTube | `YOUTUBE_API_KEY`; opsional filter `channelIds` | Penemuan metadata video, **belum membaca transkrip** |
| Google | `GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID` | Penemuan tautan; Custom Search hanya untuk pelanggan lama |
| Facebook Pages | Page IDs, `FACEBOOK_PAGE_ACCESS_TOKEN`, `FACEBOOK_GRAPH_VERSION`, izin baca yang sesuai | Kiriman Page yang diizinkan; bukan grup privat |
| Feed build terstruktur | `communityBuildFeeds` dengan `trusted: true` | Klaim build yang sudah ditinjau kurator dan cocok revisi |

Google Custom Search [ditutup untuk pelanggan baru](https://developers.google.com/custom-search/v1/overview) dan pelanggan lama harus bermigrasi sebelum 1 Januari 2027. Integrasi ini opsional; pemantauan situs, feed, dan platform lain berjalan mandiri. Jangan memasukkan token ke URL sumber, kode frontend, atau commit. Simpan key pada `.env` lokal atau GitHub repository secrets.

**Batas analisis saat ini:** sistem tidak mengklaim memahami video, membaca semua posting Facebook, atau memiliki konsensus komunitas lengkap. Penemuan konten dan validasi bukti adalah tahap yang berbeda. Data naratif perlu ditinjau menjadi klaim terstruktur, atau dipasok melalui feed kurator tepercaya. Popularitas tidak dipakai sebagai pengganti bukti.

### Menambahkan bukti build

Lihat contoh nyata pada `data/community-builds.json`. Klaim membutuhkan:

- `main`, dua `supports`, `goals`, dan jalur `damageTags`;
- URL sumber HTTPS, penulis, tanggal publikasi, tanggal review, ringkasan, dan kondisi pemakaian;
- `status: "reviewed"` serta `catalogRevision` yang sama dengan `data/snapshot.json`;
- `sourceFingerprint` ketika sumber berubah dan klaimnya sudah diperiksa ulang;
- batas kedaluwarsa, maksimal 180 hari, dihitung dari **tanggal publikasi**.

Contoh feed tepercaya:

```json
{
  "id": "community-curator",
  "label": "Kurator komunitas",
  "url": "https://your-public-domain.example/stella-builds.json",
  "trusted": true
}
```

Endpoint mengembalikan `{ "version": 1, "claims": [...] }` dengan schema yang sama. Klaim yang tidak cocok revisi tidak berpengaruh. Satu penulis dihitung sekali walaupun mengunggah ke berbagai platform. Sinyal komunitas maksimal 8 poin, terpisah dari skor kit 0–100.

`data/curated-overrides.json` menyimpan build/efek yang telah diperiksa beserta fingerprint kit-nya. Perubahan angka pada kit membuat override lama tidak berlaku. Jangan sekadar mengganti hash untuk mempertahankan kurasi setelah patch; periksa sumber dan kecocokan build dahulu.

## Pengujian

```sh
npm run check
npm test
```

Tes mencakup kepemilikan, penguncian Main, elemen, perbedaan posisi build, pemilihan Disc unik, ranking target, perubahan angka kit, penambahan karakter, rollback pengambilan gagal, validitas bukti, deduplikasi penulis, dan perlindungan data kredensial.

Uji browser opsional menggunakan Puppeteer yang terpasang terpisah:

```powershell
$env:PUPPETEER_MODULE='C:\path\to\puppeteer\lib\puppeteer\puppeteer.js'
$env:BASE_URL='http://localhost:4317'
node tests/browser-check.mjs
```

Uji desktop dan mobile telah dijalankan: pemilihan tim, detail build/Disc, penyimpanan dan pemulihan, pencarian koleksi, serta layar 390 px dan 320 px. Screenshot dan laporan lokal ada di `.verification/` dan tidak dikirim ke Git.

## Batas rekomendasi

Skor adalah heuristik kecocokan, **bukan simulasi DPS atau jaminan tim terbaik**. Level, Talent, Crescendo, urutan rotasi, resistansi musuh, kondisi event, dan aktivasi Harmony belum dimodelkan penuh. Perubahan multiplier bisa membatalkan validasi build tanpa mengubah ranking heuristik; dibutuhkan hasil uji komunitas terbaru untuk menyimpulkan dampak damage. Entri otomatis diberi label analisis awal.

Nama serta ilustrasi Stella Sora merupakan milik pemegang haknya. Proyek ini tidak berafiliasi dengan Yostar. Provenance aset dan data tercatat di [DATA_SOURCES.md](DATA_SOURCES.md).
