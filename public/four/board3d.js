// 3D Four in a Row: a glossy blue rack on a wooden table, rendered with Three.js.
// main.js keeps the game state; this class mirrors it and reports taps on columns.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const Rules = window.FourRules;
const DISC_R = 0.42;
const DISC_T = 0.17;
const HOLE_R = 0.4;
const PANEL_T = 0.09;
const GAP = DISC_T / 2 + 0.03;
const BASE_Y = 0.55; // centre of the bottom row above the table
const COLORS = { r: 0xd8262d, y: 0xf6bf14 };
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

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
    for (let x = 0; x <= size; x += size / 8) ctx.lineTo(x, y + Math.sin(x / 40 + i) * 5 + (rand() - 0.5) * 4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return canvas;
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

// A checker-like disc with a raised rim and a ridged edge, facing +z.
function discGeometry() {
  const pts = [];
  const r = DISC_R;
  const h = DISC_T / 2;
  pts.push(new THREE.Vector2(0, h * 0.55));
  pts.push(new THREE.Vector2(r * 0.62, h * 0.55));
  pts.push(new THREE.Vector2(r * 0.7, h * 0.95));
  pts.push(new THREE.Vector2(r * 0.86, h));
  pts.push(new THREE.Vector2(r * 0.97, h * 0.8));
  pts.push(new THREE.Vector2(r, h * 0.4));
  pts.push(new THREE.Vector2(r, -h * 0.4));
  pts.push(new THREE.Vector2(r * 0.97, -h * 0.8));
  pts.push(new THREE.Vector2(r * 0.86, -h));
  pts.push(new THREE.Vector2(r * 0.7, -h * 0.95));
  pts.push(new THREE.Vector2(r * 0.62, -h * 0.55));
  pts.push(new THREE.Vector2(0, -h * 0.55));
  const g = new THREE.LatheGeometry(pts, 48);
  g.rotateX(Math.PI / 2);
  // Knurled edge: nudge the outermost vertices in and out.
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const rr = Math.hypot(v.x, v.y);
    if (rr > r * 0.99) {
      const a = Math.atan2(v.y, v.x);
      const k = 1 + Math.sin(a * 24) * 0.012;
      pos.setXY(i, v.x * k, v.y * k);
    }
  }
  g.computeVertexNormals();
  return g;
}

export class FourBoard3D {
  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.visible = false;
    this.mode = null;
    this.discs = new Map(); // cell index -> mesh
    this.loose = []; // discs falling out of the rack
    this.tweens = [];
    this.pointer = new THREE.Vector2();
    this.parallax = new THREE.Vector2();
    this.hoverCol = null;
    this.onColumn = null;
    this.onHoverColumn = null;
    this.winCells = [];

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = quality !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);

    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x2a2018, 0.8));
    const key = new THREE.DirectionalLight(0xfff0dd, 2.4);
    key.position.set(-5, 11, 9);
    key.castShadow = true;
    const shadowSize = quality === 'high' ? 2048 : 1024;
    key.shadow.mapSize.set(shadowSize, shadowSize);
    Object.assign(key.shadow.camera, { left: -9, right: 9, top: 10, bottom: -4, far: 40 });
    key.shadow.bias = -0.0006;
    key.shadow.radius = 4;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ec8ff, 0.8);
    rim.position.set(6, 5, -7);
    scene.add(rim);

    this.glowTex = glowTexture();
    this.discGeo = discGeometry();
    this.discMats = {
      r: new THREE.MeshPhysicalMaterial({ color: COLORS.r, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15, emissive: COLORS.r, emissiveIntensity: 0 }),
      y: new THREE.MeshPhysicalMaterial({ color: COLORS.y, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15, emissive: COLORS.y, emissiveIntensity: 0 }),
    };
    this.ghostMats = {
      r: new THREE.MeshStandardMaterial({ color: COLORS.r, transparent: true, opacity: 0.55, roughness: 0.3 }),
      y: new THREE.MeshStandardMaterial({ color: COLORS.y, transparent: true, opacity: 0.55, roughness: 0.3 }),
    };

    this.buildTable();
    this.rack = new THREE.Group();
    scene.add(this.rack);
    this.discLayer = new THREE.Group();
    scene.add(this.discLayer);
    this.fx = new THREE.Group();
    scene.add(this.fx);

    this.ghost = new THREE.Mesh(this.discGeo, this.ghostMats.r);
    this.ghost.visible = false;
    scene.add(this.ghost);
    this.colGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.92, 1),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    scene.add(this.colGlow);

    this.setMode('classic');

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const rect = canvas.getBoundingClientRect();
      this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.onHoverColumn?.(this.columnAt(e));
    });
    canvas.addEventListener('pointerleave', () => this.onHoverColumn?.(null));
    canvas.addEventListener('click', (e) => this.onColumn?.(this.columnAt(e)));
    this.resize();
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.tick());
  }

  // ---- construction ------------------------------------------------------

  buildTable() {
    const tex = new THREE.CanvasTexture(woodCanvas(512, '#6a3a1a', '#221006', 7));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    const table = new THREE.Mesh(new THREE.CircleGeometry(16, 64), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }));
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    this.scene.add(table);
    this.table = table;
  }

  cellX(col) {
    return col - (this.shape.cols - 1) / 2;
  }

  cellY(row) {
    return BASE_Y + (this.shape.rows - 1 - row);
  }

  setMode(mode) {
    const shapeInfo = Rules.shape(mode);
    if (this.mode === mode) return;
    this.mode = mode;
    this.shape = shapeInfo;
    this.clearDiscs();
    this.rack.clear();
    const { cols, rows } = shapeInfo;
    const w = cols + 0.5;
    const h = rows + 0.35;
    const top = BASE_Y - 0.5 + rows + 0.2;
    const bottom = BASE_Y - 0.5 - 0.15;

    const shapePath = new THREE.Shape();
    const x0 = -w / 2;
    const r = 0.22;
    shapePath.moveTo(x0 + r, bottom);
    shapePath.lineTo(x0 + w - r, bottom);
    shapePath.quadraticCurveTo(x0 + w, bottom, x0 + w, bottom + r);
    shapePath.lineTo(x0 + w, top - r);
    shapePath.quadraticCurveTo(x0 + w, top, x0 + w - r, top);
    shapePath.lineTo(x0 + r, top);
    shapePath.quadraticCurveTo(x0, top, x0, top - r);
    shapePath.lineTo(x0, bottom + r);
    shapePath.quadraticCurveTo(x0, bottom, x0 + r, bottom);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const hole = new THREE.Path();
        hole.absarc(this.cellX(col), this.cellY(row), HOLE_R, 0, Math.PI * 2, true);
        shapePath.holes.push(hole);
      }
    }
    const panelGeo = new THREE.ExtrudeGeometry(shapePath, {
      depth: PANEL_T,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.025,
      bevelSegments: 2,
      curveSegments: this.quality === 'low' ? 18 : 28,
    });
    this.rackMat = new THREE.MeshPhysicalMaterial({ color: 0x1d5fd8, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    const front = new THREE.Mesh(panelGeo, this.rackMat);
    front.position.z = GAP;
    const back = new THREE.Mesh(panelGeo, this.rackMat);
    back.position.z = -GAP - PANEL_T;
    [front, back].forEach((m) => {
      m.castShadow = true;
      m.receiveShadow = true;
      this.rack.add(m);
    });
    // Side rails close the gap between the panels, and the slider along the bottom.
    const railMat = new THREE.MeshPhysicalMaterial({ color: 0x174fb8, roughness: 0.35, clearcoat: 0.6 });
    [-1, 1].forEach((side) => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.2, h - 0.1, GAP * 2 + PANEL_T * 2), railMat);
      rail.position.set(side * (w / 2 - 0.1), (top + bottom) / 2, 0);
      rail.castShadow = true;
      this.rack.add(rail);
      // Feet
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 2.1), railMat);
      foot.position.set(side * (w / 2 - 0.1), 0.08, 0);
      foot.castShadow = true;
      foot.receiveShadow = true;
      this.rack.add(foot);
      const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 12), railMat);
      brace.rotation.x = Math.PI / 2;
      brace.position.set(side * (w / 2 - 0.1), 0.12, 0);
      this.rack.add(brace);
      // Leg up to the bottom of the rack.
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, bottom, 0.26), railMat);
      leg.position.set(side * (w / 2 - 0.1), bottom / 2, 0);
      leg.castShadow = true;
      this.rack.add(leg);
    });
    this.slider = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.12, GAP * 2 + 0.04), new THREE.MeshPhysicalMaterial({ color: 0xe8edf5, roughness: 0.4, clearcoat: 0.5 }));
    this.slider.position.set(0, bottom + 0.02, 0);
    this.slider.castShadow = true;
    this.rack.add(this.slider);
    this.sliderHome = this.slider.position.x;
    // Little column numbers along the top.
    this.bounds = { top, bottom, w };
    this.colGlow.scale.y = rows;
    this.colGlow.position.set(0, BASE_Y - 0.5 + rows / 2, GAP + PANEL_T + 0.04);
    this.fitKey = null;
  }

  // ---- discs -------------------------------------------------------------

  makeDisc(color) {
    const m = new THREE.Mesh(this.discGeo, this.discMats[color].clone());
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.color = color;
    this.discLayer.add(m);
    return m;
  }

  clearDiscs() {
    this.discs.forEach((m) => this.discLayer.remove(m));
    this.discs.clear();
    this.winCells = [];
  }

  // Instantly mirror a board string.
  setBoard(board, mode) {
    this.setMode(mode);
    const { cols } = this.shape;
    const want = new Map();
    for (let i = 0; i < board.length; i += 1) if (board[i] !== '.') want.set(i, board[i]);
    this.discs.forEach((m, i) => {
      if (want.get(i) !== m.userData.color) {
        this.discLayer.remove(m);
        this.discs.delete(i);
      }
    });
    want.forEach((color, i) => {
      if (this.discs.has(i)) return;
      const m = this.makeDisc(color);
      m.position.set(this.cellX(i % cols), this.cellY(Math.floor(i / cols)), 0);
      this.discs.set(i, m);
    });
    this.setWinLine([]);
  }

  dropDisc(col, row, color) {
    const { cols } = this.shape;
    const m = this.makeDisc(color);
    const x = this.cellX(col);
    const y0 = this.bounds.top + 0.9;
    const y1 = this.cellY(row);
    m.position.set(x, y0, 0);
    this.discs.set(row * cols + col, m);
    const fall = Math.sqrt((y0 - y1) / 18); // seconds under "gravity"
    const duration = Math.max(160, fall * 1000);
    return this.tween(duration, (t) => {
      m.position.y = y0 - (y0 - y1) * t * t;
    })
      .then(() => {
        this.onLand?.(row);
        return this.tween(170, (t) => {
          m.position.y = y1 + Math.sin(t * Math.PI) * 0.12 * (1 - t);
        });
      });
  }

  // The bottom disc slides out under the rack and topples onto the table.
  popDisc(col) {
    const { cols, rows } = this.shape;
    const bottomIdx = (rows - 1) * cols + col;
    const out = this.discs.get(bottomIdx);
    this.discs.delete(bottomIdx);
    const moving = [];
    for (let row = rows - 2; row >= 0; row -= 1) {
      const m = this.discs.get(row * cols + col);
      if (!m) continue;
      this.discs.delete(row * cols + col);
      this.discs.set((row + 1) * cols + col, m);
      moving.push({ m, from: m.position.y, to: this.cellY(row + 1) });
    }
    const jobs = [];
    if (out) {
      const x = out.position.x;
      const y0 = out.position.y;
      jobs.push(
        this.tween(420, (t) => {
          out.position.y = y0 - 0.9 * t * t;
          out.position.z = t * 0.9;
          out.rotation.x = -t * (Math.PI / 2);
          out.position.x = x + t * 0.3;
        }).then(() => this.settleLoose(out))
      );
    }
    moving.forEach(({ m, from, to }) =>
      jobs.push(
        this.tween(260, (t) => {
          m.position.y = from - (from - to) * t * t;
        })
      )
    );
    return Promise.all(jobs);
  }

  settleLoose(m) {
    m.position.y = DISC_T / 2;
    m.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI);
    this.loose.push(m);
    while (this.loose.length > 14) this.discLayer.remove(this.loose.shift());
  }

  // End of a round: pull the slider and let every disc fall out.
  releaseAll() {
    const all = [...this.discs.values()];
    this.discs.clear();
    this.setWinLine([]);
    if (!all.length) return Promise.resolve();
    const x0 = this.slider.position.x;
    const jobs = [
      this.tween(260, (t) => {
        this.slider.position.x = x0 + Math.sin(t * Math.PI) * 0.5;
      }),
    ];
    all.forEach((m, i) => {
      const y0 = m.position.y;
      const drift = (Math.random() - 0.5) * 1.2;
      const spin = (Math.random() - 0.5) * 4;
      jobs.push(
        this.tween(700 + (i % 5) * 40, (t) => {
          m.position.y = y0 - (y0 + 1.2) * t * t;
          m.position.z = t * t * (1.8 + (i % 3) * 0.4);
          m.position.x += drift * 0.01;
          m.rotation.x = -t * spin;
          m.material.transparent = true;
          m.material.opacity = 1 - Math.max(0, t - 0.7) / 0.3;
        }).then(() => this.discLayer.remove(m))
      );
    });
    this.loose.forEach((m) => this.discLayer.remove(m));
    this.loose = [];
    return Promise.all(jobs);
  }

  setWinLine(cells) {
    const { cols } = this.shape;
    this.discs.forEach((m) => (m.userData.win = false));
    this.winCells = cells || [];
    this.winCells.forEach(([c, r]) => {
      const m = this.discs.get(r * cols + c);
      if (m) m.userData.win = true;
    });
    this.fx.clear();
    if (this.winCells.length) {
      const a = this.winCells[0];
      const b = this.winCells[this.winCells.length - 1];
      const start = new THREE.Vector3(this.cellX(a[0]), this.cellY(a[1]), 0);
      const end = new THREE.Vector3(this.cellX(b[0]), this.cellY(b[1]), 0);
      const len = start.distanceTo(end) + 0.7;
      const bar = new THREE.Mesh(
        new THREE.PlaneGeometry(len, 0.22),
        new THREE.MeshBasicMaterial({ color: 0xfff6c0, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      bar.position.copy(start).add(end).multiplyScalar(0.5);
      bar.position.z = GAP + PANEL_T + 0.08;
      bar.rotation.z = Math.atan2(end.y - start.y, end.x - start.x);
      bar.userData.pulse = true;
      this.fx.add(bar);
      this.winCells.forEach(([c, r]) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xfff0a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        s.scale.setScalar(1.5);
        s.position.set(this.cellX(c), this.cellY(r), GAP + PANEL_T + 0.1);
        s.userData.pulse = true;
        this.fx.add(s);
      });
    }
  }

  // Hint arrows over columns: 'win' (you can win here) or 'block' (they threaten here).
  setMarkers(list = []) {
    if (!this.markers) {
      this.markers = new THREE.Group();
      this.scene.add(this.markers);
      this.markerGeo = new THREE.ConeGeometry(0.16, 0.3, 20).rotateX(Math.PI);
    }
    this.markers.clear();
    list.forEach(({ col, kind }) => {
      const m = new THREE.Mesh(
        this.markerGeo,
        new THREE.MeshBasicMaterial({ color: kind === 'win' ? 0x2fd07a : 0xff5a3c, transparent: true, opacity: 0.9 })
      );
      m.position.set(this.cellX(col), this.bounds.top + 0.25, GAP + PANEL_T + 0.25);
      this.markers.add(m);
    });
  }

  // Ghost disc above the column the player is about to use.
  setHover(col, color, { pop = false } = {}) {
    this.hoverCol = col;
    const on = col !== null && col !== undefined && color;
    this.ghost.visible = Boolean(on) && !pop;
    this.canvas.style.cursor = on ? 'pointer' : 'default';
    if (!on) {
      this.colGlowGoal = 0;
      return;
    }
    this.ghost.material = this.ghostMats[color];
    this.ghostGoalX = this.cellX(col);
    if (!this.ghostShown) this.ghost.position.x = this.ghostGoalX;
    this.ghostShown = true;
    this.ghost.position.y = this.bounds.top + 0.65;
    this.colGlow.position.x = this.cellX(col);
    this.colGlow.material.color.setHex(pop ? 0xff8a6a : 0xfff2b0);
    this.colGlowGoal = pop ? 0.2 : 0.12;
  }

  columnAt(event) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p)) return null;
    if (p.y < -0.3 || p.y > this.bounds.top + 2) return null;
    const col = Math.round(p.x + (this.shape.cols - 1) / 2);
    return col >= 0 && col < this.shape.cols ? col : null;
  }

  // Page coordinates of a cell's centre (used by automated tests).
  project(col, row) {
    const v = new THREE.Vector3(this.cellX(col), this.cellY(row), 0).project(this.camera);
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

  fitDistance() {
    const key = `${this.camera.aspect.toFixed(3)}:${this.mode}`;
    if (this.fitKey === key) return this.fitDist;
    const cam = this.camera.clone();
    const { w, top } = this.bounds;
    const hw = w / 2 + 0.2;
    const corners = [[-hw, 0, 1], [hw, 0, 1], [-hw, top + 1.3, 0], [hw, top + 1.3, 0]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    const v = new THREE.Vector3();
    const target = this.lookTarget();
    let dist = 5;
    for (; dist < 60; dist += 0.1) {
      cam.position.set(0, target.y + dist * 0.32, dist);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      if (corners.every((c) => (v.copy(c).project(cam), Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.93))) break;
    }
    this.fitKey = key;
    this.fitDist = dist;
    return dist;
  }

  lookTarget() {
    return new THREE.Vector3(0, (this.bounds.top + 0.6) / 2, 0);
  }

  placeCamera() {
    const dist = this.fitDistance();
    const target = this.lookTarget();
    const yaw = this.parallax.x * 0.1;
    const pitch = this.parallax.y * 0.06;
    this.camera.position.set(Math.sin(yaw) * dist, target.y + dist * (0.32 + pitch), Math.cos(yaw) * dist);
    this.camera.lookAt(target);
  }

  // ---- animation ---------------------------------------------------------

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
    const pulse = 0.5 + Math.sin(now / 180) * 0.5;
    this.discs.forEach((m) => {
      const goal = m.userData.win ? 0.25 + pulse * 0.45 : 0;
      m.material.emissiveIntensity += (goal - m.material.emissiveIntensity) * Math.min(1, dt * 10);
    });
    this.fx.children.forEach((c) => {
      if (c.userData.pulse) c.material.opacity = 0.45 + pulse * 0.45;
    });
    if (this.ghost.visible) {
      this.ghost.position.x += (this.ghostGoalX - this.ghost.position.x) * Math.min(1, dt * 16);
      this.ghost.position.y = this.bounds.top + 0.65 + Math.sin(now / 260) * 0.05;
    }
    this.markers?.children.forEach((m) => {
      m.position.y = this.bounds.top + 0.25 + Math.abs(Math.sin(now / 220)) * 0.12;
    });
    const cg = this.colGlow.material;
    cg.opacity += ((this.colGlowGoal || 0) - cg.opacity) * Math.min(1, dt * 10);
    this.parallax.x += (this.pointer.x - this.parallax.x) * Math.min(1, dt * 2);
    this.parallax.y += (this.pointer.y - this.parallax.y) * Math.min(1, dt * 2);
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }
}

export { easeOut };
