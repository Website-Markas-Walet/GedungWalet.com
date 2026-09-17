// Cloudflare Worker "sketsa-ai" — foto sketsa denah gambar tangan → data denah JSON untuk Walet Planner (/desain/).
// Khusus tim GedungWalet: tiap permintaan wajib membawa header X-Team-Key yang sama dengan secret TEAM_KEY.
// Kunci Anthropic hanya ada di sini (secret ANTHROPIC_API_KEY) dan tidak pernah dikirim ke browser.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5';
const MAX_BODY = 9_000_000;   // byte (± 6 MB foto setelah base64)
const MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp']);
const JENIS = ['void', 'jalur', 'inap', 'audio', 'lmb', 'lar', 'larj', 'vent', 'twinap', 'twtarik', 'kolam', 'menara', 'tangga', 'pintu', 'lainnya'];

// Skema keluaran (structured outputs): semua properti wajib, tanpa properti tambahan.
const N = { type: 'number' };
const obj = props => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const SCHEMA = obj({
  terbaca: { type: 'boolean' },
  depan: { type: 'string', enum: ['atas', 'bawah', 'kiri', 'kanan'] },
  bingkai: obj({ x0: N, y0: N, x1: N, y1: N }),
  ukuran: obj({ horizontal_m: N, vertikal_m: N }),
  sekat: { type: 'array', items: obj({ x1: N, y1: N, x2: N, y2: N, gantung: { type: 'boolean' } }) },
  elemen: { type: 'array', items: obj({ jenis: { type: 'string', enum: JENIS }, label: { type: 'string' }, x: N, y: N, w: N, h: N }) },
  catatan: { type: 'array', items: { type: 'string' } },
});

// Konvensi tulisan harus sama dengan LEGENDA di desain/planner-sketch.js.
const SYSTEM = `Anda membaca foto SKETSA DENAH GAMBAR TANGAN rumah walet (RBW — gedung budidaya burung walet, tampak atas) dan mengubahnya menjadi data denah untuk aplikasi Walet Planner. Hasilnya akan dicek dan direvisi tim arsitek, jadi catat hanya yang benar-benar tergambar atau tertulis; jangan mengarang elemen.

CARA MEMBACA SKETSA
- Garis luar gedung = persegi panjang terbesar (dinding luar). Dinding luar TIDAK dimasukkan ke "sekat".
- Garis di dalam gedung = sekat walet (terpal), baik digambar tebal, berarsir, maupun garis biasa. Garis putus-putus = sekat gantung (gantung: true).
- Arti tulisan keterangan (huruf besar/kecil sama saja, boleh disingkat):
  • LMB = lubang masuk burung → "lmb" (di dinding luar atau menara)
  • VOID, atau kotak bersilang X = lubang terjun antar lantai → "void"
  • LAR = pintu antar ruang pada sekat → "lar"; LAR J / LJ / LAR JENDELA → "larj"
  • INAP / R. INAP / RI = ruang inap bersirip → "inap"
  • JALUR / TRANSIT / R. JALUR = ruang jalur → "jalur"
  • AUDIO / R. AUDIO / RA = ruang audio → "audio"
  • KOLAM / K = kolam air → "kolam"
  • TANGGA / TG = tangga → "tangga"
  • PINTU / P = pintu masuk orang → "pintu"
  • V / VENT / VENTILASI = ventilasi pipa → "vent"
  • MENARA / RM / RUMAH MONYET → "menara"
  • TI = tweeter inap → "twinap"; TT = tweeter tarik → "twtarik"
  • angka + m (mis. "4 m", "12m", "4 x 12") = ukuran; DEPAN / JALAN / JLN = sisi depan gedung.
- Tulisan lain yang tidak dikenali → elemen jenis "lainnya" dengan label = tulisan aslinya, dan sebutkan di catatan.
- Ruang tanpa tulisan jangan ditebak jenisnya; cukup gambar sekatnya.

KOORDINAT (pakai arah foto apa adanya, jangan diputar)
- "bingkai": kotak garis luar gedung dalam koordinat 0..1 terhadap SELURUH FOTO (x0,y0 = kiri-atas; x1,y1 = kanan-bawah).
- Semua koordinat sekat dan elemen: 0..1 terhadap GARIS LUAR GEDUNG — x = 0 di dinding kiri, 1 di dinding kanan; y = 0 di dinding atas, 1 di dinding bawah (menurut foto).
- Sketsa tangan biasanya tidak berskala: bila ada angka ukuran (mis. void 2 m pada lebar 4 m), pakai angka itu untuk menentukan posisi dan proporsi, bukan panjang garis di foto.
- "depan": sisi foto (atas/bawah/kiri/kanan) yang merupakan sisi depan gedung (sisi jalan, tulisan DEPAN/JALAN, atau pintu masuk). Bila tidak ada petunjuk sama sekali, isi "atas" dan sebutkan di catatan.
- "ukuran": horizontal_m = panjang sisi mendatar garis luar (menurut foto) yang tertulis di sketsa, vertikal_m = sisi tegak; isi 0 bila tidak tertulis.

SEKAT
- x1,y1 → x2,y2 = kedua ujung satu garis lurus. Garis berbelok dipecah menjadi beberapa sekat lurus.
- Garis yang hampir mendatar/tegak dibuat benar-benar mendatar/tegak; ujung yang menempel dinding luar diberi nilai tepat 0 atau 1.
- Jika LAR tergambar sebagai celah pada sekat, tetap buat sekatnya menerus melewati celah itu (aplikasi memotong sekat otomatis di posisi LAR).
- Garis ukuran, panah, garis arsir, dan garis bantu bukan sekat.

ELEMEN
- x, y = sudut kiri-atas kotak; w, h = lebar dan tinggi kotak (semua 0..1 terhadap garis luar).
- Ruang (void, jalur, inap, audio) dan benda besar (kolam, tangga, menara): kotak = batas ruang/benda itu; ruang yang dibatasi sekat → tepi kotak tepat di garis sekat/dinding.
- Bukaan (lmb, lar, larj, pintu, vent): kotak kecil tepat pada garis dinding/sekat tempat bukaan itu, memanjang searah garis.
- Tweeter (twinap, twtarik): kotak kecil di posisi simbol/tulisannya; satu elemen per tweeter.

LAIN-LAIN
- Jika foto berisi beberapa denah (mis. Lt 1 dan Lt 2), baca hanya denah lantai yang diminta dan sebutkan di catatan.
- "terbaca" = false bila foto bukan denah gedung atau terlalu buram; kosongkan daftar lain dan jelaskan di catatan.
- "catatan": maksimal 8 butir singkat dalam Bahasa Indonesia — bagian yang ragu/tidak terbaca, ukuran yang bertentangan, dsb.`;

const num = (v, lo, hi, d) => { const n = +v; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const parse = s => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : null; } catch { return null; } };

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}
// Bandingkan kode tim tanpa membocorkan panjang/isi lewat waktu proses.
async function sameKey(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map(v => crypto.subtle.digest('SHA-256', enc.encode(v))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (origin && !allowed.includes(origin)) return json({ ok: false, error: 'Asal halaman tidak diizinkan.' }, 403);
    const cors = origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Team-Key', 'Access-Control-Max-Age': '86400', Vary: 'Origin' } : {};
    const reply = (data, status = 200) => json(data, status, cors);
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET' && pathname === '/') return reply({ ok: true, layanan: 'sketsa-ai', model: MODEL });
    if (request.method !== 'POST' || !['/cek', '/konversi'].includes(pathname)) return reply({ ok: false, error: 'Alamat tidak dikenal.' }, 404);

    if (!env.TEAM_KEY || !env.ANTHROPIC_API_KEY) return reply({ ok: false, error: 'Worker belum dikonfigurasi (secret TEAM_KEY / ANTHROPIC_API_KEY).' }, 500);
    if (!(await sameKey(request.headers.get('X-Team-Key') || '', env.TEAM_KEY))) return reply({ ok: false, error: 'Kode tim salah.' }, 401);
    if (pathname === '/cek') return reply({ ok: true, model: MODEL });

    if (+(request.headers.get('Content-Length') || 0) > MAX_BODY) return reply({ ok: false, error: 'Foto terlalu besar (maks ± 6 MB).' }, 413);
    let body;
    try { body = await request.json(); } catch { return reply({ ok: false, error: 'Data permintaan tidak valid.' }, 400); }
    const image = typeof body?.image === 'string' ? body.image : '';
    const media = MEDIA.has(body?.media_type) ? body.media_type : null;
    if (!media || image.length < 100 || image.length > MAX_BODY) return reply({ ok: false, error: 'Foto tidak valid (JPG / PNG / WebP).' }, 400);

    const lebar = num(body.lebar, 1, 100, 0), panjang = num(body.panjang, 1, 100, 0);
    const lantai = Math.round(num(body.lantai, 1, 20, 1)), jumlah = Math.round(num(body.jumlah_lantai, 1, 20, 1));
    const catatan = String(body.catatan || '').slice(0, 300);
    const info = [
      lebar && panjang ? `Ukuran menurut tim: lebar ${lebar} m (kiri–kanan dilihat dari depan) × panjang ${panjang} m (depan–belakang).` : 'Ukuran gedung belum diketahui tim.',
      `Baca denah Lantai ${lantai} dari ${jumlah} lantai.`,
      catatan ? `Catatan tim: ${catatan}` : '',
    ].filter(Boolean).join('\n');

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    try {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',   // bila Claude Opus 5 menolak, API otomatis mengulang di model cadangan dalam panggilan yang sama
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: media, data: image } },
            { type: 'text', text: info },
          ],
        }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      });
      const msg = await stream.finalMessage();
      if (msg.stop_reason === 'refusal') return reply({ ok: false, error: 'AI menolak memproses foto ini — coba foto lain.' }, 422);
      if (msg.stop_reason === 'max_tokens') return reply({ ok: false, error: 'Sketsa terlalu rumit untuk sekali baca — foto per lantai atau per bagian, lalu coba lagi.' }, 422);
      const texts = msg.content.filter(b => b.type === 'text').map(b => b.text);
      const plan = parse(texts.join('')) ?? parse(texts[texts.length - 1] || '');
      if (!plan) return reply({ ok: false, error: 'Jawaban AI tidak bisa dibaca — coba lagi.' }, 502);
      return reply({ ok: true, plan, model: msg.model, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens } });
    } catch (err) {
      console.error('konversi gagal', err);
      if (err instanceof Anthropic.AuthenticationError) return reply({ ok: false, error: 'ANTHROPIC_API_KEY di Worker tidak valid.' }, 500);
      if (err instanceof Anthropic.RateLimitError) return reply({ ok: false, error: 'Batas pemakaian AI tercapai — coba lagi beberapa menit lagi.' }, 429);
      if (err instanceof Anthropic.BadRequestError) return reply({ ok: false, error: `Permintaan ditolak API: ${err.message}` }, 400);
      if (err instanceof Anthropic.APIError) return reply({ ok: false, error: `Layanan AI sedang bermasalah (${err.status ?? 'koneksi'}) — coba lagi.` }, 502);
      return reply({ ok: false, error: 'Terjadi kesalahan di Worker.' }, 500);
    }
  },
};
