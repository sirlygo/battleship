// 3D card table for Color Clash: felt, the draw deck and discard pile, a spinning
// direction ring and every opponent's fanned hand. Your own hand lives in the page.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { cardCanvas, COLOR_HEX } from './card-art.js';

const CW = 1;
const CH = 1.5;
const CT = 0.012;
const SEAT_R = 4.7;
const DECK_POS = new THREE.Vector3(-1.05, 0, 0.1);
const PILE_POS = new THREE.Vector3(1.0, 0, 0.1);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function feltTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 20, size / 2, size / 2, size * 0.55);
  g.addColorStop(0, '#2e6a52');
  g.addColorStop(1, '#173d30');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  // A faint ring pattern printed on the felt.
  ctx.strokeStyle = 'rgba(255, 240, 200, 0.12)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.32, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function labelCanvas(name, count, turn) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = '700 46px "Chakra Petch", sans-serif';
  const text = name.length > 14 ? `${name.slice(0, 13)}…` : name;
  const w = Math.min(500, ctx.measureText(text).width + 150);
  const x = (512 - w) / 2;
  ctx.fillStyle = turn ? 'rgba(255, 209, 102, 0.95)' : 'rgba(10, 14, 28, 0.78)';
  ctx.beginPath();
  ctx.roundRect(x, 20, w, 88, 44);
  ctx.fill();
  ctx.fillStyle = turn ? '#241400' : '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 32, 66);
  // Card count bubble.
  ctx.fillStyle = turn ? '#241400' : '#ffd166';
  ctx.beginPath();
  ctx.arc(x + w - 46, 64, 32, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = turn ? '#ffd166' : '#241400';
  ctx.textAlign = 'center';
  ctx.font = '800 40px "Chakra Petch", sans-serif';
  ctx.fillText(String(count), x + w - 46, 67);
  return canvas;
}

export class ClashTable3D {
  constructor(canvas, { quality = 'high' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.visible = false;
    this.tweens = [];
    this.seats = new Map(); // seat -> { group, fan, label, count, angle }
    this.mySeat = null;
    this.onDeck = null;
    this.texCache = new Map();
    this.pileCards = [];
    this.direction = 1;
    this.color = 'r';

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
    scene.environmentIntensity = 0.35;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

    scene.add(new THREE.HemisphereLight(0xfff4e0, 0x1a2a20, 0.9));
    const key = new THREE.DirectionalLight(0xfff2dd, 2.2);
    key.position.set(-3, 12, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
    key.shadow.bias = -0.0008;
    key.shadow.radius = 4;
    scene.add(key);
    const spot = new THREE.PointLight(0xffe2b0, 30, 18, 1.6);
    spot.position.set(0, 6, 0);
    scene.add(spot);

    this.buildTable();
    this.cardGeo = new THREE.BoxGeometry(CW, CT, CH);
    this.edgeMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 });
    this.backMat = this.faceMaterial(null);
    this.buildDeck();
    this.buildRing();
    this.fx = new THREE.Group();
    scene.add(this.fx);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('click', (e) => {
      if (this.hitDeck(e)) this.onDeck?.();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const hit = this.hitDeck(e);
      canvas.style.cursor = hit && this.deckActive ? 'pointer' : 'default';
    });
    this.resize();
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.tick());
  }

  // ---- construction ------------------------------------------------------

  buildTable() {
    const felt = new THREE.Mesh(new THREE.CircleGeometry(6.4, 96), new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.95 }));
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    this.scene.add(felt);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(6.55, 0.28, 20, 120),
      new THREE.MeshStandardMaterial({ color: 0x5a3018, roughness: 0.35, metalness: 0.1 })
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.05;
    rim.castShadow = true;
    rim.receiveShadow = true;
    this.scene.add(rim);
    const brass = new THREE.Mesh(new THREE.TorusGeometry(6.3, 0.03, 8, 120), new THREE.MeshStandardMaterial({ color: 0xd4aa4f, metalness: 1, roughness: 0.3 }));
    brass.rotation.x = -Math.PI / 2;
    brass.position.y = 0.01;
    this.scene.add(brass);
  }

  faceMaterial(card) {
    const key = card ? `${card.color}:${card.value}` : 'back';
    if (!this.texCache.has(key)) {
      const tex = new THREE.CanvasTexture(cardCanvas(card));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      this.texCache.set(key, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 }));
    }
    return this.texCache.get(key);
  }

  // Box face order: +x, -x, +y (top), -y (bottom), +z, -z.
  makeCard(card, faceUp = true) {
    const top = faceUp && card ? this.faceMaterial(card) : this.backMat;
    const bottom = faceUp && card ? this.backMat : card ? this.faceMaterial(card) : this.backMat;
    const m = new THREE.Mesh(this.cardGeo, [this.edgeMat, this.edgeMat, top, bottom, this.edgeMat, this.edgeMat]);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  buildDeck() {
    this.deck = new THREE.Group();
    this.deck.position.copy(DECK_POS);
    this.scene.add(this.deck);
    this.deckBody = new THREE.Mesh(new THREE.BoxGeometry(CW, 1, CH), [this.edgeMat, this.edgeMat, this.backMat, this.edgeMat, this.edgeMat, this.edgeMat]);
    this.deckBody.castShadow = true;
    this.deckBody.receiveShadow = true;
    this.deck.add(this.deckBody);
    this.deckGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(CW * 1.5, CH * 1.35),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.deckGlow.rotation.x = -Math.PI / 2;
    this.deckGlow.position.y = 0.004;
    this.deck.add(this.deckGlow);
    this.setDeck(60);
  }

  buildRing() {
    const group = new THREE.Group();
    this.ringMat = new THREE.MeshStandardMaterial({ color: COLOR_HEX.r, emissive: COLOR_HEX.r, emissiveIntensity: 0.6, roughness: 0.4 });
    for (let i = 0; i < 3; i += 1) {
      const start = (i * Math.PI * 2) / 3;
      const arc = new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.05, 8, 40, Math.PI * 0.5), this.ringMat);
      arc.rotation.z = start;
      group.add(arc);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.34, 16), this.ringMat);
      const a = start + Math.PI * 0.5;
      head.position.set(Math.cos(a) * 2.35, Math.sin(a) * 2.35, 0);
      head.rotation.z = a;
      group.add(head);
    }
    group.rotation.x = -Math.PI / 2;
    group.position.y = 0.02;
    this.ring = group;
    this.scene.add(group);
  }

  // ---- state -------------------------------------------------------------

  setDeck(count) {
    this.deckCount = count;
    const h = Math.max(0.02, Math.min(count, 108) * 0.006);
    this.deckBody.scale.y = h;
    this.deckBody.position.y = h / 2;
    this.deckGlow.position.y = h + 0.003;
    this.deckBody.visible = count > 0;
  }

  setDeckActive(active) {
    this.deckActive = active;
  }

  setColor(color) {
    this.color = color;
    const hex = COLOR_HEX[color] || '#ffffff';
    this.ringMat.color.set(hex);
    this.ringMat.emissive.set(hex);
  }

  setDirection(direction) {
    this.direction = direction;
    // Arrows point the way play moves: flip the ring over for the other direction.
    this.ring.scale.x = direction === 1 ? 1 : -1;
  }

  // Lay the pile out again from the top card (older cards are just decoration).
  setPile(top, count) {
    const want = Math.min(Math.max(count, 1), 14);
    while (this.pileCards.length > want) this.scene.remove(this.pileCards.shift());
    while (this.pileCards.length < want) {
      const m = this.makeCard({ color: 'w', value: 'wild' });
      m.material[2] = this.backMat;
      m.rotation.y = (Math.random() - 0.5) * 0.9;
      m.position.set(PILE_POS.x + (Math.random() - 0.5) * 0.18, 0, PILE_POS.z + (Math.random() - 0.5) * 0.18);
      this.scene.add(m);
      this.pileCards.unshift(m);
    }
    this.pileCards.forEach((m, i) => {
      m.position.y = CT / 2 + i * CT * 1.1;
      // Buried cards show a random face; only the top one matters.
      if (i < this.pileCards.length - 1 && !m.userData.face) {
        m.userData.face = true;
        const colors = ['r', 'y', 'g', 'b'];
        m.material = [...m.material];
        m.material[2] = this.faceMaterial({ color: colors[Math.floor(Math.random() * 4)], value: String(Math.floor(Math.random() * 10)) });
      }
    });
    const topMesh = this.pileCards[this.pileCards.length - 1];
    topMesh.material = [...topMesh.material];
    topMesh.material[2] = this.faceMaterial(top);
    topMesh.userData.face = true;
  }

  seatAngle(seat) {
    return this.seats.get(seat)?.angle ?? 0;
  }

  seatPos(seat, r = SEAT_R) {
    if (seat === this.mySeat) return new THREE.Vector3(0, 0.9, 6.6);
    const a = this.seatAngle(seat);
    return new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r);
  }

  // seats: [{ seat, name, cards, gone }] in play order; me: my seat or null.
  setSeats(seats, me, turn) {
    const live = seats.filter((s) => !s.gone);
    const n = live.length;
    this.mySeat = live.some((s) => s.seat === me) ? me : null;
    const pivot = this.mySeat ?? live[0]?.seat;
    const start = Math.max(0, live.findIndex((s) => s.seat === pivot));
    const angles = new Map();
    live.forEach((s, i) => {
      const k = (i - start + n) % n;
      // Spectators see every seat; players sit at the front (angle 0).
      const a = this.mySeat === null ? ((k + 0.5) * Math.PI * 2) / n : (k * Math.PI * 2) / n;
      angles.set(s.seat, a);
    });
    // Remove seats that are gone.
    this.seats.forEach((info, seat) => {
      if (!angles.has(seat)) {
        this.scene.remove(info.group);
        this.seats.delete(seat);
      }
    });
    live.forEach((s) => {
      let info = this.seats.get(s.seat);
      if (!info) {
        const group = new THREE.Group();
        const fan = new THREE.Group();
        group.add(fan);
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
        label.scale.set(2.6, 0.65, 1);
        label.position.set(0, 0.95, 0.45);
        label.renderOrder = 5;
        group.add(label);
        const glow = new THREE.Mesh(
          new THREE.RingGeometry(0.9, 1.35, 48),
          new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })
        );
        glow.rotation.x = -Math.PI / 2;
        glow.position.y = 0.01;
        group.add(glow);
        this.scene.add(group);
        info = { group, fan, label, glow, count: -1, labelKey: '' };
        this.seats.set(s.seat, info);
      }
      info.angle = angles.get(s.seat);
      info.group.position.set(Math.sin(info.angle) * SEAT_R, 0, Math.cos(info.angle) * SEAT_R);
      info.group.rotation.y = info.angle;
      info.group.visible = s.seat !== this.mySeat;
      info.isTurn = s.seat === turn;
      this.setSeatCount(s.seat, s.cards, s.name);
    });
    this.names = new Map(seats.map((s) => [s.seat, s.name]));
  }

  setSeatCount(seat, count, name = this.names?.get(seat) || '') {
    const info = this.seats.get(seat);
    if (!info) return;
    const key = `${name}|${count}|${info.isTurn}`;
    if (info.labelKey !== key) {
      info.labelKey = key;
      const tex = new THREE.CanvasTexture(labelCanvas(name, count, info.isTurn));
      tex.colorSpace = THREE.SRGBColorSpace;
      info.label.material.map?.dispose();
      info.label.material.map = tex;
      info.label.material.needsUpdate = true;
    }
    if (info.count === count) return;
    info.count = count;
    info.fan.clear();
    const shown = Math.min(count, 14);
    const spread = Math.min(1.5, 0.16 * shown);
    for (let i = 0; i < shown; i += 1) {
      const t = shown === 1 ? 0 : i / (shown - 1) - 0.5;
      // A hand of cards held spread out, seen from above: each card pivots
      // around the player's wrist and points towards the middle of the table.
      const holder = new THREE.Group();
      holder.rotation.y = -t * spread;
      holder.position.y = 0.05 + i * 0.012;
      const m = this.makeCard(null, false);
      m.position.set(0, 0, -0.65);
      m.rotation.x = -0.22;
      holder.add(m);
      info.fan.add(holder);
    }
  }

  // ---- animation ---------------------------------------------------------

  flyCard(card, from, to, { faceUpEnd = true, faceUpStart = false, duration = 520, endRot = 0, arc = 1.2 } = {}) {
    const m = this.makeCard(card, true);
    this.scene.add(m);
    const startRot = faceUpStart ? 0 : Math.PI;
    const endFlip = faceUpEnd ? 0 : Math.PI;
    return this.tween(duration, (t) => {
      const e = easeInOut(t);
      m.position.lerpVectors(from, to, e);
      m.position.y += Math.sin(t * Math.PI) * arc;
      m.rotation.z = startRot + (endFlip - startRot) * e;
      m.rotation.y = endRot * e;
    }).then(() => m);
  }

  async playCard(seat, card, color) {
    const from = this.seatPos(seat).clone();
    from.y += 0.5;
    const to = PILE_POS.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.18, CT / 2 + Math.min(this.pileCards.length, 14) * CT * 1.1, (Math.random() - 0.5) * 0.18));
    const m = await this.flyCard(card, from, to, { faceUpStart: seat === this.mySeat, endRot: (Math.random() - 0.5) * 0.9 });
    m.rotation.z = 0;
    // The flown card becomes the new top of the pile.
    this.pileCards.push(m);
    m.userData.face = true;
    while (this.pileCards.length > 14) this.scene.remove(this.pileCards.shift());
    this.burst(to, COLOR_HEX[card.color === 'w' ? color : card.color]);
    if (card.color === 'w') this.setColor(color);
  }

  async drawTo(seat, count) {
    const shown = Math.min(count, 6);
    const jobs = [];
    for (let i = 0; i < shown; i += 1) {
      jobs.push(
        new Promise((resolve) => setTimeout(resolve, i * 110)).then(async () => {
          const from = DECK_POS.clone();
          from.y = this.deckBody.scale.y + 0.02;
          const to = this.seatPos(seat).clone();
          to.y += 0.4;
          const m = await this.flyCard(null, from, to, { faceUpEnd: false, duration: 480, arc: 0.9 });
          this.scene.remove(m);
        })
      );
    }
    await Promise.all(jobs);
  }

  // A handful of cards whoosh between two seats (hand swaps).
  async swap(a, b) {
    const pa = this.seatPos(a).clone().setY(0.6);
    const pb = this.seatPos(b).clone().setY(0.6);
    const jobs = [];
    for (let i = 0; i < 4; i += 1) {
      jobs.push(this.flyCard(null, pa, pb, { faceUpEnd: false, duration: 600 + i * 60, arc: 1.6 }).then((m) => this.scene.remove(m)));
      jobs.push(this.flyCard(null, pb, pa, { faceUpEnd: false, duration: 600 + i * 60, arc: 1.2 }).then((m) => this.scene.remove(m)));
    }
    await Promise.all(jobs);
  }

  spinRing() {
    this.ringBoost = 1;
  }

  burst(pos, hex) {
    const count = this.quality === 'low' ? 10 : 22;
    const mat = new THREE.MeshBasicMaterial({ color: hex, transparent: true });
    const geo = new THREE.SphereGeometry(0.05, 6, 6);
    const parts = [];
    for (let i = 0; i < count; i += 1) {
      const p = new THREE.Mesh(geo, mat);
      p.position.copy(pos);
      const a = Math.random() * Math.PI * 2;
      p.userData.v = new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 2), 1.5 + Math.random() * 2, Math.sin(a) * (1 + Math.random() * 2));
      this.fx.add(p);
      parts.push(p);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 48), new THREE.MeshBasicMaterial({ color: hex, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos).setY(0.03);
    this.fx.add(ring);
    this.tween(650, (t) => {
      parts.forEach((p) => {
        p.position.addScaledVector(p.userData.v, 0.016);
        p.userData.v.y -= 0.12;
      });
      mat.opacity = 1 - t;
      ring.scale.setScalar(1 + t * 4);
      ring.material.opacity = 1 - t;
    }).then(() => {
      parts.forEach((p) => this.fx.remove(p));
      this.fx.remove(ring);
    });
  }

  hitDeck(event) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    return ray.intersectObject(this.deckBody).length > 0;
  }

  // Page position of the deck (for tests).
  projectDeck() {
    const v = DECK_POS.clone().setY(this.deckBody.scale.y).project(this.camera);
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
    const key = this.camera.aspect.toFixed(3);
    if (this.fitKey !== key) {
      this.fitKey = key;
      const cam = this.camera.clone();
      const pts = [];
      for (let i = 0; i < 16; i += 1) {
        const a = (i / 16) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.sin(a) * 6.9, 0.3, Math.cos(a) * 6.9));
      }
      pts.push(new THREE.Vector3(0, 1.8, -SEAT_R));
      const v = new THREE.Vector3();
      const elev = THREE.MathUtils.degToRad(this.camera.aspect < 0.9 ? 62 : 52);
      let dist = 6;
      for (; dist < 40; dist += 0.1) {
        cam.position.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist);
        cam.lookAt(0, 0, 0.6);
        cam.updateMatrixWorld();
        if (pts.every((p) => (v.copy(p).project(cam), Math.abs(v.x) < 0.98 && Math.abs(v.y) < 0.97))) break;
      }
      this.camDist = dist;
      this.camElev = elev;
    }
    this.camera.position.set(0, Math.sin(this.camElev) * this.camDist, Math.cos(this.camElev) * this.camDist);
    this.camera.lookAt(0, 0, 0.6);
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
    this.ringBoost = Math.max(0, (this.ringBoost || 0) - dt * 0.8);
    this.ring.rotation.z += dt * (0.25 + this.ringBoost * 5) * -this.direction;
    const pulse = 0.5 + Math.sin(now / 250) * 0.5;
    this.ringMat.emissiveIntensity = 0.45 + pulse * 0.35;
    this.deckGlow.material.opacity += ((this.deckActive ? 0.25 + pulse * 0.35 : 0) - this.deckGlow.material.opacity) * Math.min(1, dt * 8);
    this.seats.forEach((info) => {
      const goal = info.isTurn ? 0.35 + pulse * 0.4 : 0;
      info.glow.material.opacity += (goal - info.glow.material.opacity) * Math.min(1, dt * 8);
    });
    this.placeCamera();
    this.renderer.render(this.scene, this.camera);
  }
}
