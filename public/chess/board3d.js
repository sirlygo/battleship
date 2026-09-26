// 3D chess board: turned wooden pieces on a wooden board, rendered with Three.js.
// Shares its interface with Board2D (board2d.js) so the game logic can use either.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { squareCanvases, makeSetMaterials, makeWizardPiece, shatter } from './piece-sets.js';

const FILES = 'abcdefgh';
const fileOf = (sq) => FILES.indexOf(sq[0]);
const rankOf = (sq) => Number(sq[1]) - 1;
// White sits at +z, so rank 1 is nearest the white player's camera.
const worldX = (sq) => fileOf(sq) - 3.5;
const worldZ = (sq) => 3.5 - rankOf(sq);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PIECE_SCALE = 1.08;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// ---------------------------------------------------------------------------
// Piece geometry (lathe profiles: [radius, height])
// ---------------------------------------------------------------------------

function arc(cx, cy, rx, ry, from, to, steps = 10) {
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = from + ((to - from) * i) / steps;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

const BASE = [
  [0, 0],
  [0.34, 0],
  [0.345, 0.03],
  [0.34, 0.06],
  [0.3, 0.085],
  [0.3, 0.1],
  [0.26, 0.13],
];

const PROFILES = {
  p: [...BASE, [0.22, 0.15], [0.15, 0.2], [0.11, 0.32], [0.1, 0.36], [0.16, 0.38], [0.165, 0.395], [0.11, 0.41],
    ...arc(0, 0.5, 0.125, 0.125, -Math.PI / 2 + 0.55, Math.PI / 2, 12)],
  r: [...BASE, [0.24, 0.15], [0.2, 0.2], [0.18, 0.46], [0.23, 0.5], [0.24, 0.52], [0.24, 0.64], [0.19, 0.64], [0.19, 0.6], [0, 0.6]],
  b: [...BASE, [0.22, 0.15], [0.14, 0.24], [0.1, 0.42], [0.09, 0.47], [0.16, 0.5], [0.165, 0.515], [0.1, 0.535],
    ...arc(0, 0.66, 0.135, 0.17, -Math.PI / 2 + 0.6, Math.PI / 2, 14), [0, 0.83]],
  q: [...BASE, [0.24, 0.15], [0.15, 0.27], [0.105, 0.55], [0.18, 0.6], [0.185, 0.615], [0.12, 0.64], [0.13, 0.7], [0.2, 0.82],
    [0.2, 0.84], [0.15, 0.845], [0.09, 0.87], [0, 0.88]],
  k: [...BASE, [0.24, 0.15], [0.15, 0.28], [0.115, 0.6], [0.19, 0.65], [0.195, 0.665], [0.13, 0.69], [0.15, 0.8], [0.18, 0.86],
    [0.13, 0.88], [0, 0.89]],
  n: [...BASE, [0.24, 0.15], [0.2, 0.2], [0.18, 0.24], [0, 0.24]],
};

function latheGeometry(profile) {
  const pts = profile.map(([x, y]) => new THREE.Vector2(Math.max(0, x), y));
  const geo = new THREE.LatheGeometry(pts, 40);
  geo.computeVertexNormals();
  return geo;
}

function knightHead() {
  const s = new THREE.Shape();
  const pts = [
    [-0.17, 0.2], [0.17, 0.2], [0.14, 0.32], [0.07, 0.4], [0.2, 0.5], [0.3, 0.56], [0.31, 0.63], [0.25, 0.68],
    [0.13, 0.75], [0.1, 0.84], [0.03, 0.77], [-0.06, 0.8], [-0.12, 0.7], [-0.19, 0.55], [-0.2, 0.38],
  ];
  s.moveTo(pts[0][0], pts[0][1]);
  pts.slice(1).forEach(([x, y]) => s.lineTo(x, y));
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.17,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.03,
    bevelSegments: 4,
    curveSegments: 6,
  });
  geo.translate(0, 0, -0.085);
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

function woodCanvas(size, base, grain, seed) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  let r = seed;
  const rand = () => {
    r = (r * 16807) % 2147483647;
    return r / 2147483647;
  };
  for (let i = 0; i < 90; i += 1) {
    ctx.strokeStyle = grain;
    ctx.globalAlpha = 0.04 + rand() * 0.08;
    ctx.lineWidth = 1 + rand() * 3;
    const y = rand() * size;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += size / 8) ctx.lineTo(x, y + Math.sin(x / 40 + i) * 6 + (rand() - 0.5) * 4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return canvas;
}

function boardTexture({ flip, coords, set = 'classic' }) {
  const size = 1024;
  const cell = size / 8;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const custom = squareCanvases(set, cell);
  const light = custom ? custom.light : woodCanvas(cell, '#e8cfa0', '#8a6030', 7);
  const dark = custom ? custom.dark : woodCanvas(cell, '#7a4a28', '#2a1508', 13);
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const rank = 7 - row; // canvas top row is rank 8
      const isLight = (col + rank) % 2 === 1;
      ctx.save();
      ctx.translate(col * cell, row * cell);
      if ((row + col) % 2) {
        ctx.translate(cell, 0);
        ctx.rotate(Math.PI / 2);
      }
      ctx.drawImage(isLight ? light : dark, 0, 0);
      ctx.restore();
    }
  }
  if (coords) {
    ctx.font = `700 ${Math.round(cell * 0.17)}px "Chakra Petch", "Segoe UI", sans-serif`;
    for (let i = 0; i < 8; i += 1) {
      // Rank numbers along the player's left edge, files along their near edge.
      const rankSq = flip ? `h${i + 1}` : `a${i + 1}`;
      const fileSq = flip ? `${FILES[i]}8` : `${FILES[i]}1`;
      [[rankSq, String(i + 1), 'rank'], [fileSq, FILES[i], 'file']].forEach(([sq, text, kind]) => {
        const col = fileOf(sq);
        const row = 7 - rankOf(sq);
        const isLight = (fileOf(sq) + rankOf(sq)) % 2 === 1;
        ctx.save();
        ctx.translate(col * cell + cell / 2, row * cell + cell / 2);
        if (flip) ctx.rotate(Math.PI);
        ctx.fillStyle = isLight ? 'rgba(122, 74, 40, 0.9)' : 'rgba(232, 207, 160, 0.85)';
        ctx.textAlign = kind === 'rank' ? 'left' : 'right';
        ctx.textBaseline = kind === 'rank' ? 'top' : 'bottom';
        const x = kind === 'rank' ? -cell / 2 + cell * 0.06 : cell / 2 - cell * 0.06;
        const y = kind === 'rank' ? -cell / 2 + cell * 0.04 : cell / 2 - cell * 0.03;
        ctx.fillText(text, x, y);
        ctx.restore();
      });
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export class Board3D {
  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    this.inputEl = canvas;
    this.flip = false;
    this.coords = true;
    this.pieces = new Map(); // square -> { group, type, color }
    this.tweens = [];
    this.drag = null;
    this.dirty = true;
    this.pointer = new THREE.Vector2();
    this.parallax = new THREE.Vector2();
    this.quality = quality;
    this.set = 'classic';
    this.setMats = null;
    this.setCache = {};
    this.shake = 0;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = quality !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    this.camAngle = 0;
    this.camAngleGoal = 0;

    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x2a2018, 0.7));
    const key = new THREE.DirectionalLight(0xffeedd, 2.2);
    key.position.set(-4, 10, 5);
    key.castShadow = true;
    const shadowSize = quality === 'high' ? 2048 : 1024;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    key.shadow.bias = -0.0005;
    key.shadow.radius = 4;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ec8ff, 0.6);
    rim.position.set(5, 6, -6);
    scene.add(rim);

    this.buildBoard();
    this.buildMaterials();
    this.buildOverlays();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    });
    this.resize();
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.tick());
  }

  // ---- construction ------------------------------------------------------

  buildBoard() {
    this.boardMat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.0 });
    this.boardMat.map = boardTexture({ flip: this.flip, coords: this.coords });
    const top = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), this.boardMat);
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    this.scene.add(top);
    this.boardTop = top;

    const frameTex = new THREE.CanvasTexture(woodCanvas(512, '#4a2c16', '#1a0c04', 29));
    frameTex.colorSpace = THREE.SRGBColorSpace;
    frameTex.wrapS = frameTex.wrapT = THREE.RepeatWrapping;
    frameTex.repeat.set(3, 0.4);
    const frameMat = new THREE.MeshStandardMaterial({ map: frameTex, roughness: 0.45, metalness: 0.05 });
    this.woodFrameMat = frameMat;
    this.frameMeshes = [];
    const w = 0.55;
    const h = 0.28;
    [
      [8 + w * 2, w, 0, 4 + w / 2],
      [8 + w * 2, w, 0, -4 - w / 2],
      [w, 8, 4 + w / 2, 0],
      [w, 8, -4 - w / 2, 0],
    ].forEach(([sx, sz, x, z]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), frameMat);
      m.position.set(x, -h / 2 + 0.02, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      this.frameMeshes.push(m);
    });
    const under = new THREE.Mesh(new THREE.BoxGeometry(8, 0.26, 8), frameMat);
    under.position.y = -0.14;
    this.scene.add(under);
    this.frameMeshes.push(under);

    // Table beneath, fading into the page background.
    const fade = document.createElement('canvas');
    fade.width = fade.height = 256;
    const fctx = fade.getContext('2d');
    const grad = fctx.createRadialGradient(128, 128, 30, 128, 128, 128);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = grad;
    fctx.fillRect(0, 0, 256, 256);
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 16),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(fade), transparent: true, depthWrite: false })
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.28;
    // Invisible surface that only shows the board's cast shadow.
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.ShadowMaterial({ opacity: 0.35 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = -0.27;
    catcher.receiveShadow = true;
    this.scene.add(catcher);
    this.scene.add(table);
  }

  buildMaterials() {
    // Low quality skips the (costly) clear-coat varnish layer.
    this.materials =
      this.quality === 'low'
        ? {
            w: new THREE.MeshStandardMaterial({ color: 0xf2e8d5, roughness: 0.35 }),
            b: new THREE.MeshStandardMaterial({ color: 0x2b211c, roughness: 0.3 }),
          }
        : {
            w: new THREE.MeshPhysicalMaterial({ color: 0xf2e8d5, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
            b: new THREE.MeshPhysicalMaterial({ color: 0x2b211c, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.15 }),
          };
    this.classicMaterials = this.materials;
    this.geometries = {};
    ['p', 'r', 'b', 'q', 'k', 'n'].forEach((t) => {
      this.geometries[t] = latheGeometry(PROFILES[t]);
    });
    this.geometries.knightHead = knightHead();
    this.geometries.merlon = new THREE.BoxGeometry(0.1, 0.09, 0.1);
    this.geometries.ball = new THREE.SphereGeometry(0.045, 16, 12);
    this.geometries.crossV = new THREE.BoxGeometry(0.055, 0.2, 0.055);
    this.geometries.crossH = new THREE.BoxGeometry(0.16, 0.055, 0.055);
    this.geometries.point = new THREE.SphereGeometry(0.03, 10, 8);
  }

  buildOverlays() {
    const flat = (geo) => {
      geo.rotateX(-Math.PI / 2);
      return geo;
    };
    const mat = (color, opacity, extra = {}) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, ...extra });
    this.overlayGeo = {
      square: flat(new THREE.PlaneGeometry(1, 1)),
      dot: flat(new THREE.CircleGeometry(0.15, 28)),
      ring: flat(new THREE.RingGeometry(0.4, 0.48, 40)),
      frame: flat(new THREE.RingGeometry(0.47, 0.5, 4, 1, Math.PI / 4)),
    };
    this.overlayMat = {
      last: mat(0xdde040, 0.42),
      selected: mat(0x1f8f3a, 0.55),
      target: mat(0x1f8f3a, 0.6),
      check: mat(0xff2a1a, 0.95, { map: glowTexture(), blending: THREE.AdditiveBlending }),
      hover: mat(0xffffff, 0.8),
    };
    this.overlays = new THREE.Group();
    this.overlays.position.y = 0.004;
    this.scene.add(this.overlays);
  }

  // Switches between the classic, Wizard's Chess and Crystal looks, keeping every piece in place.
  setPieceSet(set) {
    if (!['classic', 'wizard', 'crystal'].includes(set) || set === this.set) return;
    this.set = set;
    this.setMats = set === 'classic' ? null : (this.setCache[set] ||= makeSetMaterials(set, this.quality));
    this.materials = set === 'crystal' ? { w: this.setMats.w, b: this.setMats.b } : this.classicMaterials;
    const frame = this.setMats?.frame || this.woodFrameMat;
    this.frameMeshes.forEach((m) => (m.material = frame));
    const boardLook = this.setMats?.board || { roughness: 0.55, metalness: 0 };
    this.boardMat.roughness = boardLook.roughness;
    this.boardMat.metalness = boardLook.metalness;
    this.refreshBoardTexture();
    this.pieces.forEach((p, sq) => {
      const { lift } = p.group.userData;
      this.scene.remove(p.group);
      const group = this.makePiece(p.type, p.color);
      group.position.set(worldX(sq), 0, worldZ(sq));
      group.userData.lift = lift || 0;
      p.group = group;
    });
    this.dirty = true;
  }

  makePiece(type, color) {
    if (this.set === 'wizard') {
      const statue = makeWizardPiece(type, color, this.setMats, this.geometries.knightHead);
      this.scene.add(statue);
      return statue;
    }
    const group = new THREE.Group();
    const material = this.materials[color];
    const add = (geo, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      return m;
    };
    add(this.geometries[type]);
    if (type === 'r') {
      for (let i = 0; i < 4; i += 1) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        const m = add(this.geometries.merlon, Math.cos(a) * 0.18, 0.685, Math.sin(a) * 0.18);
        m.rotation.y = -a;
      }
    } else if (type === 'b') {
      add(this.geometries.ball, 0, 0.86, 0);
    } else if (type === 'q') {
      add(this.geometries.ball, 0, 0.92, 0);
      for (let i = 0; i < 8; i += 1) {
        const a = (i * Math.PI) / 4;
        add(this.geometries.point, Math.cos(a) * 0.19, 0.855, Math.sin(a) * 0.19);
      }
    } else if (type === 'k') {
      add(this.geometries.crossV, 0, 0.98, 0);
      add(this.geometries.crossH, 0, 1.0, 0);
    } else if (type === 'n') {
      const head = add(this.geometries.knightHead);
      head.scale.set(1.05, 1.05, 1.05);
    }
    // Knights show their profile to the players, looking toward the board's centre file.
    group.rotation.y = color === 'w' ? Math.PI : 0;
    group.scale.setScalar(PIECE_SCALE);
    this.scene.add(group);
    return group;
  }

  // ---- layout ------------------------------------------------------------

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  placeCamera() {
    // Orbit around the board; angle 0 is White's side, PI is Black's.
    const angle = this.camAngle;
    const elevation = THREE.MathUtils.degToRad(this.camera.aspect < 0.9 ? 55 : 50);
    const dist = this.fitDistance(elevation);
    const px = this.parallax.x * 0.15;
    const py = this.parallax.y * 0.1;
    const horizontal = Math.cos(elevation) * dist;
    this.camera.position.set(
      Math.sin(angle) * horizontal + Math.cos(angle) * px,
      Math.sin(elevation) * dist + py,
      Math.cos(angle) * horizontal - Math.sin(angle) * px
    );
    this.camera.lookAt(Math.sin(angle) * 0.2, 0, Math.cos(angle) * 0.2);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
    }
  }

  // Smallest camera distance at which every corner of the board's rim stays on screen.
  fitDistance(elevation) {
    const key = `${this.camera.aspect.toFixed(3)}:${elevation.toFixed(3)}`;
    if (this.fitKey === key) return this.fitDist;
    const cam = this.camera.clone();
    const corners = [
      [-4.6, 0.3, 4.6],
      [4.6, 0.3, 4.6],
      [-4.6, 0, -4.6],
      [4.6, 0, -4.6],
      [-4.6, 1.1, -4.6],
      [4.6, 1.1, -4.6],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const v = new THREE.Vector3();
    let dist = 8;
    for (; dist < 40; dist += 0.1) {
      cam.position.set(0, Math.sin(elevation) * dist, Math.cos(elevation) * dist);
      cam.lookAt(0, 0, 0.2);
      cam.updateMatrixWorld();
      const fits = corners.every((c) => {
        v.copy(c).project(cam);
        return Math.abs(v.x) < 0.96 && Math.abs(v.y) < 0.96;
      });
      if (fits) break;
    }
    this.fitKey = key;
    this.fitDist = dist;
    return dist;
  }

  // ---- public interface --------------------------------------------------

  show(visible) {
    this.canvas.hidden = !visible;
    this.visible = visible;
    if (visible) {
      this.resize();
      this.dirty = true;
    }
  }

  setOrientation(flip) {
    if (this.flip === flip && this.boardMat.map) return;
    this.flip = flip;
    this.camAngleGoal = flip ? Math.PI : 0;
    this.refreshBoardTexture();
  }

  setShowCoords(show) {
    if (this.coords === show) return;
    this.coords = show;
    this.refreshBoardTexture();
  }

  refreshBoardTexture() {
    this.boardMat.map?.dispose();
    this.boardMat.map = boardTexture({ flip: this.flip, coords: this.coords, set: this.set });
    this.boardMat.needsUpdate = true;
    this.dirty = true;
  }

  setPosition(chess, { appear = false } = {}) {
    this.pieces.forEach((p) => this.scene.remove(p.group));
    this.pieces.clear();
    chess.board().flat().forEach((p, i) => {
      if (!p) return;
      const group = this.makePiece(p.type, p.color);
      group.position.set(worldX(p.square), 0, worldZ(p.square));
      this.pieces.set(p.square, { group, type: p.type, color: p.color });
      if (appear) this.dropIn(group, i * 12);
    });
    this.dirty = true;
  }

  dropIn(group, delay) {
    group.position.y = 1.5;
    group.visible = false;
    setTimeout(() => {
      group.visible = true;
      this.tween(420, (t) => {
        const bounce = t < 0.8 ? 1 - Math.pow(t / 0.8, 2) : Math.sin(((t - 0.8) / 0.2) * Math.PI) * 0.06;
        group.position.y = 1.5 * Math.max(0, bounce);
      });
    }, delay);
  }

  tween(duration, update) {
    return new Promise((resolve) => {
      this.tweens.push({ start: performance.now(), duration, update, resolve });
      this.dirty = true;
    });
  }

  removePiece(sq, { animate = true } = {}) {
    const piece = this.pieces.get(sq);
    if (!piece) return;
    this.pieces.delete(sq);
    if (!animate) {
      this.scene.remove(piece.group);
      return;
    }
    if (this.set === 'wizard' && this.visible) {
      shatter(this, piece.group, piece.color);
      return;
    }
    const g = piece.group;
    const y0 = g.position.y;
    const spin = (Math.random() - 0.5) * 2;
    this.tween(420, (t) => {
      g.position.y = y0 + Math.sin(t * Math.PI) * 0.6;
      g.rotation.z = spin * t;
      g.scale.setScalar(PIECE_SCALE * (1 - t * t));
    }).then(() => this.scene.remove(g));
  }

  slide(group, from, to, { hop = 0.22, duration = 300 } = {}) {
    const x0 = group.position.x;
    const z0 = group.position.z;
    const x1 = worldX(to);
    const z1 = worldZ(to);
    return this.tween(duration, (t) => {
      const e = easeInOut(t);
      group.position.x = x0 + (x1 - x0) * e;
      group.position.z = z0 + (z1 - z0) * e;
      group.position.y = Math.sin(Math.PI * t) * hop;
    });
  }

  async playMove({ from, to }, chess) {
    const moving = this.pieces.get(from);
    let captured = false;
    if (moving) {
      this.pieces.delete(from);
      const knight = moving.type === 'n';
      const castle = moving.type === 'k' && Math.abs(fileOf(from) - fileOf(to)) === 2;
      const smash = this.set === 'wizard' && this.pieces.has(to);
      const slides = [
        this.slide(moving.group, from, to, {
          hop: knight ? 0.7 : smash ? 0.55 : 0.2,
          duration: knight ? 380 : smash ? 460 : 300,
        }),
      ];
      if (castle) {
        const rank = from[1];
        const [rookFrom, rookTo] = fileOf(to) === 6 ? [`h${rank}`, `f${rank}`] : [`a${rank}`, `d${rank}`];
        const rook = this.pieces.get(rookFrom);
        if (rook) {
          this.pieces.delete(rookFrom);
          this.pieces.set(rookTo, rook);
          slides.push(this.slide(rook.group, rookFrom, rookTo, { hop: 0.5, duration: 380 }));
        }
      }
      await wait(knight ? 260 : 200);
      if (this.pieces.has(to)) {
        this.removePiece(to);
        captured = true;
      }
      this.pieces.set(to, moving);
      await Promise.all(slides);
    }
    return { captured: this.settle(chess).captured || captured };
  }

  applyLocalMove(from, to) {
    const moving = this.pieces.get(from);
    if (!moving) return;
    this.pieces.delete(from);
    if (this.pieces.has(to)) this.removePiece(to);
    this.pieces.set(to, moving);
    moving.group.position.set(worldX(to), 0, worldZ(to));
    this.drag = null;
    this.dirty = true;
  }

  settle(chess) {
    const target = new Map();
    chess.board().flat().forEach((p) => p && target.set(p.square, p));
    let captured = false;
    this.pieces.forEach((piece, sq) => {
      const want = target.get(sq);
      if (!want) {
        this.removePiece(sq);
        captured = true;
      } else if (want.type !== piece.type || want.color !== piece.color) {
        this.removePiece(sq, { animate: false });
        const group = this.makePiece(want.type, want.color);
        group.position.set(worldX(sq), 0, worldZ(sq));
        this.pieces.set(sq, { group, type: want.type, color: want.color });
        this.tween(420, (t) => group.scale.setScalar(PIECE_SCALE * (0.3 + 0.7 * t + Math.sin(t * Math.PI) * 0.25)));
      }
    });
    target.forEach((want, sq) => {
      if (this.pieces.has(sq)) return;
      const group = this.makePiece(want.type, want.color);
      group.position.set(worldX(sq), 0, worldZ(sq));
      this.pieces.set(sq, { group, type: want.type, color: want.color });
    });
    this.dirty = true;
    return { captured };
  }

  // King of the Hill marks the four centre squares with a gold glow.
  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (this.hillGroup) this.scene.remove(this.hillGroup);
    this.hillGroup = null;
    if (mode === 'koth') {
      const g = new THREE.Group();
      ['d4', 'e4', 'd5', 'e5'].forEach((sq) => {
        const m = new THREE.Mesh(this.overlayGeo.square, new THREE.MeshBasicMaterial({ color: 0xffc94d, transparent: true, opacity: 0.28, depthWrite: false }));
        m.position.set(worldX(sq), 0.002, worldZ(sq));
        g.add(m);
      });
      this.hillGroup = g;
      this.scene.add(g);
    }
    this.dirty = true;
  }

  setHighlights({ last = null, selected = null, targets = [], check = null, hover = null } = {}) {
    this.overlays.clear();
    const put = (geoName, matName, sq, y = 0) => {
      const m = new THREE.Mesh(this.overlayGeo[geoName], this.overlayMat[matName]);
      m.position.set(worldX(sq), y, worldZ(sq));
      this.overlays.add(m);
      return m;
    };
    last?.forEach((sq) => put('square', 'last', sq));
    if (selected) put('square', 'selected', selected, 0.001);
    targets.forEach(({ sq, capture }) => put(capture ? 'ring' : 'dot', 'target', sq, 0.002));
    if (hover) put('frame', 'hover', hover, 0.003);
    if (check) {
      const glow = put('square', 'check', check, 0.002);
      glow.scale.setScalar(1.4);
      this.checkGlow = glow;
    } else {
      this.checkGlow = null;
    }
    // Lift the selected piece a little.
    this.pieces.forEach((p, sq) => {
      if (this.drag?.from === sq) return;
      const lifted = sq === selected;
      p.group.userData.lift = lifted ? 0.12 : 0;
    });
    this.dirty = true;
  }

  squareFromEvent(event) {
    const hit = this.pickPoint(event);
    if (!hit) return null;
    const file = Math.floor(hit.x + 4);
    const rank = Math.floor(4 - hit.z);
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    return `${FILES[file]}${rank + 1}`;
  }

  pickPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const point = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point) ? point : null;
  }

  dragStart(sq) {
    const piece = this.pieces.get(sq);
    if (piece) this.drag = { from: sq, piece };
  }

  dragMove(event) {
    if (!this.drag) return;
    const point = this.pickPoint(event);
    if (!point) return;
    const g = this.drag.piece.group;
    g.position.x = THREE.MathUtils.clamp(point.x, -4.2, 4.2);
    g.position.z = THREE.MathUtils.clamp(point.z, -4.2, 4.2);
    g.position.y = 0.45;
    this.dirty = true;
  }

  dragEnd(sq) {
    const piece = this.pieces.get(sq);
    this.drag = null;
    if (!piece) return;
    const g = piece.group;
    const x0 = g.position.x;
    const z0 = g.position.z;
    const y0 = g.position.y;
    this.tween(180, (t) => {
      g.position.x = x0 + (worldX(sq) - x0) * t;
      g.position.z = z0 + (worldZ(sq) - z0) * t;
      g.position.y = y0 * (1 - t);
    });
  }

  // ---- frame loop --------------------------------------------------------

  tick() {
    if (!this.visible) return;
    const dt = Math.min(this.clock.getDelta(), 0.1);
    const now = performance.now();
    let active = this.tweens.length > 0 || Boolean(this.drag) || Boolean(this.checkGlow);

    for (let i = this.tweens.length - 1; i >= 0; i -= 1) {
      const tw = this.tweens[i];
      const t = Math.min((now - tw.start) / tw.duration, 1);
      tw.update(t);
      if (t >= 1) {
        this.tweens.splice(i, 1);
        tw.resolve();
      }
    }

    // Selected-piece lift and camera easing.
    this.pieces.forEach((p) => {
      if (this.drag?.piece === p || this.tweens.length) return;
      const goal = p.group.userData.lift || 0;
      if (Math.abs(p.group.position.y - goal) > 0.001) {
        p.group.position.y += (goal - p.group.position.y) * Math.min(1, dt * 14);
        active = true;
      }
    });
    const angleDiff = this.camAngleGoal - this.camAngle;
    if (Math.abs(angleDiff) > 0.0005) {
      this.camAngle += angleDiff * Math.min(1, dt * 3.2);
      active = true;
    }
    const px = this.pointer.x - this.parallax.x;
    const py = this.pointer.y - this.parallax.y;
    if (Math.abs(px) + Math.abs(py) > 0.002) {
      this.parallax.x += px * Math.min(1, dt * 2);
      this.parallax.y += py * Math.min(1, dt * 2);
      active = true;
    }
    if (this.checkGlow) {
      const s = 1.3 + Math.sin(now / 180) * 0.12;
      this.checkGlow.scale.setScalar(s);
    }
    if (this.shake > 0.001) {
      this.shake *= Math.pow(0.02, dt);
      active = true;
    }

    if (!active && !this.dirty) return;
    this.dirty = false;
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }
}
