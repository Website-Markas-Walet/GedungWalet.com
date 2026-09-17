// Analisis kelayakan desain — aturan buku Budidaya Walet Markaswalet & DED GedungWalet.
// Catatan diberi `at` (lantai + kotak) supaya bisa diklik → lokasinya ditandai di denah.
import { RULES, SUARA } from './planner-data.js';
import { derive, center, dist, ovArea, inRect, angDiff, distToRect, siripEfektif, siripVolume, twinapRekomendasi, isLar, floorRect, floorHt, levels } from './planner-geom.js';
import { simulate, luxTxt } from './planner-light.js';
import { climate } from './planner-air.js';
import { simulateSound, nilaiDb } from './planner-sound.js';
import { cableInfo } from './planner-cable.js';

const fmt = n => (+n).toLocaleString('id-ID');
const r1 = v => Math.round(v * 10) / 10;

export function analyze(m) {
  const nF = m.floors.length, top = nF - 1, sv = m.survey || null, LV = levels(m);
  const rects = m.floors.map(fl => floorRect(m, fl)), hts = m.floors.map(fl => floorHt(m, fl));
  const tinggi = hts.reduce((a, b) => a + b, 0), luasTotal = rects.reduce((s, F) => s + F.w * F.h, 0);
  const notes = [], rekom = [];
  let score = 100, sirip = 0, ventN = 0, kolamN = 0, lmbN = 0, menaraN = 0, tanggaN = 0, audioN = 0, twinapN = 0, twtarikN = 0, inapN = 0;
  const pen = (p, txt, lvl = 'warn', at = null) => { score -= p; notes.push({ lvl, txt, at }); };
  const info = (txt, at = null) => notes.push({ lvl: 'ok', txt, at });
  const by = (fl, t) => fl.items.filter(it => it.t === t);
  const atF = i => ({ f: i, ...rects[Math.min(i, top)] });                        // tanda satu lantai penuh
  const atR = (i, r) => ({ f: i, x: r.x, y: r.y, w: r.w ?? 0.3, h: r.h ?? 0.3 }); // tanda kotak objek/ruang
  const ders = m.floors.map(fl => derive(m, fl));

  // --- dimensi gedung ---
  if (m.h > RULES.panjangMax) pen(10, `Panjang ${fmt(m.h)} m melebihi batas ${RULES.panjangMax} m — bagi menjadi 2 unit RBW.`, 'bad');
  if (!RULES.kelasLebar.includes(m.w) && m.w % 4) info(`Lebar ${fmt(m.w)} m di luar kelas standar 4 / 8 / 12 m (modul kolom 4 m) — boleh, tapi struktur kurang efisien.`);
  const salahT = m.floors.filter((fl, i) => hts[i] > RULES.lantaiTinggiMax || hts[i] < RULES.lantaiTinggiMin).map(fl => fl.name);
  if (salahT.length) pen(8, `Tinggi ${salahT.join(', ')} di luar rentang ${RULES.lantaiTinggiMin}–${RULES.lantaiTinggiMax} m.`, 'bad');
  else if (hts.some(h => h > RULES.lantaiTinggi + 0.3)) pen(3, `Ada lantai lebih tinggi dari ${RULES.lantaiTinggi} m — standar ${RULES.lantaiTinggi} m agar panen tanpa tangga dan 1 pengecoran = 2 lantai.`);
  if (nF % 2) info(`Jumlah lantai ganjil (${nF}); buku menyarankan genap (2/4/6) karena satu pengecoran 4 m dibagi 2 lantai.`);
  if (tinggi > RULES.tinggiBangunan[1]) pen(4, `Tinggi bangunan ${fmt(tinggi)} m melebihi ${RULES.tinggiBangunan[1]} m.`);
  const terbuka = sv && (sv.env === 'sawah' || sv.env === 'air');
  if (tinggi > RULES.tinggiAreaTerbukaMax) {
    if (terbuka) pen(4, `Area terbuka berangin: tinggi gedung ${fmt(tinggi)} m melebihi ${RULES.tinggiAreaTerbukaMax} m.`);
    else if (!sv) info(`Tinggi ${fmt(tinggi)} m: di area terbuka berangin (sawah/pantai) batasi maks ${RULES.tinggiAreaTerbukaMax} m.`);
  }

  // --- void: ada di tiap lantai & lurus vertikal ---
  const voids = m.floors.map(fl => by(fl, 'void'));
  m.floors.forEach((fl, i) => {
    const nm = fl.name;
    if (!voids[i].length) { pen(12, `${nm}: belum ada void (lubang terjun) — jalur terbang vertikal walet.`, 'bad', atF(i)); return; }
    voids[i].forEach(v => {
      if (Math.min(v.w, v.h) < RULES.voidSisiMin) pen(4, `${nm}: void ${fmt(v.w)}×${fmt(v.h)} m terlalu sempit (sisi minimal ${RULES.voidSisiMin} m, rekomendasi ≥ 2×2 m).`, 'warn', atR(i, v));
      const above = voids[i + 1] || [], up = rects[i + 1];
      const under = up && ovArea(v, up) > 0.5 * v.w * v.h;          // void berada di bawah lantai atas?
      const ov = Math.max(0, ...above.map(u => ovArea(u, v) / Math.min(u.w * u.h, v.w * v.h)));
      if (i < top && !under) info(`${nm}: void berada di luar ${m.floors[i + 1].name} — lubang menembus dak; tutup, atau manfaatkan sebagai LMB / lubang naga.`, atR(i, v));
      else if (above.length && ov === 0) pen(5, `${nm}: void tidak segaris dengan void ${m.floors[i + 1].name} — buku menyarankan void terjun lurus, bukan zig-zag.`, 'warn', atR(i, v));
      by(fl, 'tangga').forEach(t => { if (ovArea(t, v) > 0.05) pen(6, `${nm}: tangga berada di dalam void — void harus bebas hambatan; pakai LAL terpisah.`, 'warn', atR(i, t)); });
      by(fl, 'inap').forEach(z => { if (ovArea(z, v) > 0.2) pen(6, `${nm}: ruang inap menumpuk dengan void — ruang inap harus gelap, pisahkan dengan sekat.`, 'warn', atR(i, z)); });
    });
  });

  // --- LMB, menara (lantai sendiri di atas void) & tweeter hexagonal ---
  const needMenara = tinggi < RULES.menaraWajibJikaTinggi, MN = m.menara || null, MF = MN ? floorRect(m, MN) : null;
  const lmbCek = (fl, d, nm, l, fi) => {
    const lebar = Math.round(Math.max(l.w, l.h) * 100), t = l.tcm || 50, at = atR(fi, l);
    if (lebar < RULES.lmbLebarCm[0] || lebar > RULES.lmbLebarCm[1]) pen(4, `${nm}: lebar LMB ${lebar} cm di luar ${RULES.lmbLebarCm[0]}–${RULES.lmbLebarCm[1]} cm.`, 'warn', at);
    if (t < RULES.lmbTinggiCm[0] - 10 || t > RULES.lmbTinggiCm[1]) pen(3, `${nm}: tinggi LMB ${t} cm di luar ${RULES.lmbTinggiCm[0]}–${RULES.lmbTinggiCm[1]} cm.`, 'warn', at);
    if (!by(fl, 'twtarik').some(tw => d.roles.get(tw.id) === 'lmb' && dist(center(tw), center(l)) <= 1.2)) pen(2, `${nm}: tambahkan tweeter tarik di bibir LMB (menghadap keluar).`, 'warn', at);
  };
  const mnLmb = MN ? by(MN, 'lmb') : [];
  if (MN) { menaraN = 1; lmbN += mnLmb.length; const dm = derive(m, MN); mnLmb.forEach(l => lmbCek(MN, dm, 'Menara', l, m.floors.length)); }
  m.floors.forEach((fl, i) => {
    const nm = fl.name, lmbs = by(fl, 'lmb'), d = ders[i];
    lmbN += lmbs.length;
    if (i !== top) { if (lmbs.length) pen(6, `${nm}: LMB sebaiknya hanya di lantai teratas / menara.`, 'warn', atR(i, lmbs[0])); return; }
    if (!lmbs.length && !mnLmb.length) pen(20, MN ? 'Menara belum punya LMB — buka tab "Menara" lalu pasang LMB di dindingnya.' : `${nm}: belum ada LMB (lubang masuk burung).`, 'bad', MN ? atR(m.floors.length, MF) : atF(i));
    lmbs.forEach(l => {
      lmbCek(fl, d, nm, l, i);
      if (!voids[i].some(z => distToRect(center(l), z) <= 0.45)) pen(6, `${nm}: LMB tidak menempel ke void — walet masuk LMB lalu terjun lewat void.`, 'warn', atR(i, l));
    });
    if (needMenara && MN && lmbs.length) pen(4, `${nm}: ${lmbs.length} LMB di lantai ini — gedung < ${RULES.menaraWajibJikaTinggi} m sebaiknya memasang LMB di dinding menara (tab "Menara").`, 'warn', atR(i, lmbs[0]));
    const nL = lmbs.length + mnLmb.length;
    if (RULES.lmbBesarJika(m.w, m.h) && nL && nL < 2) pen(5, 'RBW besar (lebar ≥ 8 m / panjang ≥ 20 m) disarankan ≥ 2 LMB.');
    if (!RULES.lmbBesarJika(m.w, m.h) && nL > 1) info('RBW kecil cukup 1 LMB (1 sisi) agar cahaya tidak berlebih.');
    if (needMenara && !MN) pen(10, `Tinggi gedung ${fmt(tinggi)} m < ${RULES.menaraWajibJikaTinggi} m → wajib menara (rumah monyet) 2–3 m di atas void — tambahkan lantai "Menara".`, 'bad', atF(top));
    if (MF) {
      if (Math.min(MF.w, MF.h) < 2) pen(4, `Menara ${fmt(MF.w)}×${fmt(MF.h)} m; minimum 2×2 m.`, 'warn', atR(m.floors.length, MF));
      if (!voids[i].some(v => ovArea(MF, v) >= 0.5 * v.w * v.h)) pen(5, 'Menara harus tepat di atas void — geser menara di tab "Menara".', 'warn', atR(m.floors.length, MF));
      const mt = floorHt(m, MN);
      if (mt < RULES.menaraTinggi[0] || mt > RULES.menaraTinggi[1]) info(`Tinggi menara ${fmt(mt)} m; buku menyarankan ${RULES.menaraTinggi[0]}–${RULES.menaraTinggi[1]} m.`);
    }
  });
  const hexas = LV.flatMap(fl => by(fl, 'hexa').map(h => ({ h, fl })));
  if (lmbN && !hexas.length) pen(2, 'Belum ada tweeter hexagonal (suara panggil) — pasang mepet di atas LMB (di menara atau lantai ber-LMB).');
  const jauh = hexas.filter(({ h, fl }) => !by(fl, 'lmb').some(l => dist(center(l), center(h)) <= 1.2)).length;
  if (jauh) info(`${jauh} tweeter hexagonal tidak mepet LMB — seret ke dekat LMB agar menempel otomatis.`);

  // --- ruang inap (zona dibagi sekat), sekat, LAR, tweeter, ventilasi per lantai ---
  m.floors.forEach((fl, i) => {
    const nm = fl.name, d = ders[i], F = rects[i], rooms = d.rooms, twi = by(fl, 'twinap'), twt = by(fl, 'twtarik');
    twinapN += twi.length; twtarikN += twt.length; inapN += rooms.length;
    sirip += siripEfektif(fl, d);
    if (!rooms.length) pen(10, `${nm}: belum ada ruang inap + sirip — sarang efektif hanya dihitung di ruang inap & jalur bersirip.`, 'bad', atF(i));
    const need = RULES.jumlahInap(F.w);
    if (rooms.length && rooms.length < need) pen(3, `${nm}: ${rooms.length} ruang inap; lebar ${fmt(F.w)} m umumnya ${need} ruang inap per blok.`, 'warn', atF(i));
    const up = rects[i + 1];
    if (up) by(fl, 'tangga').forEach(t => { if (ovArea(t, up) < 0.9 * t.w * t.h) pen(3, `${nm}: tangga tidak berada di bawah ${m.floors[i + 1].name} — tidak bisa naik ke lantai atas.`, 'warn', atR(i, t)); });
    let besar = null, gapBad = 0, noLar = null, noTw = null, sedikitTw = 0, noTarik = null, salahArah = 0;
    rooms.forEach(r => {
      const o = d.orient.get(r.id), kotak = r.st === 'kotak', g = r.gap || (kotak ? RULES.siripKotak : RULES.siripJarak);
      if (r.w > RULES.inapMaks + 0.05 && r.h > RULES.inapMaks + 0.05) besar = besar || { n: 0, r }; if (besar && r.w > RULES.inapMaks + 0.05 && r.h > RULES.inapMaks + 0.05) besar.n++;
      if (kotak ? g < RULES.siripKotakMin - 1e-9 || g > RULES.siripKotakMax + 1e-9 : g < RULES.siripJarakMin - 1e-9 || g > RULES.siripJarakMax + 1e-9) gapBad++;
      if (!d.entr.get(r.id).length) noLar = noLar ? { n: noLar.n + 1, r: noLar.r } : { n: 1, r };
      const inRoom = twi.filter(t => inRect(center(t), r)), rek = twinapRekomendasi(r, o);
      if (!inRoom.length) noTw = noTw ? { n: noTw.n + 1, r: noTw.r } : { n: 1, r }; else if (inRoom.length < rek * 0.5) sedikitTw++;
      salahArah += inRoom.filter(t => Number.isFinite(t.dir) && angDiff(d.dirs.get(t.id), d.autoDir.get(t.id)) > 45).length;
      if (!twt.some(t => d.roles.get(t.id) === 'inap' && inRect(center(t), r))) noTarik = noTarik ? { n: noTarik.n + 1, r: noTarik.r } : { n: 1, r };
    });
    if (noLar) pen(Math.min(16, noLar.n * 8), `${nm}: ${noLar.n} ruang inap tanpa jalan masuk (LAR atau sekat gantung) — walet tidak bisa masuk.`, 'bad', atR(i, noLar.r));
    if (besar) pen(Math.min(8, besar.n * 3), `${nm}: ${besar.n} ruang inap lebih besar dari ${RULES.inapMaks}×${RULES.inapMaks} m — belah dengan sekat (ruang inap bebas kecil, jangan terlalu besar).`, 'warn', atR(i, besar.r));
    if (gapBad) pen(3, `${nm}: jarak sirip di luar anjuran (sirip panjang ${RULES.siripJarakMin * 100}–${RULES.siripJarakMax * 100} cm, sirip kotak ${RULES.siripKotakMin * 100}–${RULES.siripKotakMax * 100} cm).`, 'warn', atF(i));
    if (noTw) pen(Math.min(8, noTw.n * 3), `${nm}: ${noTw.n} ruang inap belum ada tweeter inap.`, 'warn', atR(i, noTw.r));
    if (sedikitTw) pen(2, `${nm}: tweeter inap kurang — pakai pola 2-1-2 / 3-2-3 / 4-3-4 per baris sirip tiap ±1 m.`, 'warn', atF(i));
    if (salahArah) pen(Math.min(4, salahArah), `${nm}: ${salahArah} tweeter inap tidak menghadap jalan masuk ruangnya (LAR / sekat gantung).`, 'warn', atF(i));
    if (rooms.length && twt.length && noTarik) pen(Math.min(6, noTarik.n * 2), `${nm}: ${noTarik.n} ruang inap tanpa tweeter tarik inap di pojok belakang.`, 'warn', atR(i, noTarik.r));
    if (rooms.length && !twt.length) pen(4, `${nm}: belum ada tweeter tarik (rantai inap → LAR inap → jalur → LAR void → LMB).`, 'warn', atF(i));
    if (voids[i].length && twt.length && !twt.some(t => d.roles.get(t.id) === 'void')) pen(2, `${nm}: tambahkan tweeter tarik di bibir void (LAR void).`, 'warn', atR(i, voids[i][0]));
    const far1 = twt.find(t => { const tg = d.targets.get(t.id); return tg && dist(center(t), center(tg)) > RULES.tarikMaksJarak; });
    const far = twt.filter(t => { const tg = d.targets.get(t.id); return tg && dist(center(t), center(tg)) > RULES.tarikMaksJarak; }).length;
    if (far) pen(Math.min(6, far * 2), `${nm}: ${far} tweeter tarik berjarak > ${RULES.tarikMaksJarak} m dari tweeter di depannya — tambah tweeter tarik di antaranya.`, 'warn', far1 && atR(i, far1));
    if (d.blocked.size) { const b0 = fl.items.find(t => d.blocked.has(t.id)); pen(Math.min(6, d.blocked.size * 2), `${nm}: ${d.blocked.size} tweeter tarik menabrak sekat (tanda ✕) — rantai suara tidak bisa lanjut; pasang tweeter tarik di kusen LAR, atau tarik garis manual ke tweeter di depannya lewat LAR.`, 'warn', b0 && atR(i, b0)); }
    d.sp.regions.forEach(r => { if (d.sp.isVoid[r.id] && d.sp.regions.length > 1 && !d.sp.deg[r.id]) pen(6, `${nm}: ruang void tertutup sekat tanpa LAR void — walet dari void tidak bisa masuk ke ruang lain.`, 'bad', atR(i, r.box)); });
    const tertutup = d.sp.regions.filter(r => !d.sp.isVoid[r.id] && !Number.isFinite(d.sp.hop[r.id]) && r.area >= 1 && d.sp.type[r.id] !== 'audio');
    if (voids[i].length && tertutup.length) pen(Math.min(6, tertutup.length * 2), `${nm}: ${tertutup.length} ruang tertutup sekat tanpa jalan (LAR) ke ruang void — walet tidak bisa masuk ke ruang itu.`, 'warn', atR(i, tertutup[0].box));
    // ruang jalur: pemilik — jalur paling lama ditempati burung (remang) → beri sirip & tweeter inap juga
    by(fl, 'jalur').forEach(z => {
      if (!(z.gap || z.st)) info(`${nm}: ruang jalur belum diberi sirip — jalur justru paling lama ditempati burung; aktifkan sirip di panel kanan.`, atR(i, z));
      else if (!twi.some(t => inRect(center(t), z))) info(`${nm}: ruang jalur bersirip belum ada tweeter inap.`, atR(i, z));
    });
    // sekat & LAR
    if (!fl.walls.length && rooms.length) pen(8, `${nm}: belum ada sekat walet — tanpa sekat burung hanya mengisi bagian belakang dan cahaya void masuk ke ruang inap.`, 'bad', atF(i));
    const lars = fl.items.filter(it => isLar(it.t)), lepas0 = lars.find(l => !d.onWall.has(l.id)), lepas = lars.filter(l => !d.onWall.has(l.id)).length;
    if (lepas) pen(Math.min(6, lepas * 2), `${nm}: ${lepas} LAR belum menempel di sekat — seret ke garis sekat agar sekat terpotong.`, 'warn', lepas0 && atR(i, lepas0));
    const salahUkur = lars.filter(l => { const s = Math.max(l.w, l.h); return s < RULES.larLebar[0] || s > RULES.larLebar[1]; }).length;
    if (salahUkur) pen(1, `${nm}: ${salahUkur} LAR di luar lebar ideal 1–1,5 m.`, 'warn', atF(i));
    // ventilasi
    const vents = by(fl, 'vent'), needV = Math.round(RULES.ventPerLantai(F.w, F.h) * (sv?.rh === 'lembab' ? 0.5 : 1));
    ventN += vents.length;
    if (vents.length < needV * 0.6) pen(Math.min(6, Math.ceil((needV - vents.length) / 4)), `${nm}: ventilasi ${vents.length} titik; disarankan ±${needV} (pipa 4" tiap ±${sv?.rh === 'lembab' ? 2 : 1} m, 60 cm di bawah sirip).`, 'warn', atF(i));
    kolamN += by(fl, 'kolam').length; tanggaN += by(fl, 'tangga').length; audioN += by(fl, 'audio').length;
    if (i > 0 && by(fl, 'kolam').length) info(`${nm}: kolam biasanya di lantai dasar (lantai bawah paling lembab ±90%, atas ±75%).`, atR(i, by(fl, 'kolam')[0]));
  });
  const g = m.floors[0];
  if (!by(g, 'kolam').length) pen(5, `Lantai 1: tambahkan kolam air (ventilasi di atasnya) untuk kelembapan ${RULES.rh[0]}–${RULES.rh[1]}%.`, 'warn', atF(0));
  if (!by(g, 'pintu').length) pen(2, 'Lantai 1: belum ada pintu masuk.', 'warn', atF(0));
  if (!audioN) info(`Ruang audio ±${RULES.audioLuas} m² belum ada — boleh di dalam gedung dekat pintu, atau di luar gedung (seret keluar batas lantai).`);
  else levels(m).forEach((fl, i) => by(fl, 'audio').forEach(z => {
    const F = floorRect(m, fl), luar = z.x + z.w / 2 < F.x || z.x + z.w / 2 > F.x + F.w || z.y + z.h / 2 < F.y || z.y + z.h / 2 > F.y + F.h;
    if (z.w * z.h < RULES.audioLuas - 0.05) pen(1, `Ruang audio ${fmt(z.w)}×${fmt(z.h)} m (${fmt(Math.round(z.w * z.h * 10) / 10)} m²); pemilik menetapkan ±${RULES.audioLuas} m²${luar ? ' (posisi di luar gedung ✓)' : ''}.`, 'warn', atR(i, z));
  }));
  if (nF > 1 && !tanggaN) pen(3, 'Belum ada tangga/LAL untuk akses panen antar lantai (jangan lewat void).', 'warn', atF(0));

  // --- pencahayaan (simulasi perkiraan): ruang inap harus gelap < 1 lux (hal. 337, 343) ---
  let lux = null;
  try {
    const L = simulate(m);
    lux = { maxInap: 0, floors: [] };
    L.floors.forEach((f, fi) => {
      const avg = t => { const rs = f.regions.filter(r => r.type === t); return rs.length ? rs.reduce((s, r) => s + r.lux * r.area, 0) / rs.reduce((s, r) => s + r.area, 0) : null; };
      const inap = f.regions.filter(r => r.type === 'inap'), terang = inap.filter(r => r.lux > RULES.luxInap);
      const mx = inap.length ? Math.max(...inap.map(r => r.lux)) : null;
      if (mx != null) lux.maxInap = Math.max(lux.maxInap, mx);
      lux.floors.push({ fi, inap: mx, jalur: avg('jalur'), void: avg('void') });
      if (terang.length) pen(Math.min(9, terang.length * 3), `${LV[fi].name}: ${terang.length} ruang inap diperkirakan ${luxTxt(Math.max(...terang.map(r => r.lux)))} (> ${RULES.luxInap} lux) — cahaya LMB/void terlalu tembus; buat LAR tidak segaris dengan LMB/void, tambah sekat, atau perkecil LMB (lihat "Cek lux").`, 'warn', terang[0].box && atR(fi, terang[0].box));
      const buntu = inap.filter(r => !r.reach);
      if (buntu.length) pen(Math.min(6, buntu.length * 2), `${LV[fi].name}: ${buntu.length} ruang inap tanpa jalur cahaya ke LMB — anakan yang belajar terbang tidak menemukan arah terang untuk keluar; sambungkan lewat LAR ke jalur yang remang menuju void (lihat "Cek lux").`, 'warn', buntu[0].box && atR(fi, buntu[0].box));
    });
  } catch (e) { console.warn('simulasi cahaya gagal', e); }

  // --- suhu & kelembapan per lantai (perkiraan; target suhu 26–31 °C, RH 75–85%) ---
  let iklim = null;
  try {
    iklim = climate(m);
    const salahT2 = iklim.levels.filter(l => !l.okT), salahRH = iklim.levels.filter(l => !l.okRH);
    if (salahT2.length) info(`Suhu di luar target 26–31 °C (pukul ${String(iklim.jam).padStart(2, '0')}.00): ${salahT2.slice(0, 3).map(l => `${l.name} ±${String(l.T).replace('.', ',')} °C`).join(', ')} — lihat "Cek udara".`, atF(salahT2[0].i));
    if (salahRH.length) info(`Kelembapan di luar target 75–85%: ${salahRH.slice(0, 3).map(l => `${l.name} ±${l.RH}%`).join(', ')} — atur kolam & ventilasi.`, atF(salahRH[0].i));
    if (iklim.panas.length >= 2) info(`${iklim.panas.length} sisi dinding terpapar matahari langsung (permukaan dalam ≥ 33 °C) — cat luar putih / paranet 2 lapis di sisi ${[...new Set(iklim.panas.map(p => p.arah))].join(' & ')}.`);
  } catch (e) { console.warn('simulasi iklim gagal', e); }

  // --- dB suara per ruang (target buku hal. 421-425 menurut lingkungan) ---
  let db = null;
  try {
    if (twtarikN + twinapN > 0) {
      db = simulateSound(m);
      let lemah = null, keras = null, nL = 0, nK = 0;
      db.floors.forEach(f => f.regions.forEach(r => nilaiDb(r, db.target).forEach(v => {
        if (v.k === 'tarik0' || v.k === 'tarikLemah') { nL++; lemah = lemah || { f: f.li, r }; } else { nK++; keras = keras || { f: f.li, r }; }
      })));
      if (nL) pen(Math.min(4, nL), `${nL} ruang dengan suara tarik lemah / tanpa suara (< ${db.target.tarik[0]} dB) — tambah tweeter tarik atau naikkan volume channel (lihat "Cek dB").`, 'warn', lemah.r.box && atR(lemah.f, lemah.r.box));
      if (nK) pen(Math.min(3, nK), `${nK} ruang terlalu keras dari target buku (${db.target.tarik[0]}–${db.target.tarik[1]} dB tarik / ${db.target.inap[0]}–${db.target.inap[1]} dB inap) — turunkan volume channel di "Ruang audio".`, 'warn', keras.r.box && atR(keras.f, keras.r.box));
    }
  } catch (e) { console.warn('simulasi dB gagal', e); }

  // --- kabel tweeter → ruang audio ---
  let kabel = null;
  try {
    kabel = cableInfo(m);
    const tembus = kabel.chs.filter(c => c.tembus);
    if (tembus.length) pen(2, `Kabel channel ${tembus.map(c => c.nm).slice(0, 3).join(', ')} terkurung sekat bata — kabel tidak boleh menembus dinding bata; ganti bahan sekat menjadi terpal atau beri jalur.`, 'warn');
    if (!audioN && (twtarikN + twinapN) > 0) info(`Belum ada ruang audio — panjang kabel dihitung dari pojok gedung (${fmt(kabel.total)} m, ${fmt(kabel.klem)} klem).`);
  } catch (e) { console.warn('hitung kabel gagal', e); }

  // --- titik sarang (pemantauan) ---
  const sarangN = { baru: 0, lama: 0, polesan: 0, jadi: 0 };
  LV.forEach(fl => fl.items.filter(it => it.t === 'sarang').forEach(s => { sarangN[s.ns || 'jadi'] = (sarangN[s.ns || 'jadi'] || 0) + 1; }));

  // --- rekomendasi dari pengamatan cepat (tidak memengaruhi skor) ---
  if (sv) {
    const su = SUARA[sv.env];
    if (su) rekom.push(`Suara untuk area ${su.label.toLowerCase()}: panggil ${su.panggil}; tarik ${su.tarik}; inap ${su.inap}.`);
    if (sv.env === 'air') rekom.push('Dekat perairan: jangan arahkan ventilasi ke laut dan kurangi jumlah ventilasi.');
    if (sv.env === 'kota') rekom.push('Area desa/kota: jaga jarak dari permukiman padat karena suara panggil menyala 05.00–19.00.');
    if (sv.suhu === 'panas') rekom.push('Suhu > 31 °C: cat luar putih, paranet 2 lapis berjarak 1 m dari dinding, aluminium foil di bawah atap, mesin embun ±20 menit tiap 3 jam.');
    if (sv.suhu === '?') rekom.push('Ukur suhu lokasi dengan termogun — target 26–31 °C.');
    if (sv.rh === 'kering') rekom.push('Area kering: tambah kolam / baskom air dan pasang ventilasi tepat di atas kolam; target kelembapan 75–85%.');
    if (sv.rh === 'lembab') rekom.push('Area lembab: ventilasi cukup tiap ±2 m; jaga kelembapan di bawah 90% agar sarang tidak lembek dan menguning.');
    if (sv.tinggi === 'ya') rekom.push('Ada penghalang tinggi di sekitar: naikkan menara ≥ 3 m agar LMB dan hexagonal tidak terhalang.');
    if (sv.angin !== '?' && sv.angin === sv.burung) rekom.push('LMB menghadap sisi berangin kencang: buat LMB lebih rendah dan terlindung, atau pakai LMB siku.');
    if (sv.populasi === 'sepi') rekom.push('Populasi sekitar masih sedikit: pasang hexagonal suara panggil di puncak menara tepat di atas LMB, aktif 05.00–19.00.');
    if (sv.populasi === 'ramai') rekom.push('Populasi sekitar ramai: utamakan suara tarik dan inap yang berkualitas agar walet mau menginap.');
    if (sv.burung === '?') rekom.push('Arah datang burung belum diamati — amati arah pulang walet saat senja sebelum menetapkan arah LMB.');
  }

  if (!notes.length) info('Semua aturan dasar terpenuhi. Detail arah LMB, suara, dan iklim mikro dibahas saat konsultasi.');
  score = Math.max(0, Math.min(100, Math.round(score)));
  const siripM = Math.round(sirip), sarang = Math.round(sirip * RULES.sarangPerMeterSirip);
  const siripM3 = Math.round(siripVolume(m, sirip) * 100) / 100, siripBatang = Math.ceil(sirip / RULES.papanPanjang);
  const kgRef = RULES.produksi6x12KgTahun.map(k => r1((k * luasTotal) / (72 * 2)));
  const channels = kabel?.chs.length || 2 * nF + (hexas.length ? 1 : 0);   // channel dari pengaturan kabel (tab Ruang audio)
  return { score, siripM, siripM3, siripBatang, sarang, inapN, ventN, kolamN, lmbN, menaraN, hexaN: hexas.length, twinapN, twtarikN, channels,
    kabelM: kabel ? Math.round(kabel.total) : 0, klemN: kabel ? kabel.klem : 0, sarangN, luas: rects[0].w * rects[0].h, luasTotal, tinggi, notes, rekom, kgRef, lux, iklim, db };
}
