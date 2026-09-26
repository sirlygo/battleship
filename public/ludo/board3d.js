// 3D Ludo: a lacquered cross board with raised yards, glossy pawns and a
// tumbling die. main.js keeps the game state; this class mirrors it.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const L = window.LudoRules;
export const HEX = { red: '#e0413b', green: '#2fb35a', yellow: '#f5b920', blue: '#2f7fe0' };
const LIGHT = { red: '#ffd9d4', green: '#d5f5df', yellow: '#fff1c8', blue: '#d6e6ff' };
const wx = (col) => col - 7.5;
const wz = (row) => row - 7.5;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function star(ctx, x, y, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

// Draws the whole board onto a 2D canvas context of the given size.
export function drawBoard(ctx, size) {
  const c = size / 15;
  ctx.fillStyle = '#f7f1e3';
  ctx.fillRect(0, 0, size, size);
  // Track squares.
  const cell = (x, y, fill) => {
    ctx.fillStyle = fill;
    ctx.fillRect(x * c, y * c, c, c);
    ctx.strokeStyle = 'rgba(60, 40, 20, 0.35)';
    ctx.lineWidth = Math.max(1, c * 0.03);
    ctx.strokeRect(x * c, y * c, c, c);
  };
  L.TRACK.forEach(([x, y]) => cell(x, y, '#fffaf0'));
  L.COLORS.forEach((color) => {
    L.HOME_PATH[color].forEach(([x, y]) => cell(x, y, HEX[color]));
    const [sx, sy] = L.TRACK[L.START[color]];
    cell(sx, sy, HEX[color]);
    // Arrow into the start square.
    ctx.save();
    ctx.translate((sx + 0.5) * c, (sy + 0.5) * c);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, c * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
  L.STARS.forEach((i) => {
    const [x, y] = L.TRACK[i];
    star(ctx, (x + 0.5) * c, (y + 0.5) * c, c * 0.34, 'rgba(120, 90, 40, 0.55)');
  });
  // The last square before each home column gets an arrow.
  L.COLORS.forEach((color) => {
    const [x, y] = L.TRACK[(L.START[color] + 50) % 52];
    const [hx, hy] = L.HOME_PATH[color][0];
    ctx.save();
    ctx.translate((x + 0.5) * c, (y + 0.5) * c);
    ctx.rotate(Math.atan2(hy - y, hx - x));
    ctx.fillStyle = HEX[color];
    ctx.beginPath();
    ctx.moveTo(c * 0.32, 0);
    ctx.lineTo(-c * 0.18, -c * 0.24);
    ctx.lineTo(-c * 0.18, c * 0.24);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
  // Yards.
  L.COLORS.forEach((color) => {
    const [yx, yy] = L.YARD[color];
    ctx.fillStyle = HEX[color];
    ctx.fillRect(yx * c, yy * c, 6 * c, 6 * c);
    ctx.fillStyle = '#fffaf0';
    ctx.beginPath();
    ctx.roundRect((yx + 0.8) * c, (yy + 0.8) * c, 4.4 * c, 4.4 * c, c * 0.5);
    ctx.fill();
    L.YARD_SPOTS.forEach(([sx, sy]) => {
      ctx.fillStyle = LIGHT[color];
      ctx.beginPath();
      ctx.arc((yx + sx) * c, (yy + sy) * c, c * 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = HEX[color];
      ctx.lineWidth = c * 0.08;
      ctx.stroke();
    });
  });
  // Centre triangles.
  const cx = 7.5 * c;
  const cy = 7.5 * c;
  const tri = { red: [[6, 6], [6, 9]], green: [[6, 6], [9, 6]], yellow: [[9, 6], [9, 9]], blue: [[6, 9], [9, 9]] };
  L.COLORS.forEach((color) => {
    const [[ax, ay], [bx, by]] = tri[color];
    ctx.fillStyle = HEX[color];
    ctx.beginPath();
    ctx.moveTo(ax * c, ay * c);
    ctx.lineTo(bx * c, by * c);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
  });
  ctx.strokeStyle = 'rgba(60, 40, 20, 0.5)';
  ctx.lineWidth = c * 0.05;
  ctx.strokeRect(0, 0, size, size);
}

function boardTexture() {
  const size = 1536;
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
  ctx.fillStyle = n === 1 ? '#d6342c' : '#1c1c22';
  pips[n].forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, n === 1 ? 15 : 11, 0, Math.PI * 2);
    ctx.fill();
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Box faces: +x, -x, +y, -y, +z, -z. Opposite faces add up to 7.
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
// Rotation that brings face value n to the top (+y).
const UP_ROT = {
  1: new THREE.Euler(0, 0, 0),
  6: new THREE.Euler(Math.PI, 0, 0),
  3: new THREE.Euler(0, 0, Math.PI / 2),
  4: new THREE.Euler(0, 0, -Math.PI / 2),
  2: new THREE.Euler(-Math.PI / 2, 0, 0),
  5: new THREE.Euler(Math.PI / 2, 0, 0),
};

function pawnGeometry() {
  const p = [
    [0, 0], [0.34, 0], [0.36, 0.04], [0.34, 0.1], [0.26, 0.14], [0.2, 0.2], [0.15, 0.38],
    [0.13, 0.5], [0.2, 0.54], [0.2, 0.58], [0.12, 0.6], [0.1, 0.62],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.LatheGeometry(p, 32);
  const head = new THREE.SphereGeometry(0.17, 24, 16);
  head.translate(0, 0.74, 0);
  return { body, head };
}

export class LudoBoard3D {
  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.visible = false;
    this.tweens = [];
    this.pawns = new Map(); // `${seat}:${token}` -> mesh
    this.onToken = null;
    this.azimuth = 0;
    this.azimuthGoal = 0;
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
    scene.environmentIntensity = 0.45;
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 120);

    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x2a2018, 0.8));
    const key = new THREE.DirectionalLight(0xfff0dd, 2.3);
    key.position.set(-6, 16, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    Object.assign(key.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, far: 50 });
    key.shadow.bias = -0.0006;
    key.shadow.radius = 4;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ec8ff, 0.5);
    rim.position.set(8, 6, -8);
    scene.add(rim);

    this.pawnGeo = pawnGeometry();
    this.pawnMats = {};
    Object.entries(HEX).forEach(([k, v]) => {
      this.pawnMats[k] = new THREE.MeshPhysicalMaterial({ color: v, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, emissive: v, emissiveIntensity: 0 });
    });
    this.buildBoard();
    this.buildDie();
    this.fx = new THREE.Group();
    scene.add(this.fx);
    this.rings = new THREE.Group();
    scene.add(this.rings);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const rect = canvas.getBoundingClientRect();
      this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      const hit = this.pawnAt(e);
      this.hover = hit;
      canvas.style.cursor = hit && this.movable?.has(hit.key) ? 'pointer' : 'default';
    });
    canvas.addEventListener('click', (e) => {
      const hit = this.pawnAt(e);
      if (hit) this.onToken?.(hit.seat, hit.token);
    });
    this.resize();
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.tick());
  }

  // ---- construction ------------------------------------------------------

  buildBoard() {
    const top = new THREE.Mesh(new THREE.PlaneGeometry(15, 15), new THREE.MeshStandardMaterial({ map: boardTexture(), roughness: 0.4 }));
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    this.scene.add(top);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x5a3018, roughness: 0.35 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(16.2, 0.5, 16.2), frameMat);
    base.position.y = -0.26;
    base.receiveShadow = true;
    base.castShadow = true;
    this.scene.add(base);
    [[16.2, 0.6, 0, 7.8], [16.2, 0.6, 0, -7.8], [0.6, 15, 7.8, 0], [0.6, 15, -7.8, 0]].forEach(([sx, sz, x, z]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.22, sz), frameMat);
      m.position.set(x, 0.07, z);
      m.castShadow = true;
      this.scene.add(m);
    });
    // Raised yard rims.
    L.COLORS.forEach((color) => {
      const [yx, yy] = L.YARD[color];
      const mat = new THREE.MeshPhysicalMaterial({ color: HEX[color], roughness: 0.3, clearcoat: 0.8 });
      const cx = wx(yx + 3);
      const cz = wz(yy + 3);
      const t = 0.25;
      [[6, t, 0, -3 + t / 2], [6, t, 0, 3 - t / 2], [t, 6, -3 + t / 2, 0], [t, 6, 3 - t / 2, 0]].forEach(([sx, sz, x, z]) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.16, sz), mat);
        m.position.set(cx + x, 0.08, cz + z);
        m.castShadow = true;
        m.receiveShadow = true;
        this.scene.add(m);
      });
    });
    // Home pyramid in the middle, one colour per face.
    const pyr = new THREE.Group();
    const faces = { red: -Math.PI / 2, green: Math.PI, yellow: Math.PI / 2, blue: 0 };
    Object.entries(faces).forEach(([color, rot]) => {
      const g = new THREE.BufferGeometry();
      const h = 0.7;
      g.setAttribute('position', new THREE.Float32BufferAttribute([-1.5, 0, 1.5, 1.5, 0, 1.5, 0, h, 0], 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: HEX[color], roughness: 0.3, clearcoat: 1, side: THREE.DoubleSide }));
      m.rotation.y = rot;
      m.castShadow = true;
      pyr.add(m);
    });
    this.scene.add(pyr);
    this.pyramid = pyr;
  }

  buildDie() {
    const mats = FACE_VALUES.map((n) => new THREE.MeshStandardMaterial({ map: dieFace(n), roughness: 0.35 }));
    const geo = new THREE.BoxGeometry(0.8, 0.8, 0.8, 1, 1, 1);
    this.die = new THREE.Mesh(geo, mats);
    this.die.castShadow = true;
    this.die.position.set(0, 0.4, 0);
    this.die.visible = false;
    this.scene.add(this.die);
  }

  // ---- pawns -------------------------------------------------------------

  worldOf(color, progress, token, stackIndex = 0, stackSize = 1) {
    const [x, y] = L.cellOf(color, progress, token);
    let ox = 0;
    let oz = 0;
    if (stackSize > 1 && progress >= 0 && progress < L.FINISH) {
      const a = (stackIndex / stackSize) * Math.PI * 2 + 0.6;
      ox = Math.cos(a) * 0.22;
      oz = Math.sin(a) * 0.22;
    }
    return new THREE.Vector3(wx(x) + ox, 0, wz(y) + oz);
  }

  makePawn(color) {
    const g = new THREE.Group();
    const mat = this.pawnMats[color].clone();
    const body = new THREE.Mesh(this.pawnGeo.body, mat);
    const head = new THREE.Mesh(this.pawnGeo.head, mat);
    [body, head].forEach((m) => {
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    });
    g.userData.mat = mat;
    this.scene.add(g);
    return g;
  }

  // seats: [{ seat, color, tokens, gone }]
  setPawns(seats) {
    const seen = new Set();
    const squares = new Map();
    seats.forEach((s) => {
      if (s.gone) return;
      s.tokens.forEach((p, t) => {
        if (p < 0 || p >= L.FINISH) return;
        const [x, y] = L.cellOf(s.color, p, t);
        const k = `${x},${y}`;
        if (!squares.has(k)) squares.set(k, []);
        squares.get(k).push(`${s.seat}:${t}`);
      });
    });
    seats.forEach((s) => {
      if (s.gone) return;
      s.tokens.forEach((p, t) => {
        const key = `${s.seat}:${t}`;
        seen.add(key);
        let pawn = this.pawns.get(key);
        if (!pawn) {
          pawn = this.makePawn(s.color);
          pawn.userData.seat = s.seat;
          pawn.userData.token = t;
          this.pawns.set(key, pawn);
        }
        let idx = 0;
        let size = 1;
        if (p >= 0 && p < L.FINISH) {
          const [x, y] = L.cellOf(s.color, p, t);
          const list = squares.get(`${x},${y}`);
          idx = list.indexOf(key);
          size = list.length;
        }
        if (!pawn.userData.moving) pawn.position.copy(this.worldOf(s.color, p, t, idx, size));
        pawn.scale.setScalar(p >= L.FINISH ? 0.7 : 1);
      });
    });
    this.pawns.forEach((pawn, key) => {
      if (!seen.has(key)) {
        this.scene.remove(pawn);
        this.pawns.delete(key);
      }
    });
  }

  setMovable(keys, color) {
    this.movable = new Set(keys);
    this.rings.clear();
    keys.forEach((key) => {
      const pawn = this.pawns.get(key);
      if (!pawn) return;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.36, 0.5, 40),
        new THREE.MeshBasicMaterial({ color: HEX[color] || '#ffd166', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.userData.pawn = pawn;
      this.rings.add(ring);
    });
  }

  // Hop a pawn along its path, one square at a time.
  async movePawn(seat, token, color, from, to) {
    const pawn = this.pawns.get(`${seat}:${token}`);
    if (!pawn) return;
    pawn.userData.moving = true;
    const steps = [];
    if (from < 0) steps.push(0);
    else for (let p = from + 1; p <= to; p += 1) steps.push(p);
    for (const p of steps) {
      const start = pawn.position.clone();
      const end = this.worldOf(color, p, token);
      const hop = p === 0 && from < 0 ? 1.2 : 0.55;
      await this.tween(from < 0 ? 420 : 170, (t) => {
        pawn.position.lerpVectors(start, end, easeInOut(t));
        pawn.position.y = Math.sin(t * Math.PI) * hop;
      });
      this.onStep?.();
    }
    pawn.userData.moving = false;
  }

  // A bumped pawn flies back to its yard, spinning.
  async bumpPawn(seat, token, color) {
    const pawn = this.pawns.get(`${seat}:${token}`);
    if (!pawn) return;
    pawn.userData.moving = true;
    const start = pawn.position.clone();
    const end = this.worldOf(color, -1, token);
    this.burst(start, HEX[color]);
    await this.tween(700, (t) => {
      pawn.position.lerpVectors(start, end, easeInOut(t));
      pawn.position.y = Math.sin(t * Math.PI) * 3;
      pawn.rotation.x = t * Math.PI * 4;
    });
    pawn.rotation.set(0, 0, 0);
    pawn.userData.moving = false;
  }

  celebrate(color) {
    this.burst(new THREE.Vector3(0, 0.9, 0), HEX[color], 60);
  }

  // Throw the die towards a colour's yard and land on `value`.
  async rollDie(value, color) {
    const die = this.die;
    die.visible = true;
    const [yx, yy] = L.YARD[color];
    const end = new THREE.Vector3(wx(yx + 3), 0.4, wz(yy + 3));
    const start = new THREE.Vector3(end.x * 0.3, 3, end.z * 0.3);
    const spin = new THREE.Vector3(8 + Math.random() * 6, 5 + Math.random() * 5, 7 + Math.random() * 4);
    const final = new THREE.Quaternion().setFromEuler(UP_ROT[value]);
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
    final.premultiply(yaw);
    const q = new THREE.Quaternion();
    await this.tween(820, (t) => {
      const e = 1 - Math.pow(1 - t, 3);
      die.position.lerpVectors(start, end, e);
      die.position.y = 0.4 + Math.abs(Math.cos(t * Math.PI * 2.5)) * (1 - t) * 2.2;
      // Tumble, then settle onto the rolled face.
      const k = 1 - e;
      q.setFromEuler(new THREE.Euler(spin.x * k, spin.y * k, spin.z * k));
      die.quaternion.copy(final).multiply(q);
      if (t > 0.3 && !this.dieBounced) {
        this.dieBounced = true;
        this.onDieBounce?.();
      }
    });
    this.dieBounced = false;
    die.quaternion.copy(final);
  }

  hideDie() {
    this.die.visible = false;
  }

  burst(pos, hex, count = 26) {
    const n = this.quality === 'low' ? Math.round(count / 2) : count;
    const mat = new THREE.MeshBasicMaterial({ color: hex, transparent: true });
    const geo = new THREE.SphereGeometry(0.07, 6, 6);
    const parts = [];
    for (let i = 0; i < n; i += 1) {
      const p = new THREE.Mesh(geo, mat);
      p.position.copy(pos);
      const a = Math.random() * Math.PI * 2;
      p.userData.v = new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 2.5), 2 + Math.random() * 3, Math.sin(a) * (1 + Math.random() * 2.5));
      this.fx.add(p);
      parts.push(p);
    }
    this.tween(900, (t) => {
      parts.forEach((p) => {
        p.position.addScaledVector(p.userData.v, 0.016);
        p.userData.v.y -= 0.14;
      });
      mat.opacity = 1 - t;
    }).then(() => parts.forEach((p) => this.fx.remove(p)));
  }

  pawnAt(event) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const meshes = [];
    this.pawns.forEach((pawn) => pawn.children.forEach((c) => meshes.push(c)));
    const hits = ray.intersectObjects(meshes, false);
    let best = null;
    if (hits.length) {
      const g = hits[0].object.parent;
      best = { seat: g.userData.seat, token: g.userData.token, key: `${g.userData.seat}:${g.userData.token}` };
    } else {
      // Near miss on a small screen: take the closest movable pawn under the finger.
      const p = new THREE.Vector3();
      if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) {
        let dist = 0.7;
        this.pawns.forEach((pawn, key) => {
          if (!this.movable?.has(key)) return;
          const d = Math.hypot(pawn.position.x - p.x, pawn.position.z - p.z);
          if (d < dist) {
            dist = d;
            best = { seat: pawn.userData.seat, token: pawn.userData.token, key };
          }
        });
      }
    }
    return best;
  }

  project(seat, token) {
    const pawn = this.pawns.get(`${seat}:${token}`);
    const v = pawn.position.clone().setY(0.5).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  // Turn the board so a colour's yard sits at the bottom-left.
  setOrientation(color) {
    const [yx, yy] = L.YARD[color] || L.YARD.blue;
    const a = Math.atan2(wx(yx + 3), wz(yy + 3));
    this.azimuthGoal = a - Math.atan2(-4.5, 4.5);
    if (!this.visible) this.azimuth = this.azimuthGoal;
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
    const elev = THREE.MathUtils.degToRad(this.camera.aspect < 0.9 ? 64 : 58);
    const key = `${this.camera.aspect.toFixed(3)}`;
    if (this.fitKey !== key) {
      this.fitKey = key;
      const cam = this.camera.clone();
      const v = new THREE.Vector3();
      const pts = [];
      // Any azimuth: fit the board's circumscribed circle.
      for (let i = 0; i < 24; i += 1) {
        const a = (i / 24) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * 10.6, 0, Math.sin(a) * 10.6));
      }
      let dist = 8;
      for (; dist < 80; dist += 0.2) {
        cam.position.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist);
        cam.lookAt(0, 0, 0);
        cam.updateMatrixWorld();
        if (pts.every((p) => (v.copy(p).project(cam), Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.02))) break;
      }
      this.camDist = dist;
    }
    const az = this.azimuth + this.parallax.x * 0.06;
    const el = elev + this.parallax.y * 0.03;
    const h = Math.cos(el) * this.camDist;
    this.camera.position.set(Math.sin(az) * h, Math.sin(el) * this.camDist, Math.cos(az) * h);
    this.camera.lookAt(0, 0, 0);
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
    const pulse = 0.5 + Math.sin(now / 220) * 0.5;
    this.pawns.forEach((pawn, key) => {
      const on = this.movable?.has(key);
      const goal = on ? 0.15 + pulse * 0.35 : 0;
      pawn.userData.mat.emissiveIntensity += (goal - pawn.userData.mat.emissiveIntensity) * Math.min(1, dt * 10);
      if (!pawn.userData.moving) {
        const lift = on ? 0.08 + pulse * 0.12 + (this.hover?.key === key ? 0.15 : 0) : 0;
        pawn.position.y += (lift - pawn.position.y) * Math.min(1, dt * 10);
      }
    });
    this.rings.children.forEach((ring) => {
      const p = ring.userData.pawn;
      ring.position.set(p.position.x, 0.012, p.position.z);
      ring.scale.setScalar(0.9 + pulse * 0.2);
    });
    let diff = this.azimuthGoal - this.azimuth;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    if (Math.abs(diff) > 0.0005) this.azimuth += diff * Math.min(1, dt * 2.5);
    this.parallax.x += (this.pointer.x - this.parallax.x) * Math.min(1, dt * 2);
    this.parallax.y += (this.pointer.y - this.parallax.y) * Math.min(1, dt * 2);
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }
}
