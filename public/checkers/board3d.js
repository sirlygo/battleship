// 3D checkers board: glossy stacked checkers on a wooden board, rendered with Three.js.
// main.js keeps the game state; this class mirrors it and reports taps on squares.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const Rules = window.CheckersRules;
const SIZE = Rules.SIZE;
const wx = (x) => x - (SIZE - 1) / 2;
const wz = (y) => y - (SIZE - 1) / 2;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const DISC_H = 0.13;

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
  for (let i = 0; i < 80; i += 1) {
    ctx.strokeStyle = grain;
    ctx.globalAlpha = 0.04 + rand() * 0.08;
    ctx.lineWidth = 1 + rand() * 3;
    const y = rand() * size;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += size / 8) ctx.lineTo(x, y + Math.sin(x / 40 + i) * 5 + (rand() - 0.5) * 4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return canvas;
}

function boardTexture({ numbers }) {
  const size = 1024;
  const cell = size / SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const light = woodCanvas(cell, '#ecd6ab', '#9a6a38', 5);
  const dark = woodCanvas(cell, '#6b3a1c', '#241006', 11);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      ctx.save();
      ctx.translate(x * cell, y * cell);
      if ((x + y) % 2) {
        ctx.translate(cell, 0);
        ctx.rotate(Math.PI / 2);
      }
      ctx.drawImage((x + y) % 2 ? dark : light, 0, 0);
      ctx.restore();
      if (numbers && (x + y) % 2) {
        ctx.font = `700 ${Math.round(cell * 0.2)}px "Chakra Petch", sans-serif`;
        ctx.fillStyle = 'rgba(255, 230, 190, 0.55)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(String(y * 4 + Math.floor(x / 2) + 1), x * cell + cell * 0.07, y * cell + cell * 0.05);
      }
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
  g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export class CheckersBoard3D {
  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.visible = false;
    this.flip = false;
    this.numbers = false;
    this.pieces = new Map(); // square index -> { group, piece }
    this.tweens = [];
    this.pointer = new THREE.Vector2();
    this.parallax = new THREE.Vector2();
    this.camAngle = 0;
    this.camAngleGoal = 0;
    this.onSquare = null;

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
    scene.environmentIntensity = 0.4;
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);

    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x2a2018, 0.7));
    const key = new THREE.DirectionalLight(0xffeedd, 2.2);
    key.position.set(-4, 10, 5);
    key.castShadow = true;
    const shadowSize = quality === 'high' ? 2048 : 1024;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
    key.shadow.bias = -0.0005;
    key.shadow.radius = 4;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ec8ff, 0.6);
    rim.position.set(5, 6, -6);
    scene.add(rim);

    this.buildBoard();
    this.buildPieces();
    this.overlays = new THREE.Group();
    this.overlays.position.y = 0.004;
    scene.add(this.overlays);
    this.fx = new THREE.Group();
    scene.add(this.fx);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      if (e.pointerType === 'mouse') this.setHover(this.squareAt(e));
    });
    canvas.addEventListener('pointerleave', () => this.setHover(null));
    canvas.addEventListener('click', (e) => {
      const sq = this.squareAt(e);
      this.onSquare?.(sq ? sq[0] : null, sq ? sq[1] : null);
    });
    this.resize();
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.tick());
    document.fonts?.ready.then(() => this.refreshBoardTexture());
  }

  // ---- construction ------------------------------------------------------

  buildBoard() {
    this.boardMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 });
    this.boardMat.map = boardTexture({ numbers: this.numbers });
    const top = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), this.boardMat);
    top.rotation.x = -Math.PI / 2;
    top.receiveShadow = true;
    this.scene.add(top);

    const frameTex = new THREE.CanvasTexture(woodCanvas(512, '#4a2410', '#150702', 31));
    frameTex.colorSpace = THREE.SRGBColorSpace;
    frameTex.wrapS = frameTex.wrapT = THREE.RepeatWrapping;
    frameTex.repeat.set(3, 0.4);
    const frameMat = new THREE.MeshStandardMaterial({ map: frameTex, roughness: 0.4, metalness: 0.05 });
    const w = 0.55;
    const h = 0.3;
    [
      [8 + w * 2, w, 0, 4 + w / 2],
      [8 + w * 2, w, 0, -4 - w / 2],
      [w, 8, 4 + w / 2, 0],
      [w, 8, -4 - w / 2, 0],
    ].forEach(([sx, sz, x, z]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), frameMat);
      m.position.set(x, -h / 2 + 0.03, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
    });
    // Brass inlay around the playing area.
    const brass = new THREE.MeshStandardMaterial({ color: 0xd4aa4f, metalness: 1, roughness: 0.3 });
    [
      [8.12, 0.06, 0, 4.03],
      [8.12, 0.06, 0, -4.03],
      [0.06, 8.12, 4.03, 0],
      [0.06, 8.12, -4.03, 0],
    ].forEach(([sx, sz, x, z]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.02, sz), brass);
      m.position.set(x, 0.01, z);
      this.scene.add(m);
    });
    const under = new THREE.Mesh(new THREE.BoxGeometry(8, 0.26, 8), frameMat);
    under.position.y = -0.14;
    this.scene.add(under);

    // Shadow on the table, fading into the page.
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), new THREE.ShadowMaterial({ opacity: 0.35 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.position.y = -0.27;
    catcher.receiveShadow = true;
    this.scene.add(catcher);
  }

  buildPieces() {
    // A classic checker: bevelled rim, ridged edge and a recessed face.
    const profile = [
      [0, 0], [0.36, 0], [0.385, 0.012], [0.39, 0.03], [0.385, 0.045], [0.39, 0.06], [0.385, 0.075], [0.39, 0.09],
      [0.385, 0.105], [0.375, 0.122], [0.35, DISC_H], [0.3, DISC_H], [0.28, DISC_H - 0.018], [0.14, DISC_H - 0.02],
      [0.12, DISC_H - 0.012], [0, DISC_H - 0.012],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    this.discGeo = new THREE.LatheGeometry(profile, 48);
    this.discGeo.computeVertexNormals();
    this.ringGeo = new THREE.TorusGeometry(0.21, 0.018, 8, 40);
    this.ringGeo.rotateX(Math.PI / 2);
    this.crownGeo = (() => {
      // Gold crown: a band with five points.
      const shape = new THREE.Shape();
      const pts = 5;
      shape.moveTo(-0.2, 0);
      for (let i = 0; i <= pts; i += 1) {
        const x = -0.2 + (0.4 * i) / pts;
        shape.lineTo(x, i % 2 === 0 ? 0.13 : 0.06);
      }
      shape.lineTo(0.2, 0);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 });
      geo.translate(0, 0, -0.015);
      return geo;
    })();
    const physical = this.quality !== 'low';
    const mat = (color) =>
      physical
        ? new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.12 })
        : new THREE.MeshStandardMaterial({ color, roughness: 0.3 });
    this.mats = {
      r: mat(0xc9261f),
      b: mat(0x1d1b1f),
      gold: new THREE.MeshStandardMaterial({ color: 0xffc94d, metalness: 1, roughness: 0.25, emissive: 0x3a2400, emissiveIntensity: 0.3 }),
      ringR: new THREE.MeshStandardMaterial({ color: 0xff7a6a, roughness: 0.4 }),
      ringB: new THREE.MeshStandardMaterial({ color: 0x55525c, roughness: 0.4 }),
    };
    this.glowTex = glowTexture();
  }

  makeChecker(color) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(this.discGeo, this.mats[color]);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    const ring = new THREE.Mesh(this.ringGeo, color === 'r' ? this.mats.ringR : this.mats.ringB);
    ring.position.y = DISC_H - 0.012;
    g.add(ring);
    return g;
  }

  makePiece(piece) {
    const color = Rules.colorOf(piece);
    const group = new THREE.Group();
    group.add(this.makeChecker(color));
    if (Rules.isKing(piece)) this.addCrown(group, color, false);
    // Selection / movable glow under the piece.
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.glowTex, color: 0xffd166, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    glow.position.y = 0.005;
    group.add(glow);
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.49, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0, depthWrite: false })
    );
    halo.position.y = 0.006;
    group.add(halo);
    group.userData = { glow, halo, lift: 0, color };
    this.scene.add(group);
    return group;
  }

  addCrown(group, color, animate = true) {
    const top = this.makeChecker(color);
    top.position.y = DISC_H;
    const crown = new THREE.Mesh(this.crownGeo, this.mats.gold);
    crown.position.y = DISC_H * 2 - 0.02;
    crown.castShadow = true;
    const crown2 = crown.clone();
    crown2.rotation.y = Math.PI / 2;
    const king = new THREE.Group();
    king.add(top, crown, crown2);
    group.add(king);
    group.userData.king = king;
    if (animate) {
      king.position.y = 1.4;
      this.tween(520, (t) => {
        const bounce = t < 0.75 ? 1 - Math.pow(t / 0.75, 2) : Math.sin(((t - 0.75) / 0.25) * Math.PI) * 0.08;
        king.position.y = 1.4 * Math.max(0, bounce);
        king.rotation.y = (1 - t) * Math.PI * 2;
      });
      this.burst(group.position.x, group.position.z, 0xffd166, 40);
    }
  }

  // ---- public interface --------------------------------------------------

  show(visible) {
    this.canvas.hidden = !visible;
    this.visible = visible;
    if (visible) this.resize();
    else this.tweens.splice(0).forEach((tw) => (tw.update(1), tw.resolve()));
  }

  setOrientation(flip) {
    this.flip = flip;
    this.camAngleGoal = flip ? Math.PI : 0;
    if (!this.visible) this.camAngle = this.camAngleGoal;
  }

  setShowNumbers(show) {
    if (this.numbers === show) return;
    this.numbers = show;
    this.refreshBoardTexture();
  }

  refreshBoardTexture() {
    this.boardMat.map?.dispose();
    this.boardMat.map = boardTexture({ numbers: this.numbers });
    this.boardMat.needsUpdate = true;
  }

  setPosition(board, { appear = false } = {}) {
    this.pieces.forEach((p) => this.scene.remove(p.group));
    this.pieces.clear();
    let n = 0;
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const piece = board[y * SIZE + x];
        if (piece === '.') continue;
        const group = this.makePiece(piece);
        group.position.set(wx(x), 0, wz(y));
        this.pieces.set(y * SIZE + x, { group, piece });
        if (appear && this.visible) this.dropIn(group, n * 30);
        n += 1;
      }
    }
  }

  dropIn(group, delay) {
    group.visible = false;
    group.position.y = 1.6;
    setTimeout(() => {
      group.visible = true;
      this.tween(420, (t) => {
        const bounce = t < 0.8 ? 1 - Math.pow(t / 0.8, 2) : Math.sin(((t - 0.8) / 0.2) * Math.PI) * 0.05;
        group.position.y = 1.6 * Math.max(0, bounce);
      });
    }, delay);
  }

  /** Animates a move: hops along its path, knocking out captured pieces. */
  async playMove(move) {
    const [sx, sy] = move.path[0];
    const entry = this.pieces.get(sy * SIZE + sx);
    if (!entry) return;
    this.pieces.delete(sy * SIZE + sx);
    const g = entry.group;
    g.userData.lift = 0;
    for (let i = 1; i < move.path.length; i += 1) {
      const [x, y] = move.path[i];
      const x0 = g.position.x;
      const z0 = g.position.z;
      const jump = Boolean(move.captures[i - 1]);
      const dur = this.visible ? (jump ? 320 : 240) : 0;
      await this.tween(dur, (t) => {
        const e = easeInOut(t);
        g.position.x = x0 + (wx(x) - x0) * e;
        g.position.z = z0 + (wz(y) - z0) * e;
        g.position.y = Math.sin(Math.PI * t) * (jump ? 0.75 : 0.22);
      });
      const cap = move.captures[i - 1];
      if (cap) this.knockOut(cap[1] * SIZE + cap[0]);
    }
    const [ex, ey] = move.path[move.path.length - 1];
    if (move.promoted) {
      entry.piece = entry.piece.toUpperCase();
      this.addCrown(g, Rules.colorOf(entry.piece), this.visible);
    }
    this.pieces.set(ey * SIZE + ex, entry);
  }

  knockOut(index) {
    const victim = this.pieces.get(index);
    if (!victim) return;
    this.pieces.delete(index);
    const g = victim.group;
    const x0 = g.position.x;
    const z0 = g.position.z;
    const dir = Math.random() < 0.5 ? -1 : 1;
    this.burst(x0, z0, victim.group.userData.color === 'r' ? 0xff5a4a : 0xb0b0c0, 30);
    this.tween(this.visible ? 650 : 0, (t) => {
      g.position.y = Math.sin(t * Math.PI) * 1.1 + t * -0.2;
      g.position.x = x0 + dir * t * 1.2;
      g.position.z = z0 + t * 0.4;
      g.rotation.z = dir * t * Math.PI * 1.5;
      g.scale.setScalar(1 - t * 0.9);
    }).then(() => this.scene.remove(g));
  }

  // Makes the 3D pieces match a board string (after animations settle).
  sync(board) {
    let ok = true;
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const want = board[i];
      const have = this.pieces.get(i)?.piece || '.';
      if (want !== have) ok = false;
    }
    if (!ok) this.setPosition(board);
  }

  burst(x, z, color, count) {
    if (!this.visible) return;
    const geo = new THREE.SphereGeometry(0.035, 6, 4);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const parts = Array.from({ length: count }, () => {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 2;
      return { p: new THREE.Vector3(x, 0.2, z), v: new THREE.Vector3(Math.cos(a) * s, 2 + Math.random() * 2.5, Math.sin(a) * s) };
    });
    this.fx.add(mesh);
    const m = new THREE.Matrix4();
    let last = performance.now();
    this.tween(800, (t) => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      parts.forEach((p, i) => {
        p.v.y -= 9 * dt;
        p.p.addScaledVector(p.v, dt);
        if (p.p.y < 0.02) p.p.y = 0.02;
        m.makeTranslation(p.p.x, p.p.y, p.p.z);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mat.opacity = 1 - t;
    }).then(() => {
      this.fx.remove(mesh);
      geo.dispose();
      mat.dispose();
    });
  }

  /**
   * @param {{ last?: number[][], movable?: number[][], selected?: number[]|null, path?: number[][], targets?: {x,y,jump}[] }} h
   */
  setHighlights({ last = [], movable = [], selected = null, path = [], targets = [] } = {}) {
    this.overlays.clear();
    const sq = (x, y, color, opacity, y0 = 0, scale = 1) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(scale, scale).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
      );
      m.position.set(wx(x), y0, wz(y));
      this.overlays.add(m);
      return m;
    };
    last.forEach(([x, y]) => sq(x, y, 0xdde040, 0.3));
    path.forEach(([x, y]) => sq(x, y, 0x1f8f3a, 0.45, 0.001));
    this.targetMeshes = targets.map(({ x, y, jump }) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(jump ? 0.3 : 0.12, jump ? 0.42 : 0.2, 40).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: jump ? 0xff5a3c : 0x2fd07a, transparent: true, opacity: 0.85, depthWrite: false })
      );
      ring.position.set(wx(x), 0.003, wz(y));
      this.overlays.add(ring);
      return ring;
    });
    const movableSet = new Set(movable.map(([x, y]) => y * SIZE + x));
    const selIndex = selected ? selected[1] * SIZE + selected[0] : -1;
    this.pieces.forEach((p, i) => {
      p.group.userData.lift = i === selIndex ? 0.18 : 0;
      p.group.userData.glowGoal = i === selIndex ? 0.95 : movableSet.has(i) ? 0.45 : 0;
    });
  }

  setHover(square) {
    this.hoverSq = square;
    this.canvas.style.cursor = square ? 'pointer' : 'default';
  }

  squareAt(event) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.06), p)) return null;
    const x = Math.floor(p.x + SIZE / 2);
    const y = Math.floor(p.z + SIZE / 2);
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return null;
    return [x, y];
  }

  // Page coordinates of a square's centre (used by automated tests).
  project(x, y) {
    const v = new THREE.Vector3(wx(x), 0.06, wz(y)).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
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

  fitDistance(elevation) {
    const key = `${this.camera.aspect.toFixed(3)}:${elevation.toFixed(3)}`;
    if (this.fitKey === key) return this.fitDist;
    const cam = this.camera.clone();
    const e = 4.6;
    const corners = [[-e, 0.3, e], [e, 0.3, e], [-e, 0, -e], [e, 0, -e], [-e, 0.5, -e], [e, 0.5, -e]].map(
      ([x, y, z]) => new THREE.Vector3(x, y, z)
    );
    const v = new THREE.Vector3();
    let dist = 6;
    for (; dist < 40; dist += 0.1) {
      cam.position.set(0, Math.sin(elevation) * dist, Math.cos(elevation) * dist);
      cam.lookAt(0, 0, 0.25);
      cam.updateMatrixWorld();
      if (corners.every((c) => (v.copy(c).project(cam), Math.abs(v.x) < 0.96 && Math.abs(v.y) < 0.96))) break;
    }
    this.fitKey = key;
    this.fitDist = dist;
    return dist;
  }

  placeCamera() {
    const angle = this.camAngle;
    const elevation = THREE.MathUtils.degToRad(this.camera.aspect < 0.9 ? 56 : 50);
    const dist = this.fitDistance(elevation);
    const px = this.parallax.x * 0.15;
    const py = this.parallax.y * 0.1;
    const horizontal = Math.cos(elevation) * dist;
    this.camera.position.set(
      Math.sin(angle) * horizontal + Math.cos(angle) * px,
      Math.sin(elevation) * dist + py,
      Math.cos(angle) * horizontal - Math.sin(angle) * px
    );
    this.camera.lookAt(Math.sin(angle) * 0.25, 0, Math.cos(angle) * 0.25);
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
      const t = Math.min((now - tw.start) / tw.duration, 1);
      tw.update(t);
      if (t >= 1) {
        this.tweens.splice(i, 1);
        tw.resolve();
      }
    }
    const pulse = 0.75 + Math.sin(now / 240) * 0.25;
    this.pieces.forEach((p) => {
      const u = p.group.userData;
      const goal = u.lift || 0;
      if (!this.tweens.length || Math.abs(p.group.position.y - goal) < 0.3) {
        p.group.position.y += (goal - p.group.position.y) * Math.min(1, dt * 12);
      }
      const glowGoal = (u.glowGoal || 0) * (u.glowGoal && u.glowGoal < 0.9 ? pulse : 1);
      u.glow.material.opacity += (glowGoal - u.glow.material.opacity) * Math.min(1, dt * 10);
      u.halo.material.opacity += ((u.glowGoal ? 0.35 + glowGoal * 0.65 : 0) - u.halo.material.opacity) * Math.min(1, dt * 10);
      u.halo.material.color.setHex(u.glowGoal > 0.9 ? 0x6dffc4 : 0xffd166);
    });
    this.targetMeshes?.forEach((m) => m.scale.setScalar(0.92 + Math.sin(now / 200) * 0.08));
    const diff = this.camAngleGoal - this.camAngle;
    if (Math.abs(diff) > 0.0005) this.camAngle += diff * Math.min(1, dt * 3);
    this.parallax.x += (this.pointer.x - this.parallax.x) * Math.min(1, dt * 2);
    this.parallax.y += (this.pointer.y - this.parallax.y) * Math.min(1, dt * 2);
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }
}
