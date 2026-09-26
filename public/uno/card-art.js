// Card faces for UNO, drawn on canvas so the 3D table and the hand
// share exactly the same artwork.

export const COLOR_HEX = { r: '#e8413c', y: '#f5b920', g: '#2fb35a', b: '#2f7fe0', w: '#1d1f2a' };
export const COLOR_NAME = { r: 'Red', y: 'Yellow', g: 'Green', b: 'Blue' };
export const CARD_W = 256;
export const CARD_H = 384;

const cache = new Map();

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + amount * 255)));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

function glyph(ctx, value, x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const font = (s) => `900 ${Math.round(s)}px "Chakra Petch", "Arial Black", sans-serif`;
  if (/^\d$/.test(value)) {
    ctx.font = font(size);
    ctx.fillText(value, 0, size * 0.04);
    if (value === '6' || value === '9') {
      ctx.fillRect(-size * 0.22, size * 0.42, size * 0.44, size * 0.07);
    }
  } else if (value === 'skip') {
    ctx.lineWidth = size * 0.14;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-size * 0.25, size * 0.25);
    ctx.lineTo(size * 0.25, -size * 0.25);
    ctx.stroke();
  } else if (value === 'rev') {
    ctx.lineWidth = size * 0.12;
    ctx.lineCap = 'round';
    for (const s of [1, -1]) {
      ctx.save();
      ctx.rotate(s === 1 ? 0 : Math.PI);
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.3, Math.PI * 1.05, Math.PI * 1.85);
      ctx.stroke();
      const ax = Math.cos(Math.PI * 1.85) * size * 0.3;
      const ay = Math.sin(Math.PI * 1.85) * size * 0.3;
      ctx.beginPath();
      ctx.moveTo(ax + size * 0.16, ay + size * 0.02);
      ctx.lineTo(ax - size * 0.04, ay - size * 0.14);
      ctx.lineTo(ax - size * 0.06, ay + size * 0.14);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  } else if (value === 'd2' || value === 'w4') {
    ctx.font = font(size * 0.78);
    ctx.fillText(value === 'd2' ? '+2' : '+4', 0, size * 0.04);
  } else if (value === 'wild') {
    ctx.font = font(size * 0.5);
    ctx.fillText('★', 0, size * 0.04);
  }
  ctx.restore();
}

// Four-colour pinwheel used on wild cards and the card back.
function pinwheel(ctx, x, y, r) {
  ['r', 'y', 'g', 'b'].forEach((c, i) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, (i * Math.PI) / 2 - Math.PI / 4, ((i + 1) * Math.PI) / 2 - Math.PI / 4);
    ctx.closePath();
    ctx.fillStyle = COLOR_HEX[c];
    ctx.fill();
  });
}

function drawFace(ctx, card) {
  const W = CARD_W;
  const H = CARD_H;
  const base = COLOR_HEX[card.color];
  // White border and body.
  roundRect(ctx, 0, 0, W, H, 26);
  ctx.fillStyle = '#fbfaf5';
  ctx.fill();
  roundRect(ctx, 14, 14, W - 28, H - 28, 18);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, shade(base, 0.12));
  g.addColorStop(1, shade(base, -0.12));
  ctx.fillStyle = g;
  ctx.fill();
  // Diagonal sheen stripes.
  ctx.save();
  roundRect(ctx, 14, 14, W - 28, H - 28, 18);
  ctx.clip();
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = '#fff';
  for (let i = -H; i < W + H; i += 46) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 18, 0);
    ctx.lineTo(i + 18 - H, H);
    ctx.lineTo(i - H, H);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // Centre emblem: a tilted white diamond.
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-0.18);
  const dw = W * 0.36;
  const dh = H * 0.34;
  ctx.beginPath();
  ctx.moveTo(0, -dh);
  ctx.quadraticCurveTo(dw * 0.18, -dh * 0.18, dw, 0);
  ctx.quadraticCurveTo(dw * 0.18, dh * 0.18, 0, dh);
  ctx.quadraticCurveTo(-dw * 0.18, dh * 0.18, -dw, 0);
  ctx.quadraticCurveTo(-dw * 0.18, -dh * 0.18, 0, -dh);
  ctx.closePath();
  ctx.fillStyle = '#fbfaf5';
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.restore();
  if (card.color === 'w') pinwheel(ctx, W / 2, H / 2, W * 0.2);
  const ink = card.color === 'w' ? '#fff' : base;
  const big = card.color === 'w' ? W * 0.34 : W * 0.46;
  if (card.color === 'w') {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    glyph(ctx, card.value, W / 2, H / 2, big, ink);
    ctx.restore();
  } else {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowOffsetY = 3;
    glyph(ctx, card.value, W / 2, H / 2, big, ink);
    ctx.restore();
  }
  // Corner marks.
  const corner = card.color === 'w' ? '#fff' : '#fff';
  glyph(ctx, card.value, 46, 50, 52, corner);
  ctx.save();
  ctx.translate(W - 46, H - 50);
  ctx.rotate(Math.PI);
  glyph(ctx, card.value, 0, 0, 52, corner);
  ctx.restore();
}

function drawBack(ctx) {
  const W = CARD_W;
  const H = CARD_H;
  roundRect(ctx, 0, 0, W, H, 26);
  ctx.fillStyle = '#fbfaf5';
  ctx.fill();
  roundRect(ctx, 14, 14, W - 28, H - 28, 18);
  const g = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, H * 0.6);
  g.addColorStop(0, '#3a2a6a');
  g.addColorStop(1, '#120c26');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  roundRect(ctx, 14, 14, W - 28, H - 28, 18);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 3;
  for (let r = 30; r < H; r += 26) {
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-0.35);
  pinwheel(ctx, 0, 0, W * 0.27);
  ctx.beginPath();
  ctx.arc(0, 0, W * 0.27, 0, Math.PI * 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#fbfaf5';
  ctx.stroke();
  ctx.fillStyle = '#fbfaf5';
  ctx.font = '900 44px "Chakra Petch", "Arial Black", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 8;
  ctx.fillText('UNO', 0, 4);
  ctx.restore();
}

// Returns a canvas for a card face (or the back when card is null).
export function cardCanvas(card) {
  const key = card ? `${card.color}:${card.value}` : 'back';
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (card) drawFace(ctx, card);
  else drawBack(ctx);
  cache.set(key, canvas);
  return canvas;
}

const urls = new Map();
export function cardUrl(card) {
  const key = card ? `${card.color}:${card.value}` : 'back';
  if (!urls.has(key)) urls.set(key, cardCanvas(card).toDataURL('image/png'));
  return urls.get(key);
}

// Fonts load late; redraw everything once they are ready.
export function resetArt() {
  cache.clear();
  urls.clear();
}

export function cardLabel(card) {
  const L = { skip: 'Skip', rev: 'Reverse', d2: '+2', wild: 'Wild', w4: 'Wild +4' };
  if (card.color === 'w') return L[card.value];
  return `${COLOR_NAME[card.color]} ${L[card.value] || card.value}`;
}
