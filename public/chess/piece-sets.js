// Alternative looks for the 3D chess board. The classic wooden set lives in board3d.js;
// this file adds "Wizard's Chess" (carved stone statues that smash each other) and
// "Crystal" (glass pieces on a dark glass board).

import * as THREE from 'three';

export const PIECE_SETS = {
  classic: { name: 'Classic wood' },
  wizard: { name: "Wizard's Chess" },
  crystal: { name: 'Crystal' },
};

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

function seeded(seed) {
  let r = seed;
  return () => {
    r = (r * 16807) % 2147483647;
    return r / 2147483647;
  };
}

export function marbleCanvas(size, base, vein, seed) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const rand = seeded(seed);
  // Cloudy variation.
  for (let i = 0; i < 40; i += 1) {
    const g = ctx.createRadialGradient(rand() * size, rand() * size, 0, rand() * size, rand() * size, size * (0.2 + rand() * 0.5));
    g.addColorStop(0, rand() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // Veins.
  for (let i = 0; i < 7; i += 1) {
    ctx.strokeStyle = vein;
    ctx.globalAlpha = 0.18 + rand() * 0.3;
    ctx.lineWidth = 0.6 + rand() * 2.2;
    ctx.beginPath();
    let x = rand() * size;
    let y = 0;
    ctx.moveTo(x, y);
    while (y < size) {
      x += (rand() - 0.5) * size * 0.25;
      y += size * (0.05 + rand() * 0.1);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return c;
}

function noiseCanvas(size, base, spread, seed) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const rand = seeded(seed);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * spread;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  // Chisel marks and speckles.
  for (let i = 0; i < 260; i += 1) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)';
    ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 3, 1 + rand() * 2);
  }
  return c;
}

function tex(canvas, repeat = 1) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}

// Square fills for the board texture, per set.
export function squareCanvases(set, cell) {
  if (set === 'wizard') {
    return { light: marbleCanvas(cell, '#e9e4da', '#8a8478', 3), dark: marbleCanvas(cell, '#2c3330', '#8fa39a', 9) };
  }
  if (set === 'crystal') {
    const make = (a, b, seed) => {
      const c = document.createElement('canvas');
      c.width = c.height = cell;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, cell, cell);
      g.addColorStop(0, a);
      g.addColorStop(1, b);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cell, cell);
      const rand = seeded(seed);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      for (let i = 0; i < 3; i += 1) {
        ctx.lineWidth = 1 + rand() * 2;
        ctx.beginPath();
        const o = rand() * cell;
        ctx.moveTo(o, 0);
        ctx.lineTo(o - cell * 0.6, cell);
        ctx.stroke();
      }
      return c;
    };
    return { light: make('#cfe6ff', '#9fc3ea', 4), dark: make('#1a2440', '#0b1020', 8) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export function makeSetMaterials(set, quality) {
  if (set === 'wizard') {
    const stone = (base, spread, seed) => {
      const map = tex(noiseCanvas(256, base, spread, seed), 2);
      return new THREE.MeshStandardMaterial({ map, bumpMap: map, bumpScale: 0.6, roughness: 0.92, metalness: 0 });
    };
    return {
      w: stone('#b9b1a2', 38, 3),
      b: stone('#3b3b42', 30, 7),
      eyesW: new THREE.MeshBasicMaterial({ color: 0x9fe8ff }),
      eyesB: new THREE.MeshBasicMaterial({ color: 0xff5a2a }),
      frame: new THREE.MeshStandardMaterial({ map: tex(noiseCanvas(256, '#6d6a66', 40, 11), 3), roughness: 0.95 }),
      board: { roughness: 0.35, metalness: 0.02 },
      chunkW: new THREE.MeshStandardMaterial({ color: 0xb9b1a2, roughness: 0.95, flatShading: true }),
      chunkB: new THREE.MeshStandardMaterial({ color: 0x3b3b42, roughness: 0.95, flatShading: true }),
    };
  }
  if (set === 'crystal') {
    const glass = (color, attenuation) =>
      quality === 'low'
        ? new THREE.MeshStandardMaterial({ color, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.78 })
        : new THREE.MeshPhysicalMaterial({
            color,
            roughness: 0.04,
            metalness: 0,
            transmission: 1,
            thickness: 0.6,
            ior: 1.5,
            attenuationColor: new THREE.Color(attenuation),
            attenuationDistance: 0.6,
            clearcoat: 1,
            clearcoatRoughness: 0.05,
            specularIntensity: 1,
          });
    return {
      w: glass(0xf4fbff, 0xd6ecff),
      b: glass(0x6a4a9a, 0x2a0f4a),
      frame: new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.2, metalness: 0.8 }),
      board: { roughness: 0.12, metalness: 0.15 },
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wizard's Chess statues (built facing +z)
// ---------------------------------------------------------------------------

function lathe(points, segments = 18) {
  const geo = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segments);
  geo.computeVertexNormals();
  return geo;
}

const G = {};
function geometries() {
  if (G.ready) return G;
  G.plinth = new THREE.CylinderGeometry(0.36, 0.4, 0.08, 8);
  G.plinth2 = new THREE.CylinderGeometry(0.3, 0.34, 0.06, 8);
  G.robe = lathe([[0, 0], [0.27, 0], [0.24, 0.12], [0.19, 0.3], [0.15, 0.46], [0.12, 0.54], [0, 0.56]]);
  G.gown = lathe([[0, 0], [0.31, 0], [0.26, 0.1], [0.18, 0.3], [0.13, 0.5], [0.12, 0.62], [0, 0.64]]);
  G.soldier = lathe([[0, 0], [0.2, 0], [0.17, 0.12], [0.13, 0.26], [0.11, 0.32], [0, 0.33]]);
  G.head = new THREE.SphereGeometry(0.09, 14, 12);
  G.headSmall = new THREE.SphereGeometry(0.075, 12, 10);
  G.helmet = new THREE.SphereGeometry(0.085, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  G.brim = new THREE.CylinderGeometry(0.1, 0.1, 0.015, 14);
  G.shield = new THREE.CylinderGeometry(0.11, 0.11, 0.025, 16);
  G.shield.rotateX(Math.PI / 2);
  G.pole = new THREE.CylinderGeometry(0.012, 0.012, 0.62, 6);
  G.spearTip = new THREE.ConeGeometry(0.03, 0.09, 6);
  G.eye = new THREE.SphereGeometry(0.014, 6, 4);
  G.tower = lathe([[0, 0], [0.26, 0], [0.24, 0.06], [0.22, 0.08], [0.2, 0.52], [0.25, 0.56], [0.26, 0.62], [0, 0.62]], 16);
  G.merlon = new THREE.BoxGeometry(0.09, 0.1, 0.08);
  G.band = new THREE.TorusGeometry(0.205, 0.015, 6, 20);
  G.band.rotateX(Math.PI / 2);
  G.window = new THREE.BoxGeometry(0.07, 0.12, 0.05);
  G.mitre = new THREE.ConeGeometry(0.075, 0.22, 10);
  G.orb = new THREE.SphereGeometry(0.04, 10, 8);
  G.crownRing = new THREE.CylinderGeometry(0.09, 0.08, 0.05, 14, 1, true);
  G.spike = new THREE.ConeGeometry(0.018, 0.06, 5);
  G.cross = new THREE.BoxGeometry(0.03, 0.12, 0.03);
  G.crossBar = new THREE.BoxGeometry(0.09, 0.03, 0.03);
  G.cape = new THREE.CylinderGeometry(0.16, 0.26, 0.5, 14, 1, true, Math.PI * 0.55, Math.PI * 0.9);
  G.blade = new THREE.BoxGeometry(0.035, 0.42, 0.012);
  G.guard = new THREE.BoxGeometry(0.14, 0.025, 0.03);
  G.shoulder = new THREE.SphereGeometry(0.075, 10, 8);
  // Horse head for the knight: a chunky extruded profile.
  const s = new THREE.Shape();
  s.moveTo(-0.18, 0);
  s.lineTo(0.18, 0);
  s.quadraticCurveTo(0.12, 0.18, 0.1, 0.27); // chest to throat
  s.quadraticCurveTo(0.2, 0.31, 0.3, 0.38); // jaw
  s.quadraticCurveTo(0.39, 0.43, 0.37, 0.5); // muzzle
  s.quadraticCurveTo(0.34, 0.57, 0.24, 0.57); // nose bridge
  s.quadraticCurveTo(0.16, 0.6, 0.12, 0.68); // forehead
  s.lineTo(0.14, 0.8); // ear
  s.lineTo(0.06, 0.71);
  s.lineTo(0.02, 0.79); // second ear
  s.lineTo(-0.04, 0.69);
  s.quadraticCurveTo(-0.17, 0.63, -0.21, 0.44); // poll and mane line
  s.quadraticCurveTo(-0.24, 0.2, -0.18, 0);
  G.horse = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 3, curveSegments: 4 });
  G.horse.translate(0, 0, -0.1);
  G.horse.computeVertexNormals();
  G.mane = new THREE.BoxGeometry(0.05, 0.08, 0.06);
  G.ready = true;
  return G;
}

export function makeWizardPiece(type, color, mats, knightHead) {
  const g = geometries();
  const mat = mats[color];
  const group = new THREE.Group();
  const add = (geo, x = 0, y = 0, z = 0, m = mat) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const eyes = (y, z, spread = 0.03) => {
    const em = color === 'w' ? mats.eyesW : mats.eyesB;
    add(g.eye, -spread, y, z, em).castShadow = false;
    add(g.eye, spread, y, z, em).castShadow = false;
  };
  add(g.plinth, 0, 0.04);
  switch (type) {
    case 'p': {
      add(g.soldier, 0, 0.08);
      add(g.headSmall, 0, 0.47);
      add(g.helmet, 0, 0.48);
      add(g.brim, 0, 0.48);
      eyes(0.47, 0.068, 0.026);
      const shield = add(g.shield, -0.1, 0.25, 0.14);
      shield.rotation.y = 0.3;
      add(g.pole, 0.16, 0.39, 0.02);
      add(g.spearTip, 0.16, 0.74, 0.02);
      break;
    }
    case 'r': {
      add(g.plinth2, 0, 0.11);
      add(g.tower, 0, 0.13);
      add(g.band, 0, 0.3);
      add(g.band, 0, 0.48);
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2;
        const m = add(g.merlon, Math.cos(a) * 0.2, 0.8, Math.sin(a) * 0.2);
        m.rotation.y = -a;
      }
      const win = add(g.window, 0, 0.42, 0.2, new THREE.MeshBasicMaterial({ color: color === 'w' ? 0x9fe8ff : 0xff5a2a }));
      win.castShadow = false;
      break;
    }
    case 'n': {
      add(g.plinth2, 0, 0.11);
      // The classic knight's silhouette, carved in stone and shown in profile.
      const horse = add(knightHead || g.horse, 0, -0.1);
      horse.scale.set(1.35, 1.45, 1.0);
      add(g.soldier, 0, 0.08).scale.set(1.1, 0.5, 1.1);
      const em = color === 'w' ? mats.eyesW : mats.eyesB;
      add(g.eye, 0.13, 0.88, 0.1, em).castShadow = false;
      add(g.eye, 0.13, 0.88, -0.1, em).castShadow = false;
      // Mane ridges down the back of the neck.
      for (let i = 0; i < 5; i += 1) {
        const m = add(g.mane, -0.2 - i * 0.012, 0.95 - i * 0.12, 0);
        m.scale.set(0.8, 1, 1.9);
      }
      break;
    }
    case 'b': {
      add(g.robe, 0, 0.08);
      add(g.head, 0, 0.72);
      eyes(0.73, 0.083);
      add(g.mitre, 0, 0.9);
      add(g.shoulder, -0.13, 0.58);
      add(g.shoulder, 0.13, 0.58);
      add(g.pole, 0.2, 0.4, 0.06);
      add(g.orb, 0.2, 0.73, 0.06, color === 'w' ? mats.eyesW : mats.eyesB).castShadow = false;
      break;
    }
    case 'q': {
      add(g.gown, 0, 0.08);
      add(g.cape, 0, 0.36);
      add(g.head, 0, 0.8);
      eyes(0.81, 0.083);
      add(g.shoulder, -0.13, 0.66);
      add(g.shoulder, 0.13, 0.66);
      add(g.crownRing, 0, 0.9);
      for (let i = 0; i < 7; i += 1) {
        const a = (i / 7) * Math.PI * 2;
        add(g.spike, Math.cos(a) * 0.085, 0.95, Math.sin(a) * 0.085);
      }
      add(g.pole, -0.2, 0.46, 0.06);
      add(g.orb, -0.2, 0.8, 0.06);
      break;
    }
    case 'k': {
      add(g.gown, 0, 0.08).scale.set(1.08, 1.05, 1.08);
      add(g.cape, 0, 0.38).scale.set(1.1, 1.1, 1.1);
      add(g.head, 0, 0.86);
      eyes(0.87, 0.083);
      add(g.shoulder, -0.14, 0.7);
      add(g.shoulder, 0.14, 0.7);
      add(g.crownRing, 0, 0.96);
      for (let i = 0; i < 5; i += 1) {
        const a = (i / 5) * Math.PI * 2;
        add(g.spike, Math.cos(a) * 0.085, 1.01, Math.sin(a) * 0.085);
      }
      add(g.cross, 0, 1.08);
      add(g.crossBar, 0, 1.1);
      // Sword held point-down in front.
      add(g.blade, 0, 0.4, 0.2);
      add(g.guard, 0, 0.62, 0.2);
      break;
    }
    default:
      break;
  }
  // Statues face the enemy: white looks towards -z (Black's side). Knights are modelled
  // in profile, so the players see the horse's head from the side.
  group.rotation.y = color === 'w' ? Math.PI : 0;
  group.scale.setScalar(1.22);
  return group;
}

// Crystal pieces reuse the classic silhouettes with glass materials (handled in board3d.js).

// ---------------------------------------------------------------------------
// Smash effect for Wizard's Chess captures
// ---------------------------------------------------------------------------

export function shatter(board, group, color) {
  const mats = board.setMats;
  const chunkMat = color === 'w' ? mats.chunkW : mats.chunkB;
  const pieces = [];
  const origin = group.position.clone();
  const holder = new THREE.Group();
  board.scene.add(holder);
  for (let i = 0; i < 26; i += 1) {
    const size = 0.04 + Math.random() * 0.07;
    const geo = Math.random() < 0.5 ? new THREE.DodecahedronGeometry(size, 0) : new THREE.TetrahedronGeometry(size * 1.2, 0);
    const m = new THREE.Mesh(geo, chunkMat);
    m.castShadow = true;
    m.position.set(origin.x + (Math.random() - 0.5) * 0.3, 0.1 + Math.random() * 0.8, origin.z + (Math.random() - 0.5) * 0.3);
    const a = Math.random() * Math.PI * 2;
    const sp = 1 + Math.random() * 2.2;
    pieces.push({ m, v: new THREE.Vector3(Math.cos(a) * sp, 1.5 + Math.random() * 2.5, Math.sin(a) * sp), w: new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8) });
    holder.add(m);
  }
  // Dust puff.
  const dustMat = new THREE.MeshBasicMaterial({ color: color === 'w' ? 0xe8e0d0 : 0x6a6a72, transparent: true, opacity: 0.5, depthWrite: false });
  const dust = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), dustMat);
  dust.position.set(origin.x, 0.25, origin.z);
  holder.add(dust);
  board.scene.remove(group);
  let last = performance.now();
  board.shake = 0.12;
  board
    .tween(1400, (t) => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      pieces.forEach((p) => {
        p.v.y -= 9 * dt;
        p.m.position.addScaledVector(p.v, dt);
        if (p.m.position.y < 0.04) {
          p.m.position.y = 0.04;
          p.v.multiplyScalar(0.4);
          p.v.y = Math.abs(p.v.y) * 0.3;
        }
        p.m.rotation.x += p.w.x * dt;
        p.m.rotation.y += p.w.y * dt;
        if (t > 0.7) p.m.scale.setScalar(1 - (t - 0.7) / 0.3);
      });
      dust.scale.setScalar(1 + t * 3);
      dustMat.opacity = 0.5 * (1 - t);
    })
    .then(() => {
      board.scene.remove(holder);
      pieces.forEach((p) => p.m.geometry.dispose());
      dustMat.dispose();
    });
}
