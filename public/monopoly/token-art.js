// Coin artwork for the player pieces: a trainer portrait on a Poké Ball coin in
// the Pokémon edition, or the classic token drawn in silver. Drawn on canvas so
// the 3D coins, the 2D board and the page icons all match.

const cache = new Map();
const SKIN = '#f6d2b0';
const SKIN_TAN = '#d9a273';
const INK = '#2a1e1a';

const TRAINERS = {
  ash: { hair: '#1c1c22', shirt: '#2f5fb0', trim: '#fbfaf5' },
  misty: { hair: '#f28a2e', shirt: '#f5d02e', trim: '#e0413b' },
  brock: { hair: '#3a2412', shirt: '#f08a2e', trim: '#3e8a4a', skin: SKIN_TAN, squint: true },
  gary: { hair: '#a8733f', shirt: '#6a3fa8', trim: '#1c1c22' },
  may: { hair: '#8a5230', shirt: '#e0413b', trim: '#1c1c22' },
  dawn: { hair: '#223a86', shirt: '#1c1c22', trim: '#e05aa8' },
};

const path = (ctx, fn) => {
  ctx.beginPath();
  fn();
};

// ---------------------------------------------------------------------------
// Trainer portraits (drawn in a 512 box, centred on the head)
// ---------------------------------------------------------------------------

function face(ctx, t, cx, cy, r) {
  // Ears and head.
  ctx.fillStyle = t.skin || SKIN;
  [-1, 1].forEach((s) => {
    path(ctx, () => ctx.ellipse(cx + s * r * 0.95, cy + r * 0.1, r * 0.18, r * 0.24, 0, 0, Math.PI * 2));
    ctx.fill();
  });
  path(ctx, () => ctx.ellipse(cx, cy, r, r * 1.05, 0, 0, Math.PI * 2));
  ctx.fill();
  // Eyes.
  if (t.squint) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = r * 0.07;
    ctx.lineCap = 'round';
    [-1, 1].forEach((s) => {
      path(ctx, () => {
        ctx.moveTo(cx + s * r * 0.5, cy + r * 0.12);
        ctx.lineTo(cx + s * r * 0.2, cy + r * 0.12);
      });
      ctx.stroke();
    });
  } else {
    [-1, 1].forEach((s) => {
      const ex = cx + s * r * 0.36;
      const ey = cy + r * 0.12;
      ctx.fillStyle = INK;
      path(ctx, () => ctx.ellipse(ex, ey, r * 0.13, r * 0.19, 0, 0, Math.PI * 2));
      ctx.fill();
      ctx.fillStyle = '#fff';
      path(ctx, () => ctx.arc(ex - r * 0.04, ey - r * 0.07, r * 0.055, 0, Math.PI * 2));
      ctx.fill();
      // Brows.
      ctx.strokeStyle = INK;
      ctx.lineWidth = r * 0.05;
      ctx.lineCap = 'round';
      path(ctx, () => {
        ctx.moveTo(ex - r * 0.14, ey - r * 0.3);
        ctx.quadraticCurveTo(ex, ey - r * 0.38 + s * 0, ex + r * 0.14, ey - r * 0.3);
      });
      ctx.stroke();
    });
  }
  // Blush and smile.
  ctx.fillStyle = 'rgba(240, 110, 110, 0.35)';
  [-1, 1].forEach((s) => {
    path(ctx, () => ctx.ellipse(cx + s * r * 0.58, cy + r * 0.42, r * 0.14, r * 0.08, 0, 0, Math.PI * 2));
    ctx.fill();
  });
  ctx.fillStyle = '#9a2a2a';
  path(ctx, () => {
    ctx.moveTo(cx - r * 0.22, cy + r * 0.48);
    ctx.quadraticCurveTo(cx, cy + r * 0.82, cx + r * 0.22, cy + r * 0.48);
    ctx.closePath();
  });
  ctx.fill();
}

function bust(ctx, t, cx, cy, r) {
  // Shoulders and shirt, with a trim stripe.
  ctx.fillStyle = t.shirt;
  path(ctx, () => {
    ctx.moveTo(cx - r * 1.9, cy + r * 3);
    ctx.quadraticCurveTo(cx - r * 1.8, cy + r * 1.2, cx - r * 0.5, cy + r * 1.05);
    ctx.lineTo(cx + r * 0.5, cy + r * 1.05);
    ctx.quadraticCurveTo(cx + r * 1.8, cy + r * 1.2, cx + r * 1.9, cy + r * 3);
    ctx.closePath();
  });
  ctx.fill();
  ctx.fillStyle = t.trim;
  path(ctx, () => {
    ctx.moveTo(cx - r * 0.45, cy + r * 1.06);
    ctx.lineTo(cx, cy + r * 1.6);
    ctx.lineTo(cx + r * 0.45, cy + r * 1.06);
    ctx.lineTo(cx + r * 0.25, cy + r * 1.06);
    ctx.lineTo(cx, cy + r * 1.35);
    ctx.lineTo(cx - r * 0.25, cy + r * 1.06);
    ctx.closePath();
  });
  ctx.fill();
  // Neck.
  ctx.fillStyle = t.skin || SKIN;
  path(ctx, () => ctx.rect(cx - r * 0.25, cy + r * 0.8, r * 0.5, r * 0.32));
  ctx.fill();
}

function spikes(ctx, cx, cy, r, color, count, lift) {
  ctx.fillStyle = color;
  path(ctx, () => {
    ctx.moveTo(cx - r * 1.05, cy + r * 0.05);
    for (let i = 0; i <= count; i += 1) {
      const a = Math.PI + (i / count) * Math.PI;
      const tip = r * (1.3 + lift * (i % 2 ? 0.15 : 0.35));
      const mid = r * 0.95;
      const a2 = Math.PI + ((i + 0.5) / count) * Math.PI;
      ctx.lineTo(cx + Math.cos(a) * tip, cy - r * 0.1 + Math.sin(a) * tip);
      if (i < count) ctx.lineTo(cx + Math.cos(a2) * mid, cy - r * 0.1 + Math.sin(a2) * mid);
    }
    ctx.lineTo(cx + r * 1.05, cy + r * 0.05);
    ctx.quadraticCurveTo(cx, cy - r * 0.45, cx - r * 1.05, cy + r * 0.05);
  });
  ctx.fill();
}

function drawTrainerArt(ctx, kind, cx, cy, r) {
  const t = TRAINERS[kind] || TRAINERS.ash;
  bust(ctx, t, cx, cy, r);
  // Hair that sits behind the face.
  if (kind === 'dawn') {
    ctx.fillStyle = t.hair;
    path(ctx, () => ctx.roundRect(cx - r * 1.25, cy - r * 0.6, r * 2.5, r * 2.1, r * 0.6));
    ctx.fill();
  }
  if (kind === 'misty') {
    ctx.fillStyle = t.hair;
    path(ctx, () => ctx.ellipse(cx + r * 1.2, cy - r * 0.6, r * 0.35, r * 0.55, 0.6, 0, Math.PI * 2));
    ctx.fill();
    ctx.fillStyle = '#e0413b';
    path(ctx, () => ctx.arc(cx + r * 0.95, cy - r * 0.35, r * 0.12, 0, Math.PI * 2));
    ctx.fill();
  }
  if (kind === 'may') {
    ctx.fillStyle = t.hair;
    [-1, 1].forEach((s) => {
      path(ctx, () => ctx.ellipse(cx + s * r * 1.02, cy + r * 0.55, r * 0.22, r * 0.55, s * 0.15, 0, Math.PI * 2));
      ctx.fill();
    });
  }
  face(ctx, t, cx, cy, r);
  // Hair and hats on top.
  switch (kind) {
    case 'ash': {
      spikes(ctx, cx, cy + r * 0.05, r, t.hair, 9, 0.2);
      // Cap: red crown, white front panel, green badge, brim.
      ctx.fillStyle = '#d6231e';
      path(ctx, () => {
        ctx.moveTo(cx - r * 1.05, cy - r * 0.2);
        ctx.quadraticCurveTo(cx - r * 1.0, cy - r * 1.35, cx, cy - r * 1.35);
        ctx.quadraticCurveTo(cx + r * 1.0, cy - r * 1.35, cx + r * 1.05, cy - r * 0.2);
        ctx.closePath();
      });
      ctx.fill();
      ctx.fillStyle = '#fbfaf5';
      path(ctx, () => {
        ctx.moveTo(cx - r * 0.55, cy - r * 0.3);
        ctx.quadraticCurveTo(cx - r * 0.5, cy - r * 1.25, cx, cy - r * 1.3);
        ctx.quadraticCurveTo(cx + r * 0.5, cy - r * 1.25, cx + r * 0.55, cy - r * 0.3);
        ctx.closePath();
      });
      ctx.fill();
      ctx.strokeStyle = '#2fb35a';
      ctx.lineWidth = r * 0.12;
      path(ctx, () => ctx.arc(cx, cy - r * 0.6, r * 0.22, Math.PI * 0.9, Math.PI * 2.1));
      ctx.stroke();
      ctx.fillStyle = '#d6231e';
      path(ctx, () => ctx.ellipse(cx, cy - r * 0.22, r * 1.15, r * 0.2, 0, 0, Math.PI * 2));
      ctx.fill();
      break;
    }
    case 'misty':
      ctx.fillStyle = t.hair;
      path(ctx, () => {
        ctx.moveTo(cx - r * 1.05, cy + r * 0.1);
        ctx.quadraticCurveTo(cx - r * 1.1, cy - r * 1.2, cx, cy - r * 1.15);
        ctx.quadraticCurveTo(cx + r * 1.1, cy - r * 1.2, cx + r * 1.05, cy + r * 0.1);
        ctx.lineTo(cx + r * 0.7, cy - r * 0.35);
        ctx.lineTo(cx + r * 0.35, cy - r * 0.15);
        ctx.lineTo(cx, cy - r * 0.4);
        ctx.lineTo(cx - r * 0.35, cy - r * 0.15);
        ctx.lineTo(cx - r * 0.7, cy - r * 0.35);
        ctx.closePath();
      });
      ctx.fill();
      break;
    case 'brock':
      spikes(ctx, cx, cy - r * 0.1, r, t.hair, 11, 0.9);
      break;
    case 'gary':
      spikes(ctx, cx, cy - r * 0.05, r, t.hair, 7, 0.6);
      ctx.fillStyle = t.hair;
      path(ctx, () => {
        ctx.moveTo(cx - r * 0.9, cy - r * 0.2);
        ctx.quadraticCurveTo(cx - r * 0.2, cy - r * 0.9, cx + r * 0.9, cy - r * 0.35);
        ctx.lineTo(cx + r * 0.3, cy - r * 0.25);
        ctx.closePath();
      });
      ctx.fill();
      break;
    case 'may':
      ctx.fillStyle = t.hair;
      path(ctx, () => {
        ctx.moveTo(cx - r * 1.05, cy + r * 0.2);
        ctx.quadraticCurveTo(cx - r * 1.1, cy - r * 1.0, cx, cy - r * 1.0);
        ctx.quadraticCurveTo(cx + r * 1.1, cy - r * 1.0, cx + r * 1.05, cy + r * 0.2);
        ctx.lineTo(cx + r * 0.5, cy - r * 0.3);
        ctx.lineTo(cx, cy - r * 0.2);
        ctx.lineTo(cx - r * 0.5, cy - r * 0.3);
        ctx.closePath();
      });
      ctx.fill();
      // Red bandana with its knot.
      ctx.fillStyle = '#e0413b';
      path(ctx, () => {
        ctx.moveTo(cx - r * 1.08, cy - r * 0.45);
        ctx.quadraticCurveTo(cx, cy - r * 1.55, cx + r * 1.08, cy - r * 0.45);
        ctx.quadraticCurveTo(cx, cy - r * 0.85, cx - r * 1.08, cy - r * 0.45);
      });
      ctx.fill();
      ctx.fillStyle = '#fbfaf5';
      path(ctx, () => ctx.ellipse(cx, cy - r * 1.05, r * 0.25, r * 0.08, 0, 0, Math.PI * 2));
      ctx.fill();
      break;
    case 'dawn':
    default:
      ctx.fillStyle = t.hair;
      path(ctx, () => {
        ctx.moveTo(cx - r * 1.05, cy + r * 0.3);
        ctx.quadraticCurveTo(cx - r * 1.1, cy - r * 1.0, cx, cy - r * 1.0);
        ctx.quadraticCurveTo(cx + r * 1.1, cy - r * 1.0, cx + r * 1.05, cy + r * 0.3);
        ctx.lineTo(cx + r * 0.6, cy - r * 0.35);
        ctx.lineTo(cx - r * 0.6, cy - r * 0.35);
        ctx.closePath();
      });
      ctx.fill();
      // White beanie with a pink badge.
      ctx.fillStyle = '#fbfaf5';
      path(ctx, () => {
        ctx.moveTo(cx - r * 1.08, cy - r * 0.5);
        ctx.quadraticCurveTo(cx - r * 0.9, cy - r * 1.6, cx, cy - r * 1.6);
        ctx.quadraticCurveTo(cx + r * 0.9, cy - r * 1.6, cx + r * 1.08, cy - r * 0.5);
        ctx.closePath();
      });
      ctx.fill();
      ctx.fillStyle = '#e05aa8';
      path(ctx, () => ctx.rect(cx - r * 1.08, cy - r * 0.62, r * 2.16, r * 0.16));
      ctx.fill();
      path(ctx, () => ctx.arc(cx + r * 0.55, cy - r * 1.05, r * 0.16, 0, Math.PI * 2));
      ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Classic tokens (silver silhouettes)
// ---------------------------------------------------------------------------

function drawClassicArt(ctx, kind, cx, cy, s) {
  const g = ctx.createLinearGradient(cx - s, cy - s, cx + s, cy + s);
  g.addColorStop(0, '#f4f6f8');
  g.addColorStop(0.5, '#b9bec6');
  g.addColorStop(1, '#7c828b');
  ctx.fillStyle = g;
  ctx.strokeStyle = '#3a3f46';
  ctx.lineWidth = s * 0.05;
  ctx.lineJoin = 'round';
  const fillStroke = () => {
    ctx.fill();
    ctx.stroke();
  };
  switch (kind) {
    case 'car':
      path(ctx, () => {
        ctx.moveTo(cx - s * 0.95, cy + s * 0.15);
        ctx.lineTo(cx - s * 0.9, cy - s * 0.1);
        ctx.lineTo(cx - s * 0.35, cy - s * 0.15);
        ctx.lineTo(cx - s * 0.2, cy - s * 0.45);
        ctx.lineTo(cx + s * 0.1, cy - s * 0.45);
        ctx.lineTo(cx + s * 0.2, cy - s * 0.15);
        ctx.lineTo(cx + s * 0.85, cy - s * 0.1);
        ctx.quadraticCurveTo(cx + s * 1.0, cy, cx + s * 0.95, cy + s * 0.15);
        ctx.closePath();
      });
      fillStroke();
      [-0.55, 0.55].forEach((x) => {
        ctx.fillStyle = '#2a2e33';
        path(ctx, () => ctx.arc(cx + x * s, cy + s * 0.2, s * 0.24, 0, Math.PI * 2));
        ctx.fill();
        ctx.fillStyle = g;
        path(ctx, () => ctx.arc(cx + x * s, cy + s * 0.2, s * 0.11, 0, Math.PI * 2));
        ctx.fill();
      });
      break;
    case 'hat':
      path(ctx, () => ctx.ellipse(cx, cy + s * 0.45, s * 0.85, s * 0.18, 0, 0, Math.PI * 2));
      fillStroke();
      path(ctx, () => {
        ctx.moveTo(cx - s * 0.5, cy + s * 0.45);
        ctx.lineTo(cx - s * 0.45, cy - s * 0.65);
        ctx.quadraticCurveTo(cx, cy - s * 0.78, cx + s * 0.45, cy - s * 0.65);
        ctx.lineTo(cx + s * 0.5, cy + s * 0.45);
        ctx.closePath();
      });
      fillStroke();
      ctx.fillStyle = '#3a3f46';
      path(ctx, () => ctx.rect(cx - s * 0.49, cy + s * 0.12, s * 0.98, s * 0.16));
      ctx.fill();
      break;
    case 'dog':
      path(ctx, () => {
        ctx.moveTo(cx - s * 0.75, cy + s * 0.55);
        ctx.lineTo(cx - s * 0.7, cy - s * 0.05);
        ctx.lineTo(cx - s * 0.9, cy - s * 0.35);
        ctx.lineTo(cx - s * 0.6, cy - s * 0.15);
        ctx.lineTo(cx + s * 0.25, cy - s * 0.15);
        ctx.lineTo(cx + s * 0.3, cy - s * 0.55);
        ctx.lineTo(cx + s * 0.42, cy - s * 0.35);
        ctx.lineTo(cx + s * 0.55, cy - s * 0.6);
        ctx.lineTo(cx + s * 0.62, cy - s * 0.3);
        ctx.lineTo(cx + s * 0.95, cy - s * 0.15);
        ctx.lineTo(cx + s * 0.85, cy + s * 0.05);
        ctx.lineTo(cx + s * 0.55, cy + s * 0.1);
        ctx.lineTo(cx + s * 0.5, cy + s * 0.55);
        ctx.lineTo(cx + s * 0.3, cy + s * 0.55);
        ctx.lineTo(cx + s * 0.28, cy + s * 0.25);
        ctx.lineTo(cx - s * 0.4, cy + s * 0.25);
        ctx.lineTo(cx - s * 0.45, cy + s * 0.55);
        ctx.closePath();
      });
      fillStroke();
      break;
    case 'ship':
      path(ctx, () => {
        ctx.moveTo(cx - s * 0.95, cy + s * 0.05);
        ctx.lineTo(cx + s * 0.95, cy + s * 0.05);
        ctx.lineTo(cx + s * 0.7, cy + s * 0.4);
        ctx.lineTo(cx - s * 0.8, cy + s * 0.4);
        ctx.closePath();
      });
      fillStroke();
      path(ctx, () => {
        ctx.moveTo(cx - s * 0.45, cy + s * 0.05);
        ctx.lineTo(cx - s * 0.4, cy - s * 0.2);
        ctx.lineTo(cx - s * 0.1, cy - s * 0.2);
        ctx.lineTo(cx - s * 0.05, cy - s * 0.5);
        ctx.lineTo(cx + s * 0.15, cy - s * 0.5);
        ctx.lineTo(cx + s * 0.2, cy - s * 0.2);
        ctx.lineTo(cx + s * 0.45, cy - s * 0.2);
        ctx.lineTo(cx + s * 0.5, cy + s * 0.05);
        ctx.closePath();
      });
      fillStroke();
      ctx.lineWidth = s * 0.06;
      path(ctx, () => {
        ctx.moveTo(cx + s * 0.45, cy - s * 0.1);
        ctx.lineTo(cx + s * 0.85, cy - s * 0.15);
        ctx.moveTo(cx - s * 0.4, cy - s * 0.1);
        ctx.lineTo(cx - s * 0.8, cy - s * 0.15);
        ctx.moveTo(cx + s * 0.05, cy - s * 0.5);
        ctx.lineTo(cx + s * 0.05, cy - s * 0.85);
      });
      ctx.stroke();
      break;
    case 'boot':
      path(ctx, () => {
        ctx.moveTo(cx - s * 0.45, cy - s * 0.8);
        ctx.lineTo(cx + s * 0.1, cy - s * 0.8);
        ctx.lineTo(cx + s * 0.1, cy + s * 0.05);
        ctx.quadraticCurveTo(cx + s * 0.9, cy + s * 0.05, cx + s * 0.9, cy + s * 0.45);
        ctx.lineTo(cx + s * 0.9, cy + s * 0.6);
        ctx.lineTo(cx - s * 0.5, cy + s * 0.6);
        ctx.closePath();
      });
      fillStroke();
      ctx.fillStyle = '#3a3f46';
      path(ctx, () => ctx.rect(cx - s * 0.5, cy + s * 0.48, s * 1.4, s * 0.12));
      ctx.fill();
      break;
    case 'thimble':
    default:
      path(ctx, () => {
        ctx.moveTo(cx - s * 0.55, cy + s * 0.65);
        ctx.lineTo(cx - s * 0.45, cy - s * 0.4);
        ctx.quadraticCurveTo(cx, cy - s * 0.9, cx + s * 0.45, cy - s * 0.4);
        ctx.lineTo(cx + s * 0.55, cy + s * 0.65);
        ctx.closePath();
      });
      fillStroke();
      ctx.fillStyle = '#5a6068';
      for (let row = 0; row < 4; row += 1) {
        for (let i = -2; i <= 2; i += 1) {
          path(ctx, () => ctx.arc(cx + i * s * 0.17, cy - s * 0.3 + row * s * 0.2, s * 0.045, 0, Math.PI * 2));
          ctx.fill();
        }
      }
      ctx.fillStyle = '#3a3f46';
      path(ctx, () => ctx.rect(cx - s * 0.56, cy + s * 0.5, s * 1.12, s * 0.12));
      ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// The coin
// ---------------------------------------------------------------------------

// A round coin face: player-colour rim, themed background, picture in the middle.
export function coinCanvas(kind, color, size = 512) {
  const key = `${kind}|${color}|${size}`;
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const trainer = kind in TRAINERS;
  // Rim in the player's colour.
  const rim = ctx.createRadialGradient(c, c * 0.8, c * 0.2, c, c, c);
  rim.addColorStop(0, color);
  rim.addColorStop(1, color);
  ctx.fillStyle = rim;
  path(ctx, () => ctx.arc(c, c, c, 0, Math.PI * 2));
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = size * 0.018;
  path(ctx, () => ctx.arc(c, c, c * 0.95, 0, Math.PI * 2));
  ctx.stroke();
  // Inner face.
  const inner = c * 0.84;
  ctx.save();
  path(ctx, () => ctx.arc(c, c, inner, 0, Math.PI * 2));
  ctx.clip();
  if (trainer) {
    // Poké Ball background.
    ctx.fillStyle = '#e8453c';
    ctx.fillRect(0, 0, size, c);
    ctx.fillStyle = '#fbfaf5';
    ctx.fillRect(0, c, size, c);
    ctx.fillStyle = '#1c1c22';
    ctx.fillRect(0, c - size * 0.025, size, size * 0.05);
    path(ctx, () => ctx.arc(c, c, size * 0.13, 0, Math.PI * 2));
    ctx.fill();
    ctx.fillStyle = '#fbfaf5';
    path(ctx, () => ctx.arc(c, c, size * 0.09, 0, Math.PI * 2));
    ctx.fill();
    drawTrainerArt(ctx, kind, c, c * 0.92, size * 0.19);
  } else {
    const bg = ctx.createRadialGradient(c, c * 0.8, 0, c, c, inner);
    bg.addColorStop(0, '#2f8a4f');
    bg.addColorStop(1, '#14502b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
    drawClassicArt(ctx, kind, c, c, size * 0.3);
  }
  // Soft shine across the top.
  const shine = ctx.createLinearGradient(0, 0, 0, size);
  shine.addColorStop(0, 'rgba(255,255,255,0.25)');
  shine.addColorStop(0.45, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = size * 0.012;
  path(ctx, () => ctx.arc(c, c, inner, 0, Math.PI * 2));
  ctx.stroke();
  cache.set(key, canvas);
  return canvas;
}

const urls = new Map();
export function coinUrl(kind, color) {
  const key = `${kind}|${color}`;
  if (!urls.has(key)) urls.set(key, coinCanvas(kind, color, 128).toDataURL('image/png'));
  return urls.get(key);
}
