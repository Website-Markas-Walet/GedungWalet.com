// Gambar denah satu lantai sebagai markup SVG — dipakai editor interaktif, thumbnail, dan lembar desain.
// Konvensi DED GedungWalet: sekat walet (terpal) = arsir hitam, balok bangunan = garis ganda polos, kolom = kotak hitam.
import { TYPES, RULES, SARANG_WARNA } from './planner-data.js';
import { derive, structure, center, WALL_T, floorRect, floorHt, wallSideRuns, levels } from './planner-geom.js';

const f1 = v => Math.round(v * 10) / 10;
const fmt = n => (+n).toLocaleString('id-ID');
// teks label harus di-escape: "< 0,01 lux" berisi '<' yang membuat SVG tidak valid saat dirender ke PDF/thumbnail
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const TXT = 'font-family="Roboto, Arial, sans-serif" fill="#3a4452"';
export const RESIZABLE = new Set(['void', 'jalur', 'inap', 'audio', 'kolam', 'tangga', 'menara', 'lmb', 'lar', 'larj', 'pintu']);
const OBJ_Z = { kolam: 0, tangga: 1, menara: 2, vent: 3, lar: 4, larj: 4, pintu: 4, lmb: 5, twinap: 6, twtarik: 7, hexa: 8, sarang: 9 };
const lockGlyph = (x, y) => `<g transform="translate(${f1(x)} ${f1(y)})" pointer-events="none"><rect x="-4.5" y="-1.5" width="9" height="7" rx="1.5" fill="#C62828"/><path d="M-2.6 -1.5v-2.2a2.6 2.6 0 0 1 5.2 0v2.2" fill="none" stroke="#C62828" stroke-width="1.4"/></g>`;
const mtxt = v => `${v.toFixed(2).replace('.', ',')} m`;

// Simbol tweeter gaya Audax AX-65 (tampak atas): magnet kotak di belakang, corong kotak melebar ke arah hadap
// (dir, derajat layar), pelat muka persegi, + 2 gelombang suara di depan mulutnya.
export function tweeterSym(cx, cy, dir, color, r) {
  const L = r * 2.3, a = -L / 2, k = a + L * 0.42, n0 = r * 0.34, n1 = r * 0.92, F = L / 2;
  const P = [[k, -n0], [F, -n1], [F, n1], [k, n0]].map(([x, y]) => `${f1(x)},${f1(y)}`).join(' ');
  const arc = R => { const x = R * Math.cos(0.66), y = R * Math.sin(0.66); return `M${f1(x)} ${f1(-y)}A${f1(R)} ${f1(R)} 0 0 1 ${f1(x)} ${f1(y)}`; };
  return `<g transform="translate(${f1(cx)} ${f1(cy)}) rotate(${f1(dir)})">`
    + `<rect x="${f1(a)}" y="${f1(-n0)}" width="${f1(k - a)}" height="${f1(2 * n0)}" fill="${color}" stroke="#fff" stroke-width=".6"/>`   // magnet
    + `<polygon points="${P}" fill="${color}" stroke="#fff" stroke-width=".6" stroke-linejoin="round"/>`                                   // corong kotak
    + `<rect x="${f1(F - r * 0.16)}" y="${f1(-n1 - r * 0.18)}" width="${f1(r * 0.3)}" height="${f1(2 * (n1 + r * 0.18))}" fill="${color}"/>`   // pelat muka persegi
    + `<path d="${arc(F + r * 0.6)}${arc(F + r * 1.2)}" fill="none" stroke="${color}" stroke-opacity=".7" stroke-width="1" stroke-linecap="round"/></g>`
    + `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(Math.max(6, r * 2))}" fill="#fff" fill-opacity="0"/>`;
}
const twR = (it, S) => Math.max(2.2, S(it.w) * 0.42);
// Tweeter hexagonal: 6 tweeter panggil di tiap sisi segi enam, menghadap keluar ke 6 arah.
export function hexaSym(cx, cy, R, color) {
  const pt = (a, r) => `${f1(cx + r * Math.cos(a))},${f1(cy + r * Math.sin(a))}`;
  const spk = Array.from({ length: 6 }, (_, k) => { const a = (Math.PI / 3) * k + Math.PI / 6; return `<circle cx="${f1(cx + R * 0.6 * Math.cos(a))}" cy="${f1(cy + R * 0.6 * Math.sin(a))}" r="${f1(Math.max(0.8, R * 0.19))}" fill="#fff"/>`; }).join('');
  return `<polygon points="${Array.from({ length: 6 }, (_, k) => pt((Math.PI / 3) * k, R)).join(' ')}" fill="${color}" stroke="#fff" stroke-width=".8" stroke-linejoin="round"/>${spk}<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(Math.max(0.8, R * 0.15))}" fill="#fff"/>`;
}

// o: { s (px/m), ox, oy, pfx, interactive, sel (Set id terpilih), grid ('canvas'|'building'), vw, vh, dims, labels, ghost, chain,
//      struktur, preview, der, sketch, heat {href,x,y,w,h}, luxLabels [{x,y,txt,bad}], measures [{x1,y1,x2,y2}], marquee {x1,y1,x2,y2} }
export function drawFloor(m, i, o = {}) {
  const LV = levels(m), fl = LV[i], s = o.s, ox = o.ox || 0, oy = o.oy || 0, P = o.pfx || 'p', act = !!o.interactive;
  const show = o.show || (() => 1);   // 1 = tampil, 0 < a < 1 = redup (mode fokus), 0 = disembunyikan
  const sel = o.sel instanceof Set ? o.sel : new Set(), one = sel.size === 1;
  const X = x => f1(ox + x * s), Y = y => f1(oy + y * s), S = v => f1(v * s);
  const der = o.der || derive(m, fl);
  const defs = [
    `<pattern id="${P}-h" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#fff"/><line x1="0" y1="0" x2="0" y2="5" stroke="#1f2328" stroke-width="1.3"/></pattern>`,
    `<pattern id="${P}-g" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#fff"/><line x1="0" y1="0" x2="0" y2="5" stroke="#9aa1a9" stroke-width="1.1"/></pattern>`,
  ];
  const sp = new Map();
  const siripFill = (gap, or, color) => {   // or: 'x' | 'y' (sirip panjang) | 'k' (sirip kotak)
    const g = Math.max(2, gap * s), key = or + Math.round(g * 10);
    if (!sp.has(key)) {
      const id = `${P}-s${sp.size}`; sp.set(key, id);
      const st = `stroke="${color}" stroke-opacity=".65" stroke-width="1" fill="none"`;
      defs.push(or === 'k'
        ? `<pattern id="${id}" x="${f1(ox)}" y="${f1(oy)}" width="${f1(g)}" height="${f1(g)}" patternUnits="userSpaceOnUse"><path d="M0 ${f1(g / 2)}H${f1(g)}M${f1(g / 2)} 0V${f1(g)}" ${st}/></pattern>`
        : or === 'x'
          ? `<pattern id="${id}" x="${f1(ox)}" y="${f1(oy)}" width="8" height="${f1(g)}" patternUnits="userSpaceOnUse"><line x1="0" y1="${f1(g / 2)}" x2="8" y2="${f1(g / 2)}" ${st}/></pattern>`
          : `<pattern id="${id}" x="${f1(ox)}" y="${f1(oy)}" width="${f1(g)}" height="8" patternUnits="userSpaceOnUse"><line x1="${f1(g / 2)}" y1="0" x2="${f1(g / 2)}" y2="8" ${st}/></pattern>`);
    }
    return sp.get(key);
  };
  const out = [];
  const wrap = (it, inner) => {
    const a = show(it), dim = a < 1 ? ` opacity="${a}" pointer-events="none"` : '';
    return act ? `<g class="el${sel.has(it.id) ? ' sel' : ''}${it.locked ? ' lk' : ''}" data-id="${it.id}"${dim}>${inner}</g>` : `<g${dim}>${inner}</g>`;
  };

  // grid latar 1 m, abu-abu 25% (sub-grid 0,5 m saat zoom dekat)
  if (o.grid) {
    const step = s >= 90 ? 0.5 : 1, cv = o.grid === 'canvas', L = [];
    const [gx0, gx1, gy0, gy1] = cv ? [Math.floor(-ox / s), Math.ceil((o.vw - ox) / s), Math.floor(-oy / s), Math.ceil((o.vh - oy) / s)] : [0, m.w, 0, m.h];
    const ya = cv ? 0 : Y(0), yb = cv ? o.vh : Y(m.h), xa = cv ? 0 : X(0), xb = cv ? o.vw : X(m.w);
    for (let x = gx0; x <= gx1 + 1e-6; x += step) L.push(`<line x1="${X(x)}" y1="${ya}" x2="${X(x)}" y2="${yb}"${x % 1 ? ' stroke-opacity=".45"' : ''}/>`);
    for (let y = gy0; y <= gy1 + 1e-6; y += step) L.push(`<line x1="${xa}" y1="${Y(y)}" x2="${xb}" y2="${Y(y)}"${y % 1 ? ' stroke-opacity=".45"' : ''}/>`);
    out.push(`<g stroke="#808080" stroke-width="1" opacity=".25" pointer-events="none">${L.join('')}</g>`);
  }
  // dak atap lantai di bawahnya yang tidak tertutup lantai ini (lantai atas boleh lebih kecil)
  const F = der.F, below = i > 0 ? floorRect(m, LV[i - 1]) : null;
  if (below && (below.x !== F.x || below.y !== F.y || below.w !== F.w || below.h !== F.h)) {
    defs.push(`<pattern id="${P}-r" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#f3f4f6"/><line x1="0" y1="0" x2="0" y2="7" stroke="#d1d5db" stroke-width="1"/></pattern>`);
    out.push(`<rect x="${X(below.x)}" y="${Y(below.y)}" width="${S(below.w)}" height="${S(below.h)}" fill="url(#${P}-r)" stroke="#9aa1a9" stroke-dasharray="6 4" pointer-events="none"/>`);
    if (S(below.w) > 90) out.push(`<text x="${f1(X(below.x) + 6)}" y="${f1(Y(below.y + below.h) - 6)}" font-size="10" ${TXT} pointer-events="none">Dak atap ${LV[i - 1].name}</text>`);
  }
  out.push(`<rect x="${X(F.x)}" y="${Y(F.y)}" width="${S(F.w)}" height="${S(F.h)}" fill="#fff" fill-opacity=".88"/>`);
  // foto satelit lokasi (Google Maps) di bawah semuanya — konteks lahan di sekitar gedung
  if (o.site?.href) {
    const st2 = o.site, iw = S(st2.w), ih = S(st2.h), cx = X(st2.cx), cy = Y(st2.cy);
    out.splice(0, 0, `<image href="${String(st2.href).replace(/"/g, '%22')}" x="${f1(cx - iw / 2)}" y="${f1(cy - ih / 2)}" width="${f1(iw)}" height="${f1(ih)}" preserveAspectRatio="none" opacity="${Math.min(1, Math.max(0.05, +st2.op || 0.7))}"${st2.rot ? ` transform="rotate(${+st2.rot} ${f1(cx)} ${f1(cy)})"` : ''} pointer-events="none"/>`);
  }
  // foto sketsa tangan di bawah denah (editor & pratinjau konversi) — untuk dijiplak / dicek
  const skt = o.sketch;
  if (skt?.href) {
    const q = (skt.rot || 0) % 180 !== 0, cx = X(skt.x + skt.w / 2), cy = Y(skt.y + skt.h / 2), iw = S(q ? skt.h : skt.w), ih = S(q ? skt.w : skt.h);
    out.push(`<image href="${String(skt.href).replace(/"/g, '%22')}" x="${f1(cx - iw / 2)}" y="${f1(cy - ih / 2)}" width="${iw}" height="${ih}" preserveAspectRatio="none" opacity="${Math.min(1, Math.max(0.05, +skt.op || 0.55))}"${skt.rot ? ` transform="rotate(${+skt.rot} ${cx} ${cy})"` : ''} pointer-events="none"/>`);
  }
  // bayangan void lantai atas & bawah — membantu membuat void terjun lurus
  if (o.ghost) [i - 1, i + 1].forEach(j => (LV[j]?.items || []).filter(z => z.t === 'void').forEach(v =>
    out.push(`<rect x="${X(v.x)}" y="${Y(v.y)}" width="${S(v.w)}" height="${S(v.h)}" fill="none" stroke="#0C447C" stroke-opacity=".45" stroke-dasharray="2 4" pointer-events="none"/>`)));

  // zona; ruang inap digambar per ruang hasil pembagian sekat (sirip panjang / kotak + papan yang menempel di dinding)
  fl.items.filter(it => TYPES[it.t]?.kind === 'zone' && show(it)).sort((a, b) => (TYPES[a.t].z || 0) - (TYPES[b.t].z || 0)).forEach(it => {
    const T = TYPES[it.t], x = X(it.x), y = Y(it.y), w = S(it.w), h = S(it.h);
    let g = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${T.fill}" stroke="${T.color}" stroke-width="1.2" stroke-dasharray="5 3"/>`;
    if (it.t === 'inap' || it.t === 'jalur') (der.zoneRooms.get(it.id) || []).forEach(r => {
      const kotak = r.st === 'kotak', gap = r.gap || (kotak ? RULES.siripKotak : RULES.siripJarak);
      g += `<rect x="${X(r.x)}" y="${Y(r.y)}" width="${S(r.w)}" height="${S(r.h)}" fill="url(#${siripFill(gap, kotak ? 'k' : der.orient.get(r.id), T.color)})"/>`;
      const runs = wallSideRuns(r, der.segs), ins = 0.1, L = [];
      runs.top.forEach(([a, b]) => L.push(`M${X(a)} ${Y(r.y + ins)}H${X(b)}`));
      runs.bottom.forEach(([a, b]) => L.push(`M${X(a)} ${Y(r.y + r.h - ins)}H${X(b)}`));
      runs.left.forEach(([a, b]) => L.push(`M${X(r.x + ins)} ${Y(a)}V${Y(b)}`));
      runs.right.forEach(([a, b]) => L.push(`M${X(r.x + r.w - ins)} ${Y(a)}V${Y(b)}`));
      if (L.length) g += `<path d="${L.join('')}" stroke="${T.color}" stroke-width="${f1(Math.max(1.4, S(0.035)))}" stroke-opacity=".8" fill="none"/>`;
    });
    if (it.t === 'void') g += `<path d="M${x} ${y}L${f1(x + w)} ${f1(y + h)}M${f1(x + w)} ${y}L${x} ${f1(y + h)}" stroke="${T.color}" stroke-opacity=".5" fill="none"/>`;
    if (it.t === 'jalur' && w > 50 && h > 30) g += `<path d="M${f1(x + w / 2 - 9)} ${f1(y + h / 2)}a9 9 0 1 1 3 6.5" fill="none" stroke="${T.color}" stroke-width="1.4" stroke-opacity=".6"/>`;
    out.push(wrap(it, g));
  });
  // simulasi cahaya: medan lux di atas zona, di bawah sekat & benda
  if (o.heat) out.push(`<image href="${o.heat.href}" x="${X(o.heat.x)}" y="${Y(o.heat.y)}" width="${S(o.heat.w)}" height="${S(o.heat.h)}" preserveAspectRatio="none" opacity=".92" pointer-events="none"/>`);

  // struktur: balok = garis ganda polos (di bawah sekat)
  const st = (o.struktur ?? m.showStruktur !== false) ? structure(m, F) : null;
  if (st) {
    const bt = Math.max(2, S(0.12)), B = [];
    st.bx.forEach(x => B.push(`<rect x="${f1(X(x) - bt / 2)}" y="${Y(F.y)}" width="${bt}" height="${S(F.h)}"/>`));
    st.by.forEach(y => B.push(`<rect x="${X(F.x)}" y="${f1(Y(y) - bt / 2)}" width="${S(F.w)}" height="${bt}"/>`));
    out.push(`<g fill="#fff" fill-opacity="${o.heat ? '.15' : '.55'}" stroke="#5f6670" stroke-width=".7" pointer-events="none">${B.join('')}</g>`);
  }

  // dinding luar & sekat walet (arsir), terpotong bukaan LAR / LMB / pintu
  der.segs.forEach(sg => {
    const wa = sg.ext ? 1 : show({ t: 'sekat', id: sg.id });
    if (sg.len < 0.01 || !wa) return;
    const t = sg.ext ? WALL_T.ext : WALL_T.sekat, ux = (sg.x2 - sg.x1) / sg.len, uy = (sg.y2 - sg.y1) / sg.len;
    const nx = (-uy * t) / 2, ny = (ux * t) / 2, gant = sg.jenis === 'gantung', bata = !sg.ext && sg.bahan === 'bata';
    const pt = (a, k) => `${X(sg.x1 + ux * a + nx * k)},${Y(sg.y1 + uy * a + ny * k)}`;
    // sekat bata / dinding = abu-abu pejal (kabel tidak bisa menembus); terpal = arsir hitam
    let g = sg.pieces.map(([a, b]) => `<polygon points="${pt(a, 1)} ${pt(b, 1)} ${pt(b, -1)} ${pt(a, -1)}" fill="${bata ? '#b6b3ab' : `url(#${P}-${gant ? 'g' : 'h'})`}" stroke="#1a1a1a" stroke-width="${sg.ext ? 1.2 : bata ? 1.1 : 0.9}"${gant ? ' stroke-dasharray="4 3"' : ''}/>`).join('');
    sg.ops.filter(op => op.kind === 'jendela').forEach(op => {    // LAR jendela: dua garis tipis pada celah
      g += [0.45, -0.45].map(k => `<polyline points="${pt(op.a, k)} ${pt(op.b, k)}" fill="none" stroke="#1a1a1a" stroke-width=".8"/>`).join('');
    });
    if (sg.ext || !act || wa < 1) { out.push(`<g pointer-events="none"${wa < 1 ? ` opacity="${wa}"` : ''}>${g}</g>`); return; }
    out.push(`<g class="wall${sel.has(sg.id) ? ' sel' : ''}${sg.locked ? ' lk' : ''}" data-wid="${sg.id}"><line x1="${X(sg.x1)}" y1="${Y(sg.y1)}" x2="${X(sg.x2)}" y2="${Y(sg.y2)}" stroke="#000" stroke-opacity="0" stroke-width="${Math.max(10, S(t) + 6)}"/>${g}</g>`);
    if (sg.locked) out.push(lockGlyph(X((sg.x1 + sg.x2) / 2) + 8, Y((sg.y1 + sg.y2) / 2) - 8));
  });
  if (st) {
    const ks = Math.max(4, S(0.3)), K = [];
    st.xs.forEach(x => st.ys.forEach(y => K.push(`<rect x="${f1(X(x) - ks / 2)}" y="${f1(Y(y) - ks / 2)}" width="${ks}" height="${ks}"/>`)));
    out.push(`<g fill="#111" pointer-events="none">${K.join('')}</g>`);
  }

  // rantai suara tarik (garis putus-putus ke tweeter tarik di depannya)
  if (o.chain) der.targets.forEach((tg, id) => {
    const it = tg && fl.items.find(z => z.id === id); if (!it || !show(it) || !show(tg)) return;
    const a = center(it), b = center(tg);
    out.push(`<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" stroke="#C62828" stroke-opacity=".35" stroke-dasharray="4 3" pointer-events="none"/>`);
  });
  // tweeter tarik yang rantainya menabrak sekat (tidak bisa lanjut) → tanda ✕ merah
  if (o.chain) (der.blocked || []).forEach(id => {
    const it = fl.items.find(z => z.id === id); if (!it || !show(it)) return;
    const c = center(it), x = X(c.x) + 8, y = Y(c.y) - 8;
    out.push(`<path d="M${f1(x - 3)} ${f1(y - 3)}L${f1(x + 3)} ${f1(y + 3)}M${f1(x + 3)} ${f1(y - 3)}L${f1(x - 3)} ${f1(y + 3)}" stroke="#C62828" stroke-width="1.8" stroke-linecap="round" pointer-events="none"/>`);
  });

  // benda
  fl.items.filter(it => TYPES[it.t]?.kind === 'obj' && show(it)).sort((a, b) => (OBJ_Z[a.t] ?? 3) - (OBJ_Z[b.t] ?? 3)).forEach(it => {
    const T = TYPES[it.t], x = X(it.x), y = Y(it.y), w = S(it.w), h = S(it.h), c = center(it), cx = X(c.x), cy = Y(c.y);
    const rect = (stroke = T.color, dash = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" fill="${T.fill}" stroke="${stroke}" stroke-width="1.1"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
    let g;
    switch (it.t) {
      case 'kolam': g = rect() + (w > 12 ? `<path d="M${f1(x + 3)} ${cy}q${f1(w / 4)} -5 ${f1(w / 2)} 0t${f1(w / 2 - 6)} 0" fill="none" stroke="#185FA5" stroke-width="1.1"/>` : ''); break;
      case 'tangga': {
        const vert = it.h >= it.w, n = Math.max(3, Math.round((vert ? it.h : it.w) / 0.25)); g = rect();
        for (let k = 1; k < n; k++) g += vert ? `<line x1="${x}" y1="${f1(y + (h * k) / n)}" x2="${f1(x + w)}" y2="${f1(y + (h * k) / n)}" stroke="${T.color}" stroke-opacity=".55"/>`
          : `<line x1="${f1(x + (w * k) / n)}" y1="${y}" x2="${f1(x + (w * k) / n)}" y2="${f1(y + h)}" stroke="${T.color}" stroke-opacity=".55"/>`;
        break;
      }
      case 'menara':
        g = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${T.fill}" stroke="${T.color}" stroke-width="1.3" stroke-dasharray="7 4"/>`
          + (w > 12 && h > 12 ? `<rect x="${f1(x + 4)}" y="${f1(y + 4)}" width="${f1(w - 8)}" height="${f1(h - 8)}" fill="none" stroke="${T.color}" stroke-dasharray="2 3"/>` : '')
          + (w > 70 ? `<text x="${cx}" y="${f1(y + 14)}" font-size="10" text-anchor="middle" ${TXT}>Menara (di atas atap)</text>` : '');
        break;
      case 'lar': case 'larj': {
        const on = der.onWall.has(it.id), hz = it.w >= it.h, fn = der.larType?.get(it.id);
        g = rect(on ? T.color : '#C62828', '3 2');
        if (s >= 28) g += `<text x="${hz ? cx : f1(cx + S(0.18) + 3)}" y="${hz ? f1(cy - S(0.18) - 3) : f1(cy + 3)}" font-size="9.5" text-anchor="${hz ? 'middle' : 'start'}" ${TXT}>${it.t === 'larj' ? 'LAR-J' : 'LAR'}${fn && s >= 40 ? ` ${fn}` : ''}</text>`;
        break;
      }
      case 'pintu': {
        const hz = it.w >= it.h, L = hz ? w : h;
        g = rect() + (hz ? `<path d="M${x} ${f1(cy + L)}A${f1(L)} ${f1(L)} 0 0 0 ${f1(x + w)} ${cy}" fill="none" stroke="${T.color}" stroke-dasharray="2 2"/>`
          : `<path d="M${f1(cx + L)} ${y}A${f1(L)} ${f1(L)} 0 0 1 ${cx} ${f1(y + h)}" fill="none" stroke="${T.color}" stroke-dasharray="2 2"/>`);
        break;
      }
      case 'lmb': g = rect() + (s >= 25 ? `<text x="${it.w >= it.h ? cx : f1(x + w + 4)}" y="${it.w >= it.h ? f1(y + h + 11) : f1(cy + 3)}" font-size="9.5" text-anchor="${it.w >= it.h ? 'middle' : 'start'}" ${TXT}>LMB</text>` : ''); break;
      case 'sarang': {   // titik sarang: mangkuk kecil, warna menurut jenisnya (baru/lama/polesan/jadi)
        const col = SARANG_WARNA[it.ns] || SARANG_WARNA.jadi, r = Math.max(3, S(it.w) / 2);
        g = `<path d="M${f1(cx - r)} ${f1(cy - r * 0.25)}h${f1(2 * r)}a${f1(r)} ${f1(r * 0.9)} 0 0 1 -${f1(2 * r)} 0z" fill="${col}" fill-opacity="${it.ns === 'lama' ? 0.35 : 0.85}" stroke="${col}" stroke-width="1.2"/>`
          + (it.ns === 'baru' ? `<circle cx="${f1(cx)}" cy="${f1(cy - r * 0.55)}" r="${f1(Math.max(1.2, r * 0.3))}" fill="${col}"/>` : '')
          + `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(Math.max(6, r * 1.7))}" fill="#fff" fill-opacity="0"/>`;
        break;
      }
      case 'twinap': case 'twtarik': g = tweeterSym(cx, cy, der.dirs.get(it.id) ?? 270, T.color, twR(it, S)); break;
      case 'hexa': g = hexaSym(cx, cy, Math.max(4, S(Math.min(it.w, it.h)) / 2), T.color) + `<circle cx="${cx}" cy="${cy}" r="${f1(Math.max(7, S(it.w) / 2))}" fill="#fff" fill-opacity="0"/>`; break;
      case 'vent': {
        // paralon 4" bulat menembus dinding → elbow → pipa turun 1 m (lingkaran = pipa tegak dilihat dari atas)
        const e = [[it.y - F.y, 0, 1], [F.y + F.h - it.y - it.h, 0, -1], [it.x - F.x, 1, 0], [F.x + F.w - it.x - it.w, -1, 0]].reduce((p, q) => (q[0] < p[0] ? q : p));
        const nx = e[1], ny = e[2], hz = nx === 0, depth = hz ? it.h : it.w;
        const wx = hz ? c.x : nx > 0 ? it.x : it.x + it.w, wy = hz ? (ny > 0 ? it.y : it.y + it.h) : c.y;   // titik di garis dinding
        const d = Math.max(0.08, Math.min(0.22, depth - 0.07)), ex = X(wx + nx * d), ey = Y(wy + ny * d), r = Math.max(2.6, S(0.065));
        g = `<line x1="${X(wx - nx * 0.1)}" y1="${Y(wy - ny * 0.1)}" x2="${ex}" y2="${ey}" stroke="${T.color}" stroke-width="${f1(Math.max(3, S(0.11)))}" stroke-opacity=".55"/>`
          + `<circle cx="${ex}" cy="${ey}" r="${f1(r)}" fill="#fff" stroke="${T.color}" stroke-width="1.3"/><circle cx="${ex}" cy="${ey}" r="${f1(r * 0.38)}" fill="${T.color}"/>`
          + (s >= 90 ? `<text x="${f1(ex + r + 3)}" y="${f1(ey + 3)}" font-size="9" ${TXT}>↓1 m</text>` : '')
          + `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" fill-opacity="0"/>`;
        break;
      }
      default: g = rect();
    }
    out.push(wrap(it, g));
  });

  // tapak menara di lantai teratas (isi menara digambar di lantai "Menara" sendiri)
  if (m.menara && i === m.floors.length - 1 && show({ t: 'menara', id: 'menara' })) {
    const R = floorRect(m, m.menara), x = X(R.x), y = Y(R.y), w = S(R.w), h = S(R.h);
    out.push(`<g pointer-events="none"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(153,53,86,.06)" stroke="#993556" stroke-width="1.3" stroke-dasharray="7 4"/>`
      + (w > 64 ? `<text x="${f1(x + w / 2)}" y="${f1(y + 13)}" font-size="10" text-anchor="middle" ${TXT}>Menara di atas</text>` : '') + '</g>');
    if (act) out.push(`<g class="mnlink"><title>Buka lantai menara (LMB & hexagonal)</title><rect x="${f1(x + w / 2 - 36)}" y="${f1(y + h - 22)}" width="72" height="17" rx="8.5" fill="#993556"/><text x="${f1(x + w / 2)}" y="${f1(y + h - 10)}" font-size="10" text-anchor="middle" fill="#fff" font-family="Roboto, Arial, sans-serif">Buka menara ↗</text></g>`);
  }

  // keterangan ruang DI LUAR denah (margin kiri) dengan garis penunjuk ke ruangnya — di dalam sering tak terbaca
  if (o.labels !== false && s >= 13) {
    const ents = [];
    fl.items.forEach(it => {
      const T = TYPES[it.t]; if (T?.kind !== 'zone' || show(it) < 1) return;
      const parts = it.t === 'inap' || it.t === 'jalur' ? der.zoneRooms.get(it.id) || [it] : [it];
      const base = it.t === 'inap' ? (it.st === 'kotak' ? 'Ruang inap · sirip kotak' : 'Ruang inap') : it.t === 'jalur' ? `Ruang jalur${it.gap || it.st ? ' + sirip' : ''}` : T.name.split(' (')[0];
      parts.forEach((r, k) => { if (r.w * r.h >= 0.4) ents.push({ cx: r.x + r.w / 2, cy: r.y + r.h / 2, nm: base + (parts.length > 1 ? ` ${k + 1}` : '') }); });
    });
    if (ents.length) {
      const lx = X(F.x) - 16;
      let last = Y(F.y) - 15;
      const L = [];
      ents.sort((a, b) => a.cy - b.cy || a.cx - b.cx).forEach(e => {
        const ly = Math.max(Y(e.cy), last + 14); last = ly;
        L.push(`<polyline points="${f1(lx + 4)},${f1(ly - 3)} ${f1(X(F.x) - 5)},${f1(ly - 3)} ${X(e.cx)},${Y(e.cy)}" fill="none" stroke="#9aa1a9" stroke-width=".8"/>`
          + `<circle cx="${X(e.cx)}" cy="${Y(e.cy)}" r="1.6" fill="#9aa1a9"/>`
          + `<text x="${f1(lx)}" y="${f1(ly)}" font-size="10" text-anchor="end" ${TXT}>${esc(e.nm)}</text>`);
      });
      out.push(`<g pointer-events="none" opacity=".9">${L.join('')}</g>`);
    }
  }

  // jalur kabel tweeter → ruang audio (mode "Kabel"): polyline siku per channel + titik riser
  if (o.cables) {
    const C = [];
    (o.cables.runs || []).forEach(r => {
      C.push(`<polyline points="${r.pts.map(([px, py]) => `${X(px)},${Y(py)}`).join(' ')}" fill="none" stroke="${r.warna}" stroke-width="1.8" stroke-opacity="${r.on === false ? 0.25 : 0.9}" stroke-linejoin="round" stroke-linecap="round"${r.on === false ? ' stroke-dasharray="3 4"' : ''}/>`);
    });
    // keterangan ujung kabel: titik "ujung" di tweeter terakhir tiap jalur; R = titik naik-turun ke ruang audio
    (o.cables.ends || []).forEach(e2 => {
      const ex2 = X(e2.x), ey2 = Y(e2.y);
      C.push(`<circle cx="${ex2}" cy="${ey2}" r="4.5" fill="${e2.warna}" stroke="#fff" stroke-width="1.4"/>`
        + (s >= 26 ? `<text x="${f1(ex2 + 7)}" y="${f1(ey2 + 3.5)}" font-size="9" font-weight="700" fill="${e2.warna}" stroke="#fff" stroke-width="2.6" paint-order="stroke" font-family="Roboto, Arial, sans-serif">ujung</text>` : ''));
    });
    if (o.cables.riser) {
      const rx = X(o.cables.riser.x), ry = Y(o.cables.riser.y);
      C.push(`<circle cx="${rx}" cy="${ry}" r="7" fill="#fff" stroke="#37474F" stroke-width="1.6"/><text x="${rx}" y="${f1(ry + 3.4)}" font-size="9" font-weight="700" text-anchor="middle" fill="#37474F" font-family="Roboto, Arial, sans-serif">R</text>`);
      if (o.cables.riserTxt && s >= 22) C.push(`<text x="${f1(rx + 11)}" y="${f1(ry - 8)}" font-size="9.5" font-weight="700" fill="#37474F" stroke="#fff" stroke-width="2.6" paint-order="stroke" font-family="Roboto, Arial, sans-serif">${esc(o.cables.riserTxt)}</text>`);
    }
    out.push(`<g pointer-events="none">${C.join('')}</g>`);
  }

  // seleksi (bisa banyak objek); ukuran & pegangan hanya untuk satu objek yang tidak terkunci
  if (act) fl.items.forEach(it => {
    if (!show(it)) return;
    if (it.locked) out.push(lockGlyph(X(it.x + it.w) + 3, Y(it.y) - 4));
    if (!sel.has(it.id)) return;
    const x = X(it.x), y = Y(it.y), w = S(it.w), h = S(it.h);
    out.push(`<rect x="${f1(x - 2)}" y="${f1(y - 2)}" width="${f1(w + 4)}" height="${f1(h + 4)}" fill="none" stroke="${it.locked ? '#C62828' : '#1565C0'}" stroke-width="1.5"${it.locked ? ' stroke-dasharray="4 3"' : ''} pointer-events="none"/>`);
    if (!one) return;
    out.push(`<text x="${f1(x + w / 2)}" y="${f1(y - 6)}" font-size="11" text-anchor="middle" fill="#1565C0" font-family="Roboto, Arial, sans-serif" pointer-events="none">${fmt(it.w)} × ${fmt(it.h)} m</text>`);
    if (RESIZABLE.has(it.t) && !it.locked) out.push(`<rect class="hd" data-id="${it.id}" x="${f1(x + w - 5)}" y="${f1(y + h - 5)}" width="10" height="10"/>`);
    const tg = it.t === 'twtarik' && der.targets.get(it.id);
    if (tg) { const a = center(it), b = center(tg); out.push(`<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" stroke="#C62828" stroke-width="1.5" stroke-dasharray="5 3" pointer-events="none"/>`); }
    if (it.t === 'twtarik' && !it.locked) {   // pegangan untuk menarik garis manual ke tweeter tarik di depannya
      const dd = ((der.dirs.get(it.id) ?? 270) * Math.PI) / 180, rr = twR(it, S) * 1.2 + 11, c = center(it);
      out.push(`<circle class="hc" data-id="${it.id}" cx="${f1(X(c.x) + Math.cos(dd) * rr)}" cy="${f1(Y(c.y) + Math.sin(dd) * rr)}" r="5.5"><title>Tarik ke tweeter tarik di depannya</title></circle>`);
    }
  });

  // label lux per ruang (mode "Cek lux")
  (o.luxLabels || []).forEach(l => {
    const x = X(l.x), y = Y(l.y), w = l.txt.length * 6.1 + 14;
    out.push(`<g pointer-events="none"><rect x="${f1(x - w / 2)}" y="${f1(y - 10)}" width="${f1(w)}" height="20" rx="10" fill="#fff" fill-opacity=".92" stroke="${l.bad ? '#C62828' : '#8b95a3'}"/>`
      + `<text x="${x}" y="${f1(y + 4)}" font-size="11" text-anchor="middle" font-weight="600" fill="${l.bad ? '#C62828' : '#1a2230'}" font-family="Roboto, Arial, sans-serif">${esc(l.txt)}</text></g>`);
  });

  // ukuran & judul lantai
  if (o.dims) {
    const x0 = X(F.x), x1 = X(F.x + F.w), y0 = Y(F.y), y1 = Y(F.y + F.h), dy = f1(y1 + 24), dx = f1(x1 + 24), my = f1((y0 + y1) / 2);
    out.push(`<g stroke="#8b95a3" stroke-width="1" pointer-events="none"><line x1="${x0}" y1="${dy}" x2="${x1}" y2="${dy}"/><line x1="${x0}" y1="${f1(dy - 4)}" x2="${x0}" y2="${f1(dy + 4)}"/><line x1="${x1}" y1="${f1(dy - 4)}" x2="${x1}" y2="${f1(dy + 4)}"/>`
      + `<line x1="${dx}" y1="${y0}" x2="${dx}" y2="${y1}"/><line x1="${f1(dx - 4)}" y1="${y0}" x2="${f1(dx + 4)}" y2="${y0}"/><line x1="${f1(dx - 4)}" y1="${y1}" x2="${f1(dx + 4)}" y2="${y1}"/></g>`);
    out.push(`<text x="${f1((x0 + x1) / 2)}" y="${f1(dy + 15)}" font-size="11" text-anchor="middle" ${TXT}>${fmt(F.w)} m</text>`);
    out.push(`<text x="${f1(dx + 9)}" y="${my}" font-size="11" text-anchor="middle" transform="rotate(90 ${f1(dx + 9)} ${my})" ${TXT}>${fmt(F.h)} m</text>`);
    const off = F.x || F.y, two = off || x1 - x0 < 340;   // lantai sempit: judul di baris sendiri agar tidak menimpa "Depan"
    out.push(`<text x="${x0}" y="${f1(y0 - 12)}" font-size="10.5" ${TXT}>▲ Depan (sisi jalan)</text>`);
    if (off) out.push(`<text x="${x1}" y="${f1(y0 - 12)}" font-size="10.5" text-anchor="end" ${TXT}>kiri ${fmt(F.x)} m · depan ${fmt(F.y)} m</text>`);
    out.push(`<text x="${two && !off ? x0 : x1}" y="${f1(y0 - (two ? 27 : 12))}" font-size="11"${two && !off ? '' : ' text-anchor="end"'} ${TXT}>${fl.name} · ${fmt(Math.round(F.w * F.h * 10) / 10)} m² · tinggi ${fmt(floorHt(m, fl))} m</text>`);
  }

  // penggaris: garis ukur dengan panjang (dan komponen mendatar/tegak bila miring)
  (o.measures || []).forEach(q => {
    const len = Math.hypot(q.x2 - q.x1, q.y2 - q.y1); if (len < 0.01) return;
    const x1 = X(q.x1), y1 = Y(q.y1), x2 = X(q.x2), y2 = Y(q.y2), L = Math.hypot(x2 - x1, y2 - y1) || 1, nx = (-(y2 - y1) / L) * 6, ny = ((x2 - x1) / L) * 6;
    const dxm = Math.abs(q.x2 - q.x1), dym = Math.abs(q.y2 - q.y1), txt = mtxt(len), mx = (x1 + x2) / 2, my = (y1 + y2) / 2, tw = txt.length * 6.8 + 12;
    let g = '';
    if (dxm > 0.05 && dym > 0.05) g += `<path d="M${x1} ${y1}H${x2}V${y2}" stroke="#D81B60" stroke-opacity=".45" stroke-dasharray="3 3" fill="none"/>`
      + `<text x="${f1((x1 + x2) / 2)}" y="${f1(y1 + (y2 > y1 ? -5 : 13))}" font-size="10" text-anchor="middle" fill="#AD1457" font-family="Roboto, Arial, sans-serif">↔ ${mtxt(dxm)}</text>`
      + `<text x="${f1(x2 + (x2 > x1 ? 5 : -5))}" y="${f1((y1 + y2) / 2 + 3)}" font-size="10" text-anchor="${x2 > x1 ? 'start' : 'end'}" fill="#AD1457" font-family="Roboto, Arial, sans-serif">↕ ${mtxt(dym)}</text>`;
    g += `<g stroke="#D81B60" stroke-width="1.6" stroke-linecap="round"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><line x1="${f1(x1 - nx)}" y1="${f1(y1 - ny)}" x2="${f1(x1 + nx)}" y2="${f1(y1 + ny)}"/><line x1="${f1(x2 - nx)}" y1="${f1(y2 - ny)}" x2="${f1(x2 + nx)}" y2="${f1(y2 + ny)}"/></g>`
      + `<rect x="${f1(mx - tw / 2)}" y="${f1(my - 10)}" width="${f1(tw)}" height="20" rx="4" fill="#fff" stroke="#D81B60"/><text x="${f1(mx)}" y="${f1(my + 4)}" font-size="12" text-anchor="middle" font-weight="600" fill="#AD1457" font-family="Roboto, Arial, sans-serif">${txt}</text>`;
    out.push(`<g pointer-events="none">${g}</g>`);
  });

  // pratinjau sekat yang sedang digambar + panjang langsung (gaya SketchUp)
  if (o.preview) {
    const p = o.preview, len = Math.hypot(p.x2 - p.x1, p.y2 - p.y1);
    out.push(`<line x1="${X(p.x1)}" y1="${Y(p.y1)}" x2="${X(p.x2)}" y2="${Y(p.y2)}" stroke="#1565C0" stroke-width="3" stroke-dasharray="6 4"/>`);
    if (len > 0.05) out.push(`<text x="${X((p.x1 + p.x2) / 2)}" y="${f1(Y((p.y1 + p.y2) / 2) - 9)}" font-size="12" text-anchor="middle" fill="#1565C0" font-family="Roboto, Arial, sans-serif">${len.toFixed(2).replace('.', ',')} m</text>`);
  }
  // jalur cahaya anakan (mode "Cek lux"): dari tiap ruang lewat pintunya ke ruang yang lebih terang, sampai LMB
  if (o.flow) {
    defs.push(`<marker id="${P}-ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#E65100"/></marker>`);
    const st = `fill="none" stroke="#E65100" stroke-width="2" stroke-dasharray="6 4" stroke-linecap="round" pointer-events="none" marker-end="url(#${P}-ar)"`;
    const tx = (x, y, t, c = '#E65100', a = 'middle') => `<text x="${f1(x)}" y="${f1(y)}" font-size="11" font-weight="700" text-anchor="${a}" fill="${c}" font-family="Roboto, Arial, sans-serif" pointer-events="none">${t}</text>`;
    o.flow.forEach(fw => {
      const pts = q => q.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
      if (fw.kind === 'step') out.push(`<polyline points="${pts([fw.from, fw.via, fw.to])}" ${st}/>`);
      else if (fw.kind === 'naik' || fw.kind === 'turun') out.push(`<polyline points="${pts([fw.from, fw.via])}" ${st}/>` + tx(X(fw.via[0]) + 8, Y(fw.via[1]) + 4, fw.kind === 'naik' ? '↑ naik lewat void' : '↓ turun lewat void', '#E65100', 'start'));
      else if (fw.kind === 'exit') out.push(tx(X(fw.at[0]), Y(fw.at[1]) + 24, '☀ keluar lewat LMB'));
      else out.push(tx(X(fw.at[0]), Y(fw.at[1]) + 24, '✕ buntu — tidak ada arah terang', fw.inap ? '#C62828' : '#8b95a3'));
    });
  }
  // siklus udara: panah debit tiap bukaan — biru = udara luar masuk, merah = udara keluar, hijau = antar ruang
  if (o.air) {
    const AC = { masuk: '#1E88E5', keluar: '#E53935', dalam: '#00897B' };
    Object.entries(AC).forEach(([k, c]) => defs.push(`<marker id="${P}-a${k}" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`));
    const lbl = (x, y, t, c) => `<text x="${f1(x)}" y="${f1(y)}" font-size="10" font-weight="700" text-anchor="middle" fill="${c}" stroke="#fff" stroke-width="2.4" paint-order="stroke" font-family="Roboto, Arial, sans-serif" pointer-events="none">${t}</text>`;
    o.air.forEach(a => {
      const c = AC[a.kind] || AC.dalam, q = Math.round(a.q), L = Math.min(46, 14 + 9 * Math.log10(1 + a.q)), sw = f1(Math.min(4.5, 1.4 + Math.log10(1 + a.q)));
      if (a.v) { out.push(lbl(X(a.x), Y(a.y) + 4, `${a.v === 'naik' ? '⬆' : '⬇'} ${q} m³/j`, c)); return; }
      const x0 = X(a.x) - (a.dx * L) / 2, y0 = Y(a.y) - (a.dy * L) / 2, x1 = X(a.x) + (a.dx * L) / 2, y1 = Y(a.y) + (a.dy * L) / 2;
      out.push(`<line x1="${f1(x0)}" y1="${f1(y0)}" x2="${f1(x1)}" y2="${f1(y1)}" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" marker-end="url(#${P}-a${a.kind || 'dalam'})" pointer-events="none"/>`);
      if (q >= 1 && s >= 30) out.push(lbl(x1 + a.dx * 12, y1 + a.dy * 12 + 3, q, c));
    });
  }
  // garis bantu saat menarik tweeter tarik ke tweeter di depannya
  if (o.link) out.push(`<line x1="${X(o.link.x1)}" y1="${Y(o.link.y1)}" x2="${X(o.link.x2)}" y2="${Y(o.link.y2)}" stroke="#C62828" stroke-width="2" stroke-dasharray="5 3" pointer-events="none"/>`);
  // tanda lokasi catatan analisis yang diklik (kotak merah berdenyut)
  if (o.mark) {
    const q = o.mark, pad = 6;
    out.push(`<g class="pl-mark" pointer-events="none"><rect x="${f1(X(q.x) - pad)}" y="${f1(Y(q.y) - pad)}" width="${f1(S(q.w) + 2 * pad)}" height="${f1(S(q.h) + 2 * pad)}" rx="6" fill="none" stroke="#C62828" stroke-width="2.5" stroke-dasharray="8 6"/></g>`);
  }
  // kotak pilih: kiri→kanan = objek yang masuk penuh (biru), kanan→kiri = objek yang tersentuh (hijau putus-putus)
  if (o.marquee) {
    const q = o.marquee, cross = q.x2 < q.x1;
    out.push(`<rect x="${X(Math.min(q.x1, q.x2))}" y="${Y(Math.min(q.y1, q.y2))}" width="${S(Math.abs(q.x2 - q.x1))}" height="${S(Math.abs(q.y2 - q.y1))}" fill="${cross ? 'rgba(46,125,50,.08)' : 'rgba(21,101,192,.08)'}" stroke="${cross ? '#2E7D32' : '#1565C0'}" stroke-width="1.2"${cross ? ' stroke-dasharray="5 3"' : ''} pointer-events="none"/>`);
  }
  return `<defs>${defs.join('')}</defs>${out.join('')}`;
}

// SVG mandiri satu lantai (thumbnail & lembar desain). Label ruang berada DI LUAR kiri denah → margin kiri ekstra.
export function floorSVG(m, i, s, o = {}) {
  const P = o.pad ?? 30, PL = o.labels === false ? P : P + 104;
  const W = f1(m.w * s + P + PL), H = f1(m.h * s + 2 * P);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fff"/>`
    + drawFloor(m, i, { s, ox: PL, oy: P, grid: 'building', dims: true, pfx: `f${i}`, ...o }) + '</svg>';
}

// Simbol katalog 34×34 — bentuk objek seperti di denah.
export function symbolSVG(t, size = 34) {
  const T = TYPES[t], c = T.color, f = T.fill || 'none';
  const hatch = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#1a1a1a"/>`
    + Array.from({ length: Math.floor(w / 4) }, (_, k) => `<line x1="${x + k * 4}" y1="${y + h}" x2="${x + k * 4 + h}" y2="${y}" stroke="#1a1a1a" stroke-width=".8"/>`).join('');
  let b;
  switch (t) {
    case 'sekat': b = hatch(3, 14, 28, 6); break;
    case 'inap': b = `<rect x="4" y="4" width="26" height="26" rx="1" fill="${f}" stroke="${c}" stroke-dasharray="3 2"/>` + [9, 13, 17, 21, 25].map(y => `<line x1="6" y1="${y}" x2="28" y2="${y}" stroke="${c}" opacity=".7"/>`).join(''); break;
    case 'jalur': b = `<rect x="4" y="6" width="26" height="22" rx="1" fill="${f}" stroke="${c}" stroke-dasharray="3 2"/><path d="M12 17a5 5 0 1 1 2 4" fill="none" stroke="${c}" stroke-width="1.4"/>`; break;
    case 'void': b = `<rect x="8" y="4" width="18" height="26" rx="1" fill="${f}" stroke="${c}" stroke-dasharray="3 2"/><path d="M8 4L26 30M26 4L8 30" stroke="${c}" opacity=".6"/>`; break;
    case 'audio': b = `<rect x="7" y="5" width="20" height="24" rx="1" fill="${f}" stroke="${c}" stroke-dasharray="3 2"/><path d="M13 14h3l4-3v12l-4-3h-3z" fill="${c}" opacity=".6"/>`; break;
    case 'lmb': b = hatch(2, 8, 9, 6) + hatch(23, 8, 9, 6) + `<rect x="11" y="8" width="12" height="6" fill="${f}" stroke="${c}"/><path d="M17 17v9m-3-3 3 3 3-3" fill="none" stroke="${c}" stroke-width="1.3"/>`; break;
    case 'lar': b = hatch(2, 14, 9, 6) + hatch(23, 14, 9, 6) + `<rect x="11" y="14" width="12" height="6" fill="${f}" stroke="${c}" stroke-dasharray="2 1.5"/>`; break;
    case 'larj': b = hatch(2, 14, 9, 6) + hatch(23, 14, 9, 6) + `<rect x="11" y="14" width="12" height="6" fill="${f}" stroke="${c}" stroke-dasharray="2 1.5"/><path d="M11 16h12M11 18h12" stroke="#1a1a1a" stroke-width=".7"/>`; break;
    case 'vent': b = hatch(3, 5, 5, 24).replace(/<line[^>]*>/g, '') + `<path d="M8 15h11" stroke="${c}" stroke-width="5" stroke-opacity=".55"/><circle cx="22" cy="15" r="5" fill="#fff" stroke="${c}" stroke-width="1.3"/><circle cx="22" cy="15" r="1.9" fill="${c}"/><path d="M22 22v7m-2.5-2.5L22 29l2.5-2.5" fill="none" stroke="${c}" stroke-width="1.3"/>`; break;
    case 'hexa': b = hexaSym(17, 17, 12, c); break;
    case 'sarang': b = `<path d="M8 15h18a9 8 0 0 1-18 0z" fill="rgba(46,125,50,.3)" stroke="${c}" stroke-width="1.4"/><path d="M11 15c1.5-3 4-4.5 6-4.5s4.5 1.5 6 4.5" fill="none" stroke="${c}"/>`; break;
    case 'kolam': b = `<rect x="9" y="4" width="16" height="26" rx="1" fill="${f}" stroke="${c}"/><path d="M11 17q3.5-3 7 0t7 0" fill="none" stroke="#185FA5" stroke-width="1.2"/>`; break;
    case 'twinap': b = tweeterSym(17, 21, 270, c, 5.5); break;
    case 'twtarik': b = tweeterSym(19, 19, 225, c, 5.5); break;
    case 'menara': b = `<rect x="8" y="4" width="18" height="26" rx="1" fill="${f}" stroke="${c}" stroke-dasharray="4 2"/><rect x="11" y="7" width="12" height="20" fill="none" stroke="${c}" stroke-dasharray="2 2"/>`; break;
    case 'tangga': b = `<rect x="11" y="4" width="12" height="26" rx="1" fill="${f}" stroke="${c}"/>` + [8, 12, 16, 20, 24].map(y => `<line x1="11" y1="${y}" x2="23" y2="${y}" stroke="${c}" opacity=".7"/>`).join(''); break;
    case 'pintu': b = hatch(2, 26, 8, 5) + hatch(24, 26, 8, 5) + `<path d="M10 28V12A14 14 0 0 1 24 26" fill="none" stroke="${c}" stroke-dasharray="2 2"/>`; break;
    default: b = `<rect x="6" y="6" width="22" height="22" fill="${f}" stroke="${c}"/>`;
  }
  return `<svg class="sym" viewBox="0 0 34 34" width="${size}" height="${size}" stroke-width="1" aria-hidden="true">${b}</svg>`;
}
