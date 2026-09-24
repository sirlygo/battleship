import * as THREE from '/vendor/three/three.module.min.js';

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const BOARD_SIZE = 10;
const HALF = BOARD_SIZE / 2;
const BOARD_OFFSET = 7.5;
const BOARD_Y = 0.16;
const BOARDS = {
  self: { center: new THREE.Vector3(-BOARD_OFFSET, 0, 0), accent: 0x5ee7ff, label: 'YOUR FLEET' },
  enemy: { center: new THREE.Vector3(BOARD_OFFSET, 0, 0), accent: 0xff7a59, label: 'ENEMY WATERS' },
};
const ROW_LABELS = 'ABCDEFGHIJ';

const SUN_DIR = new THREE.Vector3(-0.55, 0.32, -0.77).normalize();
const COLORS = {
  zenith: 0x08142b,
  horizon: 0x36597a,
  sunGlow: 0xffb37a,
  deep: 0x031a28,
  shallow: 0x0d5566,
  fog: 0x2b4a66,
};

function cellToWorld(board, x, y, height = BOARD_Y) {
  const c = BOARDS[board].center;
  return new THREE.Vector3(c.x + x - HALF + 0.5, height, c.z + y - HALF + 0.5);
}

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------

const oceanVertex = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vHeight;

  const int WAVES = 3;
  vec4 wave(int i) {
    if (i == 0) return vec4(normalize(vec2(1.0, 0.35)), 0.075, 0.55);
    if (i == 1) return vec4(normalize(vec2(-0.45, 1.0)), 0.05, 0.8);
    return vec4(normalize(vec2(0.7, -0.65)), 0.03, 1.25);
  }

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    float h = 0.0;
    vec2 grad = vec2(0.0);
    for (int i = 0; i < WAVES; i++) {
      vec4 w = wave(i);
      float speed = sqrt(9.8 * w.w) * 0.35;
      float phase = dot(w.xy, world.xz) * w.w + uTime * speed;
      h += w.z * sin(phase);
      grad += w.z * w.w * cos(phase) * w.xy;
    }
    world.y += h;
    vHeight = h;
    vWorld = world.xyz;
    vNormal = normalize(vec3(-grad.x, 1.0, -grad.y));
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const oceanFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSky;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform vec3 uFog;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vHeight;

  void main() {
    vec2 p = vWorld.xz;
    float dist = length(cameraPosition - vWorld);
    float detailFade = 1.0 - smoothstep(20.0, 90.0, dist);
    vec3 detail = vec3(
      sin(p.x * 2.1 + uTime * 1.3) + sin(p.y * 1.7 - uTime * 1.1 + p.x * 0.6) + sin((p.x - p.y) * 3.9 + uTime * 2.3) * 0.5,
      0.0,
      cos(p.y * 2.6 + uTime * 1.6) + sin((p.x + p.y) * 3.1 - uTime * 1.9) + cos(p.x * 4.7 - uTime * 2.7) * 0.5
    ) * 0.07 * detailFade;
    vec3 n = normalize(vNormal + detail);
    vec3 v = normalize(cameraPosition - vWorld);

    float fresnel = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 4.0);
    vec3 water = mix(uDeep, uShallow, clamp(vHeight * 3.5 + 0.35, 0.0, 1.0) * 0.55);
    vec3 col = mix(water, uSky, clamp(fresnel * 0.9, 0.0, 1.0));

    vec3 r = reflect(-uSunDir, n);
    float spec = pow(max(dot(r, v), 0.0), 220.0) * 1.8 + pow(max(dot(r, v), 0.0), 24.0) * 0.06;
    col += uSunColor * spec;

    float foam = smoothstep(0.125, 0.16, vHeight + detail.x * 0.12);
    col = mix(col, vec3(0.7, 0.8, 0.86), foam * 0.12 * detailFade);

    float fog = smoothstep(uFogNear, uFogFar, dist);
    col = mix(col, uFog, fog);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunGlow;
  uniform vec3 uSunDir;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
    float sun = max(dot(d, uSunDir), 0.0);
    col += uSunGlow * (pow(sun, 6.0) * 0.45 + pow(sun, 64.0) * 0.8 + pow(sun, 900.0) * 3.0);
    // soft glow band along the horizon
    col += uSunGlow * 0.12 * exp(-h * 14.0) * (0.4 + 0.6 * sun);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

function makeSoftTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeTextTexture(text, { font = '600 72px "Chakra Petch", "Segoe UI", sans-serif', width = 128, height = 128, color = '#ffffff', letterSpacing = 0 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (letterSpacing && 'letterSpacing' in ctx) ctx.letterSpacing = `${letterSpacing}px`;
  ctx.fillText(text, width / 2, height / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------------------
// Ship models
// ---------------------------------------------------------------------------

const shipMaterials = {
  hull: new THREE.MeshStandardMaterial({ color: 0x5d6975, roughness: 0.55, metalness: 0.35 }),
  hullDark: new THREE.MeshStandardMaterial({ color: 0x3b434d, roughness: 0.6, metalness: 0.3 }),
  waterline: new THREE.MeshStandardMaterial({ color: 0x8a2e2a, roughness: 0.7, metalness: 0.1 }),
  deck: new THREE.MeshStandardMaterial({ color: 0x7d8792, roughness: 0.8, metalness: 0.15 }),
  super: new THREE.MeshStandardMaterial({ color: 0xc8cfd6, roughness: 0.5, metalness: 0.25 }),
  gun: new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.45, metalness: 0.6 }),
  flight: new THREE.MeshStandardMaterial({ color: 0x353b42, roughness: 0.85, metalness: 0.1 }),
  stripe: new THREE.MeshBasicMaterial({ color: 0xe8e4d4 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x1b2a3a, roughness: 0.15, metalness: 0.8, emissive: 0x0a4a66, emissiveIntensity: 0.6 }),
  sub: new THREE.MeshStandardMaterial({ color: 0x404a55, roughness: 0.45, metalness: 0.4 }),
};

const sunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 0.9, metalness: 0.1, emissive: 0x5a1a06, emissiveIntensity: 0.55 });

function hullShape(length, width, bowLength) {
  const h = length / 2;
  const w = width / 2;
  const r = Math.min(0.14, w * 0.6);
  const s = new THREE.Shape();
  s.moveTo(-h + r, -w);
  s.lineTo(h - bowLength, -w);
  s.quadraticCurveTo(h - bowLength * 0.2, -w * 0.9, h, 0);
  s.quadraticCurveTo(h - bowLength * 0.2, w * 0.9, h - bowLength, w);
  s.lineTo(-h + r, w);
  s.quadraticCurveTo(-h, w, -h, w - r);
  s.lineTo(-h, -w + r);
  s.quadraticCurveTo(-h, -w, -h + r, -w);
  return s;
}

function extrudeUp(shape, depth, bevel = 0) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 12,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function cylinder(rTop, rBottom, h, mat, x, y, z, segments = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), mat);
  m.position.set(x, y, z);
  return m;
}

function turret(x, y, barrels = 2, forward = 1, scale = 1) {
  const g = new THREE.Group();
  g.add(cylinder(0.17 * scale, 0.19 * scale, 0.1 * scale, shipMaterials.super, 0, 0.05 * scale, 0));
  g.add(box(0.26 * scale, 0.09 * scale, 0.24 * scale, shipMaterials.super, -0.02 * forward, 0.13 * scale, 0));
  const spacing = barrels === 1 ? [0] : barrels === 2 ? [-0.055, 0.055] : [-0.08, 0, 0.08];
  spacing.forEach((z) => {
    const barrel = cylinder(0.022 * scale, 0.028 * scale, 0.42 * scale, shipMaterials.gun, 0.26 * forward * scale, 0.13 * scale, z * scale, 8);
    barrel.rotation.z = Math.PI / 2;
    g.add(barrel);
  });
  g.position.set(x, y, 0);
  return g;
}

function funnel(x, y, height = 0.34, radius = 0.1) {
  const f = cylinder(radius * 0.85, radius, height, shipMaterials.hullDark, x, y + height / 2, 0);
  f.rotation.z = 0.12;
  const cap = cylinder(radius * 0.9, radius * 0.9, 0.04, shipMaterials.gun, x - 0.02, y + height, 0);
  cap.rotation.z = 0.12;
  const g = new THREE.Group();
  g.add(f, cap);
  return g;
}

function mast(x, y, height = 0.5) {
  const g = new THREE.Group();
  g.add(cylinder(0.018, 0.026, height, shipMaterials.gun, x, y + height / 2, 0, 6));
  g.add(box(0.03, 0.03, 0.3, shipMaterials.gun, x, y + height * 0.72, 0));
  const radar = box(0.06, 0.1, 0.18, shipMaterials.super, x, y + height + 0.03, 0);
  g.add(radar);
  g.userData.radar = radar;
  return g;
}

function bridge(x, y, levels) {
  const g = new THREE.Group();
  let yy = y;
  levels.forEach(([w, h, d]) => {
    g.add(box(w, h, d, shipMaterials.super, x, yy + h / 2, 0));
    yy += h;
  });
  const top = levels[levels.length - 1];
  g.add(box(top[0] * 0.3, 0.05, top[2] * 1.02, shipMaterials.glass, x + top[0] * 0.36, yy - 0.06, 0));
  g.userData.top = yy;
  return g;
}

function buildHull(group, length, width, { bowLength = 0.9, freeboard = 0.26 } = {}) {
  const lower = new THREE.Mesh(extrudeUp(hullShape(length * 0.97, width * 0.9, bowLength), 0.14), shipMaterials.waterline);
  lower.position.y = -0.16;
  const upper = new THREE.Mesh(extrudeUp(hullShape(length, width, bowLength), freeboard, 0.015), shipMaterials.hull);
  upper.position.y = -0.03;
  const deck = new THREE.Mesh(extrudeUp(hullShape(length * 0.95, width * 0.86, bowLength * 0.95), 0.02), shipMaterials.deck);
  deck.position.y = freeboard - 0.02;
  group.add(lower, upper, deck);
  return freeboard;
}

function buildCarrier() {
  const g = new THREE.Group();
  const deckY = buildHull(g, 4.7, 0.62, { bowLength: 1.1, freeboard: 0.24 });
  const flight = box(4.75, 0.06, 0.94, shipMaterials.flight, 0.05, deckY + 0.12, -0.08);
  g.add(flight);
  // Supports under the overhanging flight deck
  g.add(box(4.2, 0.1, 0.5, shipMaterials.hullDark, 0, deckY + 0.05, -0.1));
  // Runway markings
  for (let i = 0; i < 8; i += 1) {
    g.add(box(0.26, 0.005, 0.03, shipMaterials.stripe, -1.9 + i * 0.52, deckY + 0.155, -0.08));
  }
  g.add(box(4.5, 0.005, 0.015, shipMaterials.stripe, 0.05, deckY + 0.155, -0.52));
  g.add(box(4.5, 0.005, 0.015, shipMaterials.stripe, 0.05, deckY + 0.155, 0.36));
  // Angled landing strip
  const angled = box(2.2, 0.006, 0.02, shipMaterials.stripe, -0.9, deckY + 0.157, -0.24);
  angled.rotation.y = 0.16;
  g.add(angled);
  // Island superstructure on the starboard edge
  const island = bridge(0.55, deckY + 0.15, [[0.7, 0.18, 0.2], [0.5, 0.16, 0.18], [0.32, 0.14, 0.16]]);
  island.position.z = 0.3;
  g.add(island);
  const m = mast(0.5, island.userData.top, 0.35);
  m.position.z = 0.3;
  g.add(m);
  g.userData.radar = m.userData.radar;
  // A few parked jets
  const jet = (x, z, rot) => {
    const j = new THREE.Group();
    j.add(box(0.34, 0.035, 0.05, shipMaterials.super, 0, 0, 0));
    j.add(box(0.12, 0.02, 0.3, shipMaterials.super, -0.02, 0, 0));
    j.add(box(0.06, 0.02, 0.14, shipMaterials.super, -0.15, 0.01, 0));
    j.add(box(0.06, 0.08, 0.01, shipMaterials.super, -0.15, 0.04, 0));
    j.position.set(x, deckY + 0.18, z);
    j.rotation.y = rot;
    g.add(j);
  };
  jet(-1.65, -0.3, 0.5);
  jet(-1.25, -0.32, 0.5);
  jet(-0.85, -0.34, 0.5);
  jet(1.6, -0.1, 0);
  return g;
}

function buildBattleship() {
  const g = new THREE.Group();
  const deckY = buildHull(g, 3.8, 0.66, { bowLength: 1.0 });
  g.add(turret(1.1, deckY, 3, 1));
  g.add(turret(0.62, deckY + 0.08, 3, 1));
  g.add(box(0.3, 0.08, 0.3, shipMaterials.hull, 0.62, deckY + 0.04, 0));
  g.add(turret(-1.2, deckY, 3, -1));
  const b = bridge(0.05, deckY, [[0.8, 0.18, 0.46], [0.56, 0.18, 0.36], [0.34, 0.16, 0.28]]);
  g.add(b);
  const m = mast(-0.02, b.userData.top, 0.5);
  g.add(m);
  g.userData.radar = m.userData.radar;
  g.add(funnel(-0.55, deckY, 0.38, 0.13));
  return g;
}

function buildCruiser() {
  const g = new THREE.Group();
  const deckY = buildHull(g, 2.82, 0.56, { bowLength: 0.85 });
  g.add(turret(0.82, deckY, 2, 1, 0.9));
  g.add(turret(-0.95, deckY, 2, -1, 0.9));
  const b = bridge(0.2, deckY, [[0.6, 0.16, 0.38], [0.4, 0.16, 0.3]]);
  g.add(b);
  const m = mast(0.15, b.userData.top, 0.45);
  g.add(m);
  g.userData.radar = m.userData.radar;
  g.add(funnel(-0.35, deckY, 0.3, 0.1));
  return g;
}

function buildDestroyer() {
  const g = new THREE.Group();
  const deckY = buildHull(g, 1.84, 0.46, { bowLength: 0.6, freeboard: 0.22 });
  g.add(turret(0.52, deckY, 1, 1, 0.8));
  const b = bridge(0.05, deckY, [[0.42, 0.15, 0.32], [0.26, 0.13, 0.24]]);
  g.add(b);
  const m = mast(0.0, b.userData.top, 0.36);
  g.add(m);
  g.userData.radar = m.userData.radar;
  g.add(funnel(-0.38, deckY, 0.24, 0.08));
  g.add(turret(-0.68, deckY, 1, -1, 0.7));
  return g;
}

function buildSubmarine() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 2.35, 8, 16), shipMaterials.sub);
  hull.rotation.z = Math.PI / 2;
  hull.scale.set(1, 1, 1.05);
  hull.position.y = 0.0;
  g.add(hull);
  const deck = box(1.9, 0.05, 0.16, shipMaterials.hullDark, 0, 0.19, 0);
  g.add(deck);
  const sail = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.34, 6, 12), shipMaterials.sub);
  sail.rotation.z = Math.PI / 2;
  sail.scale.set(1.8, 1, 0.8);
  sail.position.set(0.35, 0.36, 0);
  g.add(sail);
  g.add(box(0.05, 0.02, 0.4, shipMaterials.sub, 0.4, 0.4, 0));
  const scope = cylinder(0.015, 0.015, 0.3, shipMaterials.gun, 0.3, 0.6, 0, 6);
  g.add(scope);
  g.userData.radar = scope;
  const fin = box(0.18, 0.02, 0.5, shipMaterials.sub, -1.25, 0.02, 0);
  g.add(fin);
  const rudder = box(0.16, 0.36, 0.02, shipMaterials.sub, -1.28, 0.05, 0);
  g.add(rudder);
  return g;
}

const SHIP_BUILDERS = {
  Carrier: buildCarrier,
  Battleship: buildBattleship,
  Cruiser: buildCruiser,
  Submarine: buildSubmarine,
  Destroyer: buildDestroyer,
};

function buildShip(name, length) {
  const builder = SHIP_BUILDERS[name];
  if (builder) return builder();
  const g = new THREE.Group();
  buildHull(g, length - 0.2, 0.5);
  return g;
}

function setShipMaterial(group, material) {
  group.traverse((obj) => {
    if (obj.isMesh) {
      if (!obj.userData.originalMaterial) obj.userData.originalMaterial = obj.material;
      obj.material = material || obj.userData.originalMaterial;
    }
  });
}

function placeShipGroup(group, board, ship) {
  const length = ship.length;
  const dir = ship.dir;
  const midX = dir === 'h' ? ship.x + (length - 1) / 2 : ship.x;
  const midY = dir === 'v' ? ship.y + (length - 1) / 2 : ship.y;
  const pos = cellToWorld(board, midX, midY, 0);
  group.position.set(pos.x, 0, pos.z);
  group.rotation.set(0, dir === 'v' ? Math.PI / 2 : 0, 0);
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------

class Particles {
  constructor(scene, texture, max = 900) {
    this.scene = scene;
    this.texture = texture;
    this.max = max;
    this.pool = [];
    this.live = [];
  }

  spawn({
    position,
    velocity = new THREE.Vector3(),
    life = 1,
    size = [0.3, 0.6],
    color = [0xffffff, 0xffffff],
    opacity = [1, 0],
    gravity = 0,
    drag = 0,
    additive = false,
  }) {
    if (this.live.length >= this.max) return;
    let p = this.pool.pop();
    if (!p) {
      const material = new THREE.SpriteMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
      });
      p = {
        sprite: new THREE.Sprite(material),
        c0: new THREE.Color(),
        c1: new THREE.Color(),
        vel: new THREE.Vector3(),
      };
    }
    p.sprite.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.sprite.position.copy(position);
    p.vel.copy(velocity);
    p.life = 0;
    p.maxLife = life;
    p.size = size;
    p.c0.set(color[0]);
    p.c1.set(color[1]);
    p.opacity = opacity;
    p.gravity = gravity;
    p.drag = drag;
    p.sprite.material.rotation = Math.random() * Math.PI * 2;
    this.update1(p, 0);
    this.scene.add(p.sprite);
    this.live.push(p);
  }

  update1(p, dt) {
    p.life += dt;
    const t = Math.min(p.life / p.maxLife, 1);
    p.vel.y += p.gravity * dt;
    if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
    p.sprite.position.addScaledVector(p.vel, dt);
    const s = p.size[0] + (p.size[1] - p.size[0]) * t;
    p.sprite.scale.set(s, s, s);
    p.sprite.material.color.lerpColors(p.c0, p.c1, t);
    p.sprite.material.opacity = p.opacity[0] + (p.opacity[1] - p.opacity[0]) * t;
  }

  update(dt) {
    for (let i = this.live.length - 1; i >= 0; i -= 1) {
      const p = this.live[i];
      this.update1(p, dt);
      if (p.life >= p.maxLife) {
        this.scene.remove(p.sprite);
        this.live.splice(i, 1);
        this.pool.push(p);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const rand = (a, b) => a + Math.random() * (b - a);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class BattleScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(COLORS.fog, 60, 190);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1200);
    this.camera.position.set(0, 20, 30);

    this.clock = new THREE.Clock();
    this.time = 0;
    this.view = 'lobby';
    this.lobbyAngle = 0.4;
    this.camPos = new THREE.Vector3(0, 20, 30);
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.goalPos = new THREE.Vector3();
    this.goalLook = new THREE.Vector3();
    this.parallax = new THREE.Vector2();
    this.parallaxGoal = new THREE.Vector2();
    this.shakeAmount = 0;
    this.activeBoard = null;

    this.softTexture = makeSoftTexture();
    this.particles = new Particles(this.scene, this.softTexture);
    this.emitters = new Map();
    this.ships = { self: new Map(), enemy: new Map() };
    this.markers = { self: new Map(), enemy: new Map() };
    this.pending = new Set();
    this.ghostCache = new Map();
    this.ghost = null;
    this.handlers = { hover: null, click: null, rotate: null };

    this.buildEnvironment();
    this.buildBoards();
    this.buildCursors();
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.tick());
  }

  // ---- construction ------------------------------------------------------

  buildEnvironment() {
    const hemi = new THREE.HemisphereLight(0x9cc7ff, 0x0b2233, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd2a8, 2.2);
    sun.position.copy(SUN_DIR).multiplyScalar(50);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x7fb4ff, 0.6);
    fill.position.set(10, 15, 20);
    this.scene.add(fill);

    this.flashLight = new THREE.PointLight(0xff8a3c, 0, 12, 1.6);
    this.scene.add(this.flashLight);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(600, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uZenith: { value: new THREE.Color(COLORS.zenith) },
          uHorizon: { value: new THREE.Color(COLORS.horizon) },
          uSunGlow: { value: new THREE.Color(COLORS.sunGlow) },
          uSunDir: { value: SUN_DIR },
        },
      })
    );
    this.scene.add(sky);

    // Ocean plane with vertices concentrated near the play area.
    const segments = 300;
    const geo = new THREE.PlaneGeometry(2, 2, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const extent = 500;
    for (let i = 0; i < pos.count; i += 1) {
      const u = pos.getX(i);
      const v = pos.getZ(i);
      pos.setX(i, Math.sign(u) * Math.pow(Math.abs(u), 1.8) * extent);
      pos.setZ(i, Math.sign(v) * Math.pow(Math.abs(v), 1.8) * extent);
    }
    geo.computeBoundingSphere();
    this.oceanUniforms = {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(COLORS.deep) },
      uShallow: { value: new THREE.Color(COLORS.shallow) },
      uSky: { value: new THREE.Color(0x4d7598) },
      uSunColor: { value: new THREE.Color(0xffd0a0) },
      uSunDir: { value: SUN_DIR },
      uFog: { value: new THREE.Color(COLORS.fog) },
      uFogNear: { value: 60 },
      uFogFar: { value: 220 },
    };
    const ocean = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        vertexShader: oceanVertex,
        fragmentShader: oceanFragment,
        uniforms: this.oceanUniforms,
      })
    );
    ocean.frustumCulled = false;
    this.scene.add(ocean);
  }

  buildBoards() {
    this.boardVisuals = {};
    Object.entries(BOARDS).forEach(([key, cfg]) => {
      const group = new THREE.Group();
      group.position.copy(cfg.center);
      const accent = new THREE.Color(cfg.accent);

      const base = new THREE.Mesh(
        new THREE.PlaneGeometry(BOARD_SIZE, BOARD_SIZE),
        new THREE.MeshBasicMaterial({ color: 0x03121d, transparent: true, opacity: 0.55, depthWrite: false })
      );
      base.rotation.x = -Math.PI / 2;
      base.position.y = BOARD_Y - 0.01;
      group.add(base);

      const points = [];
      for (let i = 0; i <= BOARD_SIZE; i += 1) {
        const o = i - HALF;
        points.push(new THREE.Vector3(o, BOARD_Y, -HALF), new THREE.Vector3(o, BOARD_Y, HALF));
        points.push(new THREE.Vector3(-HALF, BOARD_Y, o), new THREE.Vector3(HALF, BOARD_Y, o));
      }
      const lines = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.38, depthWrite: false })
      );
      group.add(lines);

      // Glowing frame
      const frameMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.8 });
      const t = 0.07;
      const frame = new THREE.Group();
      frame.add(
        box(BOARD_SIZE + t * 2, 0.05, t, frameMat, 0, BOARD_Y, -HALF - t / 2),
        box(BOARD_SIZE + t * 2, 0.05, t, frameMat, 0, BOARD_Y, HALF + t / 2),
        box(t, 0.05, BOARD_SIZE, frameMat, -HALF - t / 2, BOARD_Y, 0),
        box(t, 0.05, BOARD_SIZE, frameMat, HALF + t / 2, BOARD_Y, 0)
      );
      group.add(frame);

      // Soft glow under the frame
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(BOARD_SIZE + 1.6, BOARD_SIZE + 1.6),
        new THREE.MeshBasicMaterial({
          color: accent,
          map: this.softTexture,
          transparent: true,
          opacity: 0.0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = BOARD_Y - 0.02;
      group.add(glow);

      // Coordinates
      const labelMat = (text) =>
        new THREE.MeshBasicMaterial({
          map: makeTextTexture(text),
          transparent: true,
          depthWrite: false,
          color: accent.clone().lerp(new THREE.Color(0xffffff), 0.5),
        });
      const labelGeo = new THREE.PlaneGeometry(0.62, 0.62);
      for (let i = 0; i < BOARD_SIZE; i += 1) {
        const row = new THREE.Mesh(labelGeo, labelMat(ROW_LABELS[i]));
        row.rotation.x = -Math.PI / 2;
        row.position.set(-HALF - 0.5, BOARD_Y, i - HALF + 0.5);
        const col = new THREE.Mesh(labelGeo, labelMat(String(i + 1)));
        col.rotation.x = -Math.PI / 2;
        col.position.set(i - HALF + 0.5, BOARD_Y, -HALF - 0.5);
        group.add(row, col);
      }

      const title = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 0.75),
        new THREE.MeshBasicMaterial({
          map: makeTextTexture(cfg.label, {
            width: 768,
            height: 96,
            font: '700 64px "Chakra Petch", "Segoe UI", sans-serif',
            letterSpacing: 10,
          }),
          transparent: true,
          depthWrite: false,
          color: accent,
        })
      );
      title.rotation.x = -Math.PI / 2;
      title.position.set(0, BOARD_Y, HALF + 0.75);
      group.add(title);

      this.scene.add(group);
      this.boardVisuals[key] = { group, lines, frameMat, glow, base };
    });
  }

  buildCursors() {
    const hoverTile = new THREE.Mesh(
      new THREE.PlaneGeometry(0.94, 0.94),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false })
    );
    hoverTile.rotation.x = -Math.PI / 2;
    hoverTile.visible = false;
    this.scene.add(hoverTile);
    this.hoverTile = hoverTile;

    const reticle = new THREE.Group();
    const reticleMat = new THREE.MeshBasicMaterial({ color: 0xff5d47, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.33, 0.39, 40), reticleMat);
    ring.rotation.x = -Math.PI / 2;
    reticle.add(ring);
    for (let i = 0; i < 4; i += 1) {
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.2), reticleMat);
      tick.rotation.x = -Math.PI / 2;
      const a = (i * Math.PI) / 2;
      tick.position.set(Math.cos(a) * 0.46, 0, Math.sin(a) * 0.46);
      tick.rotation.z = a + Math.PI / 2;
      reticle.add(tick);
    }
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), reticleMat);
    dot.rotation.x = -Math.PI / 2;
    reticle.add(dot);
    reticle.visible = false;
    this.scene.add(reticle);
    this.reticle = reticle;
    this.reticleMat = reticleMat;

    this.ghostMaterials = {
      valid: new THREE.MeshBasicMaterial({ color: 0x6dffc4, transparent: true, opacity: 0.55, depthWrite: false }),
      invalid: new THREE.MeshBasicMaterial({ color: 0xff5d5d, transparent: true, opacity: 0.55, depthWrite: false }),
    };
    this.ghostFootprint = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x6dffc4, transparent: true, opacity: 0.22, depthWrite: false })
    );
    this.ghostFootprint.rotation.x = -Math.PI / 2;
    this.ghostFootprint.visible = false;
    this.scene.add(this.ghostFootprint);
  }

  bindInput() {
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BOARD_Y);
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();

    const pick = (event) => {
      const rect = this.canvas.getBoundingClientRect();
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.parallaxGoal.set(ndc.x, ndc.y);
      raycaster.setFromCamera(ndc, this.camera);
      if (!raycaster.ray.intersectPlane(plane, hit)) return null;
      for (const [board, cfg] of Object.entries(BOARDS)) {
        const lx = hit.x - cfg.center.x + HALF;
        const ly = hit.z - cfg.center.z + HALF;
        if (lx >= 0 && ly >= 0 && lx < BOARD_SIZE && ly < BOARD_SIZE) {
          return { board, x: Math.floor(lx), y: Math.floor(ly) };
        }
      }
      return null;
    };

    let down = null;
    this.canvas.addEventListener('pointermove', (event) => {
      const cell = pick(event);
      if (event.pointerType === 'mouse') this.handlers.hover?.(cell, event);
    });
    this.canvas.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse') this.handlers.hover?.(null, event);
      this.parallaxGoal.set(0, 0);
    });
    this.canvas.addEventListener('pointerdown', (event) => {
      down = { x: event.clientX, y: event.clientY, button: event.button };
    });
    this.canvas.addEventListener('pointerup', (event) => {
      if (!down) return;
      const moved = Math.hypot(event.clientX - down.x, event.clientY - down.y);
      const button = down.button;
      down = null;
      if (moved > 12) return;
      if (button === 2) {
        this.handlers.rotate?.();
        return;
      }
      if (button !== 0) return;
      const cell = pick(event);
      this.handlers.click?.(cell, event);
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  on(name, handler) {
    this.handlers[name] = handler;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.updateViewGoal(true);
  }

  // ---- camera ------------------------------------------------------------

  setView(view, { instant = false } = {}) {
    if (this.view === view && !instant) return;
    this.view = view;
    this.updateViewGoal(instant);
  }

  frameArea(cx, cz, halfW, halfD) {
    const aspect = this.camera.aspect;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const elevation = THREE.MathUtils.degToRad(aspect < 0.8 ? 62 : 56);
    // Leave room for HUD bars at the top and bottom of the screen.
    const distW = (halfW * 1.08) / (tanHalf * aspect);
    const distD = (halfD * Math.sin(elevation) * 1.55) / tanHalf;
    const dist = Math.max(distW, distD);
    this.goalLook.set(cx, 0, cz + 0.8);
    this.goalPos.set(
      cx,
      dist * Math.sin(elevation),
      cz + 0.8 + dist * Math.cos(elevation)
    );
  }

  updateViewGoal(instant = false) {
    switch (this.view) {
      case 'self':
        this.frameArea(BOARDS.self.center.x, 0, HALF + 1, HALF + 1);
        break;
      case 'enemy':
        this.frameArea(BOARDS.enemy.center.x, 0, HALF + 1, HALF + 1);
        break;
      case 'overview':
        this.frameArea(0, 0, BOARD_OFFSET + HALF + 1, HALF + 1);
        break;
      default:
        break;
    }
    if (instant && this.view !== 'lobby') {
      this.camPos.copy(this.goalPos);
      this.camLook.copy(this.goalLook);
    }
  }

  setActiveBoard(board) {
    this.activeBoard = board;
  }

  shake(amount) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  // ---- ships -------------------------------------------------------------

  setShips(board, ships = []) {
    const map = this.ships[board];
    const wanted = new Map(ships.map((s) => [s.name, s]));
    map.forEach((entry, name) => {
      if (!wanted.has(name)) {
        this.scene.remove(entry.group);
        map.delete(name);
      }
    });
    ships.forEach((ship) => {
      let entry = map.get(ship.name);
      if (!entry) {
        const group = buildShip(ship.name, ship.length);
        this.scene.add(group);
        entry = { group, phase: Math.random() * Math.PI * 2, sinkT: 0, spawnT: 0 };
        map.set(ship.name, entry);
      }
      const key = `${ship.x},${ship.y},${ship.dir}`;
      if (entry.key !== key) {
        entry.key = key;
        entry.cells = new Set();
        for (let i = 0; i < ship.length; i += 1) {
          entry.cells.add(`${ship.x + (ship.dir === 'h' ? i : 0)},${ship.y + (ship.dir === 'v' ? i : 0)}`);
        }
        placeShipGroup(entry.group, board, ship);
        entry.spawnT = 0;
      }
      if (ship.sunk && !entry.sunk) {
        entry.sunk = true;
        setShipMaterial(entry.group, sunkMaterial);
      } else if (!ship.sunk && entry.sunk) {
        entry.sunk = false;
        entry.sinkT = 0;
        setShipMaterial(entry.group, null);
      }
    });
  }

  setGhost(ghost) {
    if (this.ghost) this.ghost.group.visible = false;
    if (!ghost) {
      this.ghost = null;
      this.ghostFootprint.visible = false;
      return;
    }
    let cached = this.ghostCache.get(ghost.name);
    if (!cached) {
      const group = buildShip(ghost.name, ghost.length);
      this.scene.add(group);
      cached = { group, valid: null };
      this.ghostCache.set(ghost.name, cached);
    }
    if (cached.valid !== ghost.valid) {
      cached.valid = ghost.valid;
      setShipMaterial(cached.group, ghost.valid ? this.ghostMaterials.valid : this.ghostMaterials.invalid);
    }
    placeShipGroup(cached.group, 'self', ghost);
    cached.group.visible = true;
    this.ghost = cached;

    const fp = this.ghostFootprint;
    const w = ghost.dir === 'h' ? ghost.length : 1;
    const d = ghost.dir === 'v' ? ghost.length : 1;
    fp.scale.set(w - 0.06, d - 0.06, 1);
    const mid = cellToWorld(
      'self',
      ghost.x + (ghost.dir === 'h' ? (ghost.length - 1) / 2 : 0),
      ghost.y + (ghost.dir === 'v' ? (ghost.length - 1) / 2 : 0),
      BOARD_Y + 0.005
    );
    fp.position.copy(mid);
    fp.material.color.set(ghost.valid ? 0x6dffc4 : 0xff5d5d);
    fp.visible = true;
  }

  setHover(cell, style = 'tile') {
    if (!cell) {
      this.hoverTile.visible = false;
      this.reticle.visible = false;
      return;
    }
    const pos = cellToWorld(cell.board, cell.x, cell.y, BOARD_Y + 0.01);
    this.hoverTile.position.copy(pos);
    this.hoverTile.visible = true;
    if (style === 'aim' || style === 'blocked') {
      this.reticle.position.copy(pos).setY(BOARD_Y + 0.03);
      this.reticle.visible = true;
      const color = style === 'aim' ? 0xff5d47 : 0x8a95a8;
      this.reticleMat.color.set(color);
      this.hoverTile.material.color.set(color);
      this.hoverTile.material.opacity = style === 'aim' ? 0.22 : 0.08;
    } else {
      this.reticle.visible = false;
      this.hoverTile.material.color.set(0xffffff);
      this.hoverTile.material.opacity = 0.14;
    }
  }

  // ---- markers -----------------------------------------------------------

  markPending(board, x, y) {
    this.pending.add(`${board}:${x},${y}`);
  }

  clearPending(board, x, y) {
    this.pending.delete(`${board}:${x},${y}`);
  }

  setShots(board, shots = []) {
    const map = this.markers[board];
    const wanted = new Map();
    shots.forEach((s) => {
      const key = `${s.x},${s.y}`;
      if (this.pending.has(`${board}:${key}`)) return;
      wanted.set(key, s);
    });
    map.forEach((marker, key) => {
      const shot = wanted.get(key);
      if (!shot || shot.result !== marker.result) {
        this.removeMarker(board, key);
      }
    });
    wanted.forEach((shot, key) => {
      if (!map.has(key)) this.addMarker(board, shot);
    });
  }

  addMarker(board, { x, y, result }) {
    const key = `${x},${y}`;
    const group = new THREE.Group();
    const pos = cellToWorld(board, x, y, 0);
    group.position.copy(pos);
    const onShip = board === 'self' ? this.shipCovers('self', x, y) : this.shipCovers('enemy', x, y);
    if (result === 'miss') {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.16, 0.23, 24),
        new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.55, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = BOARD_Y + 0.01;
      const peg = cylinder(0.075, 0.09, 0.22, new THREE.MeshStandardMaterial({ color: 0xf2f6fa, roughness: 0.4 }), 0, BOARD_Y + 0.08, 0, 10);
      group.add(ring, peg);
    } else {
      const pegMat = new THREE.MeshStandardMaterial({ color: 0xff3b2f, emissive: 0xff2a10, emissiveIntensity: 1.4, roughness: 0.3 });
      const peg = cylinder(0.08, 0.1, 0.26, pegMat, 0, (onShip ? 0.32 : BOARD_Y) + 0.1, 0, 10);
      const scorch = new THREE.Mesh(
        new THREE.CircleGeometry(0.42, 20),
        new THREE.MeshBasicMaterial({ color: 0xff4a1c, map: this.softTexture, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      scorch.rotation.x = -Math.PI / 2;
      scorch.position.y = BOARD_Y + 0.02;
      group.add(scorch, peg);
      this.emitters.set(`${board}:${key}`, {
        pos: new THREE.Vector3(pos.x, onShip ? 0.45 : 0.3, pos.z),
        fire: Math.random(),
        smoke: Math.random(),
      });
    }
    group.userData.phase = Math.random() * Math.PI * 2;
    this.scene.add(group);
    this.markers[board].set(key, { group, result });
  }

  removeMarker(board, key) {
    const marker = this.markers[board].get(key);
    if (!marker) return;
    this.scene.remove(marker.group);
    marker.group.traverse((obj) => {
      if (obj.isMesh) {
        obj.geometry.dispose();
        obj.material.dispose();
      }
    });
    this.markers[board].delete(key);
    this.emitters.delete(`${board}:${key}`);
  }

  shipCovers(board, x, y) {
    const key = `${x},${y}`;
    for (const entry of this.ships[board].values()) {
      if (entry.cells.has(key)) return true;
    }
    return false;
  }

  clearBoard(board) {
    [...this.markers[board].keys()].forEach((key) => this.removeMarker(board, key));
    this.setShips(board, []);
  }

  // ---- effects -----------------------------------------------------------

  async playShot({ board, x, y, result, sunkShip = null }) {
    const target = cellToWorld(board, x, y, 0.3);
    const fromSide = board === 'enemy' ? -1 : 1;
    const start = new THREE.Vector3(target.x + fromSide * 16, 2.5, target.z + 6);
    const peak = Math.max(7, start.distanceTo(target) * 0.35);
    const duration = 950;

    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe2a0 })
    );
    this.scene.add(shell);

    await new Promise((resolve) => {
      const startTime = performance.now();
      const step = () => {
        const t = Math.min((performance.now() - startTime) / duration, 1);
        const p = new THREE.Vector3().lerpVectors(start, target, t);
        p.y += Math.sin(Math.PI * t) * peak;
        shell.position.copy(p);
        this.particles.spawn({
          position: p,
          velocity: new THREE.Vector3(rand(-0.2, 0.2), rand(0, 0.3), rand(-0.2, 0.2)),
          life: 0.45,
          size: [0.32, 0.08],
          color: [0xffd27a, 0xff5a1f],
          opacity: [0.9, 0],
          additive: true,
        });
        if (t < 1) {
          requestAnimationFrame(step);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(step);
    });

    this.scene.remove(shell);
    shell.geometry.dispose();
    shell.material.dispose();

    const impact = cellToWorld(board, x, y, 0.25);
    if (result === 'miss') {
      this.splash(impact);
    } else {
      this.explode(impact, result === 'sunk' ? 1.6 : 1);
      if (result === 'sunk' && sunkShip) {
        for (let i = 0; i < sunkShip.length; i += 1) {
          const cx = sunkShip.x + (sunkShip.dir === 'h' ? i : 0);
          const cy = sunkShip.y + (sunkShip.dir === 'v' ? i : 0);
          setTimeout(() => this.explode(cellToWorld(board, cx, cy, 0.3), 0.8), 140 + i * 160);
        }
      }
    }
    return wait(result === 'sunk' ? 500 : 250);
  }

  splash(pos) {
    for (let i = 0; i < 46; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(0.2, 1.4);
      this.particles.spawn({
        position: pos.clone().add(new THREE.Vector3(rand(-0.1, 0.1), 0, rand(-0.1, 0.1))),
        velocity: new THREE.Vector3(Math.cos(a) * r, rand(3, 6.5), Math.sin(a) * r),
        life: rand(0.7, 1.1),
        size: [rand(0.18, 0.3), rand(0.45, 0.7)],
        color: [0xffffff, 0x9fd8ff],
        opacity: [0.95, 0],
        gravity: -11,
      });
    }
    this.ripple(pos);
  }

  ripple(pos) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.38, 36),
      new THREE.MeshBasicMaterial({ color: 0xe8f7ff, transparent: true, opacity: 0.8, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos.x, BOARD_Y + 0.02, pos.z);
    this.scene.add(ring);
    const start = performance.now();
    const step = () => {
      const t = (performance.now() - start) / 1100;
      if (t >= 1) {
        this.scene.remove(ring);
        ring.geometry.dispose();
        ring.material.dispose();
        return;
      }
      const s = 1 + t * 3.5;
      ring.scale.set(s, s, s);
      ring.material.opacity = 0.8 * (1 - t);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  explode(pos, power = 1) {
    this.flashLight.position.copy(pos).setY(pos.y + 1);
    this.flashLight.intensity = 60 * power;
    this.shake(0.35 * power);
    this.particles.spawn({
      position: pos.clone().setY(pos.y + 0.3),
      life: 0.35,
      size: [1.2 * power, 3.4 * power],
      color: [0xfff1c4, 0xff7a2a],
      opacity: [1, 0],
      additive: true,
    });
    const count = Math.round(38 * power);
    for (let i = 0; i < count; i += 1) {
      const dir = new THREE.Vector3(rand(-1, 1), rand(0.3, 1.4), rand(-1, 1)).normalize();
      this.particles.spawn({
        position: pos,
        velocity: dir.multiplyScalar(rand(1.5, 4.5) * power),
        life: rand(0.4, 0.9),
        size: [rand(0.35, 0.6) * power, 0.1],
        color: [0xffd27a, 0xff3a12],
        opacity: [1, 0],
        drag: 2.5,
        additive: true,
      });
    }
    for (let i = 0; i < 14 * power; i += 1) {
      this.particles.spawn({
        position: pos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), 0.2, rand(-0.3, 0.3))),
        velocity: new THREE.Vector3(rand(-0.5, 0.5), rand(1, 2.5), rand(-0.5, 0.5)),
        life: rand(1.4, 2.4),
        size: [0.5, rand(1.4, 2.2) * power],
        color: [0x3a3330, 0x15171a],
        opacity: [0.7, 0],
        drag: 1.2,
      });
    }
    for (let i = 0; i < 10 * power; i += 1) {
      this.particles.spawn({
        position: pos,
        velocity: new THREE.Vector3(rand(-3, 3), rand(4, 7), rand(-3, 3)),
        life: rand(0.6, 1.0),
        size: [0.09, 0.05],
        color: [0xffc070, 0x552200],
        opacity: [1, 0.6],
        gravity: -14,
        additive: true,
      });
    }
  }

  celebrate(board) {
    const center = BOARDS[board].center;
    for (let i = 0; i < 6; i += 1) {
      setTimeout(() => {
        const p = new THREE.Vector3(center.x + rand(-4, 4), rand(3, 6), center.z + rand(-4, 4));
        const colors = [0x5ee7ff, 0xffd166, 0xff7a59, 0x9bff8a];
        const c = colors[i % colors.length];
        for (let k = 0; k < 50; k += 1) {
          const dir = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize();
          this.particles.spawn({
            position: p,
            velocity: dir.multiplyScalar(rand(2.5, 4)),
            life: rand(1, 1.6),
            size: [0.22, 0.05],
            color: [0xffffff, c],
            opacity: [1, 0],
            gravity: -2.5,
            drag: 1.2,
            additive: true,
          });
        }
      }, i * 380);
    }
  }

  // ---- frame loop --------------------------------------------------------

  tick() {
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    // The camera uses real elapsed time so it still settles on slow devices.
    const camDt = Math.min(rawDt, 0.5);
    this.time += dt;
    const t = this.time;
    this.oceanUniforms.uTime.value = t;

    // Camera
    if (this.view === 'lobby') {
      this.lobbyAngle += camDt * 0.045;
      const r = this.camera.aspect < 0.8 ? 36 : 27;
      this.goalPos.set(Math.sin(this.lobbyAngle) * r, 11 + Math.sin(t * 0.2) * 1.2, Math.cos(this.lobbyAngle) * r);
      this.goalLook.set(0, 0, 0);
    }
    const k = 1 - Math.exp(-camDt * 2.6);
    this.camPos.lerp(this.goalPos, k);
    this.camLook.lerp(this.goalLook, k);
    this.parallax.lerp(this.parallaxGoal, 1 - Math.exp(-dt * 2));
    this.camera.position.copy(this.camPos);
    this.camera.position.x += this.parallax.x * 0.6;
    this.camera.position.y += this.parallax.y * 0.4;
    if (this.shakeAmount > 0.001) {
      this.camera.position.x += rand(-1, 1) * this.shakeAmount;
      this.camera.position.y += rand(-1, 1) * this.shakeAmount * 0.6;
      this.shakeAmount *= Math.exp(-dt * 7);
    }
    this.camera.lookAt(this.camLook);

    // Boards
    Object.entries(this.boardVisuals).forEach(([key, v]) => {
      const active = this.activeBoard === key;
      const pulse = active ? 0.55 + Math.sin(t * 3.2) * 0.25 : 0.35;
      v.frameMat.opacity += ((active ? 1 : 0.55) - v.frameMat.opacity) * k;
      v.glow.material.opacity += ((active ? pulse * 0.5 : 0.06) - v.glow.material.opacity) * k * 2;
      v.lines.material.opacity += ((active ? 0.55 : 0.32) - v.lines.material.opacity) * k;
    });

    // Ships bob on the swell
    ['self', 'enemy'].forEach((board) => {
      this.ships[board].forEach((entry) => {
        const g = entry.group;
        const baseY = entry.sunk ? -0.24 : 0;
        if (entry.sunk) entry.sinkT = Math.min(entry.sinkT + dt * 0.5, 1);
        entry.spawnT = Math.min(entry.spawnT + dt * 3, 1);
        const drop = (1 - easeOutBack(entry.spawnT)) * 0.6;
        const sinkRoll = entry.sunk ? entry.sinkT * 0.22 : 0;
        g.position.y = baseY * (entry.sunk ? entry.sinkT : 1) + Math.sin(t * 1.3 + entry.phase) * 0.035 + drop;
        const roll = Math.sin(t * 1.1 + entry.phase) * 0.025 + sinkRoll;
        const pitch = Math.sin(t * 0.9 + entry.phase * 1.7) * 0.012 + (entry.sunk ? entry.sinkT * 0.05 : 0);
        const yaw = g.rotation.y;
        g.rotation.set(0, yaw, 0);
        g.rotateX(roll);
        g.rotateZ(pitch);
        if (g.userData.radar && !entry.sunk) g.userData.radar.rotation.y = t * 2.2;
      });
    });
    if (this.ghost?.group.visible) {
      this.ghost.group.position.y = 0.12 + Math.sin(t * 3) * 0.04;
    }

    // Markers bob a little
    ['self', 'enemy'].forEach((board) => {
      this.markers[board].forEach((m) => {
        m.group.position.y = Math.sin(t * 1.6 + m.group.userData.phase) * 0.025;
      });
    });

    // Reticle spin
    if (this.reticle.visible) {
      this.reticle.rotation.y = t * 1.6;
      const s = 1 + Math.sin(t * 6) * 0.06;
      this.reticle.scale.set(s, s, s);
    }

    // Burning hits
    this.emitters.forEach((e) => {
      e.fire += dt * 9;
      e.smoke += dt * 2.6;
      while (e.fire >= 1) {
        e.fire -= 1;
        this.particles.spawn({
          position: e.pos.clone().add(new THREE.Vector3(rand(-0.12, 0.12), 0, rand(-0.12, 0.12))),
          velocity: new THREE.Vector3(rand(-0.1, 0.1), rand(0.7, 1.2), rand(-0.1, 0.1)),
          life: rand(0.35, 0.6),
          size: [rand(0.3, 0.42), 0.08],
          color: [0xffc25a, 0xff2d0a],
          opacity: [0.95, 0],
          additive: true,
        });
      }
      while (e.smoke >= 1) {
        e.smoke -= 1;
        this.particles.spawn({
          position: e.pos.clone().setY(e.pos.y + 0.35),
          velocity: new THREE.Vector3(rand(0.1, 0.35), rand(0.6, 1.0), rand(-0.15, 0.05)),
          life: rand(1.6, 2.4),
          size: [0.3, rand(0.9, 1.3)],
          color: [0x2c2a2a, 0x121417],
          opacity: [0.55, 0],
        });
      }
    });

    this.flashLight.intensity *= Math.exp(-dt * 9);
    this.particles.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}

function easeOutBack(x) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

export { wait };
