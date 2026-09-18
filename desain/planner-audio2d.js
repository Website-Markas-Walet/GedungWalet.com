// Gambar 2D TAMPAK DEPAN (elevasi): (1) dinding ruang audio yang bisa diisi perangkat dari katalog — tweeter kontrol
// per channel, saklar, stop kontak, timer Kitani/AC, kipas DC, ampli AXM/Piro di meja, aki, lampu — meniru foto rak
// asli; (2) susunan tweeter di sekeliling LMB. Dipakai tab "Ruang audio", dialog LMB, dan lembar PDF.
import { AMPLI, AUDIO_ALAT, AUDIO_DEFAULT } from './planner-data.js';

export const WALL_W = 3.6, WALL_H = 2.3, MEJA_Y = 1.62;   // dinding elevasi (m); meja ampli di 1,62 m dari atas dinding? (y dari atas)
const f1 = v => Math.round(v * 10) / 10;
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const TXT = 'font-family="Roboto, Arial, sans-serif" fill="#2b3440"';
export const AMPLI_KEYS = new Set(AMPLI.map(a => a[0]));
export const NAMA_ALAT = Object.fromEntries([...AMPLI.map(([k, n]) => [k, n]), ...AUDIO_ALAT]);
// ukuran gambar tiap jenis (m) pada elevasi
export const ELEV_UKUR = { twk: [0.24, 0.2], saklar: [0.22, 0.14], stopkontak: [0.4, 0.12], timerKitani: [0.16, 0.22], timerAC: [0.16, 0.22], kipas: [0.2, 0.2], aki: [0.34, 0.24], lampu: [0.12, 0.16], flashdisk: [0.1, 0.05], axm: [0.62, 0.24], piro88: [0.62, 0.24], piro89: [0.62, 0.24] };

// Tata letak awal (meniru foto): tweeter kontrol per channel berderet di papan atas, saklar di bawahnya,
// stop kontak & lampu di tengah, ampli berjajar di meja, timer & kipas dekat ampli, aki di bawah meja.
export function defaultLayout(audio, chs) {
  const items = [], put = (t, x, y, ex = {}) => items.push({ id: 'ly' + items.length, t, x: f1(x * 10) / 10, y: f1(y * 10) / 10, ...ex });
  const n = Math.max(1, chs.length), step = Math.min(0.34, (WALL_W - 0.5) / n);
  chs.forEach((c, i) => put('twk', WALL_W / 2 + (i - (n - 1) / 2) * step, 0.3, { ch: c.id }));
  const nS = Math.ceil(n / 2), stepS = Math.min(0.6, (WALL_W - 0.7) / Math.max(1, nS));
  for (let i = 0; i < nS; i++) put('saklar', WALL_W / 2 + (i - (nS - 1) / 2) * stepS, 0.62);
  const alat = audio?.items?.length ? audio.items : AUDIO_DEFAULT.items;
  const cnt = t => alat.find(a => a.t === t)?.n || 0;
  for (let i = 0; i < Math.min(3, cnt('stopkontak')); i++) put('stopkontak', WALL_W / 2 + (i - (Math.min(3, cnt('stopkontak')) - 1) / 2) * 0.7, 1.0);
  if (cnt('lampu') || true) put('lampu', WALL_W / 2, 1.28);
  let ax = 0.55;
  alat.filter(a => AMPLI_KEYS.has(a.t)).forEach(a => { for (let i = 0; i < Math.min(3, a.n); i++) { put(a.t, ax, MEJA_Y - 0.14, { chN: a.ch || 4 }); ax += 0.75; } });
  if (cnt('timerKitani')) put('timerKitani', ax, MEJA_Y - 0.13), ax += 0.28;
  if (cnt('timerAC')) put('timerAC', ax, MEJA_Y - 0.13), ax += 0.28;
  if (cnt('kipas')) put('kipas', Math.min(WALL_W - 0.3, ax), MEJA_Y - 0.12);
  if (cnt('aki')) put('aki', 0.55, MEJA_Y + 0.4);
  return items;
}

// Satu perangkat pada elevasi (x, y = titik tengah dalam meter; digambar per jenis meniru barang aslinya).
function alatSVG(it, s, X, Y, ch, o) {
  const [w, h] = ELEV_UKUR[it.t] || [0.2, 0.2];
  const x = X(it.x - w / 2), y = Y(it.y - h / 2), W = w * s, H = h * s, cx = X(it.x), cy = Y(it.y);
  let g = '';
  if (it.t === 'twk') {   // tweeter kontrol AX-65 tampak depan: pelat persegi + corong kotak masuk + label channel
    const c = ch?.warna || '#444';
    g = `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(W)}" height="${f1(H)}" rx="2" fill="#23262b" stroke="#0e1013"/>`
      + `<rect x="${f1(x + W * 0.16)}" y="${f1(y + H * 0.16)}" width="${f1(W * 0.68)}" height="${f1(H * 0.68)}" fill="#0c0e11"/>`
      + `<rect x="${f1(x + W * 0.34)}" y="${f1(y + H * 0.34)}" width="${f1(W * 0.32)}" height="${f1(H * 0.32)}" fill="#2f3540"/>`
      + `<rect x="${f1(x)}" y="${f1(y - 7)}" width="${f1(W)}" height="6" rx="2" fill="${c}"/>`
      + (o.label && ch ? `<text x="${f1(cx)}" y="${f1(y - 11)}" font-size="8.5" text-anchor="middle" ${TXT}>${esc(ch.nm)}</text>` : '');
  } else if (it.t === 'saklar') g = `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(W)}" height="${f1(H)}" rx="2" fill="#fdfdfb" stroke="#c9c9c2"/><rect x="${f1(x + W * 0.16)}" y="${f1(y + H * 0.25)}" width="${f1(W * 0.26)}" height="${f1(H * 0.5)}" fill="#e8e8e2" stroke="#bdbdb5"/><rect x="${f1(x + W * 0.58)}" y="${f1(y + H * 0.25)}" width="${f1(W * 0.26)}" height="${f1(H * 0.5)}" fill="#e8e8e2" stroke="#bdbdb5"/>`;
  else if (it.t === 'stopkontak') { g = `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(W)}" height="${f1(H)}" rx="3" fill="#fbfbf8" stroke="#c9c9c2"/>`; for (let k = 0; k < 4; k++) { const px = x + W * (0.14 + k * 0.24); g += `<circle cx="${f1(px)}" cy="${f1(cy)}" r="${f1(H * 0.3)}" fill="#efefe9" stroke="#bdbdb5"/><circle cx="${f1(px - H * 0.12)}" cy="${f1(cy)}" r="1" fill="#555"/><circle cx="${f1(px + H * 0.12)}" cy="${f1(cy)}" r="1" fill="#555"/>`; } }
  else if (it.t === 'timerKitani' || it.t === 'timerAC') {   // timer colok gaya Kitani: kotak + dial bulat / layar
    g = `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(W)}" height="${f1(H)}" rx="3" fill="#f4f4f0" stroke="#b8b8b0"/>`
      + (it.t === 'timerKitani'
        ? `<circle cx="${f1(cx)}" cy="${f1(y + H * 0.42)}" r="${f1(W * 0.36)}" fill="#fff" stroke="#333"/><circle cx="${f1(cx)}" cy="${f1(y + H * 0.42)}" r="${f1(W * 0.1)}" fill="#c62828"/>`
        : `<rect x="${f1(x + W * 0.18)}" y="${f1(y + H * 0.16)}" width="${f1(W * 0.64)}" height="${f1(H * 0.3)}" fill="#9fb6a4"/>`)
      + `<rect x="${f1(x + W * 0.3)}" y="${f1(y + H * 0.74)}" width="${f1(W * 0.4)}" height="${f1(H * 0.18)}" fill="#ddd" stroke="#aaa"/>`;
  } else if (it.t === 'kipas') {   // kipas DC persegi
    g = `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(W)}" height="${f1(H)}" rx="3" fill="#16181c" stroke="#000"/><circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(W * 0.44)}" fill="#23262b"/>`;
    for (let k = 0; k < 5; k++) { const a = (k * 72 * Math.PI) / 180; g += `<ellipse cx="${f1(cx + Math.cos(a) * W * 0.2)}" cy="${f1(cy + Math.sin(a) * W * 0.2)}" rx="${f1(W * 0.16)}" ry="${f1(W * 0.09)}" fill="#3a4149" transform="rotate(${f1(k * 72 + 30)} ${f1(cx + Math.cos(a) * W * 0.2)} ${f1(cy + Math.sin(a) * W * 0.2)})"/>`; }
    g += `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(W * 0.1)}" fill="#555"/>`;
  } else if (it.t === 'aki') g = `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(W)}" height="${f1(H)}" rx="2" fill="#e8e6df" stroke="#9a988f"/><rect x="${f1(x)}" y="${f1(y)}" width="${f1(W)}" height="${f1(H * 0.28)}" fill="#2f6f4f"/><rect x="${f1(x + W * 0.12)}" y="${f1(y - 4)}" width="5" height="5" fill="#b23"/><rect x="${f1(x + W * 0.78)}" y="${f1(y - 4)}" width="5" height="5" fill="#345"/><text x="${f1(cx)}" y="${f1(y + H * 0.7)}" font-size="8" text-anchor="middle" ${TXT}>AKI</text>`;
  else if (it.t === 'lampu') g = `<line x1="${f1(cx)}" y1="${f1(y)}" x2="${f1(cx)}" y2="${f1(cy - H * 0.1)}" stroke="#777"/><circle cx="${f1(cx)}" cy="${f1(cy + H * 0.12)}" r="${f1(W * 0.5)}" fill="#fff3c2" stroke="#d8c88a"/>`;
  else if (it.t === 'flashdisk') g = `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(W)}" height="${f1(H)}" rx="1.5" fill="#3b6ea5" stroke="#2b4d73"/>`;
  else if (AMPLI_KEYS.has(it.t)) {   // ampli AXM Garuda / Piro: rak hitam, layar, kenop volume per channel (kenop = volume channel RBW)
    const nCh = Math.max(2, Math.min(12, it.chN || 4));
    g = `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(W)}" height="${f1(H)}" rx="3" fill="#111318" stroke="#000"/>`
      + `<rect x="${f1(x + W * 0.05)}" y="${f1(y + H * 0.14)}" width="${f1(W * 0.22)}" height="${f1(H * 0.3)}" fill="#20304a"/>`
      + `<text x="${f1(x + W * 0.05)}" y="${f1(y + H * 0.88)}" font-size="7.5" fill="#c9a25a" font-family="Roboto, Arial, sans-serif">${esc((NAMA_ALAT[it.t] || '').replace('Ampli ', 'AUDAX '))}</text>`;
    for (let k = 0; k < nCh; k++) {
      const kx = x + W * 0.34 + (W * 0.6 * (k + 0.5)) / nCh, ky = y + H * 0.32;
      const vol = o.volOf ? o.volOf((it._off || 0) + k) : null, ang = vol == null ? 40 : -120 + ((vol - 40) / 70) * 240;
      g += `<circle cx="${f1(kx)}" cy="${f1(ky)}" r="${f1(Math.min(7, (W * 0.5) / nCh))}" fill="#caa64f" stroke="#7c6530"/>`
        + `<line x1="${f1(kx)}" y1="${f1(ky)}" x2="${f1(kx + Math.cos(((ang - 90) * Math.PI) / 180) * 6)}" y2="${f1(ky + Math.sin(((ang - 90) * Math.PI) / 180) * 6)}" stroke="#40331a" stroke-width="1.4"/>`;
    }
  } else g = `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(W)}" height="${f1(H)}" fill="#ccc" stroke="#999"/>`;
  return g;
}

// Elevasi dinding ruang audio. o: { s, sel, interactive, label (nama channel di atas tweeter), volOf(chIdx) }.
export function audioElevSVG(chs, layout, o = {}) {
  const s = o.s || 150, P = 14, W = WALL_W * s + 2 * P, H = WALL_H * s + 2 * P + 16;
  const X = v => f1(P + v * s), Y = v => f1(P + v * s);
  const chOf = id => chs.find(c => c.id === id);
  const bata = [];
  for (let r = 0; r < WALL_H / 0.2; r++) for (let k = 0; k < WALL_W / 0.4 + 1; k++)
    bata.push(`<rect x="${X(((r % 2 ? 0.2 : 0) + k * 0.4) - 0.2)}" y="${Y(r * 0.2)}" width="${f1(0.4 * s - 1.5)}" height="${f1(0.2 * s - 1.5)}" fill="#d7d3ca"/>`);
  const meja = `<rect x="${X(0.15)}" y="${Y(MEJA_Y)}" width="${f1((WALL_W - 0.3) * s)}" height="${f1(0.05 * s)}" fill="#16181c"/>`
    + `<rect x="${X(0.3)}" y="${Y(MEJA_Y + 0.05)}" width="${f1(0.05 * s)}" height="${f1((WALL_H - MEJA_Y - 0.1) * s)}" fill="#16181c"/>`
    + `<rect x="${X(WALL_W - 0.35)}" y="${Y(MEJA_Y + 0.05)}" width="${f1(0.05 * s)}" height="${f1((WALL_H - MEJA_Y - 0.1) * s)}" fill="#16181c"/>`;
  // kabel dari tiap tweeter kontrol turun rapi ke meja ampli (klem tiap 10 cm digambar sebagai titik)
  const kabel = (layout || []).filter(it => it.t === 'twk').map(it => {
    const c = chOf(it.ch), x = X(it.x), pts = [];
    for (let yy = it.y + 0.14; yy < MEJA_Y - 0.03; yy += 0.1) pts.push(`<circle cx="${x}" cy="${Y(yy)}" r="1" fill="#fff" stroke="#aaa" stroke-width=".4"/>`);
    return `<line x1="${x}" y1="${Y(it.y + 0.1)}" x2="${x}" y2="${Y(MEJA_Y)}" stroke="${c?.warna || '#333'}" stroke-width="1.6"/>` + pts.join('');
  }).join('');
  const items = (layout || []).map(it => {
    const g = alatSVG(it, s, X, Y, chOf(it.ch), o);
    const selBox = o.sel === it.id ? (() => { const [w, h] = ELEV_UKUR[it.t] || [0.2, 0.2]; return `<rect x="${X(it.x - w / 2 - 0.03)}" y="${Y(it.y - h / 2 - 0.03)}" width="${f1((w + 0.06) * s)}" height="${f1((h + 0.06) * s)}" fill="none" stroke="#1565C0" stroke-width="1.6" stroke-dasharray="4 3"/>`; })() : '';
    return o.interactive ? `<g class="ael" data-lid="${it.id}" style="cursor:move">${g}${selBox}</g>` : `<g>${g}${selBox}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" fill="#efece6"/><clipPath id="aw"><rect x="${P}" y="${P}" width="${f1(WALL_W * s)}" height="${f1(WALL_H * s)}"/></clipPath>`
    + `<g clip-path="url(#aw)"><rect x="${P}" y="${P}" width="${f1(WALL_W * s)}" height="${f1(WALL_H * s)}" fill="#cfccc3"/>${bata.join('')}${meja}${kabel}</g>`
    + `<g clip-path="url(#aw)">${items}</g>`
    + `<rect x="${P}" y="${P}" width="${f1(WALL_W * s)}" height="${f1(WALL_H * s)}" fill="none" stroke="#1a1a1a" stroke-width="2"/>`
    + `<text x="${P}" y="${H - 6}" font-size="10" ${TXT}>Ruang audio — tampak depan · dinding ${WALL_W} × ${WALL_H} m · kenop ampli = volume channel di RBW</text></svg>`;
}

// Tampak depan LMB: lubang di dinding + susunan tweeter AX-65 (a = tarik bibir atas, s = inap sisi kiri-kanan, b = bawah).
export function lmbFrontSVG(it, tw, o = {}) {
  const lebar = Math.max(0.4, Math.max(it.w, it.h)), tinggi = Math.max(0.3, (it.tcm || 50) / 100);
  const s = o.s || 170, mw = lebar + 1.5, mh = tinggi + 1.3, P = 12;
  const W = mw * s + 2 * P, H = mh * s + 2 * P + 16, X = v => f1(P + v * s), Y = v => f1(P + v * s);
  const ox = (mw - lebar) / 2, oy = (mh - tinggi) / 2 + 0.1;
  const bata = [];
  for (let r = 0; r < mh / 0.2; r++) for (let k = 0; k < mw / 0.4 + 1; k++)
    bata.push(`<rect x="${X(((r % 2 ? 0.2 : 0) + k * 0.4) - 0.2)}" y="${Y(r * 0.2)}" width="${f1(0.4 * s - 1.5)}" height="${f1(0.2 * s - 1.5)}" fill="#d7d3ca"/>`);
  const twr = (x, y, col) => `<g><rect x="${f1(x - 0.09 * s)}" y="${f1(y - 0.075 * s)}" width="${f1(0.18 * s)}" height="${f1(0.15 * s)}" rx="2" fill="#23262b" stroke="#0e1013"/><rect x="${f1(x - 0.058 * s)}" y="${f1(y - 0.048 * s)}" width="${f1(0.116 * s)}" height="${f1(0.096 * s)}" fill="#0c0e11"/><rect x="${f1(x - 0.026 * s)}" y="${f1(y - 0.022 * s)}" width="${f1(0.052 * s)}" height="${f1(0.044 * s)}" fill="#2f3540"/><rect x="${f1(x - 0.09 * s)}" y="${f1(y - 0.075 * s - 5)}" width="${f1(0.18 * s)}" height="4" fill="${col}"/></g>`;
  const T = [];
  const n = { a: tw?.a ?? 2, s: tw?.s ?? 4, b: tw?.b ?? 0 };
  for (let k = 0; k < n.a; k++) T.push(twr(X(ox + (lebar * (k + 0.5)) / n.a), Y(oy - 0.16), '#C62828'));                       // tarik bibir atas
  for (let k = 0; k < n.s; k++) { const kiri = k % 2 === 0, row = Math.floor(k / 2); T.push(twr(X(ox + (kiri ? -0.2 : lebar + 0.2)), Y(oy + 0.12 + row * 0.24), '#534AB7')); }   // inap sisi
  for (let k = 0; k < n.b; k++) T.push(twr(X(ox + (lebar * (k + 0.5)) / Math.max(1, n.b)), Y(oy + tinggi + 0.16), '#534AB7'));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" fill="#efece6"/><g>${bata.join('')}</g>`
    + `<rect x="${X(ox - 0.05)}" y="${Y(oy - 0.05)}" width="${f1((lebar + 0.1) * s)}" height="${f1((tinggi + 0.1) * s)}" fill="#3b3f45"/>`
    + `<rect x="${X(ox)}" y="${Y(oy)}" width="${f1(lebar * s)}" height="${f1(tinggi * s)}" fill="#0b0d10"/>`
    + T.join('')
    + `<text x="${X(ox + lebar / 2)}" y="${Y(oy + tinggi + 0.55)}" font-size="11" text-anchor="middle" ${TXT}>LMB ${Math.round(lebar * 100)} × ${Math.round(tinggi * 100)} cm — tampak depan</text>`
    + `<rect x="${P}" y="${P}" width="${f1(mw * s)}" height="${f1(mh * s)}" fill="none" stroke="#1a1a1a" stroke-width="2"/></svg>`;
}
