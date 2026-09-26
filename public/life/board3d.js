// 3D Game of Life board: a winding road over green hills, little cars with peg
// people, and scenery. main.js drives it with seat positions and move paths.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const B = window.LifeBoard;
const SP = B.spaces;
const TILE_Y = 0.12;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export const TYPE_COLORS = {
  start: '#ffffff',
  payday: '#2fbf5b',
  money: '#f2a93b',
  life: '#8e5bd6',
  stop: '#d9352b',
  sue: '#e0622a',
  baby: '#58a8f0',
  twins: '#f06fae',
};

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function tileTexture(space) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const color = space.type === 'money' && space.amount < 0 ? '#d65a3a' : TYPE_COLORS[space.type] || '#ccc';
  const g = ctx.createRadialGradient(64, 50, 10, 64, 64, 80);
  g.addColorStop(0, new THREE.Color(color).lerp(new THREE.Color('#fff'), 0.25).getStyle());
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 4;
  const big = (text, size = 40, y = 64) => {
    ctx.font = `800 ${size}px "Chakra Petch", "Segoe UI", sans-serif`;
    ctx.fillText(text, 64, y);
  };
  switch (space.type) {
    case 'payday':
      big('$', 58, 54);
      big('PAYDAY', 20, 96);
      break;
    case 'money':
      big(`${space.amount > 0 ? '+' : '−'}${Math.abs(space.amount)}K`, Math.abs(space.amount) >= 100 ? 32 : 38);
      break;
    case 'life':
      big('LIFE', 36);
      break;
    case 'sue':
      big('⚖', 50, 54);
      big('SUE', 22, 98);
      break;
    case 'baby':
      big('👶', 50, 58);
      break;
    case 'twins':
      big('👶👶', 36, 60);
      break;
    case 'start':
      ctx.fillStyle = '#1b2a3a';
      big('GO', 46);
      break;
    default:
      break;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function stopTexture(space) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c92a22';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 34px "Chakra Petch", sans-serif';
  ctx.fillText('STOP', 64, 50);
  const words = { career: 'CAREER', graduation: 'GRADUATE', marry: 'MARRY', house: 'HOUSE', nightschool: 'SCHOOL', retire: 'RETIRE' };
  ctx.font = '700 18px "Chakra Petch", sans-serif';
  ctx.fillText(words[space.kind] || '', 64, 84);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6fbf4f';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 5000; i += 1) {
    const shade = 80 + Math.random() * 90;
    ctx.fillStyle = `rgba(${shade * 0.5}, ${shade + 40}, ${shade * 0.35}, 0.25)`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 4);
  return tex;
}

function labelSprite(text, { size = 40, color = '#fff', bg = 'rgba(10,20,30,0.75)' } = {}) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `700 ${size}px "Chakra Petch", sans-serif`;
  const w = Math.ceil(ctx.measureText(text).width) + 36;
  c.width = w;
  c.height = size + 24;
  ctx.font = `700 ${size}px "Chakra Petch", sans-serif`;
  if (bg) {
    ctx.fillStyle = bg;
    roundRect(ctx, 0, 0, w, c.height, 14);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, c.height / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const h = 0.32;
  sprite.scale.set((h * w) / c.height, h, 1);
  sprite.renderOrder = 20;
  return sprite;
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

function carGeometry() {
  const parts = [];
  const add = (geo, x, y, z, rx = 0, ry = 0, rz = 0) => {
    geo.rotateX(rx);
    geo.rotateY(ry);
    geo.rotateZ(rz);
    geo.translate(x, y, z);
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    parts.push(g);
  };
  // Body along +x.
  add(new THREE.BoxGeometry(0.56, 0.1, 0.3), 0, 0.1, 0);
  add(new THREE.CapsuleGeometry(0.05, 0.46, 4, 8), 0, 0.12, 0.1, 0, 0, Math.PI / 2);
  add(new THREE.CapsuleGeometry(0.05, 0.46, 4, 8), 0, 0.12, -0.1, 0, 0, Math.PI / 2);
  add(new THREE.BoxGeometry(0.12, 0.08, 0.26), 0.22, 0.17, 0);
  const car = mergeGeometries(parts);
  car.computeVertexNormals();
  return car;
}

function wheelGeometry() {
  const g = new THREE.CylinderGeometry(0.055, 0.055, 0.04, 14);
  g.rotateX(Math.PI / 2);
  return g;
}

function pegGeometry() {
  const a = new THREE.CylinderGeometry(0.022, 0.026, 0.08, 10);
  a.translate(0, 0.04, 0);
  const b = new THREE.SphereGeometry(0.03, 10, 8);
  b.translate(0, 0.1, 0);
  const g = mergeGeometries([a.toNonIndexed(), b.toNonIndexed()]);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export class LifeBoard3D {
  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.visible = false;
    this.tweens = [];
    this.cars = new Map(); // seat -> car
    this.zoom = 1;
    this.pan = new THREE.Vector2(0, 0);
    this.focus = null; // { x, z, zoom } while following a car
    this.follow = true;
    this.pointers = new Map();
    this.highlight = new Set();

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = quality !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.4;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 200);
    scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x3a5a2a, 0.9));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.3);
    sun.position.set(-9, 16, 8);
    sun.castShadow = true;
    const size = quality === 'high' ? 4096 : 2048;
    sun.shadow.mapSize.set(size, size);
    Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 9, bottom: -9, near: 1, far: 50 });
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);

    this.buildGround();
    this.buildRoad();
    this.buildScenery();
    this.geo = { car: carGeometry(), wheel: wheelGeometry(), peg: pegGeometry() };
    this.mats = {
      wheel: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 }),
      blue: new THREE.MeshStandardMaterial({ color: 0x3b7fe0, roughness: 0.35 }),
      pink: new THREE.MeshStandardMaterial({ color: 0xf06fae, roughness: 0.35 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.7 }),
    };
    this.fx = new THREE.Group();
    scene.add(this.fx);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.bindInput();
    this.resize();
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.tick());
    document.fonts?.ready.then(() => this.refreshTiles());
  }

  // ---- construction ------------------------------------------------------

  buildGround() {
    const W = 22;
    const D = 16;
    const geo = new THREE.PlaneGeometry(W, D, 110, 80);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const pts = SP.map((s) => [s.x, s.z]);
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let dmin = Infinity;
      for (const [sx, sz] of pts) dmin = Math.min(dmin, Math.hypot(sx - x, sz - z));
      const hill = (Math.sin(x * 0.9) * Math.cos(z * 1.1) + Math.sin(x * 0.37 + z * 0.61) * 0.8 + 1.2) * 0.22;
      const k = THREE.MathUtils.smoothstep(dmin, 0.9, 2.4);
      const edge = Math.min(W / 2 - Math.abs(x), D / 2 - Math.abs(z));
      pos.setY(i, hill * k * THREE.MathUtils.smoothstep(edge, 0, 1.2));
    }
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 0.95 }));
    ground.receiveShadow = true;
    this.scene.add(ground);
    // Board edge.
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xf2e6c9, roughness: 0.6 });
    const t = 0.35;
    [
      [W + t * 2, t, 0, D / 2 + t / 2],
      [W + t * 2, t, 0, -D / 2 - t / 2],
      [t, D, W / 2 + t / 2, 0],
      [t, D, -W / 2 - t / 2, 0],
    ].forEach(([sx, sz, x, z]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.35, sz), edgeMat);
      m.position.set(x, 0.05, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    });
    const under = new THREE.Mesh(new THREE.BoxGeometry(W + t * 2, 0.3, D + t * 2), new THREE.MeshStandardMaterial({ color: 0x3a2a1a }));
    under.position.y = -0.2;
    this.scene.add(under);
    this.bounds = { W, D };
  }

  buildRoad() {
    // Grey road strips under the tiles.
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.9 });
    SP.forEach((s) => {
      s.next.forEach((n) => {
        const t = SP[n];
        const len = Math.hypot(t.x - s.x, t.z - s.z);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.42), roadMat);
        strip.position.set((s.x + t.x) / 2, 0.03, (s.z + t.z) / 2);
        strip.rotation.y = -Math.atan2(t.z - s.z, t.x - s.x);
        strip.receiveShadow = true;
        this.scene.add(strip);
      });
    });
    this.tiles = [];
    const tileGeo = new THREE.CylinderGeometry(0.36, 0.38, 0.1, 28);
    const laneGeo = new THREE.CylinderGeometry(0.3, 0.32, 0.1, 28);
    const stopGeo = new THREE.CylinderGeometry(0.42, 0.44, 0.14, 8);
    const capGeo = new THREE.CircleGeometry(0.34, 28).rotateX(-Math.PI / 2);
    const laneCap = new THREE.CircleGeometry(0.28, 28).rotateX(-Math.PI / 2);
    const stopCap = new THREE.CircleGeometry(0.41, 8).rotateX(-Math.PI / 2);
    SP.forEach((s) => {
      const isStop = s.type === 'stop';
      const lane = Boolean(s.lane) && !isStop;
      const color = s.type === 'money' && s.amount < 0 ? '#d65a3a' : TYPE_COLORS[s.type] || '#ddd';
      const base = new THREE.Mesh(
        isStop ? stopGeo : lane ? laneGeo : tileGeo,
        new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.7), roughness: 0.5 })
      );
      base.position.set(s.x, isStop ? 0.1 : 0.08, s.z);
      base.rotation.y = isStop ? Math.PI / 8 : 0;
      base.castShadow = true;
      base.receiveShadow = true;
      this.scene.add(base);
      const capMat = new THREE.MeshStandardMaterial({ map: isStop ? stopTexture(s) : tileTexture(s), roughness: 0.45 });
      const cap = new THREE.Mesh(isStop ? stopCap : lane ? laneCap : capGeo, capMat);
      cap.position.set(s.x, (isStop ? 0.17 : 0.131) + 0.001, s.z);
      cap.rotation.y = isStop ? Math.PI / 8 - s.angle - Math.PI / 2 : -s.angle - Math.PI / 2;
      cap.receiveShadow = true;
      this.scene.add(cap);
      this.tiles.push({ base, cap, capMat, y: isStop ? 0.17 : TILE_Y });
    });
  }

  refreshTiles() {
    SP.forEach((s, i) => {
      const t = this.tiles[i];
      t.capMat.map.dispose();
      t.capMat.map = s.type === 'stop' ? stopTexture(s) : tileTexture(s);
      t.capMat.needsUpdate = true;
    });
  }

  buildScenery() {
    const pts = SP.map((s) => [s.x, s.z]);
    const clear = (x, z, r) => pts.every(([sx, sz]) => Math.hypot(sx - x, sz - z) > r);
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const trees = [];
    for (let i = 0; i < 400 && trees.length < 90; i += 1) {
      const x = (rand() - 0.5) * 21;
      const z = (rand() - 0.5) * 15;
      if (clear(x, z, 0.85) && trees.every(([tx, tz]) => Math.hypot(tx - x, tz - z) > 0.45)) trees.push([x, z]);
    }
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.035, 0.05, 0.2, 6),
      new THREE.MeshStandardMaterial({ color: 0x6b4423 }),
      trees.length
    );
    const crown = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.2, 0.46, 8),
      new THREE.MeshStandardMaterial({ color: 0x2f8a3a, roughness: 0.8 }),
      trees.length
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    trees.forEach(([x, z], i) => {
      const s = 0.8 + rand() * 0.6;
      const y = this.groundY(x, z);
      m.compose(v.set(x, y + 0.1 * s, z), q, new THREE.Vector3(s, s, s));
      trunk.setMatrixAt(i, m);
      m.compose(v.set(x, y + (0.2 + 0.2) * s, z), q, new THREE.Vector3(s, s, s));
      crown.setMatrixAt(i, m);
      crown.setColorAt(i, c.setHSL(0.3 + rand() * 0.08, 0.5, 0.3 + rand() * 0.12));
    });
    [trunk, crown].forEach((mesh) => {
      mesh.castShadow = true;
      this.scene.add(mesh);
    });

    // Landmarks next to the big stops.
    const landmark = (kind, color, roof, scale = 1) => {
      const stop = SP.find((s) => s.kind === kind);
      if (!stop) return;
      let spot = null;
      for (let r = 1.1; r < 3 && !spot; r += 0.2) {
        for (let a = 0; a < Math.PI * 2 && !spot; a += Math.PI / 8) {
          const x = stop.x + Math.cos(a) * r;
          const z = stop.z + Math.sin(a) * r;
          if (clear(x, z, 0.8) && Math.abs(x) < 10 && Math.abs(z) < 7) spot = [x, z];
        }
      }
      if (!spot) return;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.45), new THREE.MeshStandardMaterial({ color }));
      body.position.y = 0.2;
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.3, 4), new THREE.MeshStandardMaterial({ color: roof }));
      top.position.y = 0.55;
      top.rotation.y = Math.PI / 4;
      [body, top].forEach((mm) => {
        mm.castShadow = true;
        mm.receiveShadow = true;
        g.add(mm);
      });
      if (kind === 'graduation' || kind === 'marry') {
        const spire = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.4, 6), new THREE.MeshStandardMaterial({ color: roof }));
        spire.position.set(0, 0.85, 0);
        g.add(spire);
      }
      g.scale.setScalar(scale);
      g.position.set(spot[0], this.groundY(spot[0], spot[1]), spot[1]);
      g.rotation.y = rand() * Math.PI;
      this.scene.add(g);
    };
    landmark('graduation', 0xd9c7a0, 0x8a2a2a, 1.2);
    landmark('marry', 0xffffff, 0xc9a0dc);
    landmark('house', 0xf2d7a7, 0x3b6ea5);
    landmark('nightschool', 0xa0b8d9, 0x2a3a6a, 0.9);
    landmark('retire', 0xfff3d6, 0xd4aa4f, 1.5);
  }

  groundY(x, z) {
    const pts = SP;
    let dmin = Infinity;
    for (const s of pts) dmin = Math.min(dmin, Math.hypot(s.x - x, s.z - z));
    const hill = (Math.sin(x * 0.9) * Math.cos(z * 1.1) + Math.sin(x * 0.37 + z * 0.61) * 0.8 + 1.2) * 0.22;
    const k = THREE.MathUtils.smoothstep(dmin, 0.9, 2.4);
    const edge = Math.min(11 - Math.abs(x), 8 - Math.abs(z));
    return hill * k * THREE.MathUtils.smoothstep(edge, 0, 1.2);
  }

  // ---- cars --------------------------------------------------------------

  makeCar(seat, color) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: this.quality === 'low' ? 0 : 0.8 });
    const body = new THREE.Mesh(this.geo.car, bodyMat);
    body.castShadow = true;
    group.add(body);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.07, 0.24), this.mats.glass);
    glass.position.set(0.28, 0.18, 0);
    group.add(glass);
    [[0.18, 0.15], [-0.18, 0.15], [0.18, -0.15], [-0.18, -0.15]].forEach(([x, z]) => {
      const w = new THREE.Mesh(this.geo.wheel, this.mats.wheel);
      w.position.set(x, 0.055, z);
      w.castShadow = true;
      group.add(w);
    });
    const pegs = new THREE.Group();
    group.add(pegs);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.37, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false })
    );
    ring.position.y = 0.006;
    ring.scale.set(1.15, 1, 0.8);
    group.add(ring);
    group.scale.setScalar(1.45);
    this.scene.add(group);
    const car = { seat, group, pegs, pos: null, bodyMat, color, people: '' };
    this.cars.set(seat, car);
    return car;
  }

  setPeople(car, married, kids) {
    const key = `${married}:${kids}`;
    if (car.people === key) return;
    car.people = key;
    car.pegs.clear();
    // Seats in two rows of three on top of the car.
    const seats = [];
    for (let row = 0; row < 3; row += 1) for (const side of [0.07, -0.07]) seats.push([0.1 - row * 0.13, side]);
    const people = [this.mats.blue];
    if (married) people.push(this.mats.pink);
    for (let i = 0; i < Math.min(kids, 4); i += 1) people.push(i % 2 ? this.mats.pink : this.mats.blue);
    people.forEach((mat, i) => {
      const peg = new THREE.Mesh(this.geo.peg, mat);
      const [x, z] = seats[i];
      peg.position.set(x, 0.15, z);
      peg.castShadow = true;
      car.pegs.add(peg);
    });
  }

  // Where a car parks on a space (several cars share by fanning out).
  slot(spaceId, index, count) {
    const s = SP[spaceId];
    const off = count > 1 ? (index - (count - 1) / 2) * 0.3 : 0;
    const nx = -Math.sin(s.angle);
    const nz = Math.cos(s.angle);
    return { x: s.x + nx * off, z: s.z + nz * off, y: this.tiles[spaceId].y, angle: s.angle };
  }

  /** @param {{seat, color, pos, married, kids, retired}[]} list */
  setCars(list, animatingSeat = null) {
    const bySpace = {};
    list.forEach((p) => (bySpace[p.pos] ||= []).push(p.seat));
    list.forEach((p) => {
      const car = this.cars.get(p.seat) || this.makeCar(p.seat, p.color);
      this.setPeople(car, p.married, p.kids);
      if (p.seat === animatingSeat) return;
      const same = bySpace[p.pos];
      const sl = this.slot(p.pos, same.indexOf(p.seat), same.length);
      car.group.position.set(sl.x, sl.y, sl.z);
      car.group.rotation.y = -sl.angle;
      car.pos = p.pos;
    });
    this.cars.forEach((car, seat) => {
      car.group.visible = list.some((p) => p.seat === seat);
    });
  }

  async driveCar(seat, path) {
    const car = this.cars.get(seat);
    if (!car || !path.length) return;
    this.focusOn(SP[path[0]]);
    for (const id of path) {
      const s = SP[id];
      const g = car.group;
      const from = g.position.clone();
      const to = new THREE.Vector3(s.x, this.tiles[id].y, s.z);
      const a0 = g.rotation.y;
      let a1 = -Math.atan2(to.z - from.z, to.x - from.x);
      while (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
      while (a1 - a0 < -Math.PI) a1 += Math.PI * 2;
      await this.tween(this.visible ? 230 : 0, (k) => {
        const e = easeInOut(k);
        g.position.lerpVectors(from, to, e);
        g.position.y += Math.sin(Math.PI * k) * 0.12;
        g.rotation.y = a0 + (a1 - a0) * Math.min(1, k * 2);
      });
      this.focusOn(s);
    }
    car.pos = path[path.length - 1];
  }

  focusOn(space) {
    if (!this.follow) return;
    this.focus = { x: space.x, z: space.z, zoom: 1.9, until: performance.now() + 2500 };
  }

  setHighlight(ids) {
    this.highlight = new Set(ids);
    this.tiles.forEach((t, i) => {
      if (!this.highlight.has(i)) t.capMat.emissive?.setScalar(0);
    });
  }

  floatText(spaceId, text, color = '#fff') {
    const s = SP[spaceId];
    if (!s) return;
    const sprite = labelSprite(text, { size: 40, color, bg: 'rgba(8,16,26,0.8)' });
    sprite.position.set(s.x, 0.8, s.z);
    this.fx.add(sprite);
    this.tween(this.visible ? 1800 : 0, (k) => {
      sprite.position.y = 0.8 + k * 0.7;
      sprite.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    }).then(() => {
      this.fx.remove(sprite);
      sprite.material.map.dispose();
      sprite.material.dispose();
    });
  }

  // ---- layout / camera ---------------------------------------------------

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

  fitDistance(elevation) {
    const key = `${this.camera.aspect.toFixed(3)}:${elevation.toFixed(3)}`;
    if (this.fitKey === key) return this.fitDist;
    const cam = this.camera.clone();
    const ex = this.bounds.W / 2 + 0.2;
    const ez = this.bounds.D / 2 + 0.2;
    const corners = [[-ex, 0, ez], [ex, 0, ez], [-ex, 0.3, -ez], [ex, 0.3, -ez]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const v = new THREE.Vector3();
    let dist = 8;
    for (; dist < 120; dist += 0.2) {
      cam.position.set(0, Math.sin(elevation) * dist, Math.cos(elevation) * dist);
      cam.lookAt(0, 0, 0.3);
      cam.updateMatrixWorld();
      if (corners.every((c) => (v.copy(c).project(cam), Math.abs(v.x) < 0.99 && Math.abs(v.y) < 0.99))) break;
    }
    this.fitKey = key;
    this.fitDist = dist;
    return dist;
  }

  placeCamera(dt) {
    const narrow = this.canvas.clientWidth < 620;
    const elevation = THREE.MathUtils.degToRad(narrow ? 62 : 50);
    const now = performance.now();
    if (this.focus && now > this.focus.until) this.focus = null;
    // Ease towards the followed car, or back to the player's own view.
    const goalZoom = this.focus ? Math.max(this.zoom, this.focus.zoom) : this.zoom;
    const goalX = this.focus ? this.focus.x : this.pan.x;
    const goalZ = this.focus ? this.focus.z : this.pan.y;
    this.cam = this.cam || { zoom: 1, x: 0, z: 0 };
    const k = Math.min(1, dt * 3);
    this.cam.zoom += (goalZoom - this.cam.zoom) * k;
    this.cam.x += (goalX - this.cam.x) * k;
    this.cam.z += (goalZ - this.cam.z) * k;
    const lim = 1 - 1 / this.cam.zoom;
    const cx = THREE.MathUtils.clamp(this.cam.x, (-this.bounds.W / 2) * lim, (this.bounds.W / 2) * lim);
    const cz = THREE.MathUtils.clamp(this.cam.z, (-this.bounds.D / 2) * lim, (this.bounds.D / 2) * lim);
    const dist = this.fitDistance(elevation) / this.cam.zoom;
    this.camera.position.set(cx, Math.sin(elevation) * dist, cz + Math.cos(elevation) * dist);
    this.camera.lookAt(cx, 0, cz + 0.3);
  }

  clampPan() {
    const lim = 1 - 1 / this.zoom;
    this.pan.x = THREE.MathUtils.clamp(this.pan.x, (-this.bounds.W / 2) * lim, (this.bounds.W / 2) * lim);
    this.pan.y = THREE.MathUtils.clamp(this.pan.y, (-this.bounds.D / 2) * lim, (this.bounds.D / 2) * lim);
  }

  groundPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  }

  // Tap a tile to see what it does.
  spaceAt(clientX, clientY) {
    const p = this.groundPoint(clientX, clientY);
    if (!p) return null;
    let best = null;
    let bd = 0.45;
    SP.forEach((s) => {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < bd) {
        bd = d;
        best = s.id;
      }
    });
    return best;
  }

  bindInput() {
    const c = this.canvas;
    let press = null;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) press = { x: e.clientX, y: e.clientY, moved: false };
      else {
        press = null;
        const pts = [...this.pointers.values()];
        this.pinch = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), zoom: this.zoom };
      }
    });
    c.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) {
        if (e.pointerType === 'mouse') this.onHover?.(this.spaceAt(e.clientX, e.clientY), e.clientX, e.clientY);
        return;
      }
      if (this.pointers.size === 2 && this.pinch) {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const pts = [...this.pointers.values()];
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        this.zoom = THREE.MathUtils.clamp(this.pinch.zoom * (d / this.pinch.dist), 1, 3.5);
        this.focus = null;
        this.clampPan();
        return;
      }
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 7) press.moved = true;
      if (press?.moved) {
        const a = this.groundPoint(prev.x, prev.y);
        const b = this.groundPoint(e.clientX, e.clientY);
        if (a && b) {
          if (this.zoom < 1.3) this.zoom = 1.3;
          this.pan.x -= b.x - a.x;
          this.pan.y -= b.z - a.z;
          this.focus = null;
          this.clampPan();
        }
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    const end = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (press && !press.moved && e.type === 'pointerup') this.onTap?.(this.spaceAt(e.clientX, e.clientY), e.clientX, e.clientY);
      press = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => this.onHover?.(null));
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const before = this.groundPoint(e.clientX, e.clientY);
        this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(-e.deltaY * 0.0015), 1, 3.5);
        if (before) {
          // Zoom toward the pointer.
          const t = 1 - Math.exp(-Math.abs(e.deltaY) * 0.0015);
          this.pan.x += (before.x - this.pan.x) * (e.deltaY < 0 ? t : 0);
          this.pan.y += (before.z - this.pan.y) * (e.deltaY < 0 ? t : 0);
        }
        this.focus = null;
        this.clampPan();
      },
      { passive: false }
    );
    c.addEventListener('dblclick', () => {
      this.zoom = 1;
      this.pan.set(0, 0);
      this.focus = null;
    });
  }

  // ---- animation ---------------------------------------------------------

  tween(duration, update) {
    if (!duration) {
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
      const k = Math.min((now - tw.start) / tw.duration, 1);
      tw.update(k);
      if (k >= 1) {
        this.tweens.splice(i, 1);
        tw.resolve();
      }
    }
    const pulse = 0.5 + Math.sin(now / 200) * 0.5;
    this.highlight.forEach((i) => {
      const t = this.tiles[i];
      t.capMat.emissive.set(0xffe08a);
      t.capMat.emissiveIntensity = 0.2 + pulse * 0.6;
    });
    this.placeCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
