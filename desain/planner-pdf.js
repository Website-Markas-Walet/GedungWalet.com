// Ekspor PDF multi-lembar: tiap lembar A4 melintang berisi denah SEMUA lantai untuk satu tema (suara tarik, suara
// inap, sirip, tata ruang, ruang audio, void, pencahayaan, kenyamanan, inap vs jalur, ventilasi, dB, gabungan) +
// penjelasan rinci & legenda, lalu lembar analisis kelayakan dan lembar RAB. Lembar yang diekspor dipilih lewat
// centang di dialog "Ekspor PDF".
import { TYPES, RULES, SUARA, AMPLI, AUDIO_ALAT, dbTarget, SARANG_JENIS, SARANG_WARNA } from './planner-data.js';
import { levels, floorRect, floorHt, center, isLar } from './planner-geom.js';
import { floorSVG, symbolSVG } from './planner-draw.js';
import { simulate, heatURL, luxTxt, simOf, arahNama, LUX_STOPS, luxColor } from './planner-light.js';
import { simulateSound, nilaiDb } from './planner-sound.js';
import { comfort, TINGKAT } from './planner-comfort.js';
import { cableInfo, channels, chCover } from './planner-cable.js';
import { rabRows } from './planner-rab.js';
import { climate, simulateAir } from './planner-air.js';
import { analyze } from './planner-analysis.js';
import { makeSheetCanvas, pagesPDF } from './planner-export.js';

export const LEMBAR = [
  ['tarik', 'Denah suara tarik (tweeter & kabel)'],
  ['inap', 'Denah suara inap (tweeter & kabel)'],
  ['sirip', 'Denah papan sirip'],
  ['tata', 'Denah tata ruang'],
  ['audio', 'Denah & isi ruang audio'],
  ['void', 'Denah void (jalur terbang)'],
  ['cahaya', 'Denah pencahayaan (lux)'],
  ['nyaman', 'Denah ruangan ternyaman'],
  ['inapjalur', 'Denah ruang inap vs ruang jalur'],
  ['vent', 'Denah ventilasi'],
  ['db', 'Denah suara dB per ruang'],
  ['lengkap', 'Denah lengkap gabungan + 3D'],
  ['analisis', 'Analisis kelayakan'],
  ['rab', 'RAB perlengkapan'],
];

const PW = 1754, PH = 1240, MG = 56, RIGHT = 430, PADF = 26, PADL = PADF + 104;   // A4 melintang 150 dpi
const FONT = 'Roboto, Arial, sans-serif', HEAD = 'Raleway, Roboto, Arial, sans-serif';
const fmt = n => (+n).toLocaleString('id-ID');
const svgUrl = svg => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.includes('xmlns=') ? svg : svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
function wrap(c, text, maxW) {
  const out = [];
  String(text).split('\n').forEach(par => {
    let line = '';
    for (const w of par.split(' ')) { const t = line ? `${line} ${w}` : w; if (c.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
    out.push(line);
  });
  return out;
}
function page(judul, m, no, total) {
  const cv = document.createElement('canvas'); cv.width = PW; cv.height = PH;
  const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, PW, PH);
  c.fillStyle = '#1565C0'; c.fillRect(0, 0, PW, 8);
  c.fillStyle = '#1a1a1a'; c.font = `800 30px ${HEAD}`; c.fillText(judul, MG, 58);
  c.font = `15px ${FONT}`; c.fillStyle = '#5a6472';
  c.fillText(`${m.name || 'Rumah Walet'}${m.city ? ' · ' + m.city : ''} · ${fmt(m.w)} × ${fmt(m.h)} m · ${m.floors.length} lantai${m.menara ? ' + menara' : ''} · ${new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`, MG, 84);
  c.textAlign = 'right';
  c.fillText(`GedungWalet.com · WA 0852 3535 0662 — lembar ${no}/${total}`, PW - MG, 84);
  c.textAlign = 'left';
  c.strokeStyle = '#e6eaf0'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(MG, 100); c.lineTo(PW - MG, 100); c.stroke();
  return { cv, c };
}
// Kolom kanan: paragraf penjelasan (judul kecil + bullet), statistik, legenda.
function rightCol(c, o) {
  const x = PW - MG - RIGHT; let y = 132;
  const h4 = t => { c.fillStyle = '#1a1a1a'; c.font = `700 17px ${HEAD}`; c.fillText(t, x, y); y += 10; };
  h4('Penjelasan');
  c.font = `13.5px ${FONT}`; c.fillStyle = '#3a4452';
  o.desc.forEach(p => { y += 10; wrap(c, '• ' + p, RIGHT).forEach(l => { y += 18; c.fillText(l, x, y); }); });
  if (o.stats?.length) {
    y += 30; h4('Angka pada desain ini'); y += 8;
    o.stats.forEach(([k, v]) => {
      y += 24;
      c.font = `13.5px ${FONT}`; c.fillStyle = '#5a6472'; c.fillText(k, x, y);
      c.fillStyle = '#1a1a1a'; c.font = `600 13.5px ${FONT}`; c.textAlign = 'right'; c.fillText(String(v), x + RIGHT, y); c.textAlign = 'left';
      c.strokeStyle = '#f0f2f5'; c.beginPath(); c.moveTo(x, y + 7); c.lineTo(x + RIGHT, y + 7); c.stroke();
    });
  }
  if (o.legend?.length) {
    y += 34; h4('Legenda'); y += 4;
    o.legend.forEach(it => {
      y += 30;
      if (it.img) c.drawImage(it.img, x, y - 20, 26, 26);
      else if (it.grad) { const g = c.createLinearGradient(x, 0, x + 26, 0); it.grad.forEach(([p, col]) => g.addColorStop(p, col)); c.fillStyle = g; c.fillRect(x, y - 16, 26, 18); }
      else { c.fillStyle = it.color || '#999'; c.fillRect(x, y - 16, 22, 18); c.strokeStyle = 'rgba(0,0,0,.2)'; c.strokeRect(x, y - 16, 22, 18); }
      c.fillStyle = '#3a4452'; c.font = `13px ${FONT}`;
      wrap(c, it.t, RIGHT - 36).forEach((l, k2) => c.fillText(l, x + 34, y - 2 + k2 * 15));
    });
  }
  if (o.foot) { c.font = `11.5px ${FONT}`; c.fillStyle = '#8b95a3'; let fy = PH - 40; wrap(c, o.foot, RIGHT).reverse().forEach(l => { c.fillText(l, x, fy); fy -= 15; }); }
}
// Denah semua lantai di area kiri; overlay (heatmap dsb.) digambar di atas gambar denah dengan pemetaan koordinat.
async function drawFloors(cv, c, m, spec, shared) {
  const LV = levels(m), n = LV.length, areaW = PW - 2 * MG - RIGHT - 26, areaH = PH - 150;
  const cols = n <= 3 ? n : Math.ceil(n / (n <= 8 ? 2 : 3)), rows = Math.ceil(n / cols);
  const cellW = (areaW - (cols - 1) * 14) / cols, cellH = (areaH - (rows - 1) * 12) / rows;
  let s = 1e9;
  LV.forEach(fl => { const F = floorRect(m, fl); s = Math.min(s, (cellW - PADF - PADL) / m.w, (cellH - 2 * PADF - 26) / m.h); });
  s = Math.max(6, s);
  for (let i = 0; i < n; i++) {
    const col = i % cols, row = Math.floor(i / cols), x0 = MG + col * (cellW + 14), y0 = 128 + row * (cellH + 12);
    const svg = floorSVG(m, i, s, { pfx: `pdf${spec.k}${i}`, chain: !!spec.chain, labels: spec.labels !== false, show: spec.show, cables: spec.cablesFor ? spec.cablesFor(i) : null, luxLabels: spec.luxLabels ? spec.luxLabels(i) : null, flow: spec.flowFor ? spec.flowFor(i) : null, struktur: spec.struktur ?? false });
    const im = await loadImg(svgUrl(svg));
    const ix = x0 + (cellW - im.width) / 2, iy = y0 + 18;
    c.fillStyle = '#1a1a1a'; c.font = `700 15px ${HEAD}`;
    c.fillText(LV[i].name + (i === m.floors.length - 1 ? ' · atas' : ''), ix + PADL, y0 + 10);
    c.drawImage(im, ix, iy);
    const ov = spec.overlay ? await spec.overlay(i, shared) : null;
    if (ov) {   // {img, x, y, w, h} dalam meter denah → dipetakan ke posisi gambar
      c.globalAlpha = ov.alpha ?? 0.78;
      c.drawImage(ov.img, ix + PADL + ov.x * s, iy + PADF + ov.y * s, ov.w * s, ov.h * s);
      c.globalAlpha = 1;
    }
  }
}
const sym = async t => ({ img: await loadImg(svgUrl(symbolSVG(t, 30))) });
const showMap = (full, dim = {}) => it => (full.includes(it.t) ? 1 : dim[it.t] ?? (it.t === 'sekat' ? 0.45 : 0.08));

// Overlay warna per ruang (kenyamanan) — canvas 1 piksel = 1 sel grid ruang.
function comfortOverlay(C, fi) {
  const f = C.L.floors[fi], cvo = document.createElement('canvas');
  cvo.width = f.nx; cvo.height = f.ny;
  const c2 = cvo.getContext('2d'), img = c2.createImageData(f.nx, f.ny);
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const col = f.regions.map(r => { const room = C.rooms[r.gid]; return [...hex(TINGKAT[room.level]), room.level === 'jalan' ? 60 : 150]; });
  for (let k = 0; k < f.reg.length; k++) { const r = f.reg[k]; if (r < 0) continue; const cc = col[r]; img.data.set(cc, k * 4); }
  c2.putImageData(img, 0, 0);
  return { img: cvo, x: f.F.x, y: f.F.y, w: f.nx * f.cs, h: f.ny * f.cs, alpha: 0.8 };
}

// Susun seluruh lembar terpilih → PDF. prog(txt) melaporkan kemajuan; img3d dipakai lembar "lengkap".
export async function buildPDF(m, keys, img3d, prog = () => {}) {
  try { await document.fonts?.ready; } catch {}
  const LV = levels(m), env = m.survey?.env || 'sawah', su = SUARA[env], tg = dbTarget(env), sim = simOf(m);
  let a = null, L = null, S = null, C = null, cab = null, chs = [], clim = null, A2 = null;
  const need = k => keys.includes(k);
  try { a = analyze(m); } catch {}
  try { cab = cableInfo(m); chs = channels(m); } catch {}
  if (need('cahaya') || need('nyaman')) { try { L = simulate(m); } catch {} }
  if (need('db')) { try { S = simulateSound(m); } catch {} }
  if (need('nyaman')) { try { C = comfort(m); } catch {} }
  if (need('vent')) { try { A2 = simulateAir(m); clim = climate(m); } catch {} }
  const cvs = [], sel = LEMBAR.filter(([k]) => need(k)), total = sel.length;
  const jamTxt = `pukul ${String(Math.floor(+sim.jam)).padStart(2, '0')}.${+sim.jam % 1 ? '30' : '00'}`;
  const cableRunsFor = (types, fi) => cab ? { runs: cab.chs.filter(ch => types.includes(ch.t)).flatMap(ch => ch.runs.filter(r => r.f === fi).map(r => ({ warna: ch.warna, pts: r.pts, on: true }))), riser: cab.riser } : null;
  const chLegend = types => (cab ? cab.chs.filter(ch => types.includes(ch.t)).slice(0, 8).map(ch => ({ color: ch.warna, t: `${ch.nm} — ${ch.count} tweeter · kabel ±${fmt(Math.round(ch.len))} m` })) : []);
  let no = 0;
  for (const [k, nm] of sel) {
    no++; prog(`Menyusun lembar ${no}/${total}: ${nm}…`);
    await new Promise(r => setTimeout(r));   // beri napas UI
    if (k === 'lengkap') { cvs.push(await makeSheetCanvas(m, a, img3d)); continue; }
    if (k === 'analisis') { cvs.push(analisisPage(m, a, no, total)); continue; }
    if (k === 'rab') { rabPages(m, a, cab, no, total).forEach(cv => cvs.push(cv)); continue; }
    if (k === 'audio') { cvs.push(await audioPage(m, a, cab, chs, no, total)); continue; }
    const { cv, c } = page(`Lembar ${nm}`, m, no, total);
    const spec = { k }, o = { desc: [], stats: [], legend: [], foot: 'Denah konsep (indikatif), bukan gambar kerja. Simulasi = perkiraan orde besaran; cocokkan dengan pengukuran di lokasi. Aturan: buku Budidaya Walet Markaswalet & DED GedungWalet.' };
    if (k === 'tarik') {
      Object.assign(spec, { show: showMap(['twtarik', 'hexa', 'lmb'], { void: 0.3, lar: 0.35, larj: 0.35, jalur: 0.15, inap: 0.12 }), chain: true, labels: false, cablesFor: fi => cableRunsFor(['twtarik', 'hexa'], fi) });
      o.desc = [
        'Tweeter tarik memandu walet dari LMB masuk sampai ke ruang inap. Setiap tweeter tarik MENGHADAP tweeter tarik di depannya: inap → LAR inap → jalur → LAR void → LMB (garis putus merah = rantainya).',
        'Rantai tidak boleh menembus sekat — harus lewat LAR / bawah sekat gantung; jarak antar tweeter tarik maksimal 5 m (buku hal. 466), ±25 cm dari dinding belakang.',
        'Tweeter hexagonal (6 corong) di atas LMB memanggil walet dari luar; kabelnya naik setinggi gedung + menara.',
        `Garis berwarna = jalur kabel tiap channel menuju ruang audio (R): selalu siku mengikuti alur sirip/dinding, menembus sekat terpal, TIDAK menembus bata; klem tiap 10 cm. Suara tarik untuk area ${su.label.toLowerCase()}: ${su.tarik}.`,
      ];
      o.stats = [['Tweeter tarik', a?.twtarikN ?? '-'], ['Tweeter hexagonal', a?.hexaN ?? '-'], ['Kabel channel tarik + panggil', cab ? fmt(Math.round(cab.chs.filter(ch => ch.t !== 'twinap').reduce((s2, ch) => s2 + ch.len, 0))) + ' m' : '-'], ['Klem (tiap 10 cm)', cab ? fmt(cab.chs.filter(ch => ch.t !== 'twinap').reduce((s2, ch) => s2 + ch.klem, 0)) : '-']];
      o.legend = [await sym('twtarik'), await sym('hexa'), await sym('lmb')].map((g, i2) => ({ ...g, t: ['Tweeter tarik (corong menghadap tweeter di depannya)', 'Tweeter hexagonal — panggil, mepet di atas LMB', 'LMB — lubang masuk burung'][i2] }));
      o.legend.push({ color: '#C62828', t: 'Garis putus merah = rantai suara tarik' }, ...chLegend(['twtarik', 'hexa']));
    } else if (k === 'inap') {
      Object.assign(spec, { show: showMap(['twinap', 'sarang'], { inap: 0.35, jalur: 0.3, lar: 0.35, larj: 0.35, void: 0.15 }), labels: false, cablesFor: fi => cableRunsFor(['twinap'], fi) });
      o.desc = [
        'Tweeter inap dipasang di papan sirip ruang inap & ruang jalur, SEMUANYA menghadap jalan masuk ruangnya (LAR / sekat gantung yang mengarah ke LAR void) — hanya 4 arah lurus, tidak serong.',
        'Pola per baris sirip tiap ±1 m: 2-1-2 (lebar ±1,5 m), 3-2-3 (2–3 m), 4-3-4 (4–5 m) — buku hal. 451-452.',
        `Suara inap untuk area ${su.label.toLowerCase()}: ${su.inap} — diputar 24 jam.`,
        'Garis berwarna = kabel channel inap menuju ruang audio (R), siku mengikuti alur sirip, menembus terpal, tidak menembus bata.',
      ];
      o.stats = [['Tweeter inap', a?.twinapN ?? '-'], ['Ruang inap', a?.inapN ?? '-'], ['Kabel channel inap', cab ? fmt(Math.round(cab.chs.filter(ch => ch.t === 'twinap').reduce((s2, ch) => s2 + ch.len, 0))) + ' m' : '-'], ['Klem (tiap 10 cm)', cab ? fmt(cab.chs.filter(ch => ch.t === 'twinap').reduce((s2, ch) => s2 + ch.klem, 0)) : '-']];
      o.legend = [{ ...(await sym('twinap')), t: 'Tweeter inap (menghadap jalan masuk ruang)' }, { ...(await sym('sarang')), t: 'Titik sarang (pemantauan)' }, ...chLegend(['twinap'])];
    } else if (k === 'sirip') {
      Object.assign(spec, { show: showMap(['inap', 'jalur', 'sarang', 'sekat'], { void: 0.25, lar: 0.4, larj: 0.4 }), labels: true });
      o.desc = [
        `Sirip panjang: jarak ${RULES.siripJarakMin * 100}–${RULES.siripJarakMax * 100} cm (standar ${RULES.siripJarak * 100} cm), melintang arah burung datang. Sirip kotak: petak ${RULES.siripKotakMin * 100}–${RULES.siripKotakMax * 100} cm.`,
        `Papan ${m.siripTebal || RULES.siripTebalCm}×${m.siripLebar || RULES.siripLebarCm} cm juga dipasang menempel di semua sisi yang berdinding / bersekat, walaupun arah sirip melintang.`,
        'Ruang jalur ikut diberi sirip (paling lama ditempati burung karena remang) dan dihitung sarang. Sarang efektif hanya dari papan sirip di ruang inap & jalur — bukan void.',
        'Garis tipis di dalam ruang = arah & jarak sirip; garis tebal di tepi = papan yang menempel dinding.',
      ];
      o.stats = [['Total papan sirip', `${fmt(a?.siripM ?? 0)} m`], ['Volume kayu', `${fmt(a?.siripM3 ?? 0)} m³`], [`Perkiraan batang @${RULES.papanPanjang} m`, `± ${fmt(a?.siripBatang ?? 0)}`], ['Sarang efektif*', `± ${fmt(a?.sarang ?? 0)}`]];
      o.legend = [{ ...(await sym('inap')), t: 'Ruang inap + sirip (garis = arah sirip)' }, { ...(await sym('jalur')), t: 'Ruang jalur + sirip' }];
      o.foot = `*Asumsi ${RULES.sarangPerMeterSirip} sarang per meter sirip; belum termasuk sisa potong ±10%. ` + o.foot;
    } else if (k === 'tata') {
      Object.assign(spec, { show: showMap(['void', 'jalur', 'inap', 'audio', 'kolam', 'tangga', 'pintu', 'lar', 'larj', 'lmb', 'vent', 'menara', 'sekat'], { twinap: 0.15, twtarik: 0.15, hexa: 0.3 }), labels: true, struktur: true });
      o.desc = [
        'Alur ruang dari luar ke dalam: LMB → ruang void (lubang terjun, "lift" walet) → LAR void → ruang jalur (remang, transit) → LAR inap → ruang inap (gelap).',
        `Ruang inap bebas kecil tapi maksimal ${RULES.inapMaks}×${RULES.inapMaks} m — lebih besar dibelah sekat. Ruang audio ±${RULES.audioLuas} m², boleh di dalam atau di luar gedung.`,
        'Sekat yang saling menempel otomatis tersambung membentuk ruang; LAR & celah bawah sekat gantung adalah pintunya.',
        'Kolom & balok (kotak hitam & garis ganda) digambar sesuai modul kolom.',
      ];
      o.stats = [['Luas bangunan', `${fmt(Math.round((a?.luasTotal ?? 0) * 10) / 10)} m²`], ['Ruang inap', a?.inapN ?? '-'], ['LMB / menara', `${a?.lmbN ?? '-'} / ${a?.menaraN ? 'ada' : 'tidak'}`], ['Kolam / tangga / pintu', `${a?.kolamN ?? '-'} / ${LV.reduce((s2, f) => s2 + f.items.filter(i2 => i2.t === 'tangga').length, 0)} / ${LV.reduce((s2, f) => s2 + f.items.filter(i2 => i2.t === 'pintu').length, 0)}`]];
      o.legend = await Promise.all(['void', 'jalur', 'inap', 'audio', 'lar', 'lmb', 'kolam', 'tangga'].map(async t2 => ({ ...(await sym(t2)), t: TYPES[t2].name })));
    } else if (k === 'void') {
      Object.assign(spec, { show: showMap(['void', 'lmb', 'menara', 'larj'], { lar: 0.45, jalur: 0.2, tangga: 0.35 }), labels: false });
      o.desc = [
        'Void = lubang vertikal lurus dari atap sampai lantai dasar — jalur terbang naik-turun walet. Posisinya SAMA di tiap lantai (terjun lurus, bukan zig-zag), bebas hambatan.',
        `Ukuran minimal sisi ${RULES.voidSisiMin} m; rekomendasi ≥ 2×2 m (gedung 4×12: 2×4 m). Menara (rumah monyet) berdiri tepat di atas void; LMB di dinding menara.`,
        'LAR void menghubungkan ruang void dengan ruang jalur; di lantai teratas dipakai LAR jendela 1×1 m untuk meredam cahaya LMB.',
        'Garis putus biru antar lantai pada denah editor menandai bayangan void lantai lain — pastikan segaris.',
      ];
      const v0 = m.floors[0].items.find(i2 => i2.t === 'void');
      o.stats = [['Ukuran void lantai 1', v0 ? `${fmt(v0.w)} × ${fmt(v0.h)} m` : '-'], ['LMB', a?.lmbN ?? '-'], ['Menara', a?.menaraN ? `ada · tinggi ${fmt(floorHt(m, m.menara))} m` : 'tidak'], ['Tinggi gedung', `${fmt(a?.tinggi ?? 0)} m`]];
      o.legend = [{ ...(await sym('void')), t: 'Void (lubang terjun)' }, { ...(await sym('lmb')), t: 'LMB' }, { ...(await sym('larj')), t: 'LAR jendela (peredam cahaya)' }, { ...(await sym('menara')), t: 'Tapak menara' }];
    } else if (k === 'cahaya') {
      Object.assign(spec, {
        show: showMap(['lmb', 'larj', 'lar'], { void: 0.25, jalur: 0.2, inap: 0.15 }), labels: false,
        luxLabels: fi => (L ? L.floors[fi].regions.filter(r => r.area >= 1).map(r => ({ x: r.cx, y: r.cy, txt: luxTxt(r.lux), bad: r.type === 'inap' && r.lux > RULES.luxInap })) : null),
        flowFor: fi => (L ? L.flow[fi] : null),
        overlay: async fi => {
          if (!L) return null;
          const f = L.floors[fi];
          return { img: await loadImg(heatURL(L, fi)), x: f.F.x, y: f.F.y, w: f.nx * f.cs, h: f.ny * f.cs, alpha: 0.8 };
        },
      });
      o.desc = [
        `RBW tanpa lampu: cahaya hanya masuk lewat LMB. Simulasi ini ${jamTxt}, langit ${sim.langit}, depan gedung menghadap ${arahNama(+sim.hadap)} — LMB yang menghadap matahari mendapat sinar langsung.`,
        `Target: ruang inap GELAP < ${RULES.luxInap} lux (hal. 337-343); ruang jalur remang; makin dalam & makin ke bawah makin gelap; sekat menghalau cahaya.`,
        'Panah jingga = jalur cahaya yang menuntun anakan yang belajar terbang menuju ruang lebih terang sampai keluar LMB. Ruang inap tanpa jalur ini = buntu (✕).',
        'Angka pada tiap ruang = perkiraan lux rata-rata ±30 cm di bawah plafon (area sirip).',
      ];
      o.stats = (a?.lux ? [['Ruang inap paling terang', luxTxt(a.lux.maxInap)]] : []).concat([['Pengaturan', `${jamTxt} · ${sim.langit} · hadap ${arahNama(+sim.hadap)}`]]);
      o.legend = [{ grad: LUX_STOPS.map(([v, c2], i2) => [i2 / (LUX_STOPS.length - 1), `rgb(${c2.join(',')})`]), t: 'Skala warna: biru tua < 0,01 lux (gelap) → jingga ≥ 1.000 lux (terang)' }, { color: '#E65100', t: 'Panah jingga = jalur cahaya anakan menuju LMB' }];
    } else if (k === 'nyaman') {
      Object.assign(spec, { show: showMap(['twtarik', 'twinap'], { void: 0.3, lar: 0.4, larj: 0.4, inap: 0.15, jalur: 0.15 }), labels: false, overlay: async fi => (C ? comfortOverlay(C, fi) : null) });
      o.desc = [
        'Warna tiap ruang = seberapa nyaman ruang itu bagi walet, gabungan dari: gelap-terangnya (inap harus < 1 lux), mudah-sulitnya dijangkau dari LMB (jumlah pintu yang dilewati), ada-tidaknya suara tarik & inap, jalur keluar anakan, dan pertukaran udara.',
        'Ruang merah / kuning cepat ditinggalkan burung pada simulasi — atur ulang sekat, LAR, tweeter, atau ventilasinya.',
        'Ruang void & jalur lintasan dihitung sebagai jalan terbang (abu-abu).',
      ];
      const rs = C ? C.rooms.filter(r => r.level !== 'jalan') : [];
      o.stats = [['Ruang nyaman', rs.filter(r => r.level === 'nyaman').length], ['Kurang nyaman', rs.filter(r => r.level === 'kurang').length], ['Tidak nyaman', rs.filter(r => r.level === 'tidak').length]];
      o.legend = [{ color: TINGKAT.nyaman, t: 'Nyaman (skor ≥ 70)' }, { color: TINGKAT.kurang, t: 'Kurang nyaman (40–69)' }, { color: TINGKAT.tidak, t: 'Tidak nyaman (< 40)' }, { color: TINGKAT.jalan, t: 'Jalan terbang / void' }];
    } else if (k === 'inapjalur') {
      Object.assign(spec, { show: showMap(['inap', 'jalur', 'void', 'lar', 'larj', 'sekat'], { twinap: 0.2 }), labels: true });
      o.desc = [
        'Ruang INAP (cokelat): kamar gelap tempat walet bersarang — satu-satunya bagian yang menghasilkan; sirip di sini sarang efektif.',
        'Ruang JALUR (hijau): lorong remang antara void dan ruang inap. Justru sering paling lama ditempati burung karena remangnya — beri sirip & tweeter inap juga; sirip jalur ikut dihitung sarang.',
        'Ruang VOID (biru): jalur terbang vertikal, tidak untuk sarang.',
        'Nama tiap ruang tertulis di tepi kiri denah dengan garis penunjuk.',
      ];
      const luasT = t2 => Math.round(LV.reduce((s2, f) => s2 + f.items.filter(i2 => i2.t === t2).reduce((q, z) => q + z.w * z.h, 0), 0));
      o.stats = [['Ruang inap', `${a?.inapN ?? '-'} ruang · ±${fmt(luasT('inap'))} m²`], ['Ruang jalur', `±${fmt(luasT('jalur'))} m²`], ['Sarang efektif', `± ${fmt(a?.sarang ?? 0)}`]];
      o.legend = [{ ...(await sym('inap')), t: 'Ruang inap (gelap, sarang efektif)' }, { ...(await sym('jalur')), t: 'Ruang jalur (remang, transit + sirip)' }, { ...(await sym('void')), t: 'Void' }];
    } else if (k === 'vent') {
      Object.assign(spec, { show: showMap(['vent', 'kolam'], { lmb: 0.5, void: 0.2, inap: 0.12, jalur: 0.12 }), labels: false });
      o.desc = [
        `Ventilasi paralon 4" bulat menembus dinding tiap ±${sv2(m)} m, ${RULES.ventDiBawahSiripCm} cm di bawah sirip; di dalam memakai elbow menghadap ke bawah lalu pipa turun 1 m + jaring hama (simbol: pipa → lingkaran elbow → ↓1 m).`,
        'Tidak perlu ventilasi di sisi ruang void; kurangi di daerah lembab; jangan menghadap laut.',
        A2 ? `Siklus udara ${jamTxt}: ${A2.masuk.vent} ventilasi menjadi INTAKE dan ${A2.keluar.vent} OUTTAKE; LMB ${A2.masuk.lmb ? 'intake' : 'outtake'} (efek cerobong — udara dalam yang hangat naik keluar lewat bukaan tinggi).` : 'Siklus udara: ventilasi bawah = intake, LMB tinggi = outtake saat udara dalam lebih hangat dari luar.',
        clim ? `Perkiraan suhu/kelembapan per lantai (${jamTxt}): ${clim.levels.slice(0, 4).map(l2 => `${l2.name} ±${String(l2.T).replace('.', ',')}°C/${l2.RH}%`).join(' · ')}.` : '',
      ].filter(Boolean);
      o.stats = [['Titik ventilasi', a?.ventN ?? '-'], ['Kolam air', a?.kolamN ?? '-'], ['Target suhu / RH', `${RULES.suhu[0]}–${RULES.suhu[1]} °C / ${RULES.rh[0]}–${RULES.rh[1]}%`]];
      o.legend = [{ ...(await sym('vent')), t: 'Ventilasi: pipa 4" + elbow + pipa turun 1 m' }, { ...(await sym('kolam')), t: 'Kolam air (pelembap, ventilasi di atasnya)' }];
    } else if (k === 'db') {
      Object.assign(spec, {
        show: showMap(['twtarik', 'twinap', 'hexa'], { inap: 0.15, jalur: 0.15, void: 0.2 }), labels: false,
        luxLabels: fi => (S ? S.floors[fi].regions.filter(r => r.area >= 1 && r.type !== 'void').map(r => ({ x: r.cx, y: r.cy, txt: `T ${r.tarik || '–'} · I ${r.inap || '–'} dB`, bad: nilaiDb(r, S.target).length > 0 })) : null),
      });
      o.desc = [
        `Angka tiap ruang = perkiraan dB suara TARIK (T) dan INAP (I) di tengah ruang, dari volume channel pada 1 m dikurangi jarak & penghalang (bata ±22 dB, terpal ±10, sekat gantung ±4; bukaan LAR tidak menghalangi).`,
        `Target buku (hal. 421-425) untuk area ${su.label.toLowerCase()}: panggil ${su.panggil} · tarik ${su.tarik} · inap ${su.inap}.`,
        'Angka merah = di luar target (terlalu lemah → walet tidak tertarik; terlalu keras → walet tidak nyaman). Atur volume per channel di tab "Ruang audio".',
        S?.mati.length ? `Pada ${jamTxt} kategori ${S.mati.join(', ')} sedang MATI oleh jadwal timer.` : `Semua kategori suara aktif pada ${jamTxt} sesuai jadwal timer.`,
      ];
      o.stats = chs.slice(0, 7).map(ch => [ch.nm, `${ch.vol} dB${ch.on === false ? ' (mati)' : ''}`]);
      o.legend = [{ color: '#C62828', t: 'Angka merah = di luar target buku' }];
    }
    await drawFloors(cv, c, m, spec, {});
    rightCol(c, o);
    cvs.push(cv);
  }
  prog('Membungkus PDF…');
  return pagesPDF(cvs, 0.9);
}
const sv2 = m => (m.survey?.rh === 'lembab' ? 2 : RULES.ventJarak);

// Lembar analisis kelayakan: skor + ringkasan + seluruh catatan + rekomendasi.
function analisisPage(m, a, no, total) {
  const { cv, c } = page('Lembar analisis kelayakan', m, no, total);
  if (!a) return cv;
  const x0 = MG, colW = (PW - 2 * MG - 40) / 2;
  const sc = a.score >= 80 ? '#1D9E75' : a.score >= 55 ? '#BA7517' : '#D85A30';
  c.fillStyle = sc; c.beginPath(); c.roundRect(x0, 124, 240, 96, 12); c.fill();
  c.fillStyle = '#fff'; c.font = `500 15px ${FONT}`; c.fillText('Skor kelayakan', x0 + 20, 152);
  c.font = `800 46px ${HEAD}`; c.fillText(`${a.score} / 100`, x0 + 20, 202);
  const stats = [
    ['Luas bangunan', `${fmt(Math.round(a.luasTotal * 10) / 10)} m²`], ['Tinggi gedung', `${fmt(a.tinggi)} m · ${m.floors.length} lt${m.menara ? ' + menara' : ''}`],
    ['Ruang inap', `${a.inapN}`], ['Sirip efektif', `${fmt(a.siripM)} m (${fmt(a.siripM3)} m³ · ±${fmt(a.siripBatang)} batang)`],
    ['Sarang efektif', `± ${fmt(a.sarang)}`], ['Referensi produksi', `${fmt(a.kgRef[0])}–${fmt(a.kgRef[1])} kg/tahun`],
    ['Tweeter inap / tarik / hexa', `${a.twinapN} / ${a.twtarikN} / ${a.hexaN}`], ['Channel ampli', a.channels],
    ['Kabel / klem', a.kabelM ? `${fmt(a.kabelM)} m / ${fmt(a.klemN)}` : '-'], ['LMB / ventilasi / kolam', `${a.lmbN} / ${a.ventN} / ${a.kolamN}`],
    ...(a.lux ? [['Cahaya ruang inap maks', luxTxt(a.lux.maxInap)]] : []),
  ];
  let y = 148;
  const sx = x0 + 290;
  stats.forEach(([k2, v]) => {
    c.font = `14px ${FONT}`; c.fillStyle = '#5a6472'; c.fillText(k2, sx, y);
    c.fillStyle = '#1a1a1a'; c.font = `600 14px ${FONT}`; c.textAlign = 'right'; c.fillText(String(v), sx + 500, y); c.textAlign = 'left';
    y += 25;
  });
  y = Math.max(y, 250) + 26;
  c.fillStyle = '#1a1a1a'; c.font = `700 19px ${HEAD}`; c.fillText('Catatan analisis', x0, y);
  let cy = y + 26, col = 0;
  const colX = () => x0 + col * (colW + 40);
  a.notes.forEach(n => {
    const col2 = n.lvl === 'bad' ? '#993C1D' : n.lvl === 'warn' ? '#854F0B' : '#0F6E56';
    const lines = wrap(c, '• ' + n.txt, colW);
    if (cy + lines.length * 19 > PH - 120 && col === 0) { col = 1; cy = y + 26; }
    if (cy + lines.length * 19 > PH - 120) return;
    c.font = `13.5px ${FONT}`; c.fillStyle = col2;
    lines.forEach(l => { c.fillText(l, colX(), cy); cy += 19; });
    cy += 5;
  });
  if (a.rekom?.length && cy < PH - 220) {
    cy += 16; c.fillStyle = '#1a1a1a'; c.font = `700 19px ${HEAD}`; c.fillText('Rekomendasi lokasi', colX(), cy); cy += 24;
    c.font = `13.5px ${FONT}`; c.fillStyle = '#0C447C';
    a.rekom.forEach(t2 => wrap(c, '• ' + t2, colW).forEach(l => { if (cy < PH - 110) { c.fillText(l, colX(), cy); cy += 19; } }));
  }
  c.font = `12px ${FONT}`; c.fillStyle = '#8b95a3';
  c.fillText('Aturan: buku Budidaya Walet Markaswalet & DED GedungWalet. Simulasi & angka = perkiraan; keputusan akhir lewat konsultasi tim.', x0, PH - 60);
  return cv;
}
// Lembar RAB — bisa lebih dari satu halaman bila barisnya banyak.
function rabPages(m, a, cab, no, totalLbr) {
  let rows = [], total = 0;
  try { const r = rabRows(m, a, cab); rows = r.rows; total = r.total; } catch {}
  const per = 24, out = [];
  for (let p = 0; p * per < Math.max(1, rows.length); p++) {
    const { cv, c } = page(`Lembar RAB perlengkapan walet${rows.length > per ? ` (${p + 1}/${Math.ceil(rows.length / per)})` : ''}`, m, no, totalLbr);
    const x0 = MG, cols = [['Nama item', 0, 430], ['Jumlah', 430, 170], ['Harga satuan', 600, 190], ['Harga total', 790, 200], ['Keterangan', 990, PW - 2 * MG - 990]];
    let y = 140;
    c.font = `700 14px ${FONT}`; c.fillStyle = '#5a6472';
    cols.forEach(([t2, cx2, w2]) => c.fillText(t2, x0 + cx2 + (t2.startsWith('Harga') || t2 === 'Jumlah' ? w2 - c.measureText(t2).width - 14 : 0), y));
    c.strokeStyle = '#1a1a1a'; c.beginPath(); c.moveTo(x0, y + 10); c.lineTo(PW - MG, y + 10); c.stroke();
    y += 36;
    rows.slice(p * per, (p + 1) * per).forEach(r => {
      c.font = `14px ${FONT}`; c.fillStyle = '#1a1a1a'; c.fillText(r.nm.slice(0, 48), x0, y);
      const num = (t2, cx2, w2) => { c.textAlign = 'right'; c.fillText(t2, x0 + cx2 + w2 - 14, y); c.textAlign = 'left'; };
      num(`${fmt(r.jml)} ${r.sat}`, 430, 170); num(`Rp ${fmt(r.hrg)}`, 600, 190);
      c.font = `600 14px ${FONT}`; num(`Rp ${fmt(r.tot)}`, 790, 200); c.font = `13px ${FONT}`; c.fillStyle = '#5a6472';
      c.fillText(String(r.ket || '').slice(0, 42), x0 + 990, y);
      c.strokeStyle = '#f0f2f5'; c.beginPath(); c.moveTo(x0, y + 12); c.lineTo(PW - MG, y + 12); c.stroke();
      y += 34;
    });
    if ((p + 1) * per >= rows.length) {
      y += 8; c.strokeStyle = '#1a1a1a'; c.lineWidth = 2; c.beginPath(); c.moveTo(x0, y - 22); c.lineTo(PW - MG, y - 22); c.stroke(); c.lineWidth = 1;
      c.font = `700 17px ${FONT}`; c.fillStyle = '#1a1a1a'; c.fillText('TOTAL', x0, y + 4);
      c.textAlign = 'right'; c.fillText(`Rp ${fmt(total)}`, x0 + 990 - 14, y + 4); c.textAlign = 'left';
    }
    c.font = `12px ${FONT}`; c.fillStyle = '#8b95a3';
    c.fillText('Jumlah dihitung otomatis dari desain; harga satuan = perkiraan yang bisa diubah di tombol "RAB". Khusus perlengkapan walet — struktur bangunan (RAB sipil) dihitung terpisah saat konsultasi.', x0, PH - 60);
    out.push(cv);
  }
  return out;
}
// Lembar ruang audio: denah lantai ruang audio + tabel channel + perangkat + jadwal.
async function audioPage(m, a, cab, chs, no, total) {
  const { cv, c } = page('Lembar denah & isi ruang audio', m, no, total);
  const LV = levels(m), li = cab?.au?.li ?? 0, F = floorRect(m, LV[li]);
  const s = Math.min(560 / (m.w + 12), (PH - 220) / (m.h + 4), 34);
  const svg = floorSVG(m, li, s, { pfx: 'pdfau', chain: false, labels: true, show: it => (it.t === 'audio' ? 1 : ['pintu', 'tangga'].includes(it.t) ? 0.7 : 0.18), cables: cab ? { runs: cab.chs.flatMap(ch => ch.runs.filter(r => r.f === li).map(r => ({ warna: ch.warna, pts: r.pts, on: true }))), riser: cab.riser } : null });
  const im = await loadImg(svgUrl(svg));
  c.font = `700 15px ${HEAD}`; c.fillStyle = '#1a1a1a'; c.fillText(`${LV[li].name} — posisi ruang audio${cab?.luar ? ' (di luar gedung)' : ''}`, MG, 130);
  c.drawImage(im, MG, 140);
  const x = MG + im.width + 40, w = PW - MG - x;
  let y = 136;
  c.font = `700 17px ${HEAD}`; c.fillText('Channel & kabel', x, y); y += 10;
  const head = ['Channel', 'Sumber', 'Vol', 'Kabel', 'Suara / flashdisk'];
  const cw = [Math.round(w * 0.24), Math.round(w * 0.26), 56, 76, Math.round(w * 0.3)];
  const cx = cw.reduce((acc, v, i2) => (acc.push((acc[i2 - 1] ?? 0) + (cw[i2 - 1] ?? 0)), acc), []);
  c.font = `600 12.5px ${FONT}`; c.fillStyle = '#5a6472';
  head.forEach((h2, i2) => c.fillText(h2, x + cx[i2], y + 16));
  y += 24;
  (chs || []).slice(0, 14).forEach(ch => {
    y += 22;
    c.fillStyle = ch.warna; c.fillRect(x, y - 11, 10, 10);
    c.fillStyle = '#1a1a1a'; c.font = `12.5px ${FONT}`;
    const fl = ch.f === -1 ? 'Semua lantai' : Array.isArray(ch.f) ? `Lantai ${ch.f[0] + 1}–${ch.f[1] + 1}` : LV[ch.f]?.name || '';
    c.fillText(String(ch.nm).slice(0, 22), x + 16, y);
    c.fillText(`${(TYPES[ch.t]?.name || ch.t).split(' ')[1] || ch.t} · ${fl}${ch.n > 1 ? ` ÷${ch.n}` : ''}`, x + cx[1], y);
    c.fillText(`${ch.vol} dB`, x + cx[2], y);
    c.fillText(cab ? `${fmt(Math.round(cab.chs.find(q => q.id === ch.id)?.len || 0))} m` : '-', x + cx[3], y);
    c.fillStyle = '#5a6472'; c.fillText(`${ch.fd || '—'}${ch.ket ? ' · ' + ch.ket : ''}`.slice(0, 34), x + cx[4], y);
  });
  y += 34;
  c.fillStyle = '#1a1a1a'; c.font = `700 17px ${HEAD}`; c.fillText('Perangkat di rak', x, y);
  const NAMA = Object.fromEntries([...AMPLI.map(([k2, n2]) => [k2, n2]), ...AUDIO_ALAT]);
  c.font = `13px ${FONT}`;
  (m.audio?.items || []).filter(i2 => i2.n > 0).forEach(it => { y += 21; c.fillStyle = '#3a4452'; c.fillText(`• ${NAMA[it.t] || it.t} × ${it.n}${it.ch ? ` (${it.ch} channel)` : ''}`, x, y); });
  if (!(m.audio?.items || []).length) { y += 21; c.fillStyle = '#8b95a3'; c.fillText('• (belum diatur — buka tab "Ruang audio")', x, y); }
  y += 32;
  c.fillStyle = '#1a1a1a'; c.font = `700 17px ${HEAD}`; c.fillText('Jadwal timer suara', x, y);
  const jd = { panggil: [5, 19], tarik: [0, 24], inap: [0, 24], ...(m.audio?.jadwal || {}) };
  ['panggil', 'tarik', 'inap'].forEach(k2 => { y += 21; c.font = `13px ${FONT}`; c.fillStyle = '#3a4452'; c.fillText(`• ${k2[0].toUpperCase() + k2.slice(1)}: ${jd[k2][0]}.00–${jd[k2][1]}.00${jd[k2][0] === 0 && jd[k2][1] === 24 ? ' (24 jam)' : ''}`, x, y); });
  y += 30;
  c.font = `12.5px ${FONT}`; c.fillStyle = '#5a6472';
  wrap(c, `Semua kabel tweeter berujung di ruang audio (±${RULES.audioLuas} m², boleh di dalam atau di luar gedung). Titik R pada denah = riser tempat kabel naik-turun antar lantai. Total kabel ${a?.kabelM ? fmt(a.kabelM) + ' m' : '-'} · klem ${a?.klemN ? fmt(a.klemN) : '-'} (tiap 10 cm). Volume tiap channel = keluaran dB tweeter pada 1 m; suara panggil dibatasi 05.00–19.00 (etika lingkungan).`, w).forEach(l => { y += 17; c.fillText(l, x, y); });
  return cv;
}
