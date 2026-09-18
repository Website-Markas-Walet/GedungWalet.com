// Data statis Walet Planner: katalog elemen, preset ukuran, aturan analisis, dan pertanyaan pengamatan cepat.
// Angka di RULES dikalibrasi dari "Buku Sukses Budidaya Walet" (Markaswalet; `hal` = halaman buku) dan
// DED RBW 20×25 GedungWalet. Nilai bertanda "asumsi" TIDAK ada di sumber mana pun.

export const WA_NUMBER = '6285235350662';
export const TW = 0.16;   // ukuran tapak simbol tweeter di denah (m)
// Pengaturan simulasi cahaya & udara (disimpan di model.sim). hadap = arah kompas sisi depan gedung (°, 0 = utara).
export const SIM_DEFAULT = { hadap: 0, jam: 13, bulan: 0, langit: 'berawan', lintang: -6, suhu: 28, rh: 85, anginDari: 'depan', anginKec: 2, walet: 20 };
export const ARAH8 = [[0, 'Utara'], [45, 'Timur laut'], [90, 'Timur'], [135, 'Tenggara'], [180, 'Selatan'], [225, 'Barat daya'], [270, 'Barat'], [315, 'Barat laut']];
export const LANGIT = [['cerah', 'Cerah'], ['berawan', 'Berawan'], ['mendung', 'Mendung']];
export const SISI = [['depan', 'Depan'], ['kanan', 'Kanan'], ['belakang', 'Belakang'], ['kiri', 'Kiri']];
// Fungsi LAR menurut ruang yang dihubungkannya (bisa diatur manual di panel kanan).
export const LAR_FUNGSI = [['inap', 'LAR inap'], ['jalur', 'LAR jalur'], ['void', 'LAR void']];

// Alamat Cloudflare Worker "sketsa-ai" untuk konversi sketsa gambar tangan (lihat workers/sketsa-ai/README.md),
// mis. 'https://sketsa-ai.nama-akun.workers.dev'. Kosong = tim mengisinya per perangkat lewat tombol "Kode tim".
export const SKETCH_API = '';

// Kelas ukuran standar Markaswalet: kelas 4 m, 8 m, 12 m (hal. 183-186) + contoh DED 20×25
export const SIZE_PRESETS = [
  [4, 8], [4, 10], [4, 12], [4, 14], [6, 12], [8, 12], [8, 14], [8, 18], [12, 16], [12, 20], [20, 25],
];

export const RULES = {
  // sirip — hanya di ruang inap yang dihitung sebagai sarang efektif
  siripJarak: 0.25, siripJarakMin: 0.20, siripJarakMax: 0.30,            // hal. 276-277
  siripTinggiCm: [15, 20],                                                // hal. 278
  siripTebalCm: 2, siripLebarCm: 20,                                      // papan 2 × 20 cm: tebal = standar pemilik (buku tidak menyebut), lebar = tinggi sirip
  siripKotak: 0.4, siripKotakMin: 0.3, siripKotakMax: 0.6,                // sirip kotak/persegi (hal. 273-279); ukuran kotak = asumsi praktik lapangan
  papanPanjang: 4,                                                        // panjang papan di pasaran (m) → perkiraan jumlah batang
  sarangPerMeterSirip: 10, sarangAsumsi: true,                            // asumsi
  // ruang
  inapLebarMin: 1.5,                                                      // hal. 389
  jumlahInap: w => (w <= 5 ? 2 : w <= 9 ? 3 : 4),                         // lebar 4 m → 2 inap; 8 m → 3-4 (hal. 389)
  // void & menara
  voidSisiMin: 1,                                                         // LAR void 1×1 (hal. 392); menara min 2×2 (hal. 221)
  voidUntuk: w => (w >= 10 ? [4, 4] : w >= 8 ? [3, 4] : [2, 4]),          // 4×12 → 2×4; 10×15 → 4×4 (hal. 221-222)
  menaraWajibJikaTinggi: 10, menaraTinggi: [2, 3],                        // hal. 220, 226
  // LMB — DED: 70×50 cm, 2 tweeter tarik di bibir atas + 4 tweeter inap di sisi
  lmbLebarCm: [40, 70], lmbTinggiCm: [50, 70],                            // hal. 256 & 338
  lmbBesarJika: (w, h) => w >= 8 || h >= 20,                              // RBW besar ≥ 2 LMB (hal. 256-258, 267)
  // LAR — GedungWalet: pintu 1 m × 2 m, jendela 1 m × 1 m; buku: 1–1,5 m (hal. 392-394)
  lar: { pintu: { lebar: 1, tinggi: 2 }, jendela: { lebar: 1, tinggi: 1 } },
  larLebar: [0.9, 1.5],
  // dimensi gedung
  lantaiTinggi: 2, lantaiTinggiMax: 4, lantaiTinggiMin: 1.8,             // hal. 200-209
  panjangMax: 30,                                                         // hal. 133
  tinggiBangunan: [8, 20], tinggiAreaTerbukaMax: 10,                      // hal. 191-192
  kelasLebar: [4, 8, 12], kolom: 4,                                       // modul kolom 4 m (hal. 183-189); DED memakai 5 m
  // ventilasi
  ventJarak: 1.0, ventDiameterInci: 4, ventDiBawahSiripCm: 60,            // hal. 347-348
  ventPerLantai: (w, h) => Math.ceil((2 * (w + h)) / 1.8),               // ≈18 titik utk 4×12 (hal. 299)
  // iklim
  suhu: [26, 31], rh: [75, 85], rhBatas: [70, 90], luxInap: 1,           // hal. 112, 356, 560-561, 343
  luxRemang: 10, cahayaLuar: 20000,                                       // simulasi cahaya: batas remang/terang & cahaya siang di luar (asumsi)
  kolamPerM2: 1 / 50, kolamAsumsi: true,                                  // buku: "tergantung luas ruangan"
  // ruang audio & kabel
  audioLuas: 2,                                                           // pemilik: ruang audio 2 m², boleh di dalam / luar gedung
  inapMaks: 4,                                                            // pemilik: ruang inap bebas kecil, jangan > 4×4 m
  klemJarak: 0.1,                                                         // klem kabel tiap 10 cm (pemilik)
  // suara
  tarikMaksJarak: 5,                                                      // hal. 466
  tarikDariDinding: 0.3,                                                  // min 25 cm dari dinding belakang (hal. 462-463)
  twinapBaris: 1.0,                                                       // jarak antar baris tweeter inap (DED ±1 m)
  twinapPola: lebar => (lebar <= 1.75 ? [2, 1] : lebar <= 3.5 ? [3, 2] : [4, 3]), // 2-1-2 / 3-2-3 / 4-3-4 (hal. 451-452)
  audioMin: [1.5, 2],                                                     // hal. 317
  // ekonomi (referensi)
  produksi6x12KgTahun: [10, 15], hargaJutaPerKg: [15, 25],                // hal. 573-574
};

// Rekomendasi frekuensi & volume suara per lingkungan (hal. 421-425)
export const SUARA = {
  sawah: { label: 'Sawah / kebun / hutan', panggil: '1,5–4 kHz · 70–80 dB', tarik: '1–2 kHz · 60–70 dB', inap: '0,5–1 kHz · 50–60 dB' },
  air: { label: 'Sungai / danau / rawa / pantai', panggil: '4–5 kHz · 80–90 dB', tarik: '2–3 kHz · 70–80 dB', inap: '1–2 kHz · 60–70 dB' },
  kota: { label: 'Desa / perkotaan', panggil: '5–6 kHz · 90–100 dB', tarik: '3–4 kHz · 80–90 dB', inap: '1–2 kHz · 60–70 dB' },
};

// '60–70 dB' → [60, 70]; dbTarget('sawah') → { panggil, tarik, inap } (dB pada 1 m, dari tabel buku hal. 421-425).
export const dbRange = s => { const m = String(s || '').match(/(\d+)\s*–\s*(\d+)\s*dB/); return m ? [+m[1], +m[2]] : [60, 70]; };
export const dbTarget = env => { const su = SUARA[env] || SUARA.sawah; return { panggil: dbRange(su.panggil), tarik: dbRange(su.tarik), inap: dbRange(su.inap) }; };
export const dbMid = r => Math.round((r[0] + r[1]) / 2);

// Perangkat ruang audio (tab "Ruang audio"): ampli + alat pendukung. ch = jumlah channel bawaan ampli.
export const AMPLI = [['axm', 'Ampli AXM Garuda', 4], ['piro88', 'Ampli Piro 88', 8], ['piro89', 'Ampli Piro 89', 8]];
export const AUDIO_ALAT = [
  ['kipas', 'Kipas DC pendingin ampli'], ['timerKitani', 'Timer Kitani (kipas)'], ['timerAC', 'Timer AC (jadwal suara)'],
  ['saklar', 'Saklar cek tweeter'], ['stopkontak', 'Stop kontak'], ['aki', 'Aki mobil (cadangan listrik)'],
  ['flashdisk', 'Flashdisk suara'], ['twKontrolT', 'Tweeter kontrol tarik (di dinding)'], ['twKontrolI', 'Tweeter kontrol inap (di dinding)'],
  ['lampu', 'Lampu ruang audio'],
];
export const AUDIO_DEFAULT = { items: [{ t: 'axm', n: 1, ch: 4 }, { t: 'kipas', n: 1 }, { t: 'timerKitani', n: 1 }, { t: 'timerAC', n: 1 }, { t: 'saklar', n: 1 }, { t: 'stopkontak', n: 2 }, { t: 'aki', n: 1 }],
  jadwal: { panggil: [5, 19], tarik: [0, 24], inap: [0, 24] } };   // panggil hanya 05.00–19.00 (etika lingkungan, buku)
export const SARANG_JENIS = [['baru', 'Titik sarang baru'], ['lama', 'Titik sarang lama'], ['polesan', 'Sarang polesan'], ['jadi', 'Sarang jadi']];
export const SARANG_WARNA = { baru: '#C62828', lama: '#8b95a3', polesan: '#F9A825', jadi: '#2E7D32' };

// Rantai suara tarik dari luar ke dalam. Tiap tweeter tarik menghadap tweeter tarik di depannya (urutan lebih kecil):
// tarik inap → tarik LAR inap → tarik jalur → tarik LAR void → tarik LMB.
export const TARIK_ROLES = [
  ['lmb', 'Tarik LMB'], ['void', 'Tarik LAR void'], ['jalur', 'Tarik jalur'], ['lar', 'Tarik LAR inap'], ['inap', 'Tarik inap'],
];
export const ROLE_ORDER = Object.fromEntries(TARIK_ROLES.map(([k], i) => [k, i]));

// Pertanyaan "pengamatan cepat" → dipakai generator denah otomatis.
export const SURVEY = {
  env: { q: 'Lingkungan sekitar lokasi', opts: [['sawah', 'Sawah / kebun / hutan'], ['air', 'Sungai / danau / rawa / pantai'], ['kota', 'Desa / perkotaan']] },
  rh: { q: 'Kondisi udara di lokasi', opts: [['lembab', 'Lembab (dekat air / hutan)'], ['normal', 'Normal'], ['kering', 'Kering / panas']] },
  suhu: { q: 'Suhu siang hari (ukur dengan termogun)', opts: [['ok', '≤ 31 °C'], ['panas', '> 31 °C'], ['?', 'Belum diukur']] },
  tinggi: { q: 'Ada bangunan atau pohon yang lebih tinggi di sekitar lokasi?', opts: [['ya', 'Ya'], ['tidak', 'Tidak']] },
  burung: { q: 'Dari sisi mana walet paling banyak datang / pulang?', opts: [['depan', 'Depan (sisi jalan)'], ['belakang', 'Belakang'], ['kiri', 'Kiri'], ['kanan', 'Kanan'], ['?', 'Belum tahu']] },
  populasi: { q: 'Populasi walet di sekitar lokasi', opts: [['ramai', 'Ramai (ada gedung walet aktif di dekat lokasi)'], ['sedang', 'Sedang'], ['sepi', 'Sedikit / belum terlihat']] },
  angin: { q: 'Sisi dengan angin paling kencang', opts: [['depan', 'Depan'], ['belakang', 'Belakang'], ['kiri', 'Kiri'], ['kanan', 'Kanan'], ['?', 'Tidak tahu']] },
};
export const SURVEY_DEFAULT = { env: 'sawah', rh: 'normal', suhu: '?', tinggi: 'tidak', burung: '?', populasi: 'sedang', angin: '?' };

// kind: 'zone' = area, 'obj' = benda, 'wall' = garis sekat. w/h = ukuran default (m). z = urutan gambar zona.
export const CATALOG = [
  { group: 'Ruang', items: [
    { t: 'void', name: 'Void (lubang terjun)', kind: 'zone', w: 2, h: 4, z: 1, color: '#0C447C', fill: 'rgba(55,138,221,.22)',
      tip: 'Lubang vertikal lurus dari atap ke lantai dasar — "lift" walet. Posisinya sama di tiap lantai (bukan zig-zag), bebas hambatan, minimal 2×2 m; untuk gedung 4×12 disarankan 2×4 m.' },
    { t: 'jalur', name: 'Ruang jalur (transit)', kind: 'zone', w: 4, h: 2.5, z: 0, color: '#1D9E75', fill: 'rgba(29,158,117,.14)',
      tip: 'Lorong remang antara void dan ruang inap — justru paling lama ditempati burung karena remangnya, jadi beri sirip dan tweeter inap juga (atur di panel kanan). Sirip ruang jalur ikut dihitung sarang.' },
    { t: 'inap', name: 'Ruang inap + sirip', kind: 'zone', w: 2, h: 4, z: 0, color: '#8a5a2b', fill: 'rgba(186,117,23,.10)',
      tip: 'Kamar gelap (<1 lux) untuk sarang. Bebas sekecil apa pun, tapi jangan lebih besar dari 4×4 m — belah dengan sekat. Sirip panjang (20–30 cm, melintang arah burung datang) atau sirip kotak; papan juga menempel di sisi berdinding.' },
    { t: 'audio', name: 'Ruang audio', kind: 'zone', w: 1.5, h: 1.5, z: 1, color: '#5F5E5A', fill: 'rgba(95,94,90,.18)',
      tip: 'Ruang ampli / timer / kontrol ±2 m², boleh di dalam atau DI LUAR gedung (seret keluar batas lantai). Isi perangkatnya lewat tombol "Ruang audio" di atas; semua kabel tweeter berujung di sini.' },
  ]},
  { group: 'Bukaan', items: [
    { t: 'lmb', name: 'LMB – lubang masuk burung', kind: 'obj', w: 0.7, h: 0.2, color: '#D85A30', fill: 'rgba(216,90,48,.45)',
      tip: 'Di dinding luar lantai teratas / menara, menempel ke void. Lebar 40–70 cm, tinggi 50–70 cm (DED: 70×50 cm), dicat hitam, menghadap arah datang burung. Dinding otomatis terpotong.' },
    { t: 'lar', name: 'LAR pintu (1 × 2 m)', kind: 'obj', w: 1, h: 0.15, color: '#BA7517', fill: 'rgba(239,159,39,.30)',
      tip: 'Bukaan setinggi 2 m selebar 1 m pada sekat — akses void ↔ jalur ↔ ruang inap. Letakkan di garis sekat: sekat otomatis terpotong. Fungsinya (LAR void / jalur / inap) terbaca otomatis dari ruang yang dihubungkan, atau atur manual.' },
    { t: 'larj', name: 'LAR jendela (1 × 1 m)', kind: 'obj', w: 1, h: 0.15, color: '#BA7517', fill: 'rgba(239,159,39,.18)',
      tip: 'Bukaan 1×1 m di bagian atas sekat (bawahnya tetap tertutup) — dipakai di lantai teratas untuk mengurangi cahaya dari LMB. Sekat otomatis terpotong.' },
    { t: 'vent', name: 'Ventilasi pipa 4"', kind: 'obj', w: 0.3, h: 0.15, color: '#5F5E5A', fill: 'rgba(95,94,90,.4)',
      tip: 'Paralon 4" bulat menembus dinding tiap ±1 m, 60 cm di bawah sirip; di dalam memakai elbow menghadap ke bawah lalu pipa turun 1 m (+ jaring hama). Tidak perlu di area void; kurangi di daerah lembab; jangan menghadap laut.' },
  ]},
  { group: 'Suara & iklim', items: [
    { t: 'twinap', name: 'Tweeter inap (Audax AX-65)', kind: 'obj', w: TW, h: TW, color: '#534AB7', fill: 'rgba(83,74,183,.35)',
      tip: 'Dipasang di papan sirip ruang inap, semuanya menghadap jalan masuk ruangnya yang mengarah ke LAR void (LAR, atau sekat gantung bila burung masuk lewat bawahnya) — lurus depan/belakang/kiri/kanan saja. Pola per baris 2-1-2 (lebar 1,5 m), 3-2-3 (2–3 m), 4-3-4 (4–5 m).' },
    { t: 'twtarik', name: 'Tweeter tarik (Audax AX-65)', kind: 'obj', w: TW, h: TW, color: '#C62828', fill: 'rgba(198,40,40,.30)',
      tip: 'Di pojok ruang, kusen LAR, dan bibir void. Selalu menghadap tweeter tarik di depannya: inap → LAR inap → jalur → LAR void → LMB; rantai tidak boleh menembus sekat (lewat LAR). Tarik garis dari ujung corongnya ke tweeter di depannya untuk mengatur manual. Jarak maks 5 m.' },
    { t: 'hexa', name: 'Tweeter hexagonal Audax (panggil)', kind: 'obj', w: 0.44, h: 0.44, color: '#6A1B9A', fill: 'rgba(106,27,154,.22)',
      tip: '6 tweeter panggil tersusun segi enam, dipasang mepet di atas LMB (di menara atau lantai ber-LMB) untuk memanggil walet dari luar. Letakkan dekat LMB: otomatis menempel.' },
    { t: 'kolam', name: 'Kolam air', kind: 'obj', w: 1, h: 2, color: '#378ADD', fill: 'rgba(55,138,221,.35)',
      tip: 'Di lantai dasar, tengah atau sudut ruangan, ventilasi tepat di atasnya. Target kelembapan 75–85% (batas 70–90%).' },
    { t: 'menara', name: 'Menara (rumah monyet)', kind: 'obj', w: 2, h: 4, color: '#993556', fill: 'rgba(153,53,86,.10)',
      tip: 'Wajib jika tinggi gedung < 10 m: tinggi 2–3 m tepat di atas void, minimal 2×2 m. Menara punya lantai sendiri (tab "Menara"): LMB dan tweeter hexagonal dipasang di dindingnya. Klik untuk membuat / membuka lantai menara.' },
  ]},
  { group: 'Sarang (pemantauan)', items: [
    { t: 'sarang', name: 'Titik sarang', kind: 'obj', w: 0.14, h: 0.14, color: '#2E7D32', fill: 'rgba(46,125,50,.25)',
      tip: 'Tandai posisi sarang di sirip: titik sarang baru (kotoran baru), sarang lama, sarang polesan, atau sarang jadi — pilih jenisnya di panel kanan. Walet penghuni (punya sarang jadi/polesan/baru) langsung masuk LMB tanpa berputar di simulasi 3D.' },
  ]},
  { group: 'Struktur', items: [
    { t: 'sekat', name: 'Sekat walet', kind: 'wall', color: '#2C2C2A',
      tip: 'Klik-seret untuk menggambar. Bahan dipilih di panel kanan: TERPAL (arsir hitam, bisa ditembus kabel) atau BATA/dinding (abu-abu pejal, kabel tidak bisa menembus). Sekat penuh di lantai atas; sekat gantung 50 cm di bawah sirip cukup di lantai terbawah. LAR di garis sekat otomatis memotongnya.' },
    { t: 'tangga', name: 'Tangga (LAL)', kind: 'obj', w: 1, h: 2.5, color: '#444441', fill: 'rgba(136,135,128,.25)',
      tip: 'Akses manusia antar lantai (LAL) untuk panen — jangan lewat void. Tinggi lantai 2 m memungkinkan panen tanpa tangga.' },
    { t: 'pintu', name: 'Pintu masuk', kind: 'obj', w: 0.9, h: 0.15, color: '#444441', fill: 'rgba(136,135,128,.4)',
      tip: 'Pintu baja kunci ganda di lantai dasar, dekat ruang audio. Dinding otomatis terpotong.' },
  ]},
];

export const TYPES = Object.fromEntries(CATALOG.flatMap(g => g.items).map(it => [it.t, it]));

// Ikon garis 24×24 untuk tombol.
export const ICONS = {
  select: '<path d="M5 3l14 8-6 2-2 6z"/>',
  wall: '<rect x="3" y="10" width="18" height="4"/><path d="M6 10l-3 4M10 10l-4 4M14 10l-4 4M18 10l-4 4M21 11l-3 3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  turn: '<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v4h-4"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  auto: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
  kolom: '<rect x="3" y="3" width="4" height="4"/><rect x="17" y="3" width="4" height="4"/><rect x="3" y="17" width="4" height="4"/><rect x="17" y="17" width="4" height="4"/><path d="M7 5h10M7 19h10M5 7v10M19 7v10"/>',
  plan: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 12h9v9M12 3v5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  wa: '<path d="M4 20l1.3-4.2A8 8 0 1 1 8.4 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1a4 4 0 0 1-2-2l1-1-1-2z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.8"/><path d="M21 16l-5-5-7 7"/>',
  target: '<circle cx="12" cy="12" r="6"/><path d="M12 3v5M12 16v5M3 12h5M16 12h5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l3 3M14 9l2 2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
  ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.9-2.5L3 14.5a1.5 1.5 0 0 1 2.4-1.8L8 15"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  group: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M13 7h4v4M11 17H7v-4"/>',
  tower: '<path d="M8 21V9l4-5 4 5v12"/><path d="M6 21h12M10 13h4"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.1 6.1C3.6 7.9 2 12 2 12s4 7 10 7c1.7 0 3.2-.5 4.5-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  bird: '<path d="M2 12c4-1 7-4 10-8 0 4-1 7 2 9 3 2 6 1 8 1-3 3-7 5-11 4-3-1-6-3-9-6z"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  focus: '<circle cx="12" cy="12" r="3"/><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',
  audio: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="12" r="3"/><path d="M14 8h4M14 12h4M14 16h4"/>',
  cable: '<path d="M4 20v-6a4 4 0 0 1 4-4h8a4 4 0 0 0 4-4V4"/><circle cx="4" cy="20" r="1.6"/><circle cx="20" cy="4" r="1.6"/>',
  db: '<path d="M4 10v4h4l5 4V6l-5 4H4z"/><path d="M16.5 9.5a4 4 0 0 1 0 5M19 7a8 8 0 0 1 0 10"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M13 7l-2.5 5 2 2.5.5 6M10.5 12 8 14l-2 5M13.5 9.5 17 11l3 .5M12.5 14.5 15 17l1 4"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M3 14h18M9 4v16M15 9v11"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.9.5-1.1 1-1.1 2"/><circle cx="12" cy="17" r=".8"/>',
  panelL: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M13 10l-2 2 2 2"/>',
  panelR: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M11 10l2 2-2 2"/>',
  nest: '<path d="M5 13c0 4 3 7 7 7s7-3 7-7"/><path d="M5 13h14M8 13c1-2 2.5-3 4-3s3 1 4 3"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
};

export function icon(name, size = 18) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
