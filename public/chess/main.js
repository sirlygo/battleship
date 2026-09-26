import { Chess } from '/vendor/chess/chess.js';
import { store } from '../shared/room-client.js';
import { setupTable, bigText, toast, sound } from '../shared/table-ui.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FILES = 'abcdefgh';
const COLOR_NAME = { w: 'White', b: 'Black' };
// Solid glyphs for both colours (CSS colours them); U+FE0E keeps them out of emoji style.
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const VS = '︎';
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

const el = {
  board: $('board'),
  squares: $('squares'),
  pieces: $('pieces'),
  topPlayer: $('topPlayer'),
  bottomPlayer: $('bottomPlayer'),
  status: $('status'),
  statusTitle: $('statusTitle'),
  statusSub: $('statusSub'),
  waitingBox: $('waitingBox'),
  clockWrap: $('clockWrap'),
  clockButtons: [...document.querySelectorAll('[data-clock]')],
  drawBox: $('drawBox'),
  drawText: $('drawText'),
  acceptDrawBtn: $('acceptDrawBtn'),
  declineDrawBtn: $('declineDrawBtn'),
  gameActions: $('gameActions'),
  drawBtn: $('drawBtn'),
  resignBtn: $('resignBtn'),
  moveList: $('moveList'),
  hintsToggle: $('hintsToggle'),
  coordsToggle: $('coordsToggle'),
  gameOver: $('gameOver'),
  goKicker: $('goKicker'),
  goTitle: $('goTitle'),
  goReason: $('goReason'),
  promotion: $('promotion'),
  promoChoices: $('promoChoices'),
  promoCancel: $('promoCancel'),
};

const prefs = (() => {
  const defaults = { hints: true, coords: true };
  try {
    return { ...defaults, ...JSON.parse(store('local', 'chess:prefs') || '{}') };
  } catch {
    return defaults;
  }
})();

const view = {
  snap: null,
  chess: new Chess(),
  flip: false,
  squares: new Map(), // square name -> element
  pieces: new Map(), // square name -> { el, type, color }
  shownPly: 0,
  shownRound: null,
  animating: false,
  selected: null,
  pending: null, // { from, to } while a move is on its way to the server
  drag: null,
  clock: null,
  lastTurn: null,
  overShownRound: null,
};

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const fileOf = (sq) => FILES.indexOf(sq[0]);
const rankOf = (sq) => Number(sq[1]) - 1;
const displayCol = (sq) => (view.flip ? 7 - fileOf(sq) : fileOf(sq));
const displayRow = (sq) => (view.flip ? rankOf(sq) : 7 - rankOf(sq));

function squareAt(col, row) {
  const file = view.flip ? 7 - col : col;
  const rank = view.flip ? row : 7 - row;
  return `${FILES[file]}${rank + 1}`;
}

function squareFromPoint(clientX, clientY) {
  const rect = el.board.getBoundingClientRect();
  const col = Math.floor(((clientX - rect.left) / rect.width) * 8);
  const row = Math.floor(((clientY - rect.top) / rect.height) * 8);
  if (col < 0 || row < 0 || col > 7 || row > 7) return null;
  return squareAt(col, row);
}

// ---------------------------------------------------------------------------
// Rendering the board
// ---------------------------------------------------------------------------

function buildSquares() {
  el.squares.innerHTML = '';
  view.squares.clear();
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const sq = squareAt(col, row);
      const node = document.createElement('div');
      const light = (fileOf(sq) + rankOf(sq)) % 2 === 1;
      node.className = `cs-sq ${light ? 'light' : 'dark'}`;
      node.dataset.sq = sq;
      if (col === 0) {
        const r = document.createElement('span');
        r.className = 'coord rank';
        r.textContent = sq[1];
        node.appendChild(r);
      }
      if (row === 7) {
        const f = document.createElement('span');
        f.className = 'coord file';
        f.textContent = sq[0];
        node.appendChild(f);
      }
      el.squares.appendChild(node);
      view.squares.set(sq, node);
    }
  }
}

function place(node, sq) {
  node.style.setProperty('--x', displayCol(sq));
  node.style.setProperty('--y', displayRow(sq));
}

function makePiece(type, color, sq, { appear = false } = {}) {
  const node = document.createElement('div');
  node.className = `cs-pc ${color}${appear ? ' appear' : ''}`;
  const glyph = document.createElement('span');
  glyph.textContent = GLYPH[type] + VS;
  node.appendChild(glyph);
  place(node, sq);
  el.pieces.appendChild(node);
  return { el: node, type, color };
}

function boardMap(chess) {
  const map = new Map();
  chess.board().flat().forEach((p) => {
    if (p) map.set(p.square, { type: p.type, color: p.color });
  });
  return map;
}

function syncPieces(chess, { appear = false } = {}) {
  el.pieces.innerHTML = '';
  view.pieces.clear();
  boardMap(chess).forEach((p, sq) => view.pieces.set(sq, makePiece(p.type, p.color, sq, { appear })));
}

function removePiece(sq, { fade = true } = {}) {
  const piece = view.pieces.get(sq);
  if (!piece) return;
  view.pieces.delete(sq);
  if (fade) {
    piece.el.classList.add('taken-out');
    setTimeout(() => piece.el.remove(), 420);
  } else {
    piece.el.remove();
  }
}

// Brings the shown pieces in line with a position, animating differences.
function reconcile(chess) {
  const target = boardMap(chess);
  view.pieces.forEach((piece, sq) => {
    const want = target.get(sq);
    if (!want) removePiece(sq);
    else if (want.type !== piece.type || want.color !== piece.color) {
      removePiece(sq, { fade: false });
      view.pieces.set(sq, makePiece(want.type, want.color, sq, { appear: true }));
    }
  });
  target.forEach((want, sq) => {
    if (!view.pieces.has(sq)) view.pieces.set(sq, makePiece(want.type, want.color, sq, { appear: true }));
  });
}

async function animateMove({ from, to }, chess) {
  const moving = view.pieces.get(from);
  let captured = false;
  if (moving) {
    if (view.pieces.has(to)) {
      removePiece(to);
      captured = true;
    }
    view.pieces.delete(from);
    view.pieces.set(to, moving);
    moving.el.classList.add('moving');
    place(moving.el, to);
    // Castling: slide the rook too.
    if (moving.type === 'k' && Math.abs(fileOf(from) - fileOf(to)) === 2) {
      const rank = from[1];
      const [rookFrom, rookTo] = fileOf(to) === 6 ? [`h${rank}`, `f${rank}`] : [`a${rank}`, `d${rank}`];
      const rook = view.pieces.get(rookFrom);
      if (rook) {
        view.pieces.delete(rookFrom);
        view.pieces.set(rookTo, rook);
        place(rook.el, rookTo);
      }
    }
    await wait(240);
    moving.el.classList.remove('moving');
  }
  const before = view.pieces.size;
  reconcile(chess);
  if (view.pieces.size < before) captured = true; // en passant
  if (chess.inCheck()) sound.check();
  else if (captured) sound.capture();
  else sound.clack();
}

function renderHighlights() {
  const s = view.snap;
  view.squares.forEach((node) => node.classList.remove('last', 'selected', 'target', 'capture', 'check', 'hover-target'));
  if (!s) return;
  if (s.lastMove) {
    view.squares.get(s.lastMove.from)?.classList.add('last');
    view.squares.get(s.lastMove.to)?.classList.add('last');
  }
  if (s.inCheck && s.phase !== 'lobby') {
    const king = view.chess.board().flat().find((p) => p && p.type === 'k' && p.color === s.turnColor);
    if (king) view.squares.get(king.square)?.classList.add('check');
  }
  if (view.selected) {
    view.squares.get(view.selected)?.classList.add('selected');
    if (prefs.hints) {
      view.chess.moves({ square: view.selected, verbose: true }).forEach((m) => {
        const node = view.squares.get(m.to);
        node?.classList.add('target');
        if (m.captured) node?.classList.add('capture');
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Input: tap-to-move and drag-and-drop
// ---------------------------------------------------------------------------

function isMyTurn() {
  const s = view.snap;
  return Boolean(s && !s.spectator && s.phase === 'playing' && s.turn === 'you' && !view.pending && !view.animating);
}

function ownPieceAt(sq) {
  const p = view.chess.get(sq);
  return Boolean(p && view.snap && p.color === view.snap.myColor);
}

function legalTargets(from) {
  return view.chess.moves({ square: from, verbose: true });
}

function choosePromotion(color) {
  return new Promise((resolve) => {
    el.promoChoices.innerHTML = '';
    ['q', 'r', 'b', 'n'].forEach((type) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = color;
      btn.textContent = GLYPH[type] + VS;
      btn.title = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[type];
      btn.addEventListener('click', () => {
        el.promotion.hidden = true;
        resolve(type);
      });
      el.promoChoices.appendChild(btn);
    });
    el.promoCancel.onclick = () => {
      el.promotion.hidden = true;
      resolve(null);
    };
    el.promotion.hidden = false;
    el.promoChoices.firstElementChild.focus();
  });
}

async function attemptMove(from, to) {
  const moves = legalTargets(from).filter((m) => m.to === to);
  view.selected = null;
  if (!moves.length) {
    snapBack(from);
    renderHighlights();
    return false;
  }
  let promotion;
  if (moves.some((m) => m.promotion)) {
    promotion = await choosePromotion(view.snap.myColor);
    if (!promotion) {
      snapBack(from);
      renderHighlights();
      return false;
    }
  }
  // Show the move straight away; the server's answer confirms or reverts it.
  const piece = view.pieces.get(from);
  if (piece) {
    if (view.pieces.has(to)) removePiece(to);
    view.pieces.delete(from);
    view.pieces.set(to, piece);
    piece.el.classList.remove('dragging');
    piece.el.style.transform = '';
    place(piece.el, to);
  }
  view.pending = { from, to };
  renderHighlights();
  const res = await client.send('move', { from, to, promotion });
  if (res.error) {
    view.pending = null;
    toast(res.error, 'error');
    sound.error();
    syncPieces(view.chess);
    renderHighlights();
  }
  return true;
}

function snapBack(sq) {
  const piece = view.pieces.get(sq);
  if (!piece) return;
  piece.el.classList.remove('dragging');
  piece.el.style.transform = '';
}

el.board.addEventListener('pointerdown', (event) => {
  const s = view.snap;
  if (!s || s.phase !== 'playing' || s.spectator) return;
  const sq = squareFromPoint(event.clientX, event.clientY);
  if (!sq) return;
  if (!isMyTurn()) {
    if (ownPieceAt(sq)) toast(`Waiting for ${nameFor(s.enemyColor)} to move.`);
    return;
  }
  if (view.selected && view.selected !== sq && !ownPieceAt(sq)) {
    attemptMove(view.selected, sq);
    return;
  }
  if (!ownPieceAt(sq)) {
    view.selected = null;
    renderHighlights();
    return;
  }
  const wasSelected = view.selected === sq;
  view.selected = sq;
  renderHighlights();
  if (!legalTargets(sq).length) toast("That piece can't move.", 'error');
  view.drag = { from: sq, x: event.clientX, y: event.clientY, moved: false, wasSelected, pointerId: event.pointerId };
  el.board.setPointerCapture(event.pointerId);
});

el.board.addEventListener('pointermove', (event) => {
  const drag = view.drag;
  if (!drag) return;
  const dist = Math.hypot(event.clientX - drag.x, event.clientY - drag.y);
  if (!drag.moved && dist < 6) return;
  drag.moved = true;
  const piece = view.pieces.get(drag.from);
  if (!piece) return;
  const rect = el.board.getBoundingClientRect();
  const size = rect.width / 8;
  piece.el.classList.add('dragging');
  piece.el.style.transform = `translate(${event.clientX - rect.left - size / 2}px, ${event.clientY - rect.top - size / 2}px)`;
  const over = squareFromPoint(event.clientX, event.clientY);
  view.squares.forEach((node) => node.classList.remove('hover-target'));
  if (over && legalTargets(drag.from).some((m) => m.to === over)) view.squares.get(over).classList.add('hover-target');
});

function endDrag(event) {
  const drag = view.drag;
  if (!drag) return;
  view.drag = null;
  if (el.board.hasPointerCapture?.(drag.pointerId)) el.board.releasePointerCapture(drag.pointerId);
  if (drag.moved) {
    const to = squareFromPoint(event.clientX, event.clientY);
    if (to && to !== drag.from) attemptMove(drag.from, to);
    else {
      snapBack(drag.from);
      renderHighlights();
    }
    return;
  }
  // A plain tap on an already-selected piece deselects it.
  if (drag.wasSelected) {
    view.selected = null;
    renderHighlights();
  } else {
    sound.click();
  }
}
el.board.addEventListener('pointerup', endDrag);
el.board.addEventListener('pointercancel', (event) => {
  if (view.drag) snapBack(view.drag.from);
  view.drag = null;
  renderHighlights();
  if (el.board.hasPointerCapture?.(event.pointerId)) el.board.releasePointerCapture(event.pointerId);
});

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function nameFor(color) {
  const s = view.snap;
  if (!s) return COLOR_NAME[color];
  const seat = color === s.myColor ? s.perspective : s.perspective === 0 ? 1 : 0;
  return s.players[seat]?.name || COLOR_NAME[color];
}

function formatClock(ms) {
  const clamped = Math.max(0, ms);
  if (clamped < 20e3) return `${Math.floor(clamped / 1000)}.${Math.floor((clamped % 1000) / 100)}`;
  const total = Math.ceil(clamped / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function clockRemaining(color) {
  const c = view.clock;
  if (!c) return null;
  const base = c[color];
  return c.running === color ? base - (performance.now() - c.at) : base;
}

function renderClocks() {
  document.querySelectorAll('.cs-clock').forEach((node) => {
    const color = node.dataset.color;
    const ms = clockRemaining(color);
    if (ms === null) return;
    node.textContent = formatClock(ms);
    const running = view.clock.running === color && view.snap?.phase === 'playing';
    node.classList.toggle('running', running);
    node.classList.toggle('low', running && ms < 20e3);
  });
}
setInterval(renderClocks, 100);

function renderPlayer(node, color, isBottom) {
  const s = view.snap;
  const seat = color === s.myColor ? s.perspective : s.perspective === 0 ? 1 : 0;
  const player = s.players[seat];
  node.innerHTML = '';
  node.classList.toggle('to-move', s.phase === 'playing' && s.turnColor === color);

  const name = document.createElement('span');
  name.className = 'pname';
  name.textContent = player ? player.name : 'Waiting for opponent…';
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = !s.spectator && isBottom ? `${COLOR_NAME[color]} · you` : COLOR_NAME[color];
  node.append(name, tag);
  if (player && !player.connected) {
    const off = document.createElement('span');
    off.className = 'offline';
    off.textContent = '● offline';
    node.appendChild(off);
  }

  // Material this player has won, plus their point lead.
  const enemy = color === 'w' ? 'b' : 'w';
  const won = [...s.captured[enemy]].sort((a, b) => VALUE[b] - VALUE[a]);
  const lead = won.reduce((n, t) => n + VALUE[t], 0) - s.captured[color].reduce((n, t) => n + VALUE[t], 0);
  const material = document.createElement('span');
  material.className = 'material';
  material.textContent = won.map((t) => GLYPH[t] + VS).join('');
  if (lead > 0) {
    const b = document.createElement('b');
    b.textContent = `+${lead}`;
    material.appendChild(b);
  }
  node.appendChild(material);

  if (s.clockSetting !== 'none' && s.clock) {
    const clock = document.createElement('span');
    clock.className = 'cs-clock';
    clock.dataset.color = color;
    node.appendChild(clock);
  }
}

function resultTitle() {
  const s = view.snap;
  if (s.winner === 'draw') return 'Draw';
  if (s.spectator) return `${nameFor(s.winner === 'you' ? s.myColor : s.enemyColor)} wins`;
  return s.winner === 'you' ? 'Victory!' : 'Defeat';
}

function reasonText() {
  const s = view.snap;
  const loser = nameFor(s.winner === 'you' ? s.enemyColor : s.myColor);
  return (
    {
      checkmate: `Checkmate — ${loser}'s king is trapped.`,
      stalemate: 'Stalemate — no legal moves, but not in check.',
      material: 'Neither side has enough pieces to checkmate.',
      repetition: 'The same position occurred three times.',
      fifty: '50 moves without a capture or a pawn move.',
      resign: `${loser} resigned.`,
      forfeit: `${loser} left the game.`,
      agreement: 'Both players agreed to a draw.',
      timeout: `${loser} ran out of time.`,
      'timeout-material': 'Time ran out, but the other side could not checkmate.',
    }[s.endReason] || ''
  );
}

function renderStatus() {
  const s = view.snap;
  let title = '';
  let sub = '';
  let mine = false;
  if (s.phase === 'lobby') {
    title = 'Waiting for an opponent';
    sub = 'Share the room code below.';
  } else if (s.phase === 'playing') {
    if (s.spectator) {
      title = `${nameFor(s.turnColor)} to move`;
      sub = `${COLOR_NAME[s.turnColor]}${s.inCheck ? ' is in check' : ''} · you are spectating`;
    } else if (s.turn === 'you') {
      title = s.inCheck ? 'Check! Your move' : 'Your move';
      sub = 'Tap a piece and a square, or drag it.';
      mine = true;
    } else {
      title = `${nameFor(s.enemyColor)} is thinking…`;
      sub = `You play ${COLOR_NAME[s.myColor]}.`;
    }
  } else {
    title = resultTitle();
    sub = reasonText();
  }
  el.statusTitle.textContent = title;
  el.statusSub.textContent = sub;
  el.status.classList.toggle('mine', mine);
}

function renderMoves() {
  const history = view.snap.history;
  el.moveList.innerHTML = '';
  for (let i = 0; i < history.length; i += 2) {
    const li = document.createElement('li');
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = `${i / 2 + 1}.`;
    const a = document.createElement('span');
    a.textContent = history[i];
    const b = document.createElement('span');
    b.textContent = history[i + 1] || '';
    if (i === history.length - 1) a.className = 'latest';
    if (i + 1 === history.length - 1) b.className = 'latest';
    li.append(n, a, b);
    el.moveList.appendChild(li);
  }
  el.moveList.scrollTop = el.moveList.scrollHeight;
}

function renderGameOver() {
  const s = view.snap;
  if (s.phase !== 'over') {
    el.gameOver.hidden = true;
    return;
  }
  if (view.overShownRound !== s.round && !view.animating) {
    view.overShownRound = s.round;
    if (s.endReason === 'checkmate') bigText('CHECKMATE', '', s.winner === 'you' || s.spectator ? 'sunk' : 'lost');
    setTimeout(() => {
      if (view.snap?.phase !== 'over') return;
      el.gameOver.hidden = false;
      if (s.winner === 'enemy' && !s.spectator) sound.defeat();
      else sound.victory();
    }, 1100);
  }
  el.gameOver.dataset.result = s.winner === 'enemy' && !s.spectator ? 'loss' : 'win';
  el.goKicker.textContent = `Round ${s.round}`;
  el.goTitle.textContent = resultTitle();
  el.goReason.textContent = reasonText();
  table.renderRematch(s);
}

function renderAll() {
  const s = view.snap;
  if (!s) return;
  renderPlayer(el.bottomPlayer, s.myColor, true);
  renderPlayer(el.topPlayer, s.enemyColor, false);
  renderClocks();
  renderStatus();
  renderMoves();
  renderHighlights();

  el.waitingBox.hidden = s.phase !== 'lobby';
  el.clockWrap.hidden = s.phase === 'playing';
  el.clockButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.clock === s.options.clock);
    btn.disabled = !s.isHost;
  });

  const playing = s.phase === 'playing' && !s.spectator;
  el.gameActions.hidden = !playing;
  el.drawBtn.disabled = s.drawOffer === 'you';
  el.drawBtn.textContent = s.drawOffer === 'you' ? 'Draw offered' : 'Offer draw';
  el.drawBox.hidden = !(playing && s.drawOffer === 'enemy');
  if (!el.drawBox.hidden) el.drawText.textContent = `${nameFor(s.enemyColor)} offers a draw.`;
  el.board.classList.toggle('hide-coords', !prefs.coords);
  renderGameOver();

  if (s.phase === 'playing' && !s.spectator && s.turn === 'you' && view.lastTurn !== 'you' && s.history.length) {
    sound.yourTurn();
  }
  view.lastTurn = s.turn;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

async function onState(snap, prev) {
  view.snap = snap;
  view.chess = new Chess(snap.fen);
  view.clock = snap.clock ? { ...snap.clock, at: performance.now() } : null;
  const flip = snap.myColor === 'b';
  const fresh = !prev || snap.round !== view.shownRound || snap.history.length < view.shownPly || flip !== view.flip;

  if (!prev || prev.phase !== snap.phase) {
    view.selected = null;
    if (snap.phase === 'playing') {
      bigText(snap.spectator ? 'GAME ON' : `YOU PLAY ${COLOR_NAME[snap.myColor].toUpperCase()}`, 'White moves first', 'info');
      sound.joined();
    }
  }

  if (fresh) {
    view.flip = flip;
    view.pending = null;
    buildSquares();
    syncPieces(view.chess, { appear: snap.phase === 'playing' && snap.history.length === 0 });
    view.shownPly = snap.history.length;
    view.shownRound = snap.round;
  } else if (snap.history.length > view.shownPly) {
    const single = snap.history.length === view.shownPly + 1 && snap.lastMove;
    view.shownPly = snap.history.length;
    view.selected = null;
    const pending = view.pending;
    view.pending = null;
    if (single && pending && pending.from === snap.lastMove.from && pending.to === snap.lastMove.to) {
      // Our own move was already shown; just settle captures/castling/promotion.
      const before = view.pieces.size;
      reconcile(view.chess);
      if (view.chess.inCheck()) sound.check();
      else if (view.pieces.size < before || snap.history[snap.history.length - 1].includes('x')) sound.capture();
      else sound.clack();
    } else if (single) {
      view.animating = true;
      await animateMove(snap.lastMove, view.chess);
      view.animating = false;
    } else {
      syncPieces(view.chess);
    }
  }
  renderAll();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function savePrefs() {
  store('local', 'chess:prefs', JSON.stringify(prefs));
}

const table = setupTable({
  game: 'chess',
  title: 'Chess',
  onState,
  onExit() {
    view.snap = null;
    view.shownRound = null;
    view.overShownRound = null;
    view.selected = null;
  },
  isPlaying: (snap) => snap.phase === 'playing' && !snap.spectator,
});
const { client } = table;

el.clockButtons.forEach((btn) =>
  btn.addEventListener('click', async () => {
    const res = await client.send('room:options', { clock: btn.dataset.clock });
    if (res.error) toast(res.error, 'error');
  })
);
el.drawBtn.addEventListener('click', async () => {
  const res = await client.send('draw:offer');
  if (res.error) toast(res.error, 'error');
});
el.acceptDrawBtn.addEventListener('click', () => client.send('draw:offer'));
el.declineDrawBtn.addEventListener('click', () => client.send('draw:decline'));
el.resignBtn.addEventListener('click', async () => {
  if (!window.confirm('Resign this game?')) return;
  const res = await client.send('resign');
  if (res.error) toast(res.error, 'error');
});
el.status.addEventListener('click', () => {
  if (view.snap?.phase === 'over') el.gameOver.hidden = false;
});

// The shared settings dialog handles volume; keep the board toggles in sync with it.
$('settingsBtn').addEventListener('click', () => {
  el.hintsToggle.checked = prefs.hints;
  el.coordsToggle.checked = prefs.coords;
});
el.hintsToggle.addEventListener('change', () => {
  prefs.hints = el.hintsToggle.checked;
  savePrefs();
  renderHighlights();
});
el.coordsToggle.addEventListener('change', () => {
  prefs.coords = el.coordsToggle.checked;
  savePrefs();
  renderAll();
});

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!el.promotion.hidden) {
    el.promoCancel.click();
    return;
  }
  if (table.handleEscape()) return;
  view.selected = null;
  renderHighlights();
});

buildSquares();
syncPieces(view.chess);
el.board.classList.toggle('hide-coords', !prefs.coords);
client.autoStart();

// Test hook: `?debug` exposes internals for automated browser tests.
if (new URLSearchParams(location.search).has('debug')) window.chessPage = { view, client };
