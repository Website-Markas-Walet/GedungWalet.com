---
site: gedungwalet.com
deploy: { host: unknown, cf_account: null, branch: main, deploy_hook: unknown }
url_patterns: { artikel: "/{slug}.html", kota: "/bangun-gedung-walet-{kota}.html | /desain-gedung-walet-{kota}.html", page: "/{slug}/", desain: "/desain-gedung-walet-{kota}.html" }
chrome: { header_lines: 88, footer_lines: 61, byte_identical: "variants:3" }
analytics: { gtm: "GTM-W6D44WS", ga4_property_id: "", tiktok: "", fb_verify: "x06vtpsirds63nhlybz51avq11jjic", adsense: "ca-pub-2869782316576155" }
brand: { primary: "#1565C0", font: "Roboto, Raleway, Roboto Slab", logo: "/wp-content/uploads/2021/07/Custom-dimensions-800x200-px-1.png", favicon: "/wp-content/uploads/2021/07/cropped-favicon-32x32.png" }
ecosystem_menu: absent
contact: { wa: "6285235350662", email: "" }
media: { local_mb: 45, hotlink: "blogspot:16" }
content: { articles: 31, kota_unique: 102, kota_admin_level: kota }
cleanup: ["dead WP endpoints masih dirujuk (~247 file): /feed, /comments/feed, search ?s=, wp-json, xmlrpc, /?p=", "mixed-content: 27 rujukan absolut http://gedungwalet.com + gambar http:// -> normalisasi https/relatif", "near-duplicate slug artikel: mengenal- vs mengenali-lebih-dekat-dengan-pembudidayaan-walet", "beberapa slug artikel berakhiran -html (mis. /pengaturan-cahaya-gedung-walet-html.html)", "html lang=en-US padahal konten Bahasa Indonesia"]
blockers: ["deploy: jalur repo->live belum pasti (folder cdn-cgi = artefak scrape, BUKAN bukti Cloudflare Pages); pemilik konfirmasi host + branch produksi", "cf_account #1/#2 + nama project + ada/tidak Deploy Hook", "akses tulis CMS: pilih GitHub App (disarankan) / fine-grained PAT (Contents RW) / deploy key", "push dari sesi ini kena 403 (read-only) -> butuh izin write agar deliverable terkirim"]
---

## Catatan

**Apa saya ini.** Snapshot HTML statis beku hasil export WordPress 6.1.1 (tema Astra, builder Elementor, SEO Rank Math). Tidak ada DB/REST API — satu-satunya jalur tulis = git. 247 file `.html` di root + halaman folder `index.html`. ±136 MB total on-disk (media lokal 45 MB).

**Chrome.** `<header>` di 247/247 file, `<footer>` di 247/247. Header ~88 baris, footer ~61 baris (dari halaman kota, varian paling umum). **±3 varian header** (homepage / listing-kota / artikel); teks footer sama tapi hash beda karena whitespace + id Elementor → `byte_identical: variants:3`. Menu utama 8 item internal: Home, Layanan (#anchor), Desain (/desain), Bangun (/bangun), Ukuran (/ukuran), Tentang Kami, Kontak Kami, Area Pelayanan. **Tidak ada menu jaringan/ekosistem di chrome** (link ke budidayawalet.net/markaswalet.com muncul di body, bukan nav/footer) → `ecosystem_menu: absent`.

**Konten (JANGAN N halaman).** 4 tipe nyata: artikel (31), landing-kota-bangun (102), landing-kota-desain (102), landing-ukuran (11: 2x3,3x7,4x4,4x6,4x8,4x10,4x12,5x15,6x8,6x12,8x12). **102 kota simetris** (identik di bangun & desain) — cocok dijodohkan dgn dataset kota master sarangwalet. Model CMS: `city_landing{kota, jenis:[bangun|desain]}` + `size_landing{ukuran}` di-render 1 template × dataset. URL kota pakai kata-ganda `/bangun-gedung-walet-{kota}.html` (BUKAN `/kota/`).

**Media / rehome.** Media lokal 45 MB di `wp-content/uploads/YYYY/MM/`. Hotlink eksternal ±301 referensi tapi **hanya 16 URL gambar unik** (1.bp.blogspot.com + blogger.googleusercontent.com) → rehome 16 file ke R2, lalu ganti 301 rujukan. Peta lengkap URL→file: `handoff/media_blogger_rehome_list.json`.

**URL stabil** — semua link internal root-relative, tidak ada perubahan URL direncanakan → belum perlu redirect 301. Jika slug dinormalisasi nanti (buang `-html`, merge near-duplicate), siapkan 301 saat itu.

**Lampiran data siap-konsumsi CMS** ada di folder `handoff/`: `templates/{layout,header,footer}.html` (chrome + slot `<!-- CONTENT -->` & `{{SEO_HEAD}}`), `url_patterns.json`, `site_config.json`, `content_inventory.json`, `media_inventory.json`, `media_blogger_rehome_list.json`, `README.md`.
