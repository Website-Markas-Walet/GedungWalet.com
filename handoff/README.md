# Handoff Integrasi CMS — gedungwalet.com

Balasan atas *Brief Standar* untuk integrasi ke CMS terpusat (cms.markaswalet.id / Next.js + Supabase / Vercel, media di Cloudflare R2 `cdn.markaswalet.id`).
Scope aditif dipahami: CMS generate/edit **konten** lalu commit ke repo ini; navbar/menu/footer & URL **tidak** diubah.

---

## BLOCKER #1 — Mekanisme deploy (BUTUH KONFIRMASI PEMILIK)

Dari **dalam repo tidak bisa dipastikan** jalur repo → live. Fakta yang bisa saya verifikasi:

- Repo: `Website-Markas-Walet/GedungWalet.com`. **Branch produksi kemungkinan `main`** (hanya ada `main` + branch kerja; tidak ada `gh-pages`).
- **TIDAK ada** `.github/workflows`, `CNAME`, `.nojekyll`, `wrangler.toml`, `_redirects`, `_headers`, `netlify.toml` di repo → **tidak ada CI/CD yang tersimpan di repo**.
- Ada folder `cdn-cgi/` (termasuk `cdn-cgi/l/email-protection` + aset error-page Cloudflare). **PENTING:** ini kemungkinan besar **artefak hasil scrape** situs yang dulu ada di belakang Cloudflare, **bukan bukti Cloudflare Pages**. Jadi jangan simpulkan deploy = Cloudflare Pages hanya dari folder ini.

➡️ **Yang harus dijawab pemilik:** (a) repo ini di-deploy via apa persisnya — Cloudflare Pages / server pull / manual upload? (b) kalau Cloudflare Pages: **akun #1 atau #2**, nama project, dan **ada Deploy Hook?** (c) konfirmasi branch produksi (`main`?).

## BLOCKER #2 — Akses tulis untuk CMS (REKOMENDASI)

- Karena satu-satunya backend = **git**, CMS menulis via **commit ke repo**.
- Rekomendasi mekanisme (pilih satu, jangan kirim token di chat):
  1. **GitHub App** ter-scope ke org `Website-Markas-Walet` (paling rapi, rotasi mudah, per-repo permission) — **disarankan**.
  2. **Fine-grained PAT** repo-scoped (Contents: read/write) — cepat, tapi rotasi manual.
  3. **Deploy key** per-repo (SSH, write) — kalau CMS commit via git langsung.
- Trigger deploy: **tergantung jawaban Blocker #1** (Deploy Hook URL kalau Cloudflare Pages; otomatis kalau server watch `main`).

---

## Deliverable yang SUDAH SIAP (folder `handoff/`)

| Item brief | File | Isi |
|---|---|---|
| Chrome jadi template | `templates/layout.html`, `header.html`, `footer.html` | Wrapper nyata + slot `<!-- CONTENT -->` & `{{SEO_HEAD}}` |
| url_patterns | `url_patterns.json` | Pola per tipe + keanehan (.html vs folder, kata-ganda, endpoint WP mati) |
| Config situs | `site_config.json` | Analytics, brand, kontak, menu, link ekosistem |
| Ekspor konten | `content_inventory.json` | 31 artikel (title/slug/desc/tanggal/canonical/cover/robots) + **dataset kota (1 template + daftar kota)** |
| Inventaris media | `media_inventory.json`, `media_blogger_rehome_list.json` | Media lokal + hotlink eksternal untuk rehome ke R2 |

### Catatan penting per bagian

**Chrome / template.** Header ada di 247/247 file, footer 247/247. Ada **±3 varian header** (homepage, halaman listing/kota, artikel) — `layout.html` diambil dari halaman kota (varian paling umum). Slot `<!-- CONTENT -->` diletakkan **persis di antara `</header>` dan `<footer>`**; artinya CMS mengisi seluruh blok konten (wrapper `#content` + `<main>` + sidebar) — lihat contoh region di file kota mana pun. Blok SEO per-halaman (title/description/canonical/OG/JSON-LD Rank Math) sudah dijadikan slot `{{SEO_HEAD}}`.

**url_patterns.** Pola kota **`/bangun-gedung-walet-{kota}.html`** & **`/desain-gedung-walet-{kota}.html`** (BUKAN `/kota/`). Artikel = `/{slug}.html` (beberapa slug berakhiran `-html`, ada near-duplicate `mengenal-` vs `mengenali-`). Halaman statis = folder `/{slug}/` trailing slash. **Endpoint WP dinamis sudah mati** tapi masih dirujuk di ~247 file: `/feed`, `/comments/feed`, search `?s=`, `wp-json`, `xmlrpc`, `/?p=` → kotak search & RSS broken (bukan tugas CMS, tapi perlu tahu).

**Konten kota (JANGAN N halaman).** **102 kota simetris** (identik di bangun & desain), **11 ukuran** (`2x3,3x7,4x4,4x6,4x8,4x10,4x12,5x15,6x8,6x12,8x12`). Model CMS: `city_landing{ kota, jenis:[bangun|desain] }` + `size_landing{ ukuran }`, di-render dari 1 template × dataset. Daftar 102 kota ada di `content_inventory.json` (bisa dicocokkan dgn **dataset kota master sarangwalet ~103**).

**Media / rehome.** Media lokal **551 file** (`wp-content/uploads/YYYY/MM/`). Hotlink eksternal: **246 ref `1.bp.blogspot.com` + 55 `blogger.googleusercontent.com` = ±301 referensi, tapi hanya 16 URL unik** → cukup rehome **16 gambar** ke R2 lalu ganti ±301 rujukan (daftar lengkap URL→file di `media_blogger_rehome_list.json`). Plus **27 rujukan absolut `http://gedungwalet.com`** (mixed-content/self-abs) → normalisasi ke https/relatif.

---

## URL / slug: STABIL
Semua link internal **root-relative** (portabel). **Tidak ada perubahan URL yang direncanakan** dari sisi situs ini → belum perlu peta redirect 301. Jika nanti slug artikel dinormalisasi (mis. buang suffix `-html` / merge near-duplicate), siapkan redirect 301 saat itu.

## Config ringkas
- Analytics: **GTM-W6D44WS**, AdSense **ca-pub-2869782316576155**, FB domain verify **x06vtpsirds63nhlybz51avq11jjic**. (GA4/TikTok: tidak ada.)
- Brand: logo `Custom-dimensions-800x200-px-1.png`, favicon set 32/180/192, font Roboto/Raleway/Roboto Slab, aksen **#1565C0**.
- Kontak: **WA 6285235350662** (`api.whatsapp.com`), tampil "0852 3535 0662", alamat **Mulyosari Tengah No. 97 F, Surabaya**. Email: tidak ada.
- Link ekosistem terdeteksi: `budidayawalet.net` (23×), `markaswalet.com` (2×), `sarangwalet.web.id` (1×) → kandidat **menu jaringan terpusat**.
