// Monopoly board artwork, drawn on a canvas so the 3D board and the flat 2D view match.
// Board units: corners are 1.6 wide, other spaces 1 wide, so a side is 12.2 units.

const B = window.TycoonBoard;
export const CORNER = 1.6;
export const SIDE = CORNER * 2 + 9;

// Rectangle of a space in board units (x right, y down), plus which side it is on:
// 0 bottom, 1 left, 2 top, 3 right.
export function spaceRect(id) {
  const c = CORNER;
  if (id === 0) return { x: SIDE - c, y: SIDE - c, w: c, h: c, side: 0, corner: true };
  if (id < 10) return { x: SIDE - c - id, y: SIDE - c, w: 1, h: c, side: 0 };
  if (id === 10) return { x: 0, y: SIDE - c, w: c, h: c, side: 1, corner: true };
  if (id < 20) return { x: 0, y: SIDE - c - (id - 10), w: c, h: 1, side: 1 };
  if (id === 20) return { x: 0, y: 0, w: c, h: c, side: 2, corner: true };
  if (id < 30) return { x: c + (id - 21), y: 0, w: 1, h: c, side: 2 };
  if (id === 30) return { x: SIDE - c, y: 0, w: c, h: c, side: 3, corner: true };
  return { x: SIDE - c, y: c + (id - 31), w: c, h: 1, side: 3 };
}

export function spaceCenter(id) {
  const r = spaceRect(id);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

// Point inside a space, pushed towards its outer edge (where tokens stand).
export function tokenSpot(id, slot = 0, count = 1, jailed = false) {
  const r = spaceRect(id);
  if (id === 10) {
    // Jailed tokens sit in the cell; visitors stand along the outside edge.
    if (jailed) return { x: r.x + 1.0 + ((slot % 2) - 0.5) * 0.3 * (count > 1), y: r.y + 0.62 + Math.floor(slot / 2) * 0.3 };
    return { x: r.x + 0.24, y: r.y + 0.35 + slot * 0.3 };
  }
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const n = Math.max(count, 1);
  const a = (slot / n) * Math.PI * 2 + 0.4;
  const spread = n > 1 ? (r.corner ? 0.34 : 0.22) : 0;
  let ox = Math.cos(a) * spread;
  let oy = Math.sin(a) * spread;
  // Streets: stand below the colour band.
  const push = r.corner ? 0 : 0.18;
  const out = [[0, push], [-push, 0], [0, -push], [push, 0]][r.side];
  ox += out[0];
  oy += out[1];
  return { x: cx + ox, y: cy + oy };
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  words.forEach((w) => {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  });
  if (line) lines.push(line);
  return lines;
}

const ICON = { tax: '💰', station: '🚆', card: null, start: null };

function drawSpace(ctx, id, u) {
  const s = B.SPACES[id];
  const r = spaceRect(id);
  ctx.save();
  // Move to the space and rotate so its outer edge is "down".
  const cx = (r.x + r.w / 2) * u;
  const cy = (r.y + r.h / 2) * u;
  ctx.translate(cx, cy);
  const rot = [0, Math.PI / 2, Math.PI, -Math.PI / 2][r.side];
  ctx.rotate(rot);
  const w = (r.side % 2 === 0 ? r.w : r.h) * u;
  const h = (r.side % 2 === 0 ? r.h : r.w) * u;
  ctx.fillStyle = '#e9f3e6';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.strokeStyle = '#1b2a22';
  ctx.lineWidth = u * 0.025;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#16211b';
  const font = (px, weight = 700) => `${weight} ${Math.round(px)}px "Chakra Petch", "Arial Narrow", sans-serif`;
  if (r.corner) {
    ctx.rotate(Math.PI / 4 * (id === 10 ? 0 : 1));
    if (id === 0) {
      ctx.fillStyle = '#e0413b';
      ctx.font = font(u * 0.5, 800);
      ctx.fillText('GO', 0, -u * 0.02);
      ctx.font = font(u * 0.16, 600);
      ctx.fillStyle = '#16211b';
      ctx.fillText('Collect $200', 0, u * 0.28);
      ctx.fillText('salary as you pass', 0, u * 0.46);
      ctx.fillStyle = '#e0413b';
      ctx.beginPath();
      ctx.moveTo(-u * 0.5, -u * 0.45);
      ctx.lineTo(u * 0.3, -u * 0.45);
      ctx.lineTo(u * 0.3, -u * 0.58);
      ctx.lineTo(u * 0.55, -u * 0.38);
      ctx.lineTo(u * 0.3, -u * 0.18);
      ctx.lineTo(u * 0.3, -u * 0.31);
      ctx.lineTo(-u * 0.5, -u * 0.31);
      ctx.closePath();
      ctx.fill();
    } else if (id === 10) {
      // Jail cell in the corner, "just visiting" round the edge.
      ctx.fillStyle = '#f08a2e';
      ctx.fillRect(-w / 2 + u * 0.4, -h / 2, w - u * 0.4, h - u * 0.4);
      ctx.strokeRect(-w / 2 + u * 0.4, -h / 2, w - u * 0.4, h - u * 0.4);
      ctx.strokeStyle = '#16211b';
      ctx.lineWidth = u * 0.04;
      for (let i = 1; i < 5; i += 1) {
        const x = -w / 2 + u * 0.4 + ((w - u * 0.4) * i) / 5;
        ctx.beginPath();
        ctx.moveTo(x, -h / 2 + u * 0.15);
        ctx.lineTo(x, h / 2 - u * 0.55);
        ctx.stroke();
      }
      ctx.fillStyle = '#16211b';
      ctx.font = font(u * 0.2, 800);
      ctx.fillText('JAIL', u * 0.2, -h / 2 + u * 0.12);
      ctx.font = font(u * 0.14, 600);
      ctx.save();
      ctx.rotate(-Math.PI / 2);
      ctx.fillText('JUST', -u * 0.05, -w / 2 + u * 0.2);
      ctx.restore();
      ctx.fillText('VISITING', 0, h / 2 - u * 0.2);
    } else if (id === 20) {
      ctx.font = font(u * 0.22, 800);
      ctx.fillText('FREE', 0, -u * 0.36);
      ctx.fillText('PARKING', 0, u * 0.36);
      ctx.font = font(u * 0.5, 400);
      ctx.fillText('🚗', 0, 0);
    } else {
      ctx.font = font(u * 0.2, 800);
      ctx.fillText('GO TO', 0, -u * 0.38);
      ctx.fillText('JAIL', 0, u * 0.4);
      ctx.font = font(u * 0.46, 400);
      ctx.fillText('👮', 0, 0);
    }
    ctx.restore();
    return;
  }
  const inner = -h / 2;
  if (s.type === 'street') {
    ctx.fillStyle = B.GROUPS[s.group].color;
    ctx.fillRect(-w / 2, inner, w, h * 0.22);
    ctx.strokeRect(-w / 2, inner, w, h * 0.22);
  }
  ctx.fillStyle = '#16211b';
  // Shrink the font until the longest word fits the space.
  let px = u * 0.135;
  ctx.font = font(px, 700);
  const longest = Math.max(...s.name.toUpperCase().split(' ').map((word) => ctx.measureText(word).width));
  if (longest > w * 0.92) {
    px *= (w * 0.92) / longest;
    ctx.font = font(px, 700);
  }
  const top = s.type === 'street' ? inner + h * 0.34 : inner + h * 0.16;
  wrapText(ctx, s.name.toUpperCase(), w * 0.9).forEach((line, i) => ctx.fillText(line, 0, top + i * u * 0.15));
  if (s.type === 'card') {
    ctx.font = font(u * 0.44, 400);
    ctx.fillText(s.deck === 'lucky' ? '❓' : '🎁', 0, h * 0.06);
  } else if (s.type === 'tax') {
    ctx.font = font(u * 0.38, 400);
    ctx.fillText(s.amount === 200 ? '💰' : '💎', 0, h * 0.04);
  } else if (s.type === 'station') {
    ctx.font = font(u * 0.42, 400);
    ctx.fillText('🚆', 0, h * 0.06);
  } else if (s.type === 'utility') {
    ctx.font = font(u * 0.42, 400);
    ctx.fillText(s.icon, 0, h * 0.06);
  }
  const price = s.price ? `$${s.price}` : s.amount ? `Pay $${s.amount}` : '';
  if (price) {
    ctx.font = font(u * 0.14, 600);
    ctx.fillText(price, 0, h / 2 - u * 0.14);
  }
  ctx.restore();
}

export function drawBoard(ctx, size) {
  const u = size / SIDE;
  ctx.fillStyle = '#cfe5d0';
  ctx.fillRect(0, 0, size, size);
  // Centre.
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.45);
  g.addColorStop(0, '#dff0de');
  g.addColorStop(1, '#b9d9bb');
  ctx.fillStyle = g;
  ctx.fillRect(CORNER * u, CORNER * u, 9 * u, 9 * u);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(-Math.PI / 4);
  // The famous red banner.
  ctx.fillStyle = '#d6231e';
  ctx.beginPath();
  ctx.roundRect(-u * 3.5, -u * 0.8, u * 7, u * 1.6, u * 0.12);
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = u * 0.06;
  ctx.beginPath();
  ctx.roundRect(-u * 3.38, -u * 0.68, u * 6.76, u * 1.36, u * 0.08);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `900 ${Math.round(u * 1.1)}px "Chakra Petch", "Arial Black", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('MONOPOLY', 0, u * 0.06);
  // Card piles.
  const pile = (x, y, label, color, icon) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = u * 0.04;
    ctx.setLineDash([u * 0.12, u * 0.08]);
    ctx.beginPath();
    ctx.roundRect(-u * 1.1, -u * 0.7, u * 2.2, u * 1.4, u * 0.15);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${Math.round(u * (label.length > 10 ? 0.17 : 0.22))}px "Chakra Petch", sans-serif`;
    ctx.fillText(label, 0, u * 0.42);
    ctx.font = `${Math.round(u * 0.6)}px sans-serif`;
    ctx.fillText(icon, 0, -u * 0.1);
    ctx.restore();
  };
  pile(-u * 2.2, -u * 2.4, 'CHANCE', '#f08a2e', '❓');
  pile(u * 2.2, u * 2.4, 'COMMUNITY CHEST', '#3b82e0', '🎁');
  ctx.restore();
  for (let id = 0; id < 40; id += 1) drawSpace(ctx, id, u);
  ctx.strokeStyle = '#16211b';
  ctx.lineWidth = u * 0.05;
  ctx.strokeRect(0, 0, size, size);
  ctx.strokeRect(CORNER * u, CORNER * u, 9 * u, 9 * u);
}
