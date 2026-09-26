import { Chess } from '/vendor/chess/chess.js';
import { store } from '../shared/room-client.js';
import { setupTable, bigText, toast, sound } from '../shared/table-ui.js';
import { Board2D, GLYPH, VS } from './board2d.js';
import { Board3D } from './board3d.js';

const $ = (id) => document.getElementById(id);
const COLOR_NAME = { w: 'White', b: 'Black' };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };

const el = {
  board: $('board'),
  canvas3d: $('board3d'),
  frame: $('boardFrame'),
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
  viewButtons: [...document.querySelectorAll('[data-view]')],
  gameOver: $('gameOver'),
  goKicker: $('goKicker'),
  goTitle: $('goTitle'),
  goReason: $('goReason'),
  promotion: $('promotion'),
  promoChoices: $('promoChoices'),
  promoCancel: $('promoCancel'),
};

const prefs = (() => {
  const defaults = { hints: true, coords: true, view: '3d' };
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
// Boards: 3D (default) or flat 2D, chosen in Settings
// ---------------------------------------------------------------------------

const board2d = new Board2D({ board: el.board, squares: el.squares, pieces: el.pieces });
let board3d = null;
let board = board2d;

function make3d() {
  if (board3d) return board3d;
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const forced = new URLSearchParams(location.search).get('quality');
    const quality = ['low', 'medium', 'high'].includes(forced) ? forced : coarse ? 'medium' : 'high';
    board3d = new Board3D(el.canvas3d, { quality });
    attachInput(board3d);
  } catch (error) {
    console.warn('3D board unavailable, using 2D', error);
    board3d = null;
  }
  return board3d;
}

function useView(mode) {
  board = (mode === '3d' && make3d()) || board2d;
  board2d.show(board === board2d);
  board3d?.show(board === board3d);
  el.frame.classList.toggle('mode-3d', board === board3d);
  board.setOrientation(view.flip);
  board.setShowCoords(prefs.coords);
  board.setPosition(view.chess);
  renderHighlights();
}

function kingInCheck() {
  const s = view.snap;
  if (!s || !s.inCheck || s.phase === 'lobby') return null;
  const king = view.chess.board().flat().find((p) => p && p.type === 'k' && p.color === s.turnColor);
  return king ? king.square : null;
}

function renderHighlights(hover = null) {
  const s = view.snap;
  if (!s) {
    board.setHighlights({});
    return;
  }
  board.setHighlights({
    last: s.lastMove ? [s.lastMove.from, s.lastMove.to] : null,
    selected: view.selected,
    targets:
      view.selected && prefs.hints
        ? legalTargets(view.selected).map((m) => ({ sq: m.to, capture: Boolean(m.captured) }))
        : [],
    check: kingInCheck(),
    hover,
  });
}

function playMoveSound(captured) {
  if (view.chess.inCheck()) sound.check();
  else if (captured) sound.capture();
  else sound.clack();
}

// ---------------------------------------------------------------------------
// Input: tap-to-move and drag-and-drop (works on either board)
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
    board.dragEnd(from);
    renderHighlights();
    return;
  }
  let promotion;
  if (moves.some((m) => m.promotion)) {
    promotion = await choosePromotion(view.snap.myColor);
    if (!promotion) {
      board.dragEnd(from);
      renderHighlights();
      return;
    }
  }
  // Show the move straight away; the server's answer confirms or reverts it.
  board.applyLocalMove(from, to);
  view.pending = { from, to };
  renderHighlights();
  const res = await client.send('move', { from, to, promotion });
  if (res.error) {
    view.pending = null;
    toast(res.error, 'error');
    sound.error();
    board.setPosition(view.chess);
    renderHighlights();
  }
}

function attachInput(target) {
  const input = target.inputEl;

  input.addEventListener('pointerdown', (event) => {
    if (board !== target) return;
    const s = view.snap;
    if (!s || s.phase !== 'playing' || s.spectator) return;
    const sq = target.squareFromEvent(event);
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
    input.setPointerCapture?.(event.pointerId);
  });

  input.addEventListener('pointermove', (event) => {
    const drag = view.drag;
    if (!drag || board !== target) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
    if (!drag.moved) target.dragStart(drag.from);
    drag.moved = true;
    target.dragMove(event);
    const over = target.squareFromEvent(event);
    const legal = over && legalTargets(drag.from).some((m) => m.to === over);
    renderHighlights(legal ? over : null);
  });

  input.addEventListener('pointerup', (event) => {
    const drag = view.drag;
    if (!drag || board !== target) return;
    view.drag = null;
    if (input.hasPointerCapture?.(drag.pointerId)) input.releasePointerCapture(drag.pointerId);
    if (drag.moved) {
      const to = target.squareFromEvent(event);
      if (to && to !== drag.from) attemptMove(drag.from, to);
      else {
        target.dragEnd(drag.from);
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
  });

  input.addEventListener('pointercancel', (event) => {
    if (view.drag) target.dragEnd(view.drag.from);
    view.drag = null;
    renderHighlights();
    if (input.hasPointerCapture?.(event.pointerId)) input.releasePointerCapture(event.pointerId);
  });
}
attachInput(board2d);

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
    // Let the CHECKMATE callout finish before the results appear, so they never overlap.
    const mate = s.endReason === 'checkmate';
    if (mate) bigText('CHECKMATE', '', s.winner === 'you' || s.spectator ? 'sunk' : 'lost');
    setTimeout(() => {
      if (view.snap?.phase !== 'over') return;
      el.gameOver.hidden = false;
      if (s.winner === 'enemy' && !s.spectator) sound.defeat();
      else sound.victory();
    }, mate ? 1800 : 900);
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
    board.setOrientation(flip);
    board.setPosition(view.chess, { appear: snap.phase === 'playing' && snap.history.length === 0 });
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
      const { captured } = board.settle(view.chess);
      playMoveSound(captured || snap.history[snap.history.length - 1].includes('x'));
    } else if (single) {
      view.animating = true;
      const { captured } = await board.playMove(snap.lastMove, view.chess);
      view.animating = false;
      playMoveSound(captured);
    } else {
      board.setPosition(view.chess);
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
function syncBoardSettings() {
  el.hintsToggle.checked = prefs.hints;
  el.coordsToggle.checked = prefs.coords;
  el.viewButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.view === (board === board3d ? '3d' : '2d')));
}
$('settingsBtn').addEventListener('click', syncBoardSettings);
el.viewButtons.forEach((btn) =>
  btn.addEventListener('click', () => {
    prefs.view = btn.dataset.view;
    savePrefs();
    useView(prefs.view);
    if (prefs.view === '3d' && board !== board3d) toast('3D is not supported on this device.', 'error');
    syncBoardSettings();
    sound.click();
  })
);
el.hintsToggle.addEventListener('change', () => {
  prefs.hints = el.hintsToggle.checked;
  savePrefs();
  renderHighlights();
});
el.coordsToggle.addEventListener('change', () => {
  prefs.coords = el.coordsToggle.checked;
  savePrefs();
  board.setShowCoords(prefs.coords);
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

useView(prefs.view);
client.autoStart();

// Test hook: `?debug` exposes internals for automated browser tests.
if (new URLSearchParams(location.search).has('debug')) {
  window.chessPage = { view, client, board: () => board };
}
