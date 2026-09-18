// Pratinjau 3D Walet Planner (Three.js): lantai + menara, tampilan kamera (3D / atas / depan / belakang / kiri / kanan),
// semua lantai / per lantai / terurai, matahari menurut arah hadap gedung & jam, simulasi ±20 walet (berputar di luar,
// terpanggil hexagonal, masuk LMB, mengejar suara tarik, menyebar ke ruang), peta kenyamanan ruang (atau lux), dan
// partikel aliran udara. Gedung dibangun ulang dari model setiap kali dipanggil; kawanan burung tetap hidup.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { derive, structure, floorRect, floorHt, rectDiff, wallSideRuns, levels, center, inRect } from './planner-geom.js';
import { sunPos, simOf, luxColor, arahNama } from './planner-light.js';
import { comfort, TINGKAT } from './planner-comfort.js';
import { SARANG_WARNA } from './planner-data.js';

let renderer, scene, camera, controls, host, raf, group, flock, sunL, hemi, legend, tagBox, statBox, bar, senter, sync3;
const geoCache = new Map(), matCache = new Map();
const st = { view: 'iso', mode: 'semua', burung: true, peta: 'nyaman', udara: false, walk: false };   // pilihan toolbar 3D
let last = null, camKey = '', camTween = null, W3 = null, B3 = null, simSig = '', birds = [], flow = null, tags = [], junk = [], tPrev = 0, statT = 0, pergi = 0, siteT = { href: null, tex: null };
const GAP = 2.5;        // jarak antar lantai pada tampilan terurai (m)
// mode "jalan di dalam": posisi, arah pandang, tinggi mata, lantai, senter; tps = sudut pandang orang ketiga
const wk = { on: false, x: 0, z: 0, yaw: 0, pitch: 0, h: 1.6, lv: 0, senter: false, tps: false, keys: {}, stair: null, cam: null };
let person = null;   // sosok manusia untuk mode orang ketiga

const COL = {
  slab: 0xd9d4c7, wallOut: 0xf0ede6, sekat: 0x3a3f45, bata: 0xb3a08c, sirip: 0x8a5a2b, jalur: 0x1d9e75, lmb: 0xd85a30, void: 0x378add,
  kolam: 0x378add, twinap: 0x534ab7, twtarik: 0xc62828, hexa: 0x6a1b9a, vent: 0x5f5e5a, pipa: 0xd5d9dd, tangga: 0x6b6b66,
  pintu: 0x8b6f47, audio: 0x9aa1a9, ground: 0xcfd8dc, kolom: 0x8c8f93, balok: 0xb8b4aa, burung: 0x262a2e,
};
const hexRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rnd = (a, b) => a + Math.random() * (b - a);

export function mount(el) {
  host = el;
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  host.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 600);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.addEventListener('start', () => { camTween = null; });
  hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.9);
  sunL = new THREE.DirectionalLight(0xffffff, 1.1);
  sunL.castShadow = true; sunL.shadow.mapSize.set(2048, 2048);
  Object.assign(sunL.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
  flock = new THREE.Group();
  scene.add(hemi, sunL, sunL.target, flock, camera);
  senter = new THREE.SpotLight(0xfff1cf, 0, 16, 0.45, 0.4, 1.2);   // senter di tangan (mode jalan)
  camera.add(senter, senter.target);
  senter.position.set(0.12, -0.15, 0); senter.target.position.set(0, -0.12, -4);
  const div = cls => { const d = document.createElement('div'); d.className = cls; host.appendChild(d); return d; };
  tagBox = div('tags3'); bar = div('tb3'); statBox = div('stat3'); legend = div('legend');
  statBox.addEventListener('click', e => {
    const b = e.target.closest('[data-wkh]'); if (!b) return;
    wk.h = Math.max(1.3, Math.min(2, wk.h + (b.dataset.wkh === '+' ? 0.05 : -0.05))); statSet();
  });
  bar.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]'); if (!b) return;
    const g = b.parentElement.dataset.g, v = b.dataset.v;
    if (v === 'walk') walkToggle();
    else if (v === 'tps') { wk.tps = !wk.tps; }
    else if (g === 'view') { st.view = v; camPreset(true); }
    else if (g === 'mode') { st.mode = v; rebuild(); }
    else if (v === 'peta') { st.peta = st.peta === 'nyaman' ? 'lux' : st.peta === 'lux' ? '' : 'nyaman'; rebuild(); }
    else if (v === 'senter') senterSet(!wk.senter);
    else { st[v] = !st[v]; rebuild(); }
    renderBar();
  });
  renderBar();
  window.addEventListener('resize', resize);
  // kontrol mode jalan: WASD / panah, seret = menoleh, T = senter, Esc = keluar
  window.addEventListener('keydown', e => {
    if (!wk.on || host.hidden) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { walkToggle(); renderBar(); return; }
    if (k === 't') { senterSet(!wk.senter); renderBar(); return; }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) { wk.keys[k] = 1; e.preventDefault(); }
  });
  window.addEventListener('keyup', e => { delete wk.keys[e.key.toLowerCase()]; });
  let look = null;
  renderer.domElement.addEventListener('pointerdown', e => { if (wk.on) { look = { x: e.clientX, y: e.clientY }; renderer.domElement.setPointerCapture?.(e.pointerId); } });
  renderer.domElement.addEventListener('pointermove', e => {
    if (!wk.on || !look) return;
    wk.yaw -= (e.clientX - look.x) * 0.0042; wk.pitch = Math.max(-1.35, Math.min(1.35, wk.pitch - (e.clientY - look.y) * 0.0035));
    look = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener('pointerup', () => { look = null; });
}
function renderBar() {
  const grp = (g, list) => `<div class="grp" data-g="${g}">${list.map(([v, t, on]) => `<button type="button" data-v="${v}" class="${on ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  bar.innerHTML = wk.on
    ? grp('walk', [['walk', '✕ Keluar mode jalan', true], ['tps', wk.tps ? '👤 Orang ketiga' : '👁 Pandangan mata', wk.tps], ['senter', '🔦 Senter (T)', wk.senter]])
    : grp('view', [['iso', '3D'], ['atas', 'Atas'], ['depan', 'Depan'], ['belakang', 'Belakang'], ['kiri', 'Kiri'], ['kanan', 'Kanan']].map(([v, t]) => [v, t, st.view === v]))
    + grp('mode', [['semua', 'Semua lantai'], ['lantai', 'Per lantai'], ['terurai', 'Terurai']].map(([v, t]) => [v, t, st.mode === v]))
    + grp('sim', [['burung', 'Burung walet', st.burung], ['peta', `Peta: ${st.peta === 'nyaman' ? 'kenyamanan' : st.peta === 'lux' ? 'lux' : 'mati'}`, !!st.peta], ['udara', 'Aliran udara', st.udara]])
    + grp('walk', [['walk', '🚶 Jalan di dalam', false]]);
}
const rebuild = () => { if (last) build(last.model, last.active, last.opts); };

function resize() {
  if (!host || host.hidden) return;
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function geo(w, h, d) {
  const k = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(k);
}
function mat(color, op, side) {
  const k = `${color}|${op}|${side || ''}`;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshLambertMaterial({ color, transparent: !!op, opacity: op || 1, depthWrite: !op, side: side || THREE.FrontSide }));
  return matCache.get(k);
}
function mesh(g, color, x, y, z, op = 0, side) {
  const m = new THREE.Mesh(g, mat(color, op, side));
  m.position.set(x, y, z); m.castShadow = !op; m.receiveShadow = true;
  group.add(m);
  return m;
}
function box(w, h, d, color, x, y, z, op = 0) {
  if (w < 0.005 || h < 0.005 || d < 0.005) return null;
  return mesh(geo(w, h, d), color, x, y, z, op);
}
function cached(k, make) { if (!geoCache.has(k)) geoCache.set(k, make()); return geoCache.get(k); }
const cyl = (r, h, color, x, y, z, op) => mesh(cached(`c${r}|${h}`, () => new THREE.CylinderGeometry(r, r, h, 14)), color, x, y, z, op);
// Tweeter berbentuk corong: mulut lebar ke arah hadap (sumbu +x lokal), leher kecil di belakang.
function horn(color, x, y, z, dirDeg, op = 0) {
  const g = cached('corong', () => { const c = new THREE.CylinderGeometry(0.07, 0.022, 0.15, 14, 1, true); c.rotateZ(-Math.PI / 2); return c; });
  const m = mesh(g, color, x, y, z, op, THREE.DoubleSide);
  m.rotation.y = -(dirDeg * Math.PI) / 180;
  return m;
}
// Tweeter hexagonal: tiang + segi enam + 6 corong panggil menghadap keluar ke 6 arah.
function hexa(x, y, z, op) {
  cyl(0.025, 0.5, 0x777777, x, y + 0.25, z, op);
  mesh(cached('hexa', () => new THREE.CylinderGeometry(0.2, 0.2, 0.14, 6)), COL.hexa, x, y + 0.56, z, op);
  for (let k = 0; k < 6; k++) { const a = k * 60, r = (a * Math.PI) / 180; horn(COL.hexa, x + Math.cos(r) * 0.25, y + 0.56, z + Math.sin(r) * 0.25, a, op); }
}

// Model denah: x = lebar, y (denah) = panjang → sumbu z three; tinggi = sumbu y three.
export function build(model, active = 0, opts = {}) {
  last = { model, active, opts };
  if (group) scene.remove(group);
  junk.forEach(o => o.dispose()); junk = [];
  group = new THREE.Group();
  const LV = levels(model), show = opts.show || (() => 1), W = model.w, Lg = model.h;
  const ox = -W / 2, oz = -Lg / 2, X = x => ox + x, Z = y => oz + y;
  const hts = LV.map(fl => floorHt(model, fl)), rects = LV.map(fl => floorRect(model, fl));
  const gap = st.mode === 'terurai' ? GAP : 0, base = [], cum = [];
  hts.reduce((acc, h, i) => { base.push(acc + i * gap); cum.push(acc); return acc + h; }, 0);
  const Htot = base[LV.length - 1] + hts[LV.length - 1], vis = i => st.mode !== 'lantai' || i === active;
  active = Math.min(active, LV.length - 1);

  const gnd = new THREE.PlaneGeometry(W + 40, Lg + 40); junk.push(gnd);
  const g = new THREE.Mesh(gnd, mat(COL.ground, 0));
  g.rotation.x = -Math.PI / 2; g.position.y = -0.01; g.receiveShadow = true;
  group.add(g);
  // foto satelit lokasi sebagai tanah — gedung berdiri di lahan aslinya
  if (opts.site?.href) {
    if (siteT.href !== opts.site.href) {
      siteT.tex?.dispose();
      const tex = new THREE.TextureLoader().load(opts.site.href, () => {});
      tex.colorSpace = THREE.SRGBColorSpace;
      siteT = { href: opts.site.href, tex };
    }
    const pg = new THREE.PlaneGeometry(opts.site.w, opts.site.h), pmm = new THREE.MeshBasicMaterial({ map: siteT.tex, transparent: true, opacity: Math.min(1, (opts.site.op ?? 0.7) + 0.15), depthWrite: false });
    junk.push(pg, pmm);
    const wrap = new THREE.Group(), pm = new THREE.Mesh(pg, pmm);
    pm.rotation.x = -Math.PI / 2; pm.renderOrder = -1;
    wrap.add(pm); wrap.rotation.y = -((opts.site.rot || 0) * Math.PI) / 180;
    wrap.position.set(X(opts.site.cx), 0.02, Z(opts.site.cy));
    group.add(wrap);
  }

  const hexPts = [];
  LV.forEach((fl, i) => {
    if (!vis(i)) return;
    const H = hts[i], F = rects[i], y0 = base[i], d = derive(model, fl), mn = !!fl.menara, next = rects[i + 1];
    const semua = st.mode === 'semua';
    const op = semua ? (i > active ? 0.1 : i === active ? 0.35 : 0) : 0.28;   // dinding luar: lantai aktif tembus pandang
    const opS = semua && i > active ? 0.08 : 0.6;                              // sekat walet (terpal)
    if (!mn) {   // pelat lantai dilubangi void & lubang LAL (tangga lantai di bawahnya) — untuk jelajah naik-turun
      const holes = fl.items.filter(it => it.t === 'void').concat(i > 0 && !LV[i - 1].menara ? LV[i - 1].items.filter(it => it.t === 'tangga') : []);
      let pieces = [F];
      holes.forEach(h2 => { pieces = pieces.flatMap(r => rectDiff(r, h2)); });
      pieces.forEach(r => box(r.w, 0.12, r.h, COL.slab, X(r.x + r.w / 2), y0 + 0.06, Z(r.y + r.h / 2), semua && i > active ? 0.12 : 0));
      if (i > 0) holes.slice(fl.items.filter(it => it.t === 'void').length).forEach(t =>   // bingkai lubang LAL
        box(t.w + 0.08, 0.13, t.h + 0.08, COL.tangga, X(t.x + t.w / 2), y0 + 0.06, Z(t.y + t.h / 2), 0.65));
    }
    const st0 = model.showStruktur !== false ? structure(model, F) : null;

    // dinding luar & sekat — terpotong bukaan (LAR pintu 0–2 m, LAR jendela 1 m di bagian atas, LMB di bawah plafon)
    d.segs.forEach(sg => {
      if (sg.len < 0.05) return;
      const a = sg.ext ? 1 : show({ t: 'sekat', id: sg.id }); if (!a) return;
      const T = sg.ext ? 0.2 : sg.bahan === 'bata' ? 0.15 : 0.1, col = sg.ext ? COL.wallOut : sg.bahan === 'bata' ? COL.bata : COL.sekat, gant = sg.jenis === 'gantung', wo = sg.ext ? op : a < 1 ? 0.06 : sg.bahan === 'bata' ? Math.min(0.85, opS + 0.2) : opS;
      const ux = (sg.x2 - sg.x1) / sg.len, uy = (sg.y2 - sg.y1) / sg.len, ang = -Math.atan2(sg.y2 - sg.y1, sg.x2 - sg.x1);
      const zBot = gant ? H - 0.7 : 0;
      const part = (p, q, z0, z1) => {
        if (q - p < 0.02 || z1 - z0 < 0.02) return;
        const mx = sg.x1 + (ux * (p + q)) / 2, my = sg.y1 + (uy * (p + q)) / 2, m = box(q - p, z1 - z0, T, col, X(mx), y0 + (z0 + z1) / 2, Z(my), wo);
        if (m) m.rotation.y = ang;
      };
      sg.pieces.forEach(([p, q]) => part(p, q, zBot, H));
      sg.ops.forEach(o => {
        let o0 = 0, o1 = Math.min(H, 2);
        if (o.kind === 'jendela') { o1 = H - 0.2; o0 = Math.max(0, o1 - 1); }
        else if (o.kind === 'lmb') { o1 = H - 0.25; o0 = Math.max(0, o1 - (o.it.tcm || 50) / 100); }
        part(o.a, o.b, zBot, Math.max(zBot, o0));
        part(o.a, o.b, Math.max(zBot, o1), H);
        if (o.kind === 'lmb') { const mx = sg.x1 + (ux * (o.a + o.b)) / 2, my = sg.y1 + (uy * (o.a + o.b)) / 2, f = box(o.b - o.a + 0.08, 0.06, T + 0.04, COL.lmb, X(mx), y0 + o1 + 0.03, Z(my)); if (f) f.rotation.y = ang; }
      });
    });
    if (st0) {   // kolom & balok
      st0.xs.forEach(x => st0.ys.forEach(y => box(0.3, H, 0.3, COL.kolom, X(Math.min(F.x + F.w - 0.15, Math.max(F.x + 0.15, x))), y0 + H / 2, Z(Math.min(F.y + F.h - 0.15, Math.max(F.y + 0.15, y))), op)));
      st0.bx.forEach(x => box(0.12, 0.25, F.h, COL.balok, X(x), y0 + H - 0.125, Z(F.y + F.h / 2), op));
      st0.by.forEach(y => box(F.w, 0.25, 0.12, COL.balok, X(F.x + F.w / 2), y0 + H - 0.125, Z(y), op));
    }

    // sirip per ruang inap (zona dibagi sekat): panjang / kotak + papan yang menempel di sisi berdinding
    const tb = Math.max(0.015, (model.siripTebal || 2) / 100), lb = Math.max(0.05, (model.siripLebar || 20) / 100), yS = y0 + H - 0.02 - lb / 2;
    d.rooms.concat(d.jrooms || []).forEach(r => {
      const zi = fl.items.find(q => q.id === r.zid), a = zi ? show(zi) : 1; if (!a) return;
      const so = a < 1 ? 0.1 : op, kotak = r.st === 'kotak', gp = r.gap || (kotak ? 0.4 : 0.25), rcx = X(r.x + r.w / 2), rcz = Z(r.y + r.h / 2);
      const rowsX = () => { for (let k = 1, n = Math.ceil(r.h / gp - 1e-6); k < n; k++) box(r.w, lb, tb, COL.sirip, rcx, yS, Z(r.y + k * gp), so); };
      const rowsY = () => { for (let k = 1, n = Math.ceil(r.w / gp - 1e-6); k < n; k++) box(tb, lb, r.h, COL.sirip, X(r.x + k * gp), yS, rcz, so); };
      if (kotak) { rowsX(); rowsY(); } else if (d.orient.get(r.id) === 'x') rowsX(); else rowsY();
      const runs = wallSideRuns(r, d.segs), ins = 0.08;
      runs.top.forEach(([p, q]) => box(q - p, lb, tb, COL.sirip, X((p + q) / 2), yS, Z(r.y + ins), so));
      runs.bottom.forEach(([p, q]) => box(q - p, lb, tb, COL.sirip, X((p + q) / 2), yS, Z(r.y + r.h - ins), so));
      runs.left.forEach(([p, q]) => box(tb, lb, q - p, COL.sirip, X(r.x + ins), yS, Z((p + q) / 2), so));
      runs.right.forEach(([p, q]) => box(tb, lb, q - p, COL.sirip, X(r.x + r.w - ins), yS, Z((p + q) / 2), so));
      if (!st.peta) box(r.w, 0.02, r.h, COL.sirip, rcx, y0 + 0.13, rcz, 0.15);
    });

    fl.items.forEach(it => {
      const a = show(it); if (!a) return;
      const dim = a < 1, cx = X(it.x + it.w / 2), cz = Z(it.y + it.h / 2), f = v => (dim ? Math.min(v || 1, 0.12) : v);
      switch (it.t) {
        case 'jalur': if (!st.peta) box(it.w, 0.02, it.h, COL.jalur, cx, y0 + 0.13, cz, f(0.3)); break;
        case 'audio': box(it.w, H - 0.2, it.h, COL.audio, cx, y0 + H / 2, cz, f(0.35)); break;
        case 'void': box(it.w, H, it.h, COL.void, cx, y0 + H / 2, cz, f(0.16)); if (!dim) box(it.w, 0.14, it.h, 0x1f2933, cx, y0 + 0.06, cz); break;
        case 'kolam': box(it.w, 0.3, it.h, COL.kolam, cx, y0 + 0.27, cz, f(0.85)); break;
        case 'twinap': case 'twtarik': horn(COL[it.t], cx, y0 + H - (it.t === 'twinap' ? 0.35 : 0.6), cz, d.dirs.get(it.id) ?? 270, dim ? 0.2 : 0); break;
        case 'sarang': {   // mangkuk sarang kecil menempel di sirip, warna menurut jenis
          const col = parseInt((SARANG_WARNA[it.ns] || SARANG_WARNA.jadi).slice(1), 16);
          const g2 = cached('sarang', () => new THREE.SphereGeometry(0.055, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2));
          const s2 = mesh(g2, col, cx, y0 + H - 0.1, cz, dim ? 0.2 : 0, THREE.DoubleSide); s2.rotation.x = Math.PI;
          break;
        }
        case 'hexa': {   // di atap tepat di atas LMB; bila tertutup lantai di atasnya: di bawah plafon
          const p = center(it), roof = !(next && inRect(p, next)), y = roof ? y0 + H + 0.15 : y0 + H - 0.9;
          hexa(cx, y, cz, dim ? 0.2 : 0); if (roof) hexPts.push(new THREE.Vector3(cx, y + 0.6, cz));
          break;
        }
        case 'vent': {   // paralon 4" menembus dinding → elbow → pipa turun 1 m
          const e = [[it.y - F.y, 0, 1], [F.y + F.h - it.y - it.h, 0, -1], [it.x - F.x, 1, 0], [F.x + F.w - it.x - it.w, -1, 0]].reduce((p, q) => (q[0] < p[0] ? q : p));
          const nx = e[1], ny = e[2], hz = nx === 0, c = center(it), wx = hz ? c.x : nx > 0 ? it.x : it.x + it.w, wy = hz ? (ny > 0 ? it.y : it.y + it.h) : c.y;
          const zv = y0 + Math.max(1.2, H - 0.82), ex = wx + nx * 0.22, ey = wy + ny * 0.22, o = dim ? 0.15 : 0;
          const hp = cyl(0.055, 0.36, COL.pipa, X(wx + nx * 0.04), zv, Z(wy + ny * 0.04), o);
          if (hz) hp.rotation.x = Math.PI / 2; else hp.rotation.z = Math.PI / 2;
          mesh(cached('elbow', () => new THREE.SphereGeometry(0.068, 12, 8)), COL.pipa, X(ex), zv, Z(ey), o);
          cyl(0.055, 1, COL.pipa, X(ex), zv - 0.5, Z(ey), o);
          cyl(0.06, 0.03, COL.vent, X(ex), zv - 1, Z(ey), o);   // jaring hama di ujung bawah
          break;
        }
        case 'tangga': {
          const steps = 10, vert = it.h >= it.w;
          for (let k = 0; k < steps; k++) {
            const t = (k + 0.5) / steps;
            if (vert) box(it.w, 0.05, it.h / steps, COL.tangga, cx, y0 + (k + 1) * (H / steps) - 0.02, Z(it.y + t * it.h), f(op));
            else box(it.w / steps, 0.05, it.h, COL.tangga, X(it.x + t * it.w), y0 + (k + 1) * (H / steps) - 0.02, cz, f(op));
          }
          break;
        }
        case 'pintu': { const m = box(Math.max(it.w, it.h), 2.0, 0.06, COL.pintu, cx, y0 + 1.0, cz, f(0)); if (m && it.h > it.w) m.rotation.y = Math.PI / 2; break; }
      }
    });
    // atap / dak: bagian lantai ini yang tidak tertutup lantai di atasnya; per lantai & terurai: tanpa atap agar isi terlihat
    if (semua) {
      const top = i === LV.length - 1, roof = next ? rectDiff(F, next) : [F];
      roof.forEach(r => box(r.w + (top ? 0.4 : 0), 0.15, r.h + (top ? 0.4 : 0), COL.slab, X(r.x + r.w / 2), y0 + H + 0.075, Z(r.y + r.h / 2), i >= active ? 0.12 : 0));
    }
  });
  // garis sinkron tweeter tarik (menyala di mode jalan / gelap): rantai dari tiap tarik ke tweeter di depannya
  sync3 = new THREE.Group();
  {
    const mt = new THREE.LineBasicMaterial({ color: 0xff5723, transparent: true, opacity: 0.95 }); junk.push(mt);
    LV.forEach((fl, i) => {
      if (!vis(i)) return;
      const d = derive(model, fl), y0 = base[i], H = hts[i], pts = [];
      d.targets.forEach((tg, id) => {
        const it = fl.items.find(z => z.id === id); if (!it || !tg) return;
        const a = center(it), b = center(tg);
        pts.push(X(a.x), y0 + H - 0.6, Z(a.y), X(b.x), y0 + H - 0.6, Z(b.y));
      });
      if (!pts.length) return;
      const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); junk.push(g2);
      sync3.add(new THREE.LineSegments(g2, mt));
    });
  }
  sync3.visible = wk.on;
  group.add(sync3);
  // tangga untuk mode jalan (naik/turun antar lantai)
  B3 = { W, L: Lg, base, hts, top: Htot, X, Z,
    stairs: LV.flatMap((fl, i) => (i < LV.length - 1 ? fl.items.filter(it => it.t === 'tangga').map(it => ({ fi: i, x: it.x, y: it.y, w: it.w, h: it.h, vert: it.h >= it.w })) : [])),
    pintu: (() => { const p = LV[0].items.find(it => it.t === 'pintu'); return p ? center(p) : null; })() };
  scene.add(group);

  // simulasi: kenyamanan ruang (peta, label, tujuan burung) & aliran udara
  let C = null; try { C = comfort(model); } catch (e) { console.warn('simulasi 3D', e); }
  tagBox.innerHTML = ''; tags = [];
  if (C && st.peta) overlays(C, base, X, Z, vis);
  if (C) world(C, model, LV, base, hts, rects, X, Z, hexPts, Htot);
  flowSetup(C, base, cum, X, Z, vis);
  // label: ruang yang kurang / tidak nyaman + arah utara
  if (C && st.peta === 'nyaman') C.rooms.filter(r => (r.level === 'kurang' || r.level === 'tidak') && vis(r.fi)).slice(0, 30).forEach(r => {
    const R = C.L.regions[r.gid];
    addTag(new THREE.Vector3(X(R.cx), base[r.fi] + hts[r.fi] * 0.55, Z(R.cy)), `<b>${r.name}</b>${r.alasan[0] ? `<br><small>${r.alasan[0]}</small>` : ''}`, TINGKAT[r.level]);
  });
  const S = simOf(model), na = (-(+S.hadap || 0) * Math.PI) / 180, nr = Math.max(W, Lg) / 2 + 2.5;
  addTag(new THREE.Vector3(Math.sin(na) * nr, 0.05, -Math.cos(na) * nr), '<b>U ▲</b> utara', '#1565C0');
  sunSetup(S);
  legendSet();
  const key = [W, Lg, Htot.toFixed(2), st.mode, st.mode === 'lantai' ? active : ''].join('|');
  if (key !== camKey) { camKey = key; camPreset(false); }
}

function addTag(p, html, color) {
  const el = document.createElement('div');
  el.className = 'tag3'; el.innerHTML = html; el.style.borderLeftColor = color;
  tagBox.appendChild(el); tags.push({ p, el });
}
function updateTags() {
  if (!tags.length) return;
  const w = host.clientWidth, h = host.clientHeight, v = new THREE.Vector3();
  tags.forEach(t => {
    v.copy(t.p).project(camera);
    const on = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
    t.el.style.display = on ? '' : 'none';
    if (on) { t.el.style.left = `${((v.x + 1) / 2) * w}px`; t.el.style.top = `${((1 - v.y) / 2) * h}px`; }
  });
}

// Peta per lantai (tekstur 1 piksel = 1 sel grid ruang): warna kenyamanan tiap ruang, atau lux hasil simulasi cahaya.
function overlays(C, base, X, Z, vis) {
  C.L.floors.forEach((f, fi) => {
    if (!vis(fi)) return;
    const cv = document.createElement('canvas'); cv.width = f.nx; cv.height = f.ny;
    const c2 = cv.getContext('2d'), img = c2.createImageData(f.nx, f.ny), field = st.peta === 'lux' ? C.L.field(fi) : null;
    const col = f.regions.map(r => { const room = C.rooms[r.gid]; return [...hexRgb(TINGKAT[room.level]), room.level === 'jalan' ? 70 : 165]; });
    for (let k = 0; k < f.reg.length; k++) {
      const r = f.reg[k]; if (r < 0) continue;
      const c = field ? [...luxColor(field[k]), 210] : col[r];
      img.data[k * 4] = c[0]; img.data[k * 4 + 1] = c[1]; img.data[k * 4 + 2] = c[2]; img.data[k * 4 + 3] = c[3];
    }
    c2.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    const pw = f.nx * f.cs, ph = f.ny * f.cs, pg = new THREE.PlaneGeometry(pw, ph), pm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    junk.push(tex, pg, pm);
    const pl = new THREE.Mesh(pg, pm);
    pl.rotation.x = -Math.PI / 2; pl.position.set(X(f.F.x + pw / 2), base[fi] + 0.14, Z(f.F.y + ph / 2));
    group.add(pl);
  });
}

// ---------- dunia burung: ruang, pintu (LAR / celah sekat gantung / lubang void), LMB, hexagonal, tweeter tarik ----------
function world(C, model, LV, base, hts, rects, X, Z, hexPts, Htot) {
  const Lr = C.L, R = Lr.regions, P = (fi, x, y, z) => new THREE.Vector3(X(x), base[fi] + z, Z(y));
  const rooms = R.map(r => ({ gid: r.gid, fi: r.fi, c: P(r.fi, r.cx, r.cy, hts[r.fi] - 0.45), info: C.rooms[r.gid], tarik: C.rooms[r.gid].tarik.map(t => P(r.fi, t.x, t.y, hts[r.fi] - 0.6)) }));
  const edge = Lr.hp.map(h => P(R[h.from].fi, h.pos[0], h.pos[1], h.rect ? 0 : h.pos[2]));
  const lmbs = [];
  LV.forEach((fl, fi) => fl.items.filter(it => it.t === 'lmb').forEach(it => {
    const F = rects[fi], c = center(it), e = [[c.y - F.y, 0, -1], [F.y + F.h - c.y, 0, 1], [c.x - F.x, -1, 0], [F.x + F.w - c.x, 1, 0]].reduce((p, q) => (q[0] < p[0] ? q : p));
    if (e[0] > 0.5) return;   // hanya LMB di dinding luar; (e[1], e[2]) = arah keluar
    const wx = c.x + e[1] * e[0], wy = c.y + e[2] * e[0], zc = hts[fi] - 0.25 - (it.tcm || 50) / 200, a = Lr.at(fi, wx - e[1] * 0.5, wy - e[2] * 0.5);
    if (!a) return;
    lmbs.push({ fi, gid: a.region.gid, out: P(fi, wx + e[1] * 2.5, wy + e[2] * 2.5, zc + 0.4), lip: P(fi, wx + e[1] * 0.4, wy + e[2] * 0.4, zc), mid: P(fi, wx, wy, zc), inn: P(fi, wx - e[1] * 0.8, wy - e[2] * 0.8, zc - 0.1) });
  }));
  const sig = JSON.stringify([model.w, model.h, LV, st.mode]);
  const fresh = sig !== simSig; simSig = sig;
  // sarang jadi / polesan / titik baru = rumah walet penghuni → mereka hafal dan langsung masuk
  const nests = [];
  LV.forEach((fl, fi) => fl.items.filter(it => it.t === 'sarang' && it.ns !== 'lama').forEach(it => {
    const c = center(it), a = Lr.at(fi, c.x, c.y);
    if (a) nests.push({ fi, gid: a.region.gid, pos: P(fi, c.x, c.y, hts[fi] - 0.25) });
  }));
  W3 = { rooms, edge, adj: C.adj, hop: C.hop, lmbs, hexPts, nests, at: Lr.at, c0: new THREE.Vector3(0, 0, 0), R: Math.max(model.w, model.h) / 2 + 4, top: Htot, base, hts };
  const want = Math.max(3, Math.min(60, Math.round(+simOf(model).walet || 20)));
  while (birds.length < want) birds.push(newBird(birds.length));
  while (birds.length > want) { const b = birds.pop(); flock.remove(b.mesh); }
  birds.forEach((b, i) => { b.home = nests[i] || null; });
  if (fresh) { pergi = 0; birds.forEach(b => { if (b.state !== 'luar') toOutside(b); }); }
  flock.visible = st.burung && !wk.on ? true : st.burung;
}
function birdMesh() {
  const g = new THREE.Group(), m = mat(COL.burung, 0, THREE.DoubleSide);
  const body = new THREE.Mesh(cached('badan', () => new THREE.ConeGeometry(0.045, 0.26, 6)), m); body.rotation.x = Math.PI / 2;
  const wing = s => { const w = new THREE.BufferGeometry(); w.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.06, 0, 0, -0.05, s * 0.3, 0, -0.14], 3)); w.computeVertexNormals(); return w; };
  const wl = new THREE.Mesh(cached('sayapL', () => wing(1)), m), wr = new THREE.Mesh(cached('sayapR', () => wing(-1)), m);
  const tail = new THREE.Mesh(cached('ekor', () => { const t = new THREE.BufferGeometry(); t.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.1, 0.05, 0, -0.2, -0.05, 0, -0.2], 3)); t.computeVertexNormals(); return t; }), m);
  g.add(body, wl, wr, tail);
  return { g, wl, wr };
}
function newBird(k) {
  const { g, wl, wr } = birdMesh(), ph = rnd(0, Math.PI * 2);
  flock.add(g);
  const b = { k, mesh: g, wl, wr, pos: new THREE.Vector3(), vel: new THREE.Vector3(), state: 'luar', path: [], t: rnd(2, 12), ph, r: rnd(1.3, 2.2), h: rnd(-1, 4), w: rnd(0.35, 0.7) * (Math.random() < 0.5 ? -1 : 1), flap: rnd(0, 6), lv: -1, cur: -1, goal: -1, lmb: null, perch: null, rr: rnd(0.25, 0.6) };
  b.pos.set(Math.cos(ph) * 12, 8, Math.sin(ph) * 12);
  return b;
}
function toOutside(b) { b.state = 'luar'; b.path = []; b.t = rnd(3, 10); b.lv = -1; b.perch = null; }
// ruang tujuan: walet mengejar suara tarik — utamakan ruang inap bersuara tarik, gelap, mudah dijangkau, nyaman
function pickRoom(from, not = -1) {
  const cand = W3.rooms.filter(r => r.gid !== not && r.gid !== from && Number.isFinite(W3.hop[r.gid]) && r.info.level !== 'jalan');
  if (!cand.length) return from;
  const wt = cand.map(r => (r.info.type === 'inap' ? 1 : 0.2) * (r.tarik.length ? 2 : 0.6) * (0.35 + r.info.score / 100) / (1 + 0.25 * W3.hop[r.gid]));
  let s = Math.random() * wt.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cand.length; i++) { s -= wt[i]; if (s <= 0) return cand[i].gid; }
  return cand[cand.length - 1].gid;
}
// jalur antar ruang lewat pintu-pintunya; di tiap ruang burung lebih dulu menghampiri tweeter tarik terdekat ke pintu berikutnya
function route(a, b) {
  if (a === b || a < 0 || b < 0) return [];
  const prev = new Map([[a, null]]), q = [a];
  while (q.length) { const i = q.shift(); if (i === b) break; for (const e of W3.adj[i]) if (!prev.has(e.to)) { prev.set(e.to, { from: i, k: e.k }); q.push(e.to); } }
  if (!prev.has(b)) return [];
  const steps = []; for (let i = b; prev.get(i); i = prev.get(i).from) steps.unshift(prev.get(i));
  const pts = [];
  steps.forEach(s => {
    const door = W3.edge[s.k], tk = W3.rooms[s.from].tarik.slice().sort((p, q2) => p.distanceTo(door) - q2.distanceTo(door))[0];
    if (tk && tk.distanceTo(door) > 0.6) pts.push(tk.clone());
    pts.push(door.clone());
  });
  const end = W3.rooms[b];
  if (end.tarik.length) pts.push(end.tarik[0].clone());
  pts.push(end.c.clone());
  return pts;
}
function arrive(b) {
  if (b.state === 'masuk') {
    b.cur = b.lmb.gid;
    if (b.home) { b.state = 'dalam'; b.goal = b.home.gid; b.path = route(b.cur, b.goal); if (!b.path.length) settle(b, b.cur); return; }
    if (Math.random() < 0.5) { b.state = 'putar'; b.t = rnd(2, 5); b.pc = W3.rooms[b.cur].c; b.pr = rnd(0.6, 1.3); return; }   // mutar dulu di void
    b.state = 'dalam'; b.goal = pickRoom(b.cur); b.path = route(b.cur, b.goal);
    if (!b.path.length) settle(b, b.cur);
  } else if (b.state === 'dalam') settle(b, b.goal);
  else if (b.state === 'keluar') toOutside(b);
}
function settle(b, gid) {   // sampai di ruang: lama tinggal menurut kenyamanannya
  const r = W3.rooms[gid]; b.cur = gid; b.state = 'hinggap'; b.room = r;
  if (b.home && gid === b.home.gid) { b.perch = b.home.pos.clone(); b.t = rnd(60, 180); return; }   // penghuni: menetap di sarangnya
  const lv = r.info.level;
  b.t = lv === 'nyaman' ? rnd(10, 22) : lv === 'kurang' ? rnd(4, 7) : lv === 'tidak' ? rnd(1.2, 2.5) : rnd(2, 4);
  b.perch = lv === 'nyaman' && Math.random() < 0.7 ? r.c.clone().add(new THREE.Vector3(rnd(-0.35, 0.35), 0.2, rnd(-0.35, 0.35))) : null;
}
function leaveRoom(b) {
  const lv = b.room.info.level;
  if (lv === 'tidak' || lv === 'kurang') pergi++;
  if (lv === 'nyaman' && Math.random() < 0.55) { b.t = rnd(15, 30); return; }   // betah — tetap hinggap
  b.perch = null;
  if (Math.random() < 0.55) { const g = pickRoom(b.cur, b.cur); const p = route(b.cur, g); if (p.length) { b.state = 'dalam'; b.goal = g; b.path = p; return; } }
  const l = b.lmb || W3.lmbs[0]; if (!l) { toOutside(b); return; }
  b.state = 'keluar'; b.path = route(b.cur, l.gid).concat([l.inn.clone(), l.mid.clone(), l.lip.clone(), l.out.clone()]);
}
function steer(b, tgt, speed, agility, dt) {
  const des = tgt.clone().sub(b.pos), d = des.length(); if (d < 1e-4) return;
  des.multiplyScalar(Math.min(speed, d * 2.2 + 0.3) / d);
  b.vel.lerp(des, Math.min(1, dt * agility));
}
function levelAt(y) { for (let i = W3.base.length - 1; i >= 0; i--) if (y >= W3.base[i] - 0.05) return i; return 0; }
function tickBirds(dt) {
  if (!W3 || !st.burung) return;
  const hx = W3.hexPts;
  birds.forEach(b => {
    b.t -= dt;
    if (b.state === 'luar') {   // berputar di sekitar gedung & LMB, terpanggil suara hexagonal; penghuni hafal → cepat masuk
      b.ph += b.w * dt;
      const R = W3.R * (b.home ? 0.8 : b.r), tgt = new THREE.Vector3(Math.cos(b.ph) * R, W3.top + (b.home ? 1 : b.h), Math.sin(b.ph) * R);
      if (hx.length && !b.home) tgt.lerp(hx[b.k % hx.length], 0.3 + 0.25 * Math.sin(b.ph * 0.6 + b.k));
      steer(b, tgt, 7, 1.8, dt);
      if (b.home && b.t > 2) b.t = rnd(0.5, 2);
      if (b.t <= 0 && W3.lmbs.length) {
        const l = W3.lmbs[Math.floor(Math.random() * W3.lmbs.length)];
        b.lmb = l; b.state = 'masuk'; b.path = [l.out.clone(), l.lip.clone(), l.mid.clone(), l.inn.clone()];
      } else if (b.t <= 0) b.t = rnd(3, 8);
    } else if (b.state === 'putar') {   // berputar dulu di dalam void sebelum memilih ruang
      b.ph += 2.2 * dt;
      steer(b, b.pc.clone().add(new THREE.Vector3(Math.cos(b.ph) * b.pr, 0.3 * Math.sin(b.ph * 0.7), Math.sin(b.ph) * b.pr)), 3.2, 3, dt);
      if (b.t <= 0) { b.state = 'dalam'; b.goal = pickRoom(b.cur); b.path = route(b.cur, b.goal); if (!b.path.length) settle(b, b.cur); }
    } else if (b.state === 'hinggap') {
      if (b.perch) { b.vel.multiplyScalar(Math.max(0, 1 - dt * 6)); b.pos.lerp(b.perch, Math.min(1, dt * 2)); }
      else { b.ph += 2 * dt; steer(b, b.room.c.clone().add(new THREE.Vector3(Math.cos(b.ph) * b.rr, 0.08 * Math.sin(b.ph * 2), Math.sin(b.ph) * b.rr)), 2.2, 3, dt); }
      if (b.t <= 0) leaveRoom(b);
    } else {
      const p = b.path[0];
      if (!p) arrive(b);
      else { steer(b, p, b.state === 'dalam' ? 2.8 : 4.2, 5, dt); if (b.pos.distanceTo(p) < 0.3) b.path.shift(); }
    }
    b.pos.addScaledVector(b.vel, dt);
    b.lv = b.state === 'luar' ? -1 : levelAt(b.pos.y);
    b.mesh.position.copy(b.pos);
    if (b.vel.lengthSq() > 0.02) b.mesh.lookAt(b.pos.clone().add(b.vel));
    const still = b.state === 'hinggap' && b.perch;
    b.flap += dt * (still ? 0 : 20);
    const a = still ? 1.2 : Math.sin(b.flap) * 0.75;
    b.wl.rotation.z = a; b.wr.rotation.z = -a;
    b.mesh.visible = st.mode !== 'lantai' || b.lv < 0 || b.lv === last.active;
  });
}

// ---------- aliran udara: partikel bergerak melewati tiap bukaan menurut arah & debitnya ----------
function flowSetup(C, base, cum, X, Z, vis) {
  if (flow) { scene.remove(flow.pts); flow.pts.geometry.dispose(); flow.pts.material.dispose(); flow = null; }
  if (!st.udara || !C) return;
  const P = [];
  C.A.links.forEach(k => {
    const q = Math.abs(k.q); if (q < 1) return;
    if (!vis(k.li) && !(k.kind === 'void' && vis(k.li - 1))) return;
    const p = new THREE.Vector3(X(k.x), base[k.li] + (k.z - cum[k.li]), Z(k.y));
    const s = k.b < 0 ? (k.q < 0 ? 1 : -1) : k.q > 0 ? 1 : -1;   // luar: (nx, ny) = ke dalam; antar ruang: zona a → b
    const dir = k.kind === 'void' ? new THREE.Vector3(0, k.q > 0 ? -1 : 1, 0) : new THREE.Vector3(s * k.nx, 0, s * k.ny);
    const col = new THREE.Color(k.b < 0 ? (k.q < 0 ? 0x1e88e5 : 0xe53935) : 0x00a78e), n = 1 + Math.min(5, Math.round(Math.log10(1 + q) * 1.6));
    for (let j = 0; j < n; j++) P.push({ p, dir, u: j / n, v: 0.25 + 0.3 * Math.log10(1 + q), col });
  });
  if (!P.length) return;
  const g = new THREE.BufferGeometry(), pos = new Float32Array(P.length * 3), cl = new Float32Array(P.length * 3);
  P.forEach((o, i) => { cl[i * 3] = o.col.r; cl[i * 3 + 1] = o.col.g; cl[i * 3 + 2] = o.col.b; });
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(cl, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
  pts.frustumCulled = false;
  scene.add(pts);
  flow = { pts, P };
  tickFlow(0);
}
function tickFlow(dt) {
  if (!flow) return;
  const a = flow.pts.geometry.attributes.position;
  flow.P.forEach((o, i) => { o.u = (o.u + o.v * dt) % 1; const t = (o.u - 0.5) * 1.8; a.setXYZ(i, o.p.x + o.dir.x * t, o.p.y + o.dir.y * t, o.p.z + o.dir.z * t); });
  a.needsUpdate = true;
}

// ---------- matahari: arah dari posisi matahari (jam, bulan) & arah hadap gedung ----------
let W3sun = null, lightBase = null;
function sunSetup(S) {
  const sp = sunPos(S), A = ((sp.az - (+S.hadap || 0)) * Math.PI) / 180, el = (Math.max(3, sp.el) * Math.PI) / 180;
  const dir = new THREE.Vector3(Math.cos(el) * Math.sin(A), Math.sin(el), -Math.cos(el) * Math.cos(A));
  sunL.position.copy(dir.multiplyScalar(60)); sunL.target.position.set(0, 0, 0);
  const day = Math.max(0, Math.min(1, sp.el / 25)), night = sp.el <= 0, mend = S.langit === 'mendung' ? 0.45 : S.langit === 'berawan' ? 0.75 : 1;
  sunL.intensity = night ? 0.04 : (0.3 + 0.95 * day) * mend;
  sunL.color.set(0xffa860).lerp(new THREE.Color(0xffffff), day);
  hemi.intensity = night ? 0.25 : 0.5 + 0.4 * day;
  const bg = night ? new THREE.Color(0x1b2a41) : new THREE.Color(0xf1c9a5).lerp(new THREE.Color(0xe9eef4), day);
  scene.background = bg;
  lightBase = { sun: sunL.intensity, hemi: hemi.intensity, bg };
  W3sun = { jam: +S.jam, arah: night ? '' : arahNama(sp.az), el: sp.el };
}

// ---------- mode "jalan di dalam" (POV / orang ketiga; tinggi bisa diatur, naik-turun lewat tangga/LAL, bawa senter) ----------
function senterSet(on) { wk.senter = on; }
// sosok manusia sederhana (menghadap −z, titik asal di kaki, tinggi ±1 lalu diskalakan ke tinggi orang)
function personMesh() {
  const g = new THREE.Group(), mB = mat(0x2f5f8a, 0), mK = mat(0x263238, 0), mH = mat(0xd9a066, 0);
  const add = (geo, m2, y) => { const ms = new THREE.Mesh(geo, m2); ms.position.y = y; ms.castShadow = true; g.add(ms); return ms; };
  add(cached('p-kaki', () => new THREE.CylinderGeometry(0.075, 0.06, 0.44, 8)), mK, 0.22);
  add(cached('p-badan', () => new THREE.CylinderGeometry(0.11, 0.13, 0.38, 10)), mB, 0.63);
  add(cached('p-kepala', () => new THREE.SphereGeometry(0.1, 10, 8)), mH, 0.94);
  const tangan = cached('p-tangan', () => new THREE.CylinderGeometry(0.032, 0.028, 0.34, 6));
  [-0.16, 0.16].forEach(x => { const ms = add(tangan, mB, 0.62); ms.position.x = x; ms.rotation.z = x < 0 ? 0.12 : -0.12; });
  return g;
}
function walkToggle() {
  wk.on = !wk.on;
  if (wk.on) {
    wk.cam = { p: camera.position.clone(), t: controls.target.clone() };
    controls.enabled = false; camTween = null;
    const p = B3?.pintu, W = B3?.W || 8, L = B3?.L || 12;
    wk.x = p ? p.x - W / 2 : 0; wk.z = p ? p.y - L / 2 - 1.4 : -L / 2 - 1.4;
    wk.lv = 0; wk.yaw = Math.PI; wk.pitch = 0; wk.stair = null; wk.keys = {};
  } else {
    controls.enabled = true;
    if (wk.cam) { camera.position.copy(wk.cam.p); controls.target.copy(wk.cam.t); controls.update(); }
    camera.rotation.set(0, 0, 0);
    senter.intensity = 0;
    if (person) person.visible = false;
    if (lightBase) { sunL.intensity = lightBase.sun; hemi.intensity = lightBase.hemi; scene.background = lightBase.bg; }
  }
  if (sync3) sync3.visible = wk.on;
  statT = 0;
}
function tickWalk(dt) {
  if (!wk.on || !B3) return;
  const sp = wk.keys.shift ? 3 : 1.5;
  let mx = 0, mz = 0;
  if (wk.keys.w || wk.keys.arrowup) mz -= 1;
  if (wk.keys.s || wk.keys.arrowdown) mz += 1;
  if (wk.keys.a || wk.keys.arrowleft) mx -= 1;
  if (wk.keys.d || wk.keys.arrowright) mx += 1;
  if (mx || mz) {
    // maju (W) = arah pandang: kamera menghadap (−sin yaw, −cos yaw); samping = tegak lurusnya
    const n = Math.hypot(mx, mz), sy = Math.sin(wk.yaw), cy = Math.cos(wk.yaw);
    wk.x += ((mx * cy + mz * sy) / n) * sp * dt;
    wk.z += ((-mx * sy + mz * cy) / n) * sp * dt;
    wk.x = Math.max(-B3.W / 2 - 8, Math.min(B3.W / 2 + 8, wk.x));
    wk.z = Math.max(-B3.L / 2 - 8, Math.min(B3.L / 2 + 8, wk.z));
  }
  const px = wk.x + B3.W / 2, py = wk.z + B3.L / 2;
  // tangga: ramp antara alas lantai fi dan fi+1 — masuk dari ujung bawah (lantai fi) atau ujung atas (lantai fi+1)
  let y = B3.base[Math.min(wk.lv, B3.base.length - 1)] || 0;
  const on = B3.stairs.find(t => (wk.lv === t.fi || wk.lv === t.fi + 1) && px >= t.x - 0.25 && px <= t.x + t.w + 0.25 && py >= t.y - 0.25 && py <= t.y + t.h + 0.25);
  if (on) {
    const len = on.vert ? on.h : on.w, a = Math.max(0, Math.min(len, on.vert ? py - on.y : px - on.x));
    if (!wk.stair || wk.stair.t !== on) {
      const nearLow = a < len / 2;
      wk.stair = { t: on, low: wk.lv === on.fi ? (nearLow ? 0 : 1) : (nearLow ? 1 : 0) };   // ujung "bawah" ramp
    }
    const prog = Math.max(0, Math.min(1, wk.stair.low === 0 ? a / len : 1 - a / len));
    y = B3.base[on.fi] + prog * B3.hts[on.fi];
    if (prog >= 0.97) wk.lv = on.fi + 1;
    else if (prog <= 0.03) wk.lv = on.fi;
  } else wk.stair = null;
  const fx = -Math.sin(wk.yaw), fz = -Math.cos(wk.yaw);   // arah pandang mendatar
  if (!person) { person = personMesh(); scene.add(person); }
  person.visible = wk.tps;
  if (wk.tps) {   // orang ketiga: sosok berjalan, kamera mengikuti dari belakang-atas
    person.position.set(wk.x, y, wk.z);
    person.rotation.y = wk.yaw + Math.PI;
    person.scale.setScalar(Math.max(1.3, wk.h + 0.1));
    const d = 3.1, up = 1.35;
    camera.position.set(wk.x - fx * d, y + wk.h + up - Math.sin(wk.pitch) * 2, wk.z - fz * d);
    camera.lookAt(wk.x + fx * 1.6, y + wk.h * 0.75, wk.z + fz * 1.6);
  } else {
    camera.position.set(wk.x, y + wk.h, wk.z);
    camera.rotation.order = 'YXZ'; camera.rotation.set(wk.pitch, wk.yaw, 0);
  }
  // gelap seperti aslinya: cahaya mengikuti lux di posisi (di luar gedung = terang); senter menembus gelap
  const luar = px < -0.2 || px > B3.W + 0.2 || py < -0.2 || py > B3.L + 0.2 || y > B3.top - 0.1;
  const q = !luar && W3?.at ? W3.at(Math.min(wk.lv, B3.base.length - 1), px, py) : null;
  wk.lux = luar ? null : q ? q.lux : 0;
  const k = luar ? 1 : Math.max(0.05, Math.min(1, 0.06 + (wk.lux ?? 3) / 40));
  if (lightBase) {
    sunL.intensity = lightBase.sun * k;
    hemi.intensity = lightBase.hemi * Math.max(0.1, k);
    scene.background = lightBase.bg.clone().multiplyScalar(Math.max(0.18, k));
  }
  senter.intensity = wk.senter ? (k < 0.6 ? 6 : 2.2) : 0;
}
function legendSet() {
  const rows = [['#3a3f45', 'Sekat terpal'], ['#b3a08c', 'Sekat bata'], ['#8a5a2b', 'Papan sirip'], ['#378add', 'Void / kolam'], ['#d85a30', 'LMB'], ['#534ab7', 'Tweeter inap'], ['#c62828', 'Tweeter tarik'], ['#6a1b9a', 'Hexagonal'], ['#2E7D32', 'Sarang jadi · <span style="color:#F9A825">polesan</span> · <span style="color:#C62828">baru</span>']];
  if (st.peta === 'nyaman') rows.push([TINGKAT.nyaman, 'Nyaman'], [TINGKAT.kurang, 'Kurang nyaman'], [TINGKAT.tidak, 'Tidak nyaman']);
  if (st.udara) rows.push(['#1e88e5', 'Udara luar masuk'], ['#e53935', 'Udara keluar'], ['#00a78e', 'Antar ruang']);
  legend.innerHTML = rows.map(([c, n]) => `<div><b style="background:${c}"></b>${n}</div>`).join('') + '<div style="margin-top:4px">Seret = putar · Scroll = zoom</div>';
}
function statSet() {
  if (wk.on) {
    const lv = B3 ? Math.min(wk.lv, B3.base.length - 1) : 0;
    const lux = wk.lux == null ? 'di luar (terang)' : wk.lux < 0.01 ? '< 0,01 lux — gelap pekat' : `±${(wk.lux < 10 ? wk.lux.toFixed(1) : Math.round(wk.lux)).toString().replace('.', ',')} lux`;
    statBox.innerHTML = `🚶 <b>Mode jalan${wk.tps ? ' · orang ketiga' : ''}</b> · ${last ? levels(last.model)[lv]?.name || '' : ''} · ${lux}`
      + `<br>WASD / panah = jalan · seret = menoleh · naik-turun lewat tangga / lubang LAL · T = senter · Esc = keluar`
      + `<br>Tinggi orang <button type="button" data-wkh="-">−</button> <b>${wk.h.toFixed(2).replace('.', ',')} m</b> <button type="button" data-wkh="+">+</button>`
      + ` · garis oranye menyala = rantai tweeter tarik sinkron`;
    statBox.hidden = false;
    return;
  }
  const parts = [];
  if (W3sun) parts.push(`☀ Pukul ${String(Math.floor(W3sun.jam)).padStart(2, '0')}.${W3sun.jam % 1 ? '30' : '00'}${W3sun.arah ? ` · matahari dari ${W3sun.arah}` : ' · malam'}`);
  if (st.burung && birds.length) {
    const n = s => birds.filter(b => b.state === s).length, ph = birds.filter(b => b.home).length;
    parts.push(`<b>${birds.length} walet</b>${ph ? ` (${ph} penghuni)` : ''}: ${n('luar')} di luar · ${n('masuk') + n('dalam') + n('keluar') + n('putar')} terbang di dalam · ${n('hinggap')} di ruang${pergi ? ` · ${pergi}× meninggalkan ruang tidak nyaman` : ''}${W3 && !W3.lmbs.length ? ' · <b>belum ada LMB di dinding luar</b>' : ''}`);
  }
  statBox.innerHTML = parts.join('<br>');
  statBox.hidden = !parts.length;
}

// ---------- kamera: 3D / atas / depan / belakang / kiri / kanan ----------
function camPreset(anim) {
  if (!last) return;
  const { model, active } = last, LV = levels(model), hts = LV.map(fl => floorHt(model, fl)), gap = st.mode === 'terurai' ? GAP : 0;
  const H = hts.reduce((a, b) => a + b, 0) + gap * (LV.length - 1), a = Math.min(active, LV.length - 1);
  const yb = st.mode === 'lantai' ? hts.slice(0, a).reduce((p, q) => p + q, 0) : 0, yc = st.mode === 'lantai' ? yb + hts[a] / 2 : H / 2;
  const span = Math.max(model.w, model.h, st.mode === 'lantai' ? 4 : H), R = span * 1.3 + 3;
  const P = { iso: [R * 0.72, yc + R * 0.6, R * 0.88], atas: [0, yc + R * 1.25, 0.01], depan: [0, yc + R * 0.1, -R * 1.1], belakang: [0, yc + R * 0.1, R * 1.1], kiri: [-R * 1.1, yc + R * 0.1, 0], kanan: [R * 1.1, yc + R * 0.1, 0] }[st.view] || [R, R, R];
  const to = new THREE.Vector3(...P), tg = new THREE.Vector3(0, yc, 0);
  if (anim) camTween = { p0: camera.position.clone(), p1: to, t0: controls.target.clone(), t1: tg, k: 0 };
  else { camTween = null; camera.position.copy(to); controls.target.copy(tg); controls.update(); }
}
function tickCam(dt) {
  if (!camTween) return;
  const c = camTween; c.k = Math.min(1, c.k + dt / 0.7);
  const e = c.k < 0.5 ? 2 * c.k * c.k : 1 - (-2 * c.k + 2) ** 2 / 2;
  camera.position.lerpVectors(c.p0, c.p1, e); controls.target.lerpVectors(c.t0, c.t1, e);
  if (c.k >= 1) camTween = null;
}

export function show() {
  host.hidden = false;
  resize();
  cancelAnimationFrame(raf);
  tPrev = performance.now();
  const loop = t => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, Math.max(0, (t - tPrev) / 1000)); tPrev = t;
    tickCam(dt); tickBirds(dt); tickFlow(dt); tickWalk(dt);
    if (!wk.on) controls.update();
    renderer.render(scene, camera); updateTags();
    if ((statT -= dt) <= 0) { statT = 0.6; statSet(); }
  };
  raf = requestAnimationFrame(loop);
}
export function hide() { cancelAnimationFrame(raf); host.hidden = true; }
// Majukan simulasi burung & udara sekian detik tanpa menggambar (uji, atau saat tab browser tidak aktif).
export function advance(sec, dt = 0.05) { for (let t = 0; t < sec; t += dt) { tickBirds(dt); tickFlow(dt); } statSet(); return birds.map(b => b.state); }
export function snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); }
// Render sekali pada ukuran tetap (juga saat panel 3D tersembunyi), lalu kembalikan ukuran semula.
export function snapshotAt(w = 1280, h = 960) {
  const prev = renderer.getSize(new THREE.Vector2()), prevAspect = camera.aspect;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  controls.update(); renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  renderer.setSize(Math.max(1, prev.x), Math.max(1, prev.y), false); camera.aspect = prevAspect; camera.updateProjectionMatrix();
  return url;
}
// Gambar 3D bersih untuk lembar desain: semua lantai, sudut 3D, tanpa burung / peta / udara; tampilan pengguna dikembalikan.
export function snapshotSheet(model, w = 1280, h = 960) {
  const keep = { ...st }, prev = last, cam = [camera.position.clone(), controls.target.clone()];
  Object.assign(st, { view: 'iso', mode: 'semua', burung: false, peta: '', udara: false });
  camKey = ''; build(model, model.floors.length - 1);
  flock.visible = false; tagBox.hidden = true;
  const url = snapshotAt(w, h);
  Object.assign(st, keep); camKey = '';
  if (prev) build(prev.model, prev.active, prev.opts);
  camera.position.copy(cam[0]); controls.target.copy(cam[1]); controls.update();
  tagBox.hidden = false; renderBar();
  return url;
}
