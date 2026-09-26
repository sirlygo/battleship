// 3D Risk board: raised territories on a tabletop ocean, with little armies of
// infantry, cavalry and cannons. main.js feeds it territory state and gets picks back.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MAP = window.RiskMap;
const SCALE = 1 / 50; // map units -> world units
const W = MAP.width * SCALE; // 20
const D = MAP.height * SCALE; // 12
const LAND_H = 0.16;
const RAISE = 0.14;
const wx = (x) => (x - MAP.width / 2) * SCALE;
const wz = (y) => (y - MAP.height / 2) * SCALE;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const NEUTRAL = '#8a8f98';

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

function oceanTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#184563';
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = 'rgba(170, 220, 255, 0.10)';
  ctx.lineWidth = 2;
  for (let y = 0; y < 512; y += 24) {
    ctx.beginPath();
    for (let x = 0; x <= 512; x += 8) ctx.lineTo(x, y + Math.sin((x / 512) * Math.PI * 4 + y) * 5);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 2.4);
  return tex;
}

function woodTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4a2c16';
  ctx.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 60; i += 1) {
    ctx.strokeStyle = `rgba(20, 8, 2, ${0.05 + Math.random() * 0.12})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    const y = Math.random() * 128;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, y + Math.sin(x / 50 + i) * 3);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function nameTexture(name) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '600 44px Inter, "Segoe UI", sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(name).width) + 24;
  c.width = w;
  c.height = 64;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.strokeText(name, w / 2, 32);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText(name, w / 2, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: w / 64 };
}

function badgeCanvas() {
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 128;
  return c;
}

function drawBadge(canvas, count, color, staged) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const cx = 72;
  const cy = 72;
  ctx.beginPath();
  ctx.arc(cx, cy, 42, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy - 3, 40, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();
  ctx.font = `700 ${count >= 100 ? 34 : count >= 10 ? 42 : 48}px "Chakra Petch", "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.strokeText(String(count), cx, cy - 1);
  ctx.fillStyle = '#fff';
  ctx.fillText(String(count), cx, cy - 1);
  if (staged) {
    ctx.beginPath();
    ctx.arc(150, 34, 30, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd166';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#7a4a00';
    ctx.stroke();
    ctx.font = '700 30px "Chakra Petch", sans-serif';
    ctx.fillStyle = '#3a2400';
    ctx.fillText(`+${staged}`, 150, 35);
  }
}

// ---------------------------------------------------------------------------
// Army pieces
// ---------------------------------------------------------------------------

function pieceGeometries() {
  const prep = (geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    geo.rotateX(rx);
    geo.rotateY(ry);
    geo.rotateZ(rz);
    geo.translate(x, y, z);
    return geo.toNonIndexed ? geo.toNonIndexed() : geo;
  };
  const clean = (list) => list.map((g) => {
    g.deleteAttribute('uv');
    return g;
  });
  const infantry = mergeGeometries(
    clean([
      prep(new THREE.CylinderGeometry(0.075, 0.085, 0.03, 16), 0, 0.015),
      prep(new THREE.CylinderGeometry(0.035, 0.055, 0.13, 12), 0, 0.095),
      prep(new THREE.SphereGeometry(0.038, 12, 10), 0, 0.195),
      prep(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 14), 0, 0.225),
      prep(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 6), 0.05, 0.14, 0, 0, 0, 0.1),
    ])
  );
  const cavalry = mergeGeometries(
    clean([
      prep(new THREE.BoxGeometry(0.22, 0.025, 0.1), 0, 0.0125),
      prep(new THREE.CapsuleGeometry(0.045, 0.12, 4, 10), 0, 0.12, 0, 0, 0, Math.PI / 2),
      prep(new THREE.CapsuleGeometry(0.028, 0.08, 4, 8), 0.09, 0.19, 0, 0, 0, -0.7),
      prep(new THREE.BoxGeometry(0.07, 0.04, 0.045), 0.13, 0.23, 0, 0, 0, -0.35),
      ...[[-0.06, 0.035], [0.06, 0.035], [-0.06, -0.035], [0.06, -0.035]].map(([x, z]) =>
        prep(new THREE.CylinderGeometry(0.014, 0.012, 0.09, 6), x, 0.07, z)
      ),
      prep(new THREE.CylinderGeometry(0.028, 0.034, 0.08, 10), -0.01, 0.2, 0),
      prep(new THREE.SphereGeometry(0.026, 10, 8), -0.01, 0.26, 0),
    ])
  );
  const artillery = mergeGeometries(
    clean([
      prep(new THREE.BoxGeometry(0.26, 0.025, 0.14), 0, 0.0125),
      prep(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16), -0.02, 0.085, 0.06, Math.PI / 2),
      prep(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16), -0.02, 0.085, -0.06, Math.PI / 2),
      prep(new THREE.CylinderGeometry(0.03, 0.042, 0.26, 12), 0.05, 0.12, 0, 0, 0, Math.PI / 2 - 0.35),
      prep(new THREE.BoxGeometry(0.14, 0.03, 0.08), -0.08, 0.06, 0, 0, 0, 0.3),
    ])
  );
  [infantry, cavalry, artillery].forEach((g) => g.computeVertexNormals());
  return { infantry, cavalry, artillery };
}

// Which pieces to show for an army count (the badge carries the exact number).
function pieceMix(n) {
  const art = Math.min(4, Math.floor(n / 10));
  let rest = n - art * 10;
  if (art === 4) rest = Math.min(rest, 9);
  const cav = Math.min(1, Math.floor(rest / 5));
  const inf = Math.min(4, rest - cav * 5);
  return { art, cav, inf };
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export class RiskBoard3D {
  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.visible = false;
    this.tweens = [];
    this.terr = new Map();
    this.onPick = null;
    this.onHover = null;
    this.zoom = 1;
    this.pan = new THREE.Vector2(0, 0);
    this.pointers = new Map();
    this.showNames = true;
    this.pulseSet = new Set();

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
    scene.environmentIntensity = 0.35;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);

    scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x1a1410, 0.8));
    const key = new THREE.DirectionalLight(0xfff2e0, 2.2);
    key.position.set(-8, 16, 10);
    key.castShadow = true;
    const size = quality === 'high' ? 4096 : 2048;
    key.shadow.mapSize.set(size, size);
    Object.assign(key.shadow.camera, { left: -12, right: 12, top: 8, bottom: -8, near: 1, far: 50 });
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ec8ff, 0.5);
    rim.position.set(10, 8, -10);
    scene.add(rim);

    this.buildTable();
    this.buildTerritories();
    this.buildPieces();
    this.buildOverlays();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.bindInput();
    this.resize();
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.tick());
    document.fonts?.ready.then(() => this.refreshNames());
  }

  // ---- construction ------------------------------------------------------

  buildTable() {
    const { scene } = this;
    this.oceanTex = oceanTexture();
    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D),
      new THREE.MeshStandardMaterial({ map: this.oceanTex, roughness: 0.35, metalness: 0.1 })
    );
    ocean.rotation.x = -Math.PI / 2;
    ocean.receiveShadow = true;
    scene.add(ocean);
    // Wooden frame.
    const wood = woodTexture();
    const frameMat = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.5 });
    const t = 0.45;
    const h = 0.3;
    [
      [W + t * 2, t, 0, D / 2 + t / 2],
      [W + t * 2, t, 0, -D / 2 - t / 2],
      [t, D, W / 2 + t / 2, 0],
      [t, D, -W / 2 - t / 2, 0],
    ].forEach(([sx, sz, x, z]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), frameMat);
      m.position.set(x, h / 2 - 0.1, z);
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
    });
    const under = new THREE.Mesh(new THREE.BoxGeometry(W + t * 2, 0.2, D + t * 2), frameMat);
    under.position.y = -0.2;
    scene.add(under);
    // Brass inlay.
    const brass = new THREE.MeshStandardMaterial({ color: 0xd4aa4f, metalness: 1, roughness: 0.3 });
    const inlay = new THREE.Mesh(new THREE.BoxGeometry(W + 0.08, 0.02, D + 0.08), brass);
    inlay.position.y = -0.03;
    scene.add(inlay);
  }

  buildTerritories() {
    const loader = new SVGLoader();
    const toShapes = (d) => {
      const data = loader.parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`);
      return data.paths.flatMap((p) => SVGLoader.createShapes(p));
    };
    const extrude = (shapes, depth, bevel) => {
      const geo = new THREE.ExtrudeGeometry(shapes, {
        depth,
        bevelEnabled: bevel,
        bevelThickness: 0.025,
        bevelSize: 1.1,
        bevelSegments: 2,
        curveSegments: 4,
      });
      // Map units -> world: x/y scaled, extrusion (z) upward.
      geo.translate(-MAP.width / 2, -MAP.height / 2, -depth);
      geo.scale(SCALE, SCALE, 1);
      geo.rotateX(Math.PI / 2);
      geo.computeVertexNormals();
      return geo;
    };

    // Continent plinths, slightly lower, in the continent colour.
    MAP.continents.forEach((c) => {
      const plinth = new THREE.Mesh(
        extrude(toShapes(c.path), 0.07, false),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(c.color).multiplyScalar(0.55), roughness: 0.6 })
      );
      plinth.scale.set(1.012, 1, 1.012);
      plinth.receiveShadow = true;
      plinth.castShadow = true;
      this.scene.add(plinth);
    });

    const lineMat = new THREE.LineBasicMaterial({ color: 0x120c08, transparent: true, opacity: 0.8 });
    MAP.territories.forEach((t) => {
      const shapes = toShapes(t.path);
      const top = new THREE.MeshStandardMaterial({ color: NEUTRAL, roughness: 0.55, metalness: 0.02 });
      const side = new THREE.MeshStandardMaterial({ color: NEUTRAL, roughness: 0.7 });
      const mesh = new THREE.Mesh(extrude(shapes, LAND_H, true), [top, side]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.id = t.id;
      const group = new THREE.Group();
      group.add(mesh);
      // Outline on top.
      shapes.forEach((shape) => {
        const pts = shape.getPoints(2).map((p) => new THREE.Vector3(wx(p.x), LAND_H + 0.028, wz(p.y)));
        const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
        group.add(line);
      });
      // Name label lying on the land.
      const { tex, aspect } = nameTexture(t.name);
      const nameMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.16 * aspect, 0.16),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
      );
      nameMesh.rotation.x = -Math.PI / 2;
      nameMesh.position.set(wx(t.label[0]), LAND_H + 0.03, wz(t.label[1]) + 0.36);
      group.add(nameMesh);
      // Army count badge (sprite, always faces the camera).
      const canvas = badgeCanvas();
      const badgeTex = new THREE.CanvasTexture(canvas);
      badgeTex.colorSpace = THREE.SRGBColorSpace;
      const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTex, depthTest: false, transparent: true }));
      badge.scale.set(0.66, 0.44, 1);
      badge.center.set(72 / 192, 0.1);
      badge.renderOrder = 10;
      group.add(badge);
      this.scene.add(group);
      this.terr.set(t.id, {
        id: t.id,
        group,
        mesh,
        top,
        side,
        nameMesh,
        badge,
        badgeCanvas: canvas,
        badgeTex,
        cx: wx(t.label[0]),
        cz: wz(t.label[1]),
        color: NEUTRAL,
        base: new THREE.Color(NEUTRAL),
        dimK: 1,
        armies: -1,
        staged: 0,
        lift: 0,
        liftGoal: 0,
        state: {},
        flash: 0,
      });
    });
    this.pickables = [...this.terr.values()].map((t) => t.mesh);
  }

  refreshNames() {
    MAP.territories.forEach((t) => {
      const info = this.terr.get(t.id);
      const { tex, aspect } = nameTexture(t.name);
      info.nameMesh.material.map.dispose();
      info.nameMesh.material.map = tex;
      info.nameMesh.geometry.dispose();
      info.nameMesh.geometry = new THREE.PlaneGeometry(0.16 * aspect, 0.16);
      info.nameMesh.material.needsUpdate = true;
      const armies = info.armies;
      info.armies = -1;
      this.drawTerritoryBadge(info, armies, info.staged);
    });
  }

  buildPieces() {
    const geos = pieceGeometries();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.08 });
    const cap = 42 * 5;
    this.pieces = {};
    ['infantry', 'cavalry', 'artillery'].forEach((k) => {
      const inst = new THREE.InstancedMesh(geos[k], mat, cap);
      inst.count = 0;
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      inst.frustumCulled = false;
      this.scene.add(inst);
      this.pieces[k] = inst;
    });
    this.piecesDirty = true;
  }

  buildOverlays() {
    this.arrow = new THREE.Group();
    this.scene.add(this.arrow);
    this.arrowMat = new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0xffa31a, emissiveIntensity: 0.6, roughness: 0.4 });
    this.fx = new THREE.Group();
    this.scene.add(this.fx);
  }

  // ---- public interface --------------------------------------------------

  show(visible) {
    this.canvas.hidden = !visible;
    this.visible = visible;
    if (visible) this.resize();
  }

  setShowNames(show) {
    this.showNames = show;
    this.terr.forEach((t) => (t.nameMesh.visible = show));
  }

  /**
   * @param {{id, color, armies, staged, owned, selected, target, targeted, selectable, dim, hl}[]} list
   */
  update(list) {
    list.forEach((s) => {
      const t = this.terr.get(s.id);
      if (t.color !== s.color) {
        const from = new THREE.Color(t.color);
        const to = new THREE.Color(s.color);
        const first = t.armies === -1;
        t.color = s.color;
        if (first) {
          t.base.copy(to);
        } else {
          this.tween(700, (k) => t.base.copy(from).lerp(to, k));
          if (t.state.owned) t.flash = 1;
        }
      }
      if (t.armies !== s.armies || t.staged !== s.staged) {
        if (t.armies >= 0 && t.armies !== s.armies) t.pop = 1;
        this.drawTerritoryBadge(t, s.armies, s.staged);
        this.piecesDirty = true;
      }
      t.badge.visible = s.owned;
      t.state = s;
      t.liftGoal = s.selected ? RAISE : s.targeted ? RAISE * 0.6 : 0;
    });
  }

  drawTerritoryBadge(t, armies, staged) {
    t.armies = armies;
    t.staged = staged;
    drawBadge(t.badgeCanvas, armies, new THREE.Color(t.color).multiplyScalar(0.78).getStyle(), staged);
    t.badgeTex.needsUpdate = true;
  }

  setArrow(from, to, friendly) {
    this.arrow.clear();
    if (!from || !to) return;
    const a = this.terr.get(from);
    const b = this.terr.get(to);
    const start = new THREE.Vector3(a.cx, LAND_H + 0.35, a.cz);
    const end = new THREE.Vector3(b.cx, LAND_H + 0.2, b.cz);
    if (start.distanceTo(end) > 10) return;
    const mid = start.clone().lerp(end, 0.5);
    mid.y += 0.25 + start.distanceTo(end) * 0.25;
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
    this.arrowMat.color.set(friendly ? 0x6dffc4 : 0xffd166);
    this.arrowMat.emissive.set(friendly ? 0x1aa37a : 0xffa31a);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.035, 8), this.arrowMat);
    tube.castShadow = true;
    this.arrow.add(tube);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 14), this.arrowMat);
    const dir = curve.getTangent(1);
    head.position.copy(end);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.arrow.add(head);
  }

  hit(id) {
    const t = this.terr.get(id);
    if (t) t.hit = 1;
  }

  floatText(id, text, color = '#ff6b5a') {
    const t = this.terr.get(id);
    if (!t) return;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 96;
    const ctx = c.getContext('2d');
    ctx.font = '700 64px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, 128, 48);
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 48);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set(0.8, 0.3, 1);
    sprite.renderOrder = 20;
    sprite.position.set(t.cx, LAND_H + 0.7, t.cz);
    this.fx.add(sprite);
    this.tween(1300, (k) => {
      sprite.position.y = LAND_H + 0.7 + k * 0.6;
      sprite.material.opacity = 1 - k * k;
    }).then(() => {
      this.fx.remove(sprite);
      tex.dispose();
      sprite.material.dispose();
    });
  }

  resetView() {
    this.zoom = 1;
    this.pan.set(0, 0);
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
    const e = [W / 2 + 0.5, D / 2 + 0.5];
    const corners = [[-e[0], 0, e[1]], [e[0], 0, e[1]], [-e[0], 0.3, -e[1]], [e[0], 0.3, -e[1]]].map(
      ([x, y, z]) => new THREE.Vector3(x, y, z)
    );
    const v = new THREE.Vector3();
    let dist = 8;
    for (; dist < 120; dist += 0.2) {
      cam.position.set(0, Math.sin(elevation) * dist, Math.cos(elevation) * dist);
      cam.lookAt(0, 0, 0.3);
      cam.updateMatrixWorld();
      if (corners.every((c) => (v.copy(c).project(cam), Math.abs(v.x) < 0.98 && Math.abs(v.y) < 0.98))) break;
    }
    this.fitKey = key;
    this.fitDist = dist;
    return dist;
  }

  placeCamera() {
    const narrow = this.canvas.clientWidth < 620;
    const elevation = THREE.MathUtils.degToRad(narrow ? 64 : 52);
    const dist = this.fitDistance(elevation) / this.zoom;
    const tx = this.pan.x;
    const tz = this.pan.y;
    this.camera.position.set(tx, Math.sin(elevation) * dist, tz + Math.cos(elevation) * dist);
    this.camera.lookAt(tx, 0, tz + 0.3);
  }

  clampPan() {
    const lim = (1 - 1 / this.zoom);
    this.pan.x = THREE.MathUtils.clamp(this.pan.x, -W / 2 * lim, W / 2 * lim);
    this.pan.y = THREE.MathUtils.clamp(this.pan.y, -D / 2 * lim, D / 2 * lim);
  }

  // ---- input -------------------------------------------------------------

  rayHit(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObjects(this.pickables, false)[0];
    return hit ? hit.object.userData.id : null;
  }

  groundPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  }

  // Page coordinates of a territory's label point (used by automated tests).
  project(id) {
    const t = this.terr.get(id);
    const v = new THREE.Vector3(t.cx - 0.12, LAND_H, t.cz + 0.12).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  bindInput() {
    const c = this.canvas;
    let press = null;
    let longTimer = null;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        press = { x: e.clientX, y: e.clientY, button: e.button, moved: false, long: false, type: e.pointerType };
        clearTimeout(longTimer);
        if (e.pointerType !== 'mouse') {
          longTimer = setTimeout(() => {
            if (press && !press.moved) {
              press.long = true;
              const id = this.rayHit(press.x, press.y);
              if (id) this.onPick?.(id, true);
            }
          }, 480);
        }
      } else {
        press = null;
        clearTimeout(longTimer);
        const pts = [...this.pointers.values()];
        this.pinch = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), zoom: this.zoom };
      }
    });
    c.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (prev) {
        if (this.pointers.size === 2 && this.pinch) {
          this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const pts = [...this.pointers.values()];
          const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          this.zoom = THREE.MathUtils.clamp(this.pinch.zoom * (d / this.pinch.dist), 1, 3.5);
          this.clampPan();
          return;
        }
        if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 7) {
          press.moved = true;
          clearTimeout(longTimer);
        }
        if (press?.moved && this.zoom > 1.01) {
          // Drag to pan when zoomed in.
          const a = this.groundPoint(prev.x, prev.y);
          const b = this.groundPoint(e.clientX, e.clientY);
          if (a && b) {
            this.pan.x -= b.x - a.x;
            this.pan.y -= b.z - a.z;
            this.clampPan();
          }
        }
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (e.pointerType === 'mouse' && !press?.moved) {
        const id = this.rayHit(e.clientX, e.clientY);
        this.setHoverId(id);
        this.onHover?.(id, e.clientX, e.clientY);
      }
    });
    const end = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      clearTimeout(longTimer);
      if (press && !press.moved && !press.long && e.type === 'pointerup') {
        const id = this.rayHit(e.clientX, e.clientY);
        this.onPick?.(id, press.button === 2 || e.shiftKey);
      }
      press = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') {
        this.setHoverId(null);
        this.onHover?.(null);
      }
    });
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const before = this.groundPoint(e.clientX, e.clientY);
        this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(-e.deltaY * 0.0015), 1, 3.5);
        this.placeCamera();
        this.camera.updateMatrixWorld();
        const after = this.groundPoint(e.clientX, e.clientY);
        if (before && after) {
          this.pan.x += before.x - after.x;
          this.pan.y += before.z - after.z;
        }
        this.clampPan();
      },
      { passive: false }
    );
    c.addEventListener('dblclick', () => this.resetView());
  }

  setHoverId(id) {
    this.hoverId = id;
    const s = id ? this.terr.get(id)?.state : null;
    this.canvas.style.cursor = s && (s.selectable || s.target) ? 'pointer' : this.zoom > 1.01 ? 'grab' : 'default';
  }

  // ---- animation ---------------------------------------------------------

  tween(duration, update) {
    return new Promise((resolve) => this.tweens.push({ start: performance.now(), duration, update, resolve }));
  }

  layoutPieces() {
    const counts = { infantry: 0, cavalry: 0, artillery: 0 };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const PS = 1.6;
    const s = new THREE.Vector3(PS, PS, PS);
    const p = new THREE.Vector3();
    const color = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    this.terr.forEach((t) => {
      if (!t.state.owned || t.armies <= 0) return;
      const { art, cav, inf } = pieceMix(t.armies);
      color.set(t.color);
      const y = LAND_H + 0.02 + t.lift;
      const place = (kind, x, z, rot) => {
        const inst = this.pieces[kind];
        q.setFromAxisAngle(up, rot);
        p.set(t.cx + x, y, t.cz + z);
        m.compose(p, q, s);
        inst.setMatrixAt(counts[kind], m);
        inst.setColorAt(counts[kind], color);
        counts[kind] += 1;
      };
      // Cannons at the back, then cavalry, infantry in front — all around the badge point.
      for (let i = 0; i < art; i += 1) place('artillery', -0.3 + (i % 2) * 0.42, -0.26 - Math.floor(i / 2) * 0.24, 0.4);
      for (let i = 0; i < cav; i += 1) place('cavalry', 0.36, 0.06, -0.6);
      for (let i = 0; i < inf; i += 1) place('infantry', -0.34 + (i % 2) * 0.19, 0.08 + Math.floor(i / 2) * 0.19, 0);
    });
    Object.entries(this.pieces).forEach(([k, inst]) => {
      inst.count = counts[k];
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    });
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
    const pulse = 0.5 + Math.sin(now / 220) * 0.5;
    let lifted = false;
    this.terr.forEach((t) => {
      const s = t.state;
      if (Math.abs(t.lift - t.liftGoal) > 0.0005) {
        t.lift += (t.liftGoal - t.lift) * Math.min(1, dt * 10);
        t.group.position.y = t.lift;
        lifted = true;
      }
      let emissive = 0;
      let eColor = 0xffffff;
      if (s.selected) emissive = 0.35;
      else if (s.targeted) {
        emissive = 0.45;
        eColor = 0xff3a1a;
      } else if (s.target) {
        emissive = 0.15 + pulse * 0.3;
        eColor = 0xffc94d;
      } else if (s.hl) emissive = 0.2;
      else if (this.hoverId === t.id && (s.selectable || s.target)) emissive = 0.18;
      if (t.flash > 0) {
        emissive = Math.max(emissive, t.flash * 0.9);
        t.flash = Math.max(0, t.flash - dt * 1.4);
      }
      if (t.hit > 0) {
        emissive = Math.max(emissive, t.hit);
        eColor = 0xffffff;
        t.hit = Math.max(0, t.hit - dt * 2.2);
      }
      t.top.emissive.set(eColor);
      t.top.emissiveIntensity = emissive;
      const dim = s.dim ? 0.42 : 1;
      t.dimK += (dim - t.dimK) * Math.min(1, dt * 8);
      t.top.color.copy(t.base).multiplyScalar(t.dimK);
      t.side.color.copy(t.base).multiplyScalar(0.6 * t.dimK);
      if (t.pop > 0) {
        const k = 1 - t.pop;
        const sc = 1 + Math.sin(Math.PI * Math.min(1, k * 1.4)) * 0.45;
        t.badge.scale.set(0.66 * sc, 0.44 * sc, 1);
        t.pop = Math.max(0, t.pop - dt * 2);
      }
      t.badge.position.set(t.cx, LAND_H + 0.3 + t.lift, t.cz);
    });
    if (lifted) this.piecesDirty = true;
    if (this.piecesDirty) {
      this.layoutPieces();
      this.piecesDirty = false;
    }
    this.oceanTex.offset.x = (now / 90000) % 1;
    this.oceanTex.offset.y = Math.sin(now / 7000) * 0.02;
    this.arrowMat.emissiveIntensity = 0.4 + pulse * 0.5;
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }
}
