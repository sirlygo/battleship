// 3D Clue board: walled rooms, turned pawns and little weapon models, rendered with Three.js.
// main.js drives it with board coordinates (cells, top-left origin) and gets clicks back via onPick.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const Board = window.ClueBoard;
const { SIZE, SUSPECTS, WEAPONS, ROOMS, CENTER } = Board;
const FLOOR = 0.08; // top of the tiles
const WALL_H = 0.42;
const HALF = SIZE / 2;
const wx = (x) => x - HALF + 0.5; // cell x -> world x (cell centre)
const wz = (y) => y - HALF + 0.5;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

function shade(hex, amount) {
  const c = new THREE.Color(hex);
  if (amount > 0) c.lerp(new THREE.Color(0xffffff), amount);
  else c.lerp(new THREE.Color(0x000000), -amount);
  return `#${c.getHexString()}`;
}

function roomTexture(room) {
  const [, , w, h] = room.rect;
  const px = 96;
  const canvas = document.createElement('canvas');
  canvas.width = w * px;
  canvas.height = h * px;
  const ctx = canvas.getContext('2d');
  // Parquet / tiles in the room colour.
  for (let y = 0; y < h * 2; y += 1) {
    for (let x = 0; x < w * 2; x += 1) {
      ctx.fillStyle = shade(room.color, (x + y) % 2 ? 0.06 : -0.08);
      ctx.fillRect((x * px) / 2, (y * px) / 2, px / 2, px / 2);
    }
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 2;
  for (let x = 0; x <= w * 2; x += 1) {
    ctx.beginPath();
    ctx.moveTo((x * px) / 2, 0);
    ctx.lineTo((x * px) / 2, h * px);
    ctx.stroke();
  }
  for (let y = 0; y <= h * 2; y += 1) {
    ctx.beginPath();
    ctx.moveTo(0, (y * px) / 2);
    ctx.lineTo(w * px, (y * px) / 2);
    ctx.stroke();
  }
  // Rug under the name.
  const vign = ctx.createRadialGradient((w * px) / 2, (h * px) / 2, 10, (w * px) / 2, (h * px) / 2, Math.max(w, h) * px * 0.7);
  vign.addColorStop(0, 'rgba(255,255,255,0.06)');
  vign.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vign;
  ctx.fillRect(0, 0, w * px, h * px);
  // Name near the top edge of the room.
  const size = Math.min(px * 0.62, (w * px * 0.86) / (room.name.length * 0.5));
  ctx.font = `700 ${size}px "Playfair Display", Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillText(room.name, (w * px) / 2 + 3, px * 0.78 + 3);
  ctx.fillStyle = 'rgba(255,242,222,0.95)';
  ctx.fillText(room.name, (w * px) / 2, px * 0.78);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function envelopeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 352;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 352);
  g.addColorStop(0, '#efe3c6');
  g.addColorStop(1, '#cdb88e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 352);
  ctx.fillStyle = 'rgba(120, 90, 50, 0.25)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(256, 190);
  ctx.lineTo(512, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(90, 60, 30, 0.4)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.font = '900 54px "Playfair Display", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#8a1620';
  ctx.fillText('CASE FILE', 256, 290);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

function lathe(profile, segments = 32) {
  const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segments);
  geo.computeVertexNormals();
  return geo;
}

function arc(cx, cy, r, from, to, steps = 12) {
  const pts = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = from + ((to - from) * i) / steps;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

// The classic Clue pawn: a tapered body with a round head.
const PAWN_PROFILE = [
  [0, 0], [0.3, 0], [0.305, 0.03], [0.29, 0.07], [0.22, 0.1], [0.19, 0.14],
  [0.12, 0.46], [0.1, 0.52], [0.16, 0.555], [0.165, 0.58], [0.1, 0.61],
  ...arc(0, 0.72, 0.135, -Math.PI / 2 + 0.75, Math.PI / 2, 14),
];

function makeMaterials(quality) {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  return {
    brass: std({ color: 0xd4aa4f, metalness: 1, roughness: 0.28 }),
    steel: std({ color: 0xd9dee4, metalness: 1, roughness: 0.2 }),
    lead: std({ color: 0x8b9199, metalness: 0.75, roughness: 0.42 }),
    gun: std({ color: 0x3a3d42, metalness: 0.9, roughness: 0.32 }),
    wood: std({ color: 0x5b3418, roughness: 0.55 }),
    rope: std({ color: 0xc9a877, roughness: 0.95 }),
    wax: std({ color: 0xf6efdc, roughness: 0.6 }),
    flame: new THREE.MeshBasicMaterial({ color: 0xffc35a }),
    pawn: (color) =>
      quality === 'low'
        ? std({ color, roughness: 0.3 })
        : new THREE.MeshPhysicalMaterial({ color, roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.12 }),
  };
}

function weaponModel(id, M) {
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  switch (id) {
    case 'candlestick': {
      add(
        lathe([[0, 0], [0.2, 0], [0.2, 0.03], [0.14, 0.06], [0.05, 0.1], [0.04, 0.34], [0.06, 0.37], [0.04, 0.4], [0.035, 0.52],
          [0.11, 0.54], [0.11, 0.57], [0.05, 0.575], [0, 0.575]]),
        M.brass
      );
      add(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 16), M.wax, 0, 0.67);
      add(new THREE.SphereGeometry(0.035, 12, 8), M.flame, 0, 0.8).scale.set(1, 1.7, 1);
      break;
    }
    case 'knife': {
      const blade = new THREE.Shape();
      blade.moveTo(0, -0.045);
      blade.lineTo(0.42, -0.02);
      blade.quadraticCurveTo(0.5, 0.0, 0.5, 0.0);
      blade.quadraticCurveTo(0.4, 0.05, 0, 0.05);
      blade.closePath();
      const geo = new THREE.ExtrudeGeometry(blade, { depth: 0.012, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.004, bevelSegments: 2 });
      add(geo, M.steel, -0.12, 0.03, 0, -Math.PI / 2);
      add(new THREE.BoxGeometry(0.03, 0.05, 0.16), M.brass, -0.13, 0.03, 0);
      add(new THREE.CapsuleGeometry(0.035, 0.2, 4, 10), M.wood, -0.28, 0.035, 0, 0, 0, Math.PI / 2);
      break;
    }
    case 'pipe': {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.35, 0.05, 0.05),
        new THREE.Vector3(0.15, 0.05, 0.05),
        new THREE.Vector3(0.28, 0.05, -0.02),
        new THREE.Vector3(0.32, 0.05, -0.2),
      ]);
      add(new THREE.TubeGeometry(curve, 32, 0.045, 12), M.lead);
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 14), M.lead, -0.35, 0.05, 0.05, 0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 14), M.lead, 0.32, 0.05, -0.2, Math.PI / 2);
      break;
    }
    case 'revolver': {
      add(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 12), M.gun, 0.12, 0.08, 0, 0, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.065, 0.065, 0.1, 6), M.gun, -0.06, 0.08, 0, 0, 0, Math.PI / 2);
      add(new THREE.BoxGeometry(0.16, 0.09, 0.07), M.gun, -0.1, 0.08, 0);
      add(new THREE.BoxGeometry(0.08, 0.2, 0.07), M.wood, -0.2, 0.08, 0.06, Math.PI / 2, 0, -0.35);
      add(new THREE.TorusGeometry(0.035, 0.008, 6, 16, Math.PI), M.gun, -0.1, 0.08, 0.06, Math.PI / 2);
      break;
    }
    case 'rope': {
      add(new THREE.TorusGeometry(0.2, 0.032, 10, 36), M.rope, 0, 0.035, 0, Math.PI / 2);
      add(new THREE.TorusGeometry(0.14, 0.032, 10, 30), M.rope, 0.05, 0.07, 0.02, Math.PI / 2);
      const tail = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.18, 0.04, 0.08),
        new THREE.Vector3(0.3, 0.035, 0.18),
        new THREE.Vector3(0.38, 0.035, 0.1),
      ]);
      add(new THREE.TubeGeometry(tail, 16, 0.03, 8), M.rope);
      break;
    }
    case 'wrench': {
      add(new THREE.BoxGeometry(0.48, 0.03, 0.07), M.steel, 0, 0.03, 0);
      const jaw = new THREE.TorusGeometry(0.075, 0.03, 8, 20, Math.PI * 1.45);
      const a = add(jaw, M.steel, 0.29, 0.03, 0, Math.PI / 2, 0, 0);
      a.rotation.z = Math.PI * 0.27;
      add(new THREE.TorusGeometry(0.06, 0.025, 8, 20), M.steel, -0.28, 0.03, 0, Math.PI / 2);
      break;
    }
    default:
      break;
  }
  return g;
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export class ClueBoard3D {
  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.visible = false;
    this.tweens = [];
    this.tokens = new Map(); // suspect -> { group, x, y, mine, active }
    this.weapons = new Map(); // weapon -> { group, x, y }
    this.targets = { squares: new Map(), rooms: new Map() };
    this.hover = null;
    this.onPick = null;
    this.pointer = new THREE.Vector2();
    this.parallax = new THREE.Vector2();

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = quality !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 200);

    scene.add(new THREE.HemisphereLight(0xfff0e0, 0x201418, 0.75));
    const key = new THREE.DirectionalLight(0xfff0dc, 2.1);
    key.position.set(-10, 22, 12);
    key.castShadow = true;
    const shadowSize = quality === 'high' ? 4096 : 2048;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    Object.assign(key.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 60 });
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffb0b8, 0.45);
    rim.position.set(12, 10, -14);
    scene.add(rim);

    this.M = makeMaterials(quality);
    this.buildBoard();
    this.buildPieces();
    this.buildOverlays();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerleave', () => this.setHover(null));
    canvas.addEventListener('click', (e) => this.onClick(e));
    this.resize();
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.tick());

    // Room names use a web font: redraw once it has loaded.
    document.fonts?.ready.then(() => this.refreshLabels());
  }

  // ---- construction ------------------------------------------------------

  buildBoard() {
    const { scene, M } = this;
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a1a1e, roughness: 0.5, metalness: 0.05 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(SIZE + 1.2, 0.5, SIZE + 1.2), frameMat);
    base.position.y = -0.25;
    base.receiveShadow = true;
    scene.add(base);
    const underlay = new THREE.Mesh(
      new THREE.BoxGeometry(SIZE, 0.02, SIZE),
      new THREE.MeshStandardMaterial({ color: 0x1b1210, roughness: 0.9 })
    );
    underlay.position.y = 0.01;
    underlay.receiveShadow = true;
    scene.add(underlay);
    // Gold inlay around the edge.
    const inlay = new THREE.Mesh(new THREE.BoxGeometry(SIZE + 0.5, 0.04, SIZE + 0.5), M.brass);
    inlay.position.y = -0.005;
    scene.add(inlay);

    // Hallway tiles.
    const cells = [];
    for (let y = 0; y < SIZE; y += 1) for (let x = 0; x < SIZE; x += 1) if (Board.isHallway(x, y)) cells.push([x, y]);
    const tileMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
    const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.96, FLOOR, 0.96), tileMat, cells.length);
    const m = new THREE.Matrix4();
    this.tileIndex = new Map();
    this.tileBase = [];
    cells.forEach(([x, y], i) => {
      m.makeTranslation(wx(x), FLOOR / 2, wz(y));
      tiles.setMatrixAt(i, m);
      const c = new THREE.Color((x + y) % 2 ? 0xcdb68a : 0xc0a77a);
      tiles.setColorAt(i, c);
      this.tileBase.push(c);
      this.tileIndex.set(Board.key(x, y), i);
    });
    tiles.receiveShadow = true;
    scene.add(tiles);
    this.tiles = tiles;

    // Start squares: a coloured disc for each suspect.
    SUSPECTS.forEach((s) => {
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(0.3, 24),
        new THREE.MeshStandardMaterial({ color: s.color, roughness: 0.5, transparent: true, opacity: 0.8 })
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(wx(s.start[0]), FLOOR + 0.002, wz(s.start[1]));
      disc.receiveShadow = true;
      scene.add(disc);
    });

    // Rooms: floors, walls with door gaps, passages.
    this.roomFloors = new Map();
    const wallGeo = new THREE.BoxGeometry(1, WALL_H, 0.14);
    const segments = [];
    ROOMS.forEach((room) => {
      const [x, y, w, h] = room.rect;
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(w, FLOOR, h),
        [
          new THREE.MeshStandardMaterial({ color: room.color }),
          new THREE.MeshStandardMaterial({ color: room.color }),
          new THREE.MeshStandardMaterial({ map: roomTexture(room), roughness: 0.6 }),
          new THREE.MeshStandardMaterial({ color: room.color }),
          new THREE.MeshStandardMaterial({ color: room.color }),
          new THREE.MeshStandardMaterial({ color: room.color }),
        ]
      );
      floor.position.set(x + w / 2 - HALF, FLOOR / 2, y + h / 2 - HALF);
      floor.receiveShadow = true;
      scene.add(floor);
      this.roomFloors.set(room.id, floor);

      const isDoor = (rx, ry, hx, hy) => room.doors.some((d) => d[0] === hx && d[1] === hy && d[2] === rx && d[3] === ry);
      const wallColor = new THREE.Color(shade(room.color, -0.35));
      for (let cx = x; cx < x + w; cx += 1) {
        if (!isDoor(cx, y, cx, y - 1)) segments.push([cx + 0.5 - HALF, y - HALF, 0, wallColor]);
        if (!isDoor(cx, y + h - 1, cx, y + h)) segments.push([cx + 0.5 - HALF, y + h - HALF, 0, wallColor]);
      }
      for (let cy = y; cy < y + h; cy += 1) {
        if (!isDoor(x, cy, x - 1, cy)) segments.push([x - HALF, cy + 0.5 - HALF, Math.PI / 2, wallColor]);
        if (!isDoor(x + w - 1, cy, x + w, cy)) segments.push([x + w - HALF, cy + 0.5 - HALF, Math.PI / 2, wallColor]);
      }
      // Brass thresholds in the doorways.
      room.doors.forEach(([hx, hy, rx, ry]) => {
        const sill = new THREE.Mesh(new THREE.BoxGeometry(hx !== rx ? 0.14 : 0.8, 0.02, hx !== rx ? 0.8 : 0.14), M.brass);
        sill.position.set((wx(hx) + wx(rx)) / 2, FLOOR + 0.01, (wz(hy) + wz(ry)) / 2);
        scene.add(sill);
      });
      if (room.passage) {
        const cornerX = x > 0 ? x + w - 1 : x;
        const cornerY = y > 0 ? y + h - 1 : y;
        const hole = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.8), new THREE.MeshStandardMaterial({ color: 0x050303, roughness: 1 }));
        hole.position.set(wx(cornerX), FLOOR + 0.005, wz(cornerY));
        scene.add(hole);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.035, 8, 4, Math.PI * 2), M.brass);
        ring.rotation.set(Math.PI / 2, 0, Math.PI / 4);
        ring.position.set(wx(cornerX), FLOOR + 0.02, wz(cornerY));
        scene.add(ring);
        // Steps going down.
        for (let i = 0; i < 3; i += 1) {
          const step = new THREE.Mesh(new THREE.BoxGeometry(0.6 - i * 0.15, 0.02, 0.18), new THREE.MeshStandardMaterial({ color: 0x3a2a22 }));
          step.position.set(wx(cornerX), FLOOR + 0.012, wz(cornerY) - 0.2 + i * 0.2);
          scene.add(step);
        }
      }
    });
    const walls = new THREE.InstancedMesh(wallGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 }), segments.length);
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    segments.forEach(([x, z, rot, color], i) => {
      q.setFromAxisAngle(up, rot);
      m.compose(new THREE.Vector3(x, FLOOR + WALL_H / 2, z), q, new THREE.Vector3(1.07, 1, 1));
      walls.setMatrixAt(i, m);
      walls.setColorAt(i, color);
    });
    walls.castShadow = true;
    walls.receiveShadow = true;
    scene.add(walls);

    // The locked cellar in the middle, with the case file on top.
    const [cx, cy, cw, ch] = CENTER;
    const cellar = new THREE.Mesh(
      new THREE.BoxGeometry(cw, 0.5, ch),
      new THREE.MeshStandardMaterial({ color: 0x2a1418, roughness: 0.55 })
    );
    cellar.position.set(cx + cw / 2 - HALF, 0.25, cy + ch / 2 - HALF);
    cellar.castShadow = true;
    cellar.receiveShadow = true;
    scene.add(cellar);
    const envTex = envelopeTexture();
    this.envelopeMat = new THREE.MeshStandardMaterial({ map: envTex, roughness: 0.8 });
    const envelope = new THREE.Mesh(new THREE.BoxGeometry(3, 0.06, 2.06), [
      new THREE.MeshStandardMaterial({ color: 0xd8c59c }),
      new THREE.MeshStandardMaterial({ color: 0xd8c59c }),
      this.envelopeMat,
      new THREE.MeshStandardMaterial({ color: 0xd8c59c }),
      new THREE.MeshStandardMaterial({ color: 0xd8c59c }),
      new THREE.MeshStandardMaterial({ color: 0xd8c59c }),
    ]);
    envelope.position.set(cx + cw / 2 - HALF, 0.53, cy + ch / 2 - HALF);
    envelope.rotation.y = -0.12;
    envelope.castShadow = true;
    scene.add(envelope);
    const seal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.24, 0.06, 24),
      new THREE.MeshStandardMaterial({ color: 0xa3121f, roughness: 0.35 })
    );
    seal.position.set(envelope.position.x, 0.58, envelope.position.z - 0.12);
    seal.castShadow = true;
    scene.add(seal);
    this.envelope = envelope;
  }

  refreshLabels() {
    ROOMS.forEach((room) => {
      const floor = this.roomFloors.get(room.id);
      const mat = floor.material[2];
      mat.map.dispose();
      mat.map = roomTexture(room);
      mat.needsUpdate = true;
    });
    this.envelopeMat.map.dispose();
    this.envelopeMat.map = envelopeTexture();
    this.envelopeMat.needsUpdate = true;
  }

  buildPieces() {
    const pawnGeo = lathe(PAWN_PROFILE, 40);
    const ringGeo = new THREE.RingGeometry(0.44, 0.54, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const glow = glowTexture();
    SUSPECTS.forEach((s) => {
      const group = new THREE.Group();
      const body = new THREE.Mesh(pawnGeo, this.M.pawn(s.color));
      body.castShadow = true;
      body.receiveShadow = true;
      body.scale.setScalar(1.5);
      group.add(body);
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false })
      );
      ring.position.y = 0.012;
      ring.visible = false;
      group.add(ring);
      const halo = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xffd166, map: glow, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      halo.position.y = 0.01;
      group.add(halo);
      group.position.set(wx(s.start[0]), FLOOR, wz(s.start[1]));
      this.scene.add(group);
      this.tokens.set(s.id, { group, body, ring, halo, x: s.start[0], y: s.start[1], placed: false, active: false });
    });
    WEAPONS.forEach((w) => {
      const group = weaponModel(w.id, this.M);
      group.scale.setScalar(2.1);
      group.visible = false;
      this.scene.add(group);
      this.weapons.set(w.id, { group, room: null, x: 0, y: 0 });
    });
  }

  buildOverlays() {
    const glow = glowTexture();
    this.targetMat = new THREE.MeshBasicMaterial({ color: 0xff9f1a, transparent: true, opacity: 0.7, depthWrite: false });
    this.targetHoverMat = new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.95, depthWrite: false });
    this.targetGeo = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);
    this.roomTargetMat = new THREE.MeshBasicMaterial({
      color: 0xffc94d,
      map: glow,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.roomFrameMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, depthWrite: false });
    this.overlay = new THREE.Group();
    this.scene.add(this.overlay);
  }

  // ---- layout ------------------------------------------------------------

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
    const elevation = THREE.MathUtils.degToRad(62);
    const dist = this.fitDistance(elevation);
    const px = this.parallax.x * 0.5;
    const py = this.parallax.y * 0.3;
    this.camera.position.set(px, Math.sin(elevation) * dist + py, Math.cos(elevation) * dist);
    this.camera.lookAt(0, 0, 0.6);
  }

  fitDistance(elevation) {
    const key = `${this.camera.aspect.toFixed(3)}`;
    if (this.fitKey === key) return this.fitDist;
    const cam = this.camera.clone();
    const e = HALF + 0.6;
    const corners = [
      [-e, 0, e], [e, 0, e], [-e, 0, -e], [e, 0, -e], [-e, 0.8, -e], [e, 0.8, -e],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const v = new THREE.Vector3();
    let dist = 20;
    for (; dist < 150; dist += 0.25) {
      cam.position.set(0, Math.sin(elevation) * dist, Math.cos(elevation) * dist);
      cam.lookAt(0, 0, 0.6);
      cam.updateMatrixWorld();
      if (corners.every((c) => (v.copy(c).project(cam), Math.abs(v.x) < 0.97 && Math.abs(v.y) < 0.97))) break;
    }
    this.fitKey = key;
    this.fitDist = dist;
    return dist;
  }

  // ---- public interface --------------------------------------------------

  show(visible) {
    this.canvas.hidden = !visible;
    this.visible = visible;
    if (visible) this.resize();
  }

  /**
   * @param {{id: string, x: number, y: number, mine: boolean, active: boolean}[]} list  cell coords (top-left)
   * @param {'glide'|'hop'|'jump'|'instant'} mode
   */
  setTokens(list, mode = 'glide') {
    list.forEach(({ id, x, y, mine, active }) => {
      const t = this.tokens.get(id);
      t.ring.visible = mine;
      t.active = active;
      const moved = Math.abs(t.x - x) > 0.001 || Math.abs(t.y - y) > 0.001;
      t.x = x;
      t.y = y;
      const tx = x - HALF + 0.5;
      const tz = y - HALF + 0.5;
      const g = t.group;
      if (!t.placed || mode === 'instant') {
        t.placed = true;
        g.position.set(tx, FLOOR, tz);
        return;
      }
      if (!moved) return;
      const x0 = g.position.x;
      const z0 = g.position.z;
      const dur = mode === 'hop' ? 140 : mode === 'jump' ? 620 : 320;
      const height = mode === 'hop' ? 0.28 : mode === 'jump' ? 1.4 : 0;
      t.moving = (t.moving || 0) + 1;
      this.tween(dur, (k) => {
        const e = mode === 'hop' ? k : easeInOut(k);
        g.position.x = x0 + (tx - x0) * e;
        g.position.z = z0 + (tz - z0) * e;
        g.position.y = FLOOR + Math.sin(Math.PI * k) * height;
      }).then(() => {
        t.moving -= 1;
      });
    });
  }

  /** @param {Record<string, [number, number]>} positions  weapon -> cell coords (top-left) */
  setWeapons(positions, { instant = false } = {}) {
    this.weapons.forEach((w, id) => {
      const pos = positions[id];
      if (!pos) {
        w.group.visible = false;
        w.placed = false;
        return;
      }
      const [x, y] = pos;
      const tx = x - HALF + 0.5;
      const tz = y - HALF + 0.5;
      const g = w.group;
      g.visible = true;
      if (!w.placed || instant) {
        w.placed = true;
        w.x = x;
        w.y = y;
        g.position.set(tx, FLOOR, tz);
        g.rotation.y = 0.3 + (id.length % 3) * 0.4;
        return;
      }
      if (Math.abs(w.x - x) < 0.001 && Math.abs(w.y - y) < 0.001) return;
      w.x = x;
      w.y = y;
      const x0 = g.position.x;
      const z0 = g.position.z;
      const r0 = g.rotation.y;
      this.tween(900, (k) => {
        const e = easeInOut(k);
        g.position.x = x0 + (tx - x0) * e;
        g.position.z = z0 + (tz - z0) * e;
        g.position.y = FLOOR + Math.sin(Math.PI * k) * 2.2;
        g.rotation.y = r0 + e * Math.PI * 2;
      });
    });
  }

  /** @param {{squares: Map<string, any>, rooms: Map<string, any>}|null} options */
  setTargets(options) {
    this.overlay.clear();
    this.targets = { squares: new Map(), rooms: new Map() };
    this.setHover(null);
    if (!options) return;
    options.squares.forEach((_p, k) => {
      const [x, y] = k.split(',').map(Number);
      const mesh = new THREE.Mesh(this.targetGeo, this.targetMat);
      mesh.position.set(wx(x), FLOOR + 0.006, wz(y));
      this.overlay.add(mesh);
      this.targets.squares.set(k, mesh);
    });
    options.rooms.forEach((_p, id) => {
      const [x, y, w, h] = Board.room(id).rect;
      const group = new THREE.Group();
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2), this.roomTargetMat);
      fill.position.y = FLOOR + 0.008;
      group.add(fill);
      const edges = [
        [w, 0.08, 0, -h / 2 + 0.04],
        [w, 0.08, 0, h / 2 - 0.04],
        [0.08, h, -w / 2 + 0.04, 0],
        [0.08, h, w / 2 - 0.04, 0],
      ];
      edges.forEach(([sx, sz, ox, oz]) => {
        const e = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz).rotateX(-Math.PI / 2), this.roomFrameMat);
        e.position.set(ox, FLOOR + 0.01, oz);
        group.add(e);
      });
      group.position.set(x + w / 2 - HALF, 0, y + h / 2 - HALF);
      this.overlay.add(group);
      this.targets.rooms.set(id, group);
    });
  }

  setTrail(cells) {
    this.tileBase.forEach((c, i) => this.tiles.setColorAt(i, c));
    const hot = new THREE.Color(0xf3dc9a);
    cells.forEach(([x, y]) => {
      const i = this.tileIndex.get(Board.key(x, y));
      if (i !== undefined) this.tiles.setColorAt(i, hot);
    });
    this.tiles.instanceColor.needsUpdate = true;
  }

  // ---- input -------------------------------------------------------------

  // Page coordinates of a cell centre (used by automated tests).
  project(x, y) {
    const v = new THREE.Vector3(wx(x), FLOOR, wz(y)).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  cellFromEvent(event) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const point = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR), point)) return null;
    const x = Math.floor(point.x + HALF);
    const y = Math.floor(point.z + HALF);
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return null;
    return [x, y];
  }

  targetAt(event) {
    const cell = this.cellFromEvent(event);
    if (!cell) return null;
    const k = Board.key(cell[0], cell[1]);
    if (this.targets.squares.has(k)) return { x: cell[0], y: cell[1], k };
    const room = Board.roomAt(cell[0], cell[1]);
    if (room && this.targets.rooms.has(room.id)) return { room: room.id };
    return null;
  }

  setHover(target) {
    const key = target ? target.k || target.room : null;
    if (this.hoverKey === key) return;
    if (this.hoverKey) {
      const sq = this.targets.squares.get(this.hoverKey);
      if (sq) sq.material = this.targetMat;
      const rm = this.targets.rooms.get(this.hoverKey);
      if (rm) rm.children[0].material = this.roomTargetMat;
    }
    this.hoverKey = key;
    if (key) {
      const sq = this.targets.squares.get(key);
      if (sq) sq.material = this.targetHoverMat;
      const rm = this.targets.rooms.get(key);
      if (rm) rm.children[0].material = this.targetHoverMat;
    }
    this.canvas.style.cursor = key ? 'pointer' : 'default';
  }

  onPointerMove(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    if (event.pointerType === 'mouse') this.setHover(this.targetAt(event));
  }

  onClick(event) {
    const target = this.targetAt(event);
    if (!target || !this.onPick) return;
    this.onPick(target.room ? { room: target.room } : { x: target.x, y: target.y });
  }

  // ---- animation ---------------------------------------------------------

  tween(duration, update) {
    return new Promise((resolve) => {
      this.tweens.push({ start: performance.now(), duration, update, resolve });
    });
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
    // The pawn whose turn it is bobs and glows.
    this.tokens.forEach((t) => {
      const goal = t.active ? 0.55 : 0;
      t.halo.material.opacity += (goal - t.halo.material.opacity) * Math.min(1, dt * 6);
      if (!t.moving) {
        const bob = t.active ? Math.abs(Math.sin(now / 320)) * 0.16 : 0;
        t.body.position.y += (bob - t.body.position.y) * Math.min(1, dt * 12);
      }
      t.halo.scale.setScalar(1 + Math.sin(now / 300) * 0.08);
    });
    const pulse = 0.4 + Math.sin(now / 260) * 0.2;
    this.targetMat.opacity = 0.62 + Math.sin(now / 260) * 0.2;
    this.roomTargetMat.opacity = pulse;
    // Gentle parallax following the pointer.
    this.parallax.x += (this.pointer.x - this.parallax.x) * Math.min(1, dt * 2);
    this.parallax.y += (this.pointer.y - this.parallax.y) * Math.min(1, dt * 2);
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }
}

