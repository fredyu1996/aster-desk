/* ================= 3D WORLD ================= */
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({canvas, antialias: true, powerPreference: 'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3;
const MAXANI = renderer.capabilities.getMaxAnisotropy();
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04060c);
scene.fog = new THREE.Fog(0x04060c, 24, 48);
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.05, 120);
camera.rotation.order = 'YXZ';
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const mat = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({color: c, roughness: .7, metalness: .1}, o));
const glow = c => new THREE.MeshBasicMaterial({color: c, toneMapped: false});
function box(w, h, d, m, x = 0, y = 0, z = 0, parent = scene) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); parent.add(o); return o; }
function canvasTex(w, h) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const ctx = cv.getContext('2d'); const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding; tex.anisotropy = MAXANI; return {cv, ctx, tex, W: w, H: h}; }
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

const RX = 15, RZ = 10, RH = 4.4;   // room half-sizes & height
const solids = [];
const fontRedraws = [];             // canvases to repaint once web fonts arrive                   // world-space AABBs [minX,minZ,maxX,maxZ]

/* ---- lights ---- */
scene.add(new THREE.HemisphereLight(0x7080b8, 0x0a0a14, 0.75));
scene.add(new THREE.AmbientLight(0x1a2240, 0.35));
for (const [x, z] of [[-8, 2], [8, 2], [0, -5], [0, 6]]) { const p = new THREE.PointLight(0xbfd2ff, 0.55, 16, 2); p.position.set(x, RH - 0.3, z); scene.add(p); }
const boardLight = new THREE.PointLight(0x4f7cff, 0.9, 12, 2); boardLight.position.set(0, 2.6, -7.5); scene.add(boardLight);

/* ---- floor ---- */
{
  const T = canvasTex(1536, 1024), c = T.ctx;
  c.fillStyle = '#0a0f1c'; c.fillRect(0, 0, 1536, 1024);
  for (let i = 0; i < 30; i++) for (let j = 0; j < 20; j++) { c.fillStyle = (i + j) % 2 ? '#0b111f' : '#0c1222'; c.fillRect(i * 51.2, j * 51.2, 51.2, 51.2); }
  c.strokeStyle = 'rgba(80,110,180,.16)'; c.lineWidth = 2;
  for (let i = 0; i <= 30; i++) { c.beginPath(); c.moveTo(i * 51.2, 0); c.lineTo(i * 51.2, 1024); c.stroke(); }
  for (let j = 0; j <= 20; j++) { c.beginPath(); c.moveTo(0, j * 51.2); c.lineTo(1536, j * 51.2); c.stroke(); }
  T.tex.needsUpdate = true;
  const f = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2, RZ * 2), mat(0xffffff, {map: T.tex, roughness: .45, metalness: .35}));
  f.rotation.x = -Math.PI / 2; scene.add(f);
  // walkway glow line toward board
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 13), new THREE.MeshBasicMaterial({color: 0x2a4a99, transparent: true, opacity: .5}));
  lane.rotation.x = -Math.PI / 2; lane.position.set(0, 0.005, 2.5); scene.add(lane);
}
/* ---- ceiling ---- */
{
  const c = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2, RZ * 2), mat(0x080c16, {roughness: .9}));
  c.rotation.x = Math.PI / 2; c.position.y = RH; scene.add(c);
  for (const z of [-6, -2, 2, 6]) for (const x of [-9, 0, 9]) box(5, 0.04, 0.22, glow(0xcfe0ff), x, RH - 0.03, z);
}
/* ---- walls ---- */
const wallM = mat(0x0c1222, {roughness: .85});
box(RX * 2, RH, 0.3, wallM, 0, RH / 2, -RZ - 0.15);           // north
box(RX * 2, RH, 0.3, wallM, 0, RH / 2, RZ + 0.15);            // south
box(0.3, RH, RZ * 2, wallM, -RX - 0.15, RH / 2, 0);           // west
// east = position wall (was a window): the Trader's open positions, each beside its live chart
box(0.3, RH, RZ * 2, wallM, RX + 0.15, RH / 2, 0);
const WALL_W = 15, WALL_H = 2.8, WALL_Z = -1.2;
const WALL = canvasTex(3200, Math.round(3200 * WALL_H / WALL_W));
{
  const fr = mat(0x05070d, {metalness: .7, roughness: .3});
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, WALL_H + 0.36, WALL_W + 0.36), fr); b.position.set(RX - 0.08, 2.3, WALL_Z); scene.add(b);
  for (const y of [2.3 + WALL_H / 2 + 0.19, 2.3 - WALL_H / 2 - 0.19]) box(0.14, 0.04, WALL_W + 0.36, glow(0xffd166), RX - 0.1, y, WALL_Z);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(WALL_W, WALL_H), new THREE.MeshBasicMaterial({map: WALL.tex, toneMapped: false, fog: false}));
  m.rotation.y = -Math.PI / 2; m.position.set(RX - 0.15, 2.3, WALL_Z); scene.add(m);
  const wl = new THREE.PointLight(0xffd166, 0.45, 9, 2); wl.position.set(RX - 2.5, 2.4, WALL_Z); scene.add(wl);
}
solids.push([-RX - 1, -RZ - 1, RX + 1, -RZ + 0.35], [-RX - 1, RZ - 0.35, RX + 1, RZ + 1], [-RX - 1, -RZ, -RX + 0.35, RZ], [RX - 0.35, -RZ, RX + 1, RZ]);

/* ---- market wall (big board) ---- */
const BOARD = canvasTex(2400, 640);
{
  box(13.4, 3.85, 0.12, mat(0x05070d, {metalness: .7, roughness: .3}), 0, 2.45, -RZ + 0.08);
  box(13.4, 0.04, 0.14, glow(0x4f7cff), 0, 4.39, -RZ + 0.1); box(13.4, 0.04, 0.14, glow(0x4f7cff), 0, 0.51, -RZ + 0.1);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(13, 13 * 640 / 2400), new THREE.MeshBasicMaterial({map: BOARD.tex, toneMapped: false, fog: false}));
  m.position.set(0, 2.62, -RZ + 0.15); scene.add(m);
}
/* ---- north wall, left of the movers board: Trader vs SMC Trader return race ---- */
const RACE_W = 5.6, RACE_H = 3.2, RACE_X = -10.6, RACE_Y = 2.6;
const RACE = canvasTex(1600, Math.round(1600 * RACE_H / RACE_W));
{
  const b = new THREE.Mesh(new THREE.BoxGeometry(RACE_W + 0.3, RACE_H + 0.3, 0.12), mat(0x05070d, {metalness: .7, roughness: .3})); b.position.set(RACE_X, RACE_Y, -RZ + 0.08); scene.add(b);
  box(RACE_W + 0.3, 0.04, 0.14, glow(0xffd166), RACE_X, RACE_Y + RACE_H / 2 + 0.15, -RZ + 0.1); box(RACE_W + 0.3, 0.04, 0.14, glow(0xff8ad8), RACE_X, RACE_Y - RACE_H / 2 - 0.15, -RZ + 0.1);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(RACE_W, RACE_H), new THREE.MeshBasicMaterial({map: RACE.tex, toneMapped: false, fog: false}));
  m.position.set(RACE_X, RACE_Y, -RZ + 0.15); scene.add(m);
}
const TICKER = canvasTex(4096, 80);
TICKER.tex.wrapS = THREE.RepeatWrapping;
{
  const m = new THREE.Mesh(new THREE.PlaneGeometry(13, 0.26), new THREE.MeshBasicMaterial({map: TICKER.tex, toneMapped: false, fog: false}));
  m.position.set(0, 0.72, -RZ + 0.16); scene.add(m);
}
/* ---- west wall: neon sign + review wall (Reviewer's verdicts on the chart, rules in force) ---- */
{
  const T = canvasTex(1024, 256), c = T.ctx;
  const neon = () => { c.clearRect(0, 0, 1024, 256);
  c.font = '800 120px Inter, sans-serif'; c.textBaseline = 'middle'; c.shadowColor = '#4f7cff'; c.shadowBlur = 30;
  c.fillStyle = '#cfe0ff'; c.fillText('ASTER', 40, 128); const w = c.measureText('ASTER ').width; c.fillStyle = '#6aa8ff'; c.fillText('DESK', 40 + w, 128);
  T.tex.needsUpdate = true; }; neon(); fontRedraws.push(neon);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({map: T.tex, transparent: true, toneMapped: false}));
  m.rotation.y = Math.PI / 2; m.position.set(-RX + 0.02, 3.1, -6.6); scene.add(m);
}
const RWALL_W = 12, RWALL_H = 2.7, RWALL_Z = 2.6;
const RWALL = canvasTex(3200, Math.round(3200 * RWALL_H / RWALL_W));
{
  const fr = mat(0x05070d, {metalness: .7, roughness: .3});
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, RWALL_H + 0.36, RWALL_W + 0.36), fr); b.position.set(-RX + 0.08, 2.3, RWALL_Z); scene.add(b);
  for (const y of [2.3 + RWALL_H / 2 + 0.19, 2.3 - RWALL_H / 2 - 0.19]) box(0.14, 0.04, RWALL_W + 0.36, glow(0xc5f05a), -RX + 0.1, y, RWALL_Z);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(RWALL_W, RWALL_H), new THREE.MeshBasicMaterial({map: RWALL.tex, toneMapped: false, fog: false}));
  m.rotation.y = Math.PI / 2; m.position.set(-RX + 0.15, 2.3, RWALL_Z); scene.add(m);
  const wl = new THREE.PointLight(0xc5f05a, 0.35, 9, 2); wl.position.set(-RX + 2.5, 2.4, RWALL_Z); scene.add(wl);
}
/* ---- south (back) wall: the SMC Trader's open positions, each beside its live chart ---- */
const SWALL_W = 13, SWALL_H = 2.7, SWALL_X = -3, SWALL_Y = 2.5;
const SWALL = canvasTex(3200, Math.round(3200 * SWALL_H / SWALL_W));
{
  const fr = mat(0x1a2236, {metalness: .6, roughness: .4});
  const b = new THREE.Mesh(new THREE.BoxGeometry(SWALL_W + 0.36, SWALL_H + 0.36, 0.12), fr); b.position.set(SWALL_X, SWALL_Y, RZ - 0.08); scene.add(b);
  for (const y of [SWALL_Y + SWALL_H / 2 + 0.19, SWALL_Y - SWALL_H / 2 - 0.19]) box(SWALL_W + 0.36, 0.04, 0.14, glow(0xff8ad8), SWALL_X, y, RZ - 0.1);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(SWALL_W, SWALL_H), new THREE.MeshBasicMaterial({map: SWALL.tex, toneMapped: false, fog: false}));
  m.rotation.y = Math.PI; m.position.set(SWALL_X, SWALL_Y, RZ - 0.15); scene.add(m);
  const wl = new THREE.PointLight(0xff8ad8, 0.35, 9, 2); wl.position.set(SWALL_X, 2.4, RZ - 2.5); scene.add(wl);
}
/* ---- decor: plants, sofa, server rack ---- */
function plant(x, z) {
  box(0.5, 0.55, 0.5, mat(0x1a2236, {metalness: .5}), x, 0.275, z);
  const leaf = mat(0x1f6b4a, {roughness: .8, emissive: 0x05140c});
  for (let i = 0; i < 5; i++) { const l = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32 + Math.random() * .12, 0), leaf); l.position.set(x + (Math.random() - .5) * .3, 0.85 + i * 0.22, z + (Math.random() - .5) * .3); scene.add(l); }
  solids.push([x - .35, z - .35, x + .35, z + .35]);
}
plant(-RX + 0.8, -RZ + 0.8); plant(RX - 0.8, -RZ + 0.8); plant(-RX + 0.8, RZ - 0.8);
{ // sofa
  const sm = mat(0x24305a, {roughness: .9}); const x = -12.6, z = 6.5;
  box(1, 0.45, 3, sm, x, 0.225, z); box(0.3, 0.9, 3, sm, x - 0.45, 0.45, z); box(1, 0.6, 0.3, sm, x, 0.3, z - 1.5); box(1, 0.6, 0.3, sm, x, 0.3, z + 1.5);
  box(0.9, 0.35, 1.4, mat(0x111827, {metalness: .5}), x + 1.6, 0.175, z);
  solids.push([x - 0.7, z - 1.7, x + 2.1, z + 1.7]);
}
const LEDS = [];
{ // server rack = the data engine
  const x = 13.4, z = 8.2;
  box(1.6, 2.2, 0.9, mat(0x0a0e18, {metalness: .6, roughness: .35}), x, 1.1, z);
  for (let r = 0; r < 14; r++) for (let c = 0; c < 6; c++) {
    const m = glow(0x2ee59d); const l = box(0.06, 0.03, 0.01, m, x - 0.5 + c * 0.2, 0.3 + r * 0.13, z - 0.455); LEDS.push(l);
  }
  solids.push([x - 0.9, z - 0.55, x + 0.9, z + 0.55]);
}

/* ---- desks & agents ---- */
const DESK_POS = {ivy: [-6.4, -4.2], scout: [0, -2.2], flo: [6.4, -4.2], trader: [9.6, 4.4], rev: [4.4, 6.9], smc: [6.6, 2.0]};
const desks = [];
function makeMonitor(w, h, parent, x, y, z, ry) {
  const T = canvasTex(800, Math.round(800 * h / w));
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g);
  box(w + 0.05, h + 0.05, 0.04, mat(0x0b0f18, {metalness: .6, roughness: .4}), 0, 0, -0.025, g);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({map: T.tex, toneMapped: false})); s.position.z = 0.002; g.add(s);
  const sh = (y - h / 2) - 0.78 + 0.1; box(0.06, sh, 0.06, mat(0x161d2e, {metalness: .7}), 0, -h / 2 - sh / 2 + 0.1, -0.06, g);
  return T;
}
function labelSprite(agent) {
  const T = canvasTex(512, 132), c = T.ctx;
  const draw = () => { c.clearRect(0, 0, 512, 132);
  c.fillStyle = 'rgba(6,10,20,.85)'; rr(c, 4, 4, 504, 124, 26); c.fill(); c.strokeStyle = agent.color; c.lineWidth = 4; c.stroke();
  c.fillStyle = agent.color; let fz = 54; do { c.font = `800 ${fz}px Inter, sans-serif`; fz -= 2; } while (c.measureText(agent.name).width > 390 && fz > 28); c.fillText(agent.name, 28, 62);
  c.fillStyle = '#aab6d4'; c.font = '500 28px Inter, sans-serif'; c.fillText(agent.role, 28, 104);
  c.fillStyle = '#56627f'; c.font = '700 30px JetBrains Mono, monospace'; c.textAlign = 'right'; c.fillText('[' + agent.key + ']', 484, 62); c.textAlign = 'left';
  T.tex.needsUpdate = true; };
  draw(); fontRedraws.push(draw);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: T.tex, depthWrite: false, toneMapped: false})); sp.scale.set(1.25, 0.32, 1);
  return {sp, T, agent};
}
function bubbleSprite() {
  const T = canvasTex(1024, 220);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({map: T.tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false})); sp.scale.set(2.5, 0.54, 1); sp.visible = false; sp.renderOrder = 10;
  return {sp, T, until: 0};
}
function drawBubble(B, text, color) {
  const c = B.T.ctx; c.clearRect(0, 0, 1024, 220);
  c.font = '600 38px Inter, sans-serif';
  const words = String(text).split(' '), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (c.measureText(t).width > 920 && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur); lines.length = Math.min(lines.length, 3);
  const h = 30 + lines.length * 48, y0 = 180 - h;
  c.fillStyle = 'rgba(8,12,24,.93)'; rr(c, 6, y0, 1012, h, 24); c.fill(); c.strokeStyle = color; c.lineWidth = 4; c.stroke();
  c.beginPath(); c.moveTo(480, y0 + h); c.lineTo(512, 214); c.lineTo(544, y0 + h); c.closePath(); c.fillStyle = 'rgba(8,12,24,.93)'; c.fill();
  c.fillStyle = '#e8eeff'; lines.forEach((l, i) => c.fillText(l, 36, y0 + 52 + i * 48));
  B.T.tex.needsUpdate = true;
}
function makeAgent(color) {
  const g = new THREE.Group();
  const body = mat(color, {roughness: .4, metalness: .35, emissive: new THREE.Color(color).multiplyScalar(.12)});
  const dark = mat(0x161d2e, {roughness: .6, metalness: .45});
  box(0.38, 0.14, 0.46, dark, 0, 0.53, -0.18, g);              // thighs
  box(0.34, 0.46, 0.13, dark, 0, 0.28, -0.4, g);               // shins
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.3, 6, 14), body); torso.position.set(0, 0.92, 0.02); torso.rotation.x = -0.08; g.add(torso);
  box(0.42, 0.06, 0.26, dark, 0, 0.72, 0.02, g);                // belt
  const head = new THREE.Group(); head.position.set(0, 1.33, 0); g.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.165, 28, 18), mat(0xe3e9f7, {roughness: .3, metalness: .25})));
  const visor = box(0.25, 0.075, 0.09, glow(color), 0, 0.02, -0.125, head);
  const ant = box(0.015, 0.14, 0.015, dark, 0.08, 0.2, 0, head); const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), glow(color)); tip.position.set(0.08, 0.28, 0); head.add(tip);
  const arms = [];
  for (const sx of [-1, 1]) {
    const p = new THREE.Group(); p.position.set(sx * 0.26, 1.1, 0); g.add(p);
    box(0.09, 0.09, 0.5, body, 0, 0, -0.24, p); const hand = box(0.1, 0.06, 0.1, dark, 0, 0, -0.5, p);
    p.rotation.x = -0.62; p.rotation.y = sx * 0.12; arms.push(p);
  }
  return {g, head, arms, visor, tip};
}
for (const a of AGENTS) {
  const [x, z] = DESK_POS[a.id];
  const grp = new THREE.Group(); grp.position.set(x, 0, z);
  const [tx, tz] = a.id === 'trader' || a.id === 'rev' || a.id === 'smc' ? [RX, WALL_Z] : [0, -12]; grp.rotation.y = Math.atan2(-(tx - x), -(tz - z)); scene.add(grp);
  const big = a.id === 'scout', W = big ? 3.4 : 2.5;
  const top = mat(0x121a2e, {metalness: .55, roughness: .35});
  box(W, 0.06, 0.95, top, 0, 0.75, 0, grp);
  box(W, 0.02, 0.02, glow(a.color), 0, 0.73, 0.48, grp);
  for (const sx of [-1, 1]) box(0.06, 0.72, 0.85, mat(0x0d1322, {metalness: .6}), sx * (W / 2 - 0.05), 0.36, 0, grp);
  box(0.5, 0.02, 0.16, mat(0x1b2338), 0, 0.79, 0.22, grp);   // keyboard
  // monitors
  const mons = [];
  if (big) {
    mons.push(makeMonitor(1.0, 0.56, grp, -1.12, 1.17, -0.18, 0.36));
    mons.push(makeMonitor(1.3, 0.73, grp, 0, 1.24, -0.3, 0));
    mons.push(makeMonitor(1.0, 0.56, grp, 1.12, 1.17, -0.18, -0.36));
  } else {
    mons.push(makeMonitor(1.0, 0.56, grp, -0.54, 1.18, -0.24, 0.16));
    mons.push(makeMonitor(1.0, 0.56, grp, 0.54, 1.18, -0.24, -0.16));
  }
  // chair
  const cm = mat(0x1a2236, {roughness: .8});
  box(0.52, 0.08, 0.5, cm, 0, 0.46, 0.92, grp); box(0.52, 0.62, 0.07, cm, 0, 0.82, 1.18, grp);
  box(0.05, 0.42, 0.05, mat(0x30384d, {metalness: .8}), 0, 0.21, 0.92, grp);
  // agent
  const ag = makeAgent(a.color); ag.g.position.set(0, 0, 0.92); grp.add(ag.g);
  const lab = labelSprite(a); lab.sp.position.set(0, 1.98, 0.92); grp.add(lab.sp);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), glow(a.color)); orb.position.set(0, 2.24, 0.92); grp.add(orb);
  const bub = bubbleSprite(); bub.sp.position.set(0, 2.62, 0.92); grp.add(bub.sp);
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.0, 2.06, 72), new THREE.MeshBasicMaterial({color: a.color, transparent: true, opacity: .35, side: THREE.DoubleSide}));
  ring.rotation.x = -Math.PI / 2; ring.position.set(0, 0.01, 0.35); grp.add(ring);
  const pl = new THREE.PointLight(new THREE.Color(a.color), 0.55, 5, 2); pl.position.set(0, 2.1, 0.6); grp.add(pl);
  grp.updateMatrixWorld(true);
  const hit = new THREE.Vector3(0, 1.0, 0.35).applyMatrix4(grp.matrixWorld);
  desks.push({a, grp, mons, ag, lab, orb, bub, ring, hit, W, inv: new THREE.Matrix4().copy(grp.matrixWorld).invert(), pulse: 0, look: 0});
}

/* ---- movement / collisions ---- */
const P = {x: 0, z: 8, yaw: 0, pitch: -0.04, vx: 0, vz: 0, bob: 0};
const keys = {};
function collide(nx, nz) {
  const r = 0.32;
  nx = clamp(nx, -RX + 0.35 + r, RX - 0.35 - r); nz = clamp(nz, -RZ + 0.35 + r, RZ - 0.35 - r);
  for (const b of solids) {
    if (nx > b[0] - r && nx < b[2] + r && nz > b[1] - r && nz < b[3] + r) {
      const dl = nx - (b[0] - r), dr = (b[2] + r) - nx, dt = nz - (b[1] - r), db = (b[3] + r) - nz, m = Math.min(dl, dr, dt, db);
      if (m === dl) nx = b[0] - r; else if (m === dr) nx = b[2] + r; else if (m === dt) nz = b[1] - r; else nz = b[3] + r;
    }
  }
  const v = new THREE.Vector3();
  for (const d of desks) { // oriented rectangle in desk-local space: desk + chair
    v.set(nx, 0, nz).applyMatrix4(d.inv);
    const hx = d.W / 2 + r, z0 = -0.55 - r, z1 = 1.3 + r;
    if (v.x > -hx && v.x < hx && v.z > z0 && v.z < z1) {
      const dl = v.x + hx, dr = hx - v.x, dt = v.z - z0, db = z1 - v.z, m = Math.min(dl, dr, dt, db);
      if (m === dl) v.x = -hx; else if (m === dr) v.x = hx; else if (m === dt) v.z = z0; else v.z = z1;
      v.applyMatrix4(d.grp.matrixWorld); nx = v.x; nz = v.z;
    }
  }
  return [nx, nz];
}
function teleportTo(d) {
  const p = new THREE.Vector3(0, 0, 3.0).applyMatrix4(d.grp.matrixWorld);
  P.x = p.x; P.z = p.z; P.vx = P.vz = 0;
  const dx = d.hit.x - P.x, dz = d.hit.z - P.z; P.yaw = Math.atan2(-dx, -dz); P.pitch = -0.12;
}
