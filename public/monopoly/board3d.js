// 3D Monopoly board: the printed board on a wooden base, metal game tokens,
// little houses and hotels, owner markers, flying coins and a pair of dice.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { drawBoard, SIDE, spaceRect, tokenSpot } from './board-art.js';
import { coinCanvas } from './token-art.js';

let deckTheme = 'classic';

const B = window.TycoonBoard;
const H = SIDE / 2;
const toWorld = (p) => new THREE.Vector3(p.x - H, 0, p.y - H);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function boardTexture() {
  const size = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  drawBoard(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function dieFace(n) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fbfaf5';
  ctx.fillRect(0, 0, 128, 128);
  const pips = { 1: [[64, 64]], 2: [[34, 34], [94, 94]], 3: [[34, 34], [64, 64], [94, 94]], 4: [[34, 34], [94, 34], [34, 94], [94, 94]], 5: [[34, 34], [94, 34], [64, 64], [34, 94], [94, 94]], 6: [[34, 30], [94, 30], [34, 64], [94, 64], [34, 98], [94, 98]] };
  ctx.fillStyle = '#b3261e';
  pips[n].forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fill();
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
const UP_ROT = {
  1: new THREE.Euler(0, 0, 0),
  6: new THREE.Euler(Math.PI, 0, 0),
  3: new THREE.Euler(0, 0, Math.PI / 2),
  4: new THREE.Euler(0, 0, -Math.PI / 2),
  2: new THREE.Euler(-Math.PI / 2, 0, 0),
  5: new THREE.Euler(Math.PI / 2, 0, 0),
};

// ---------------------------------------------------------------------------
// Token models (all about 0.45 tall, facing +x)
// ---------------------------------------------------------------------------


// Player pieces are coin standees: a big picture coin on a small stand in the
// player's colour, turned to face the camera every frame.
const COIN_R = 0.34;
const coinTextures = new Map();
function coinTexture(kind, color) {
  const key = `${kind}|${color}`;
  if (!coinTextures.has(key)) {
    const tex = new THREE.CanvasTexture(coinCanvas(kind, color, 512));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    coinTextures.set(key, tex);
  }
  return coinTextures.get(key);
}

function tokenModel(kind, color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.5, roughness: 0.25, clearcoat: 1 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.05, 32), paint);
  base.position.y = 0.025;
  base.castShadow = true;
  g.add(base);
  // Glowing ring in the player's colour.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.24, 0.32, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false })
  );
  ring.position.y = 0.006;
  g.add(ring);
  g.userData.ring = ring;
  // A chunky 3D coin: ridged metal edge in the player's colour, raised rims,
  // and the picture set into both faces.
  const T = 0.1;
  const metal = new THREE.MeshPhysicalMaterial({ color, metalness: 0.85, roughness: 0.22, clearcoat: 0.6 });
  const edgeGeo = new THREE.CylinderGeometry(COIN_R, COIN_R, T, 120, 1, true);
  const pos = edgeGeo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const k = 1 + Math.sin(Math.atan2(z, x) * 60) * 0.012;
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  edgeGeo.computeVertexNormals();
  const edge = new THREE.Mesh(edgeGeo, metal);
  edge.rotation.x = Math.PI / 2;
  // The picture is unlit so it keeps its true colours under the table lights.
  const tex = coinTexture(kind, color);
  const faceMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const coin = new THREE.Group();
  coin.add(edge);
  [1, -1].forEach((side) => {
    const faceDisc = new THREE.Mesh(new THREE.CircleGeometry(COIN_R * 0.96, 64), faceMat);
    faceDisc.position.z = side * (T / 2 - 0.004);
    if (side < 0) faceDisc.rotation.y = Math.PI;
    coin.add(faceDisc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(COIN_R * 0.965, 0.02, 12, 72), metal);
    rim.position.z = side * (T / 2);
    coin.add(rim);
  });
  coin.traverse((m) => {
    m.castShadow = true;
  });
  coin.position.y = 0.05 + COIN_R + 0.04;
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.13), paint);
  post.position.y = 0.075;
  const holder = new THREE.Group();
  holder.add(coin, post);
  g.add(holder);
  g.userData.billboard = holder;
  return g;
}

function houseModel(hotel) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: hotel ? 0xd6342c : 0x2f9e4f, roughness: 0.4 });
  const w = hotel ? 0.34 : 0.15;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, 0.13), mat);
  body.position.y = 0.05;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.095, 0.07, 4, 1), mat);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(w / 0.13, 1, 1);
  roof.position.y = 0.135;
  [body, roof].forEach((m) => {
    m.castShadow = true;
    g.add(m);
  });
  return g;
}

export class TycoonBoard3D {
  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.visible = false;
    this.tweens = [];
    this.tokens = new Map(); // seat -> group
    this.positions = new Map(); // seat -> space id
    this.jailed = new Set();
    this.onSpace = null;
    this.onHover = null;
    this.follow = true;
    this.focus = new THREE.Vector3();
    this.focusGoal = new THREE.Vector3();
    this.pointer = new THREE.Vector2();
    this.parallax = new THREE.Vector2();

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = quality !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    const scene = new THREE.Scene();
    this.scene = scene;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.5;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 150);

    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x2a2018, 0.8));
    const key = new THREE.DirectionalLight(0xfff0dd, 2.2);
    key.position.set(-6, 16, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, far: 50 });
    key.shadow.bias = -0.0006;
    key.shadow.radius = 3;
    scene.add(key);

    this.buildBoard();
    this.buildDice();
    this.fx = new THREE.Group();
    this.buildDecks();
    this.markers = new THREE.Group();
    scene.add(this.markers);
    this.houses = new THREE.Group();
    scene.add(this.houses);
    scene.add(this.fx);
    this.houseCount = {};

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const rect = canvas.getBoundingClientRect();
      this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const id = this.spaceAt(e);
      this.onHover?.(id, e.clientX, e.clientY);
      canvas.style.cursor = id !== null ? 'pointer' : 'default';
    });
    canvas.addEventListener('pointerleave', () => this.onHover?.(null));
    canvas.addEventListener('click', (e) => this.onSpace?.(this.spaceAt(e), e.clientX, e.clientY));
    this.resize();
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.tick());
  }

  // ---- construction ------------------------------------------------------

  buildBoard() {
    this.boardMat = new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.45 });
    const top = new THREE.Mesh(new THREE.PlaneGeometry(SIDE, SIDE), this.boardMat);
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    this.scene.add(top);
    const base = new THREE.Mesh(new THREE.BoxGeometry(SIDE + 0.5, 0.4, SIDE + 0.5), new THREE.MeshStandardMaterial({ color: 0x4a2a14, roughness: 0.4 }));
    base.position.y = -0.21;
    base.castShadow = true;
    base.receiveShadow = true;
    this.scene.add(base);
    const table = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x14202a, roughness: 0.9 }));
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.41;
    table.receiveShadow = true;
    this.scene.add(table);
  }

  // Chance and Community Chest piles sit in the middle of the board.
  buildDecks() {
    const back = (deck) => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 332;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = deck === 'lucky' ? '#f08a2e' : '#3b82e0';
      ctx.fillRect(0, 0, 512, 332);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 10;
      ctx.strokeRect(18, 18, 476, 296);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const bigMark = deck === 'lucky' && deckTheme === 'classic';
      ctx.font = bigMark ? '900 150px "Chakra Petch", sans-serif' : '900 54px "Chakra Petch", sans-serif';
      const label = B.themeOf(deckTheme).decks[deck].split(' ');
      if (deck === 'lucky' && deckTheme === 'classic') ctx.fillText('?', 256, 176);
      else {
        ctx.fillText(label[0], 256, 130);
        ctx.fillText(label.slice(1).join(' '), 256, 200);
      }
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
    };
    this.cardFace = new THREE.MeshStandardMaterial({ color: 0xfbfaf5, roughness: 0.6 });
    Object.values(this.decks || {}).forEach((d) => this.scene.remove(d.stack));
    this.decks = {};
    [['lucky', -3.25, -0.14], ['town', 3.25, 0.14]].forEach(([deck, x, z]) => {
      const edge = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.7 });
      const top = back(deck);
      const stack = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, 1.23), [edge, edge, top, edge, edge, edge]);
      stack.position.set(x, 0.07, z);
      stack.rotation.y = Math.PI / 4;
      stack.castShadow = true;
      stack.receiveShadow = true;
      this.scene.add(stack);
      this.decks[deck] = { stack, top };
    });
  }

  // A card lifts off the pile and flips towards the camera.
  async liftCard(deck) {
    const d = this.decks?.[deck];
    if (!d) return;
    const card = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.01, 1.23), [this.cardFace, this.cardFace, d.top, this.cardFace, this.cardFace, this.cardFace]);
    card.position.copy(d.stack.position).setY(0.15);
    card.rotation.y = Math.PI / 4;
    card.castShadow = true;
    this.fx.add(card);
    const start = card.position.clone();
    const end = new THREE.Vector3(start.x * 0.4, 2.2, start.z * 0.4 + 1.5);
    await this.tween(520, (t) => {
      const e = easeInOut(t);
      card.position.lerpVectors(start, end, e);
      card.rotation.set(-e * 1.1, Math.PI / 4 * (1 - e), 0);
    });
    this.lifted = card;
  }

  dropCard() {
    const card = this.lifted;
    if (!card) return;
    this.lifted = null;
    const start = card.position.clone();
    this.tween(350, (t) => {
      card.position.y = start.y + t * 1.5;
      card.scale.setScalar(1 - t);
    }).then(() => this.fx.remove(card));
  }

  // Switch between the classic and Pokémon editions.
  setTheme(theme) {
    if (this.theme === theme) return;
    this.theme = theme;
    deckTheme = theme;
    this.refreshTexture();
    this.buildDecks();
    // Tokens differ between editions: rebuild them.
    this.tokens.forEach((g) => this.scene.remove(g));
    this.tokens.clear();
  }

  refreshTexture() {
    this.boardMat.map?.dispose();
    this.boardMat.map = boardTexture();
    this.boardMat.needsUpdate = true;
  }

  buildDice() {
    const mats = FACE_VALUES.map((n) => new THREE.MeshStandardMaterial({ map: dieFace(n), roughness: 0.3 }));
    this.dice = [0, 1].map(() => {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), mats);
      d.castShadow = true;
      d.visible = false;
      this.scene.add(d);
      return d;
    });
  }

  // ---- tokens ------------------------------------------------------------

  // seats: [{ seat, token, color, pos, bankrupt, gone }]
  setTokens(seats) {
    const alive = seats.filter((s) => !s.bankrupt && !s.gone);
    const keep = new Set(alive.map((s) => s.seat));
    this.tokens.forEach((g, seat) => {
      if (!keep.has(seat)) {
        this.scene.remove(g);
        this.tokens.delete(seat);
        this.positions.delete(seat);
      }
    });
    alive.forEach((s) => {
      if (this.tokens.has(s.seat) && this.tokens.get(s.seat).userData.kind !== s.token) {
        this.scene.remove(this.tokens.get(s.seat));
        this.tokens.delete(s.seat);
      }
      if (!this.tokens.has(s.seat)) {
        const g = tokenModel(s.token, s.color);
        g.userData.kind = s.token;
        g.userData.seat = s.seat;
        this.scene.add(g);
        this.tokens.set(s.seat, g);
      }
      this.positions.set(s.seat, s.pos);
      if (s.jail) this.jailed.add(s.seat);
      else this.jailed.delete(s.seat);
    });
    this.layoutTokens();
  }

  layoutTokens(except = null) {
    const bySpace = new Map();
    this.positions.forEach((pos, seat) => {
      const key = `${pos}:${pos === 10 && this.jailed.has(seat) ? 'j' : ''}`;
      if (!bySpace.has(key)) bySpace.set(key, []);
      bySpace.get(key).push(seat);
    });
    bySpace.forEach((seats, key) => {
      const pos = Number(key.split(':')[0]);
      const jailed = key.endsWith('j');
      seats.forEach((seat, i) => {
        if (seat === except) return;
        const g = this.tokens.get(seat);
        if (!g || g.userData.moving) return;
        const spot = toWorld(tokenSpot(pos, i, seats.length, jailed));
        g.userData.home = spot;
        g.position.set(spot.x, g.position.y, spot.z);
        
        // Big pieces, a touch smaller when several share a space.
        g.scale.setScalar(seats.length >= 3 ? 1.25 : seats.length === 2 ? 1.45 : 1.7);
      });
    });
  }

  async moveToken(seat, path, { fast = false } = {}) {
    const g = this.tokens.get(seat);
    if (!g || !path.length) return;
    g.userData.moving = true;
    for (const id of path) {
      const start = g.position.clone();
      const end = toWorld(tokenSpot(id, 0, 1));
            g.scale.setScalar(1.7);
      this.focusGoal.copy(end);
      await this.tween(fast ? 90 : 150, (t) => {
        g.position.lerpVectors(start, end, easeInOut(t));
        g.position.y = Math.sin(t * Math.PI) * 0.35;
      });
      this.positions.set(seat, id);
      this.onStep?.(id);
    }
    g.userData.moving = false;
    this.layoutTokens();
  }

  async jumpToJail(seat) {
    const g = this.tokens.get(seat);
    if (!g) return;
    g.userData.moving = true;
    const start = g.position.clone();
    const end = toWorld(tokenSpot(10, 0, 1, true));
    await this.tween(700, (t) => {
      g.position.lerpVectors(start, end, easeInOut(t));
      g.position.y = Math.sin(t * Math.PI) * 2.5;
      g.rotation.y += 0.25;
      if (t >= 1) g.rotation.y = 0;
    });
    this.positions.set(seat, 10);
    this.jailed.add(seat);
    g.userData.moving = false;
    this.layoutTokens();
  }

  // ---- property ----------------------------------------------------------

  // props: { id: { owner, houses, mortgaged } }; colors: seat -> hex
  setProps(props, colors) {
    this.markers.clear();
    Object.entries(props).forEach(([id, prop]) => {
      if (prop.owner === null) return;
      const r = spaceRect(Number(id));
      const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      // A coloured strip along the outer edge.
      const len = r.side % 2 === 0 ? r.w * 0.86 : r.h * 0.86;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, 0.09), new THREE.MeshStandardMaterial({ color: colors[prop.owner] || '#fff', roughness: 0.4, emissive: colors[prop.owner] || '#fff', emissiveIntensity: 0.25 }));
      const out = [[0, r.h / 2 - 0.08], [-r.w / 2 + 0.08, 0], [0, -r.h / 2 + 0.08], [r.w / 2 - 0.08, 0]][r.side];
      strip.position.copy(toWorld({ x: c.x + out[0], y: c.y + out[1] })).setY(0.015);
      strip.rotation.y = r.side % 2 === 0 ? 0 : Math.PI / 2;
      this.markers.add(strip);
      if (prop.mortgaged) {
        const shade = new THREE.Mesh(new THREE.PlaneGeometry(r.w * 0.96, r.h * 0.96), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
        shade.rotation.x = -Math.PI / 2;
        shade.position.copy(toWorld(c)).setY(0.006);
        this.markers.add(shade);
      }
    });
    this.setHouses(props);
  }

  setHouses(props) {
    const changed = [];
    Object.entries(props).forEach(([id, prop]) => {
      if ((this.houseCount[id] || 0) !== prop.houses) changed.push(id);
      this.houseCount[id] = prop.houses;
    });
    this.houses.clear();
    Object.entries(props).forEach(([id, prop]) => {
      if (!prop.houses) return;
      const r = spaceRect(Number(id));
      const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      // Buildings sit on the colour band (the inner edge).
      const band = [[0, -r.h / 2 + 0.17], [r.w / 2 - 0.17, 0], [0, r.h / 2 - 0.17], [-r.w / 2 + 0.17, 0]][r.side];
      const along = r.side % 2 === 0 ? [1, 0] : [0, 1];
      const list = prop.houses === 5 ? [0] : Array.from({ length: prop.houses }, (_, i) => (i - (prop.houses - 1) / 2) * 0.22);
      list.forEach((off, i) => {
        const h = houseModel(prop.houses === 5);
        h.position.copy(toWorld({ x: c.x + band[0] + along[0] * off, y: c.y + band[1] + along[1] * off }));
        h.rotation.y = r.side % 2 === 0 ? 0 : Math.PI / 2;
        this.houses.add(h);
        if (changed.includes(id) && i === list.length - 1) {
          h.scale.setScalar(0.01);
          // Pop up with a little overshoot.
          this.tween(380, (t) => h.scale.setScalar(Math.max(0.01, 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2))));
        }
      });
    });
  }

  // ---- effects -----------------------------------------------------------

  // Gold coins fly from one player to another (or to/from the bank in the middle).
  coins(fromSeat, toSeat, amount) {
    const from = fromSeat === null ? new THREE.Vector3(0, 0.3, 0) : this.tokens.get(fromSeat)?.position.clone();
    const to = toSeat === null ? new THREE.Vector3(0, 0.3, 0) : this.tokens.get(toSeat)?.position.clone();
    if (!from || !to) return Promise.resolve();
    const n = Math.min(12, 3 + Math.floor(amount / 60));
    const geo = new THREE.CylinderGeometry(0.08, 0.08, 0.02, 16);
    const mat = new THREE.MeshStandardMaterial({ color: 0xf5c518, metalness: 1, roughness: 0.25, emissive: 0x6a4a00, emissiveIntensity: 0.3 });
    const jobs = [];
    for (let i = 0; i < n; i += 1) {
      const c = new THREE.Mesh(geo, mat);
      c.rotation.x = Math.PI / 2;
      this.fx.add(c);
      const jitter = new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3);
      jobs.push(
        new Promise((r) => setTimeout(r, i * 50)).then(() =>
          this.tween(520, (t) => {
            c.position.lerpVectors(from, to, easeInOut(t)).add(jitter.clone().multiplyScalar(Math.sin(t * Math.PI)));
            c.position.y = 0.3 + Math.sin(t * Math.PI) * 1.6;
            c.rotation.z += 0.4;
          }).then(() => this.fx.remove(c))
        )
      );
    }
    return Promise.all(jobs);
  }

  burst(spaceId, hex) {
    const r = spaceRect(spaceId);
    const pos = toWorld({ x: r.x + r.w / 2, y: r.y + r.h / 2 }).setY(0.2);
    const mat = new THREE.MeshBasicMaterial({ color: hex, transparent: true });
    const geo = new THREE.BoxGeometry(0.06, 0.06, 0.02);
    const parts = [];
    for (let i = 0; i < (this.quality === 'low' ? 14 : 30); i += 1) {
      const p = new THREE.Mesh(geo, mat);
      p.position.copy(pos);
      const a = Math.random() * Math.PI * 2;
      p.userData.v = new THREE.Vector3(Math.cos(a) * (0.5 + Math.random() * 1.5), 2 + Math.random() * 2, Math.sin(a) * (0.5 + Math.random() * 1.5));
      this.fx.add(p);
      parts.push(p);
    }
    this.tween(900, (t) => {
      parts.forEach((p) => {
        p.position.addScaledVector(p.userData.v, 0.016);
        p.userData.v.y -= 0.12;
        p.rotation.x += 0.2;
      });
      mat.opacity = 1 - t;
    }).then(() => parts.forEach((p) => this.fx.remove(p)));
  }

  async rollDice(values) {
    const jobs = this.dice.map((d, i) => {
      d.visible = true;
      const end = new THREE.Vector3(-0.45 + i * 0.9, 0.275, 0.6 + i * 0.25);
      const start = new THREE.Vector3(end.x + 2.5, 2.5, end.z + 3);
      const spin = new THREE.Vector3(9 + Math.random() * 6, 5 + Math.random() * 5, 7 + Math.random() * 4);
      const final = new THREE.Quaternion().setFromEuler(UP_ROT[values[i]]);
      final.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.8));
      const q = new THREE.Quaternion();
      return this.tween(800 + i * 90, (t) => {
        const e = 1 - Math.pow(1 - t, 3);
        d.position.lerpVectors(start, end, e);
        d.position.y = 0.275 + Math.abs(Math.cos(t * Math.PI * 2.5)) * (1 - t) * 1.6;
        const k = 1 - e;
        q.setFromEuler(new THREE.Euler(spin.x * k, spin.y * k, spin.z * k));
        d.quaternion.copy(final).multiply(q);
      }).then(() => d.quaternion.copy(final));
    });
    await Promise.all(jobs);
  }

  focusOn(seat) {
    const g = this.tokens.get(seat);
    if (g) this.focusGoal.copy(g.position);
  }

  // ---- picking -----------------------------------------------------------

  spaceAt(event) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) return null;
    const x = p.x + H;
    const y = p.z + H;
    for (let id = 0; id < 40; id += 1) {
      const r = spaceRect(id);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return id;
    }
    return null;
  }

  projectSpace(id) {
    const r = spaceRect(id);
    const v = toWorld({ x: r.x + r.w / 2, y: r.y + r.h / 2 }).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  // ---- layout ------------------------------------------------------------

  show(visible) {
    this.canvas.hidden = !visible;
    this.visible = visible;
    if (visible) this.resize();
    else this.tweens.splice(0).forEach((tw) => (tw.update(1), tw.resolve()));
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitKey = null;
  }

  placeCamera() {
    const elev = THREE.MathUtils.degToRad(this.camera.aspect < 0.9 ? 66 : 58);
    const key = this.camera.aspect.toFixed(3);
    if (this.fitKey !== key) {
      this.fitKey = key;
      const cam = this.camera.clone();
      const v = new THREE.Vector3();
      const e = H + 0.25;
      const pts = [[-e, 0, -e], [e, 0, -e], [-e, 0, e], [e, 0, e]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
      let dist = 8;
      for (; dist < 80; dist += 0.1) {
        cam.position.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist);
        cam.lookAt(0, 0, 0);
        cam.updateMatrixWorld();
        if (pts.every((p) => (v.copy(p).project(cam), Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.92))) break;
      }
      this.camDist = dist;
    }
    // Lean a little towards the action when following.
    const f = this.follow ? 0.1 : 0;
    const tx = this.focus.x * f;
    const tz = this.focus.z * f;
    const zoom = 1;
    const dist = this.camDist * zoom;
    const az = this.parallax.x * 0.08;
    const el = elev + this.parallax.y * 0.03;
    const h = Math.cos(el) * dist;
    this.camera.position.set(tx + Math.sin(az) * h, Math.sin(el) * dist, tz + Math.cos(az) * h);
    this.camera.lookAt(tx, 0, tz);
  }

  tween(duration, update) {
    if (!duration || !this.visible) {
      update(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => this.tweens.push({ start: performance.now(), duration, update, resolve }));
  }

  tick() {
    if (!this.visible) return;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const now = performance.now();
    for (let i = this.tweens.length - 1; i >= 0; i -= 1) {
      const tw = this.tweens[i];
      const t = Math.min((now - tw.start) / tw.duration, 1);
      tw.update(t);
      if (t >= 1) {
        this.tweens.splice(i, 1);
        tw.resolve();
      }
    }
    // The active token bobs gently.
    this.tokens.forEach((g, seat) => {
      // Coins always turn to face the camera.
      const bb = g.userData.billboard;
      if (bb) {
        const dx = this.camera.position.x - g.position.x;
        const dz = this.camera.position.z - g.position.z;
        const dy = this.camera.position.y - g.position.y;
        bb.rotation.order = 'YXZ';
        bb.rotation.y = Math.atan2(dx, dz) - g.rotation.y;
        // Lean back towards the camera so the picture reads as a full circle.
        bb.rotation.x = -Math.atan2(dy, Math.hypot(dx, dz)) * 0.8;
      }
      if (g.userData.moving) return;
      const active = seat === this.activeSeat;
      const ring = g.userData.ring;
      if (ring) {
        ring.material.opacity = active ? 0.65 + Math.sin(now / 200) * 0.3 : 0.55;
        ring.scale.setScalar(active ? 1.05 + Math.sin(now / 200) * 0.08 : 1);
      }
      const goal = active ? 0.06 + Math.sin(now / 300) * 0.04 : 0;
      g.position.y += (goal - g.position.y) * Math.min(1, dt * 8);
    });
    this.focus.lerp(this.focusGoal, Math.min(1, dt * 2));
    this.parallax.x += (this.pointer.x - this.parallax.x) * Math.min(1, dt * 2);
    this.parallax.y += (this.pointer.y - this.parallax.y) * Math.min(1, dt * 2);
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }
}
