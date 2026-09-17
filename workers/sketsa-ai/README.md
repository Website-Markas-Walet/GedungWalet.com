# sketsa-ai — sketsa denah gambar tangan → denah Walet Planner

Cloudflare Worker kecil yang dipakai halaman **Walet Planner** (`/desain/`) dalam **mode tim**.
Tim memotret sketsa denah buatan pelanggan (yang dikirim lewat WhatsApp), mengunggahnya di planner, lalu menekan
**Konversi otomatis (AI)**. Worker meneruskan foto ke Claude (`claude-opus-5`), yang membaca garis sekat dan tulisan
keterangan (LMB, VOID, LAR, INAP, JALUR, TI, TT, …). Hasilnya muncul sebagai denah yang langsung bisa direvisi di editor.

- Kunci API Anthropic hanya tersimpan sebagai *secret* di Worker, tidak pernah sampai ke browser.
- Setiap permintaan wajib membawa **kode tim** (header `X-Team-Key`), dan hanya halaman di `ALLOWED_ORIGINS` yang boleh memanggil.
- Pengunjung umum tidak melihat tombol AI. Mereka tetap bisa memakai foto sketsa sebagai latar untuk dijiplak manual,
  atau mengirim fotonya ke tim lewat WhatsApp.

## Pasang (sekali saja)

Perlu Node.js 18+ dan akun Cloudflare (paket gratis cukup untuk mulai).

```bash
cd workers/sketsa-ai
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TEAM_KEY
npx wrangler deploy
```

- `ANTHROPIC_API_KEY`: buat di https://console.anthropic.com → API Keys. Pasang juga batas belanja bulanan di console.
- `TEAM_KEY`: kata sandi acak yang panjang (mis. 32 karakter), hanya dibagikan ke tim.
- Setelah `deploy`, catat alamatnya, mis. `https://sketsa-ai.nama-akun.workers.dev`.

Lalu isi alamat itu di `desain/planner-data.js`:

```js
export const SKETCH_API = 'https://sketsa-ai.nama-akun.workers.dev';
```

Bisa juga dibiarkan kosong dan diisi per perangkat lewat tombol **Kode tim**.

## Pakai (tiap perangkat tim)

1. Buka `https://gedungwalet.com/desain/?admin=1` sekali. Mode tim tersimpan di perangkat itu (`?admin=0` untuk mematikan).
2. **Proyek baru → Dari gambar tangan**: pilih foto sketsa, isi ukuran gedung dan lantai, lalu **Konversi otomatis (AI)**.
   Untuk desain yang sudah terbuka: panel kanan → **Sketsa tangan** → unggah foto → **Konversi otomatis (AI)**.
3. Pertama kali, isi **Kode tim** (dan alamat Worker bila `SKETCH_API` masih kosong), lalu tekan **Tes koneksi**.
4. Periksa pratinjau (foto ditumpuk di bawah hasil), ganti "sisi depan pada foto" bila perlu, lalu **Terapkan**.
   Sisanya direvisi di editor seperti biasa.

Agar sketsa terbaca baik: gambar tampak atas dengan garis luar yang jelas; tulis keterangan dengan huruf kapital
(LMB, VOID, LAR, LAR J, INAP, JALUR, AUDIO, KOLAM, TANGGA, PINTU, V, TI, TT); tulis ukuran gedung (mis. 4 m × 12 m) dan
tandai sisi DEPAN / JALAN. Satu foto per lantai, dipotret tegak lurus dari atas dengan cahaya terang.

## Biaya

Claude Opus 5 dikenai US$5 per 1 juta token masuk dan US$25 per 1 juta token keluar. Satu sketsa kira-kira 5–7 ribu
token masuk (foto + instruksi) dan 3–10 ribu token keluar (termasuk proses berpikir model), jadi sekitar
**US$0,10–0,30 (± Rp2.000–5.000) per sketsa**. Perkiraan biaya tiap konversi ditampilkan di dialog hasil.

Cloudflare Workers paket gratis: 100.000 permintaan per hari, CPU 10 ms per permintaan (waktu menunggu jawaban Claude
tidak dihitung). Bila muncul error 1102 (CPU terlampaui) untuk foto besar, aktifkan Workers Paid (US$5/bulan).

## Catatan teknis

- `src/index.js`: `POST /konversi` (foto base64 + ukuran + nomor lantai → `{ ok, plan, usage }`), `POST /cek` (tes kode tim), `GET /` (status).
- Keluaran dijamin sesuai skema JSON (structured outputs). Koordinat 0..1 relatif terhadap garis luar gedung pada foto;
  planner memutarnya sesuai sisi depan dan menskalakannya ke ukuran lantai (`desain/planner-sketch.js` → `aiToFloor`),
  lalu meluruskan dan menyambung sekat, menempelkan LAR/LMB ke garisnya, dan merapatkan tepi ruang ke sekat.
- Permintaan memakai `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`): bila Claude Opus 5 menolak sebuah foto
  karena filter keamanannya, API otomatis mengulangnya di model cadangan dalam panggilan yang sama.
- Daftar tulisan keterangan ada di dua tempat yang harus sama: prompt `SYSTEM` di `src/index.js` dan `LEGENDA` di `desain/planner-sketch.js`.
- Uji lokal: buat file `.dev.vars` berisi `ANTHROPIC_API_KEY=...` dan `TEAM_KEY=...`, jalankan `npm run dev` (http://localhost:8787),
  lalu di planner lokal (http://localhost:8765/desain/?admin=1) isi alamat layanan `http://localhost:8787`.
- Log: `npm run tail`, atau dashboard Cloudflare → Workers → sketsa-ai → Logs.
- Ganti kode tim kapan saja dengan `npx wrangler secret put TEAM_KEY`, lalu perbarui di perangkat tim.
