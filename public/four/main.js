import { store } from '../shared/room-client.js';
import { setupTable, bigText, toast, sound } from '../shared/table-ui.js';
import { FourBoard3D } from './board3d.js';

const Rules = window.FourRules;
const COLOR_NAME = { r: 'Red', y: 'Yellow' };
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const el = {
  board: $('board'),
  frame: $('boardFrame'),
  canvas3d: $('board3d'),
  viewButtons: [...document.querySelectorAll('[data-view]')],
  topPlayer: $('topPlayer'),
  bottomPlayer: $('bottomPlayer'),
  status: $('status'),
  statusTitle: $('statusTitle'),
  statusSub: $('statusSub'),
  waitingBox: $('waitingBox'),
  modeWrap: $('modeWrap'),
  modeButtons: [...document.querySelectorAll('[data-mode]')],
  actionWrap: $('actionWrap'),
  actionButtons: [...document.querySelectorAll('[data-action]')],
  gameActions: $('gameActions'),
  resignBtn: $('resignBtn'),
  moveList: $('moveList'),
  hintsToggle: $('hintsToggle'),
  gameOver: $('gameOver'),
  goKicker: $('goKicker'),
  goTitle: $('goTitle'),
  goReason: $('goReason'),
};

const prefs = (() => {
  const defaults = { hints: true, view: '3d' };
  try {
    return { ...defaults, ...JSON.parse(store('local', 'four:prefs') || '{}') };
  } catch {
    return defaults;
  }
})();

let board3d = null;

const view = {
  snap: null,
  board: null, // what is currently drawn
  mode: 'classic',
  shownMoves: 0,
  shownRound: null,
  animating: false,
  queue: [],
  action: 'drop',
  hoverCol: null,
  pending: false,
  overShownRound: null,
  lastTurn: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const shape = () => Rules.shape(view.mode);
const isMyTurn = () => {
  const s = view.snap;
  return Boolean(s && s.phase === 'playing' && !s.spectator && s.turn === 'you' && !view.animating);
};

function nameFor(color) {
  const s = view.snap;
  if (!s) return COLOR_NAME[color];
  const seat = color === s.myColor ? s.perspective : s.perspective === 0 ? 1 : 0;
  const player = s.players[seat];
  if (!s.spectator && color === s.myColor) return 'You';
  return player ? player.name : COLOR_NAME[color];
}

// Columns where a drop would win right now, for a colour.
function winningColumns(board, color) {
  const cols = [];
  for (let col = 0; col < shape().cols; col += 1) {
    const res = Rules.drop(board, view.mode, col, color);
    if (res && Rules.lines(res.board, view.mode, color).length) cols.push(col);
  }
  return cols;
}

function hintMarkers() {
  const s = view.snap;
  if (!prefs.hints || !isMyTurn()) return [];
  const mine = winningColumns(s.board, s.myColor);
  const theirs = winningColumns(s.board, s.enemyColor).filter((c) => !mine.includes(c));
  return [...mine.map((col) => ({ col, kind: 'win' })), ...theirs.map((col) => ({ col, kind: 'block' }))];
}

// ---------------------------------------------------------------------------
// 2D rack
// ---------------------------------------------------------------------------

function build2d() {
  const { cols, rows } = shape();
  el.board.innerHTML = '';
  el.board.style.setProperty('--cols', cols);
  el.board.style.setProperty('--rows', rows);
  const rack = document.createElement('div');
  rack.className = 'fr-rack';
  const hover = document.createElement('div');
  hover.className = 'fr-col-hover';
  hover.style.opacity = '0';
  rack.appendChild(hover);
  const ghost = document.createElement('div');
  ghost.className = 'fr-ghost';
  ghost.hidden = true;
  rack.appendChild(ghost);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell = document.createElement('div');
      cell.className = 'fr-cell';
      cell.dataset.col = col;
      cell.dataset.row = row;
      rack.appendChild(cell);
    }
  }
  el.board.appendChild(rack);
  view.rack2d = { rack, hover, ghost };
  draw2d(view.board || Rules.emptyBoard(view.mode));
}

function cell2d(col, row) {
  return view.rack2d?.rack.querySelector(`.fr-cell[data-col="${col}"][data-row="${row}"]`);
}

function draw2d(board, { fallIndex = -1 } = {}) {
  if (!view.rack2d) return;
  const { cols } = shape();
  for (let i = 0; i < board.length; i += 1) {
    const cell = cell2d(i % cols, Math.floor(i / cols));
    if (!cell) continue;
    const disc = cell.querySelector('.fr-disc');
    const want = board[i] === '.' ? null : board[i];
    if (!want) {
      disc?.remove();
      continue;
    }
    if (disc && disc.dataset.color === want && i !== fallIndex) continue;
    disc?.remove();
    const node = document.createElement('div');
    node.className = `fr-disc ${want}`;
    node.dataset.color = want;
    if (i === fallIndex) {
      const row = Math.floor(i / cols);
      node.classList.add('falling');
      node.style.setProperty('--fall', row + 1);
      node.style.setProperty('--fall-ms', `${Math.round(Math.sqrt(row + 1) * 150)}ms`);
    }
    cell.appendChild(node);
  }
}

function winLine2d(cells) {
  view.rack2d?.rack.querySelectorAll('.fr-disc.win').forEach((d) => d.classList.remove('win'));
  (cells || []).forEach(([c, r]) => cell2d(c, r)?.querySelector('.fr-disc')?.classList.add('win'));
}

function hover2d() {
  if (!view.rack2d) return;
  const { hover, ghost, rack } = view.rack2d;
  const col = isMyTurn() ? view.hoverCol : null;
  rack.querySelectorAll('.fr-marker').forEach((m) => m.remove());
  hintMarkers().forEach(({ col: c, kind }) => {
    const m = document.createElement('span');
    m.className = `fr-marker ${kind}`;
    m.textContent = kind === 'win' ? 'WIN' : 'BLOCK';
    const cell = cell2d(c, 0);
    if (!cell) return;
    m.style.left = `${cell.offsetLeft + cell.offsetWidth / 2}px`;
    rack.appendChild(m);
  });
  if (col === null) {
    hover.style.opacity = '0';
    ghost.hidden = true;
    return;
  }
  const cell = cell2d(col, 0);
  hover.style.opacity = '1';
  hover.style.left = `${cell.offsetLeft - 3}px`;
  hover.style.width = `${cell.offsetWidth + 6}px`;
  ghost.hidden = view.action === 'pop';
  ghost.className = `fr-ghost fr-disc ${view.snap.myColor}`;
  ghost.style.left = `${cell.offsetLeft}px`;
  ghost.style.top = `${cell.offsetTop}px`;
  ghost.style.width = `${cell.offsetWidth}px`;
}

// ---------------------------------------------------------------------------
// Drawing and animation
// ---------------------------------------------------------------------------

function drawBoard(board, mode) {
  const modeChanged = mode !== view.mode;
  view.mode = mode;
  view.board = board;
  if (modeChanged || !view.rack2d) build2d();
  else draw2d(board);
  board3d?.setBoard(board, mode);
}

async function animateMove(move) {
  const { cols } = shape();
  if (move.type === 'drop') {
    const i = move.row * cols + move.col;
    view.board = view.board.slice(0, i) + move.color + view.board.slice(i + 1);
    if (board3d?.visible) {
      await board3d.dropDisc(move.col, move.row, move.color);
    } else {
      draw2d(view.board, { fallIndex: i });
      await wait(Math.sqrt(move.row + 1) * 150 + 40);
      sound.clack();
    }
  } else {
    sound.capture();
    view.board = Rules.pop(view.board, view.mode, move.col);
    if (board3d?.visible) await board3d.popDisc(move.col);
    else {
      draw2d(view.board);
      await wait(250);
    }
  }
}

async function runQueue() {
  if (view.animating) return;
  view.animating = true;
  renderAll();
  while (view.queue.length) {
    await animateMove(view.queue.shift());
  }
  view.animating = false;
  const s = view.snap;
  if (s && view.board !== s.board) drawBoard(s.board, s.mode);
  showWin();
  renderAll();
}

function showWin() {
  const line = view.snap?.winLine || [];
  board3d?.setWinLine(line);
  winLine2d(line);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderPlayer(node, color, isBottom) {
  const s = view.snap;
  const mine = color === s.myColor;
  const seat = mine ? s.perspective : s.perspective === 0 ? 1 : 0;
  const player = s.players[seat];
  node.innerHTML = '';
  node.classList.toggle('to-move', s.phase === 'playing' && s.turnColor === color);
  const disc = document.createElement('span');
  disc.className = `disc-icon ${color}`;
  const name = document.createElement('span');
  name.className = 'pname';
  name.textContent = player ? player.name : 'Waiting for opponent…';
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = !s.spectator && isBottom ? `${COLOR_NAME[color]} · you` : COLOR_NAME[color];
  node.append(disc, name, tag);
  if (player && !player.connected) {
    const off = document.createElement('span');
    off.className = 'offline';
    off.textContent = '● offline';
    node.appendChild(off);
  }
  if (s.phase === 'playing' && s.turnColor === color) {
    const dot = document.createElement('span');
    dot.className = 'turn-dot';
    node.appendChild(dot);
  }
  const score = document.createElement('span');
  score.className = 'score';
  score.innerHTML = `${s.wins[mine ? 0 : 1]}<small>WINS</small>`;
  node.appendChild(score);
}

function modeNote(mode) {
  if (mode === 'popout') return 'Pop Out: you may pop your own bottom disc instead.';
  if (mode === 'five') return 'Five in a Row on a 9×7 rack.';
  return '';
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
      sub = 'You are spectating.';
    } else if (s.turn === 'you') {
      title = 'Your move';
      const hints = hintMarkers();
      if (hints.some((h) => h.kind === 'win')) sub = 'You can win right now!';
      else if (hints.some((h) => h.kind === 'block')) sub = `Careful — ${nameFor(s.enemyColor)} threatens a line. Block it!`;
      else sub = 'Tap a column to drop a disc.';
      mine = true;
    } else {
      title = `${nameFor(s.enemyColor)} is thinking…`;
      sub = `You play ${COLOR_NAME[s.myColor]}.`;
    }
    const note = modeNote(s.mode);
    if (note) sub += ` ${note}`;
  } else {
    title = resultTitle();
    sub = reasonText();
  }
  el.statusTitle.textContent = title;
  el.statusSub.textContent = sub;
  el.status.classList.toggle('mine', mine);
}

function resultTitle() {
  const s = view.snap;
  if (s.winner === 'draw') return 'Draw';
  if (s.spectator) return `${nameFor(s.winner === 'you' ? s.myColor : s.enemyColor)} wins`;
  return s.winner === 'you' ? 'Victory!' : 'Defeat';
}

function reasonText() {
  const s = view.snap;
  const winner = nameFor(s.winner === 'you' ? s.myColor : s.enemyColor);
  const loser = nameFor(s.winner === 'you' ? s.enemyColor : s.myColor);
  const need = s.shape.need;
  switch (s.endReason) {
    case 'line':
      return `${winner} lined up ${need} in a row.`;
    case 'popped':
      return `${loser} popped a disc and completed ${winner === 'You' ? 'your' : `${winner}'s`} line!`;
    case 'resign':
      return `${loser} resigned.`;
    case 'forfeit':
      return `${loser} left the game.`;
    case 'full':
      return 'The rack filled up with no winner.';
    case 'long':
      return 'The game went on too long.';
    default:
      return '';
  }
}

function renderMoves() {
  const s = view.snap;
  el.moveList.innerHTML = '';
  s.history.forEach((m, i) => {
    const li = document.createElement('li');
    const dot = document.createElement('i');
    dot.className = `disc-icon ${m.color}`;
    li.append(dot, document.createTextNode(`${m.type === 'pop' ? '⇩ pop ' : ''}${m.col + 1}`));
    if (i === s.history.length - 1) li.className = 'latest';
    el.moveList.appendChild(li);
  });
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
    if (s.winner !== 'draw') bigText(s.winner === 'you' && !s.spectator ? 'FOUR IN A ROW!' : `${nameFor(s.winner === 'you' ? s.myColor : s.enemyColor).toUpperCase()} WINS`, '', s.winner === 'enemy' && !s.spectator ? 'hit' : 'info');
    setTimeout(() => {
      if (view.snap?.phase !== 'over') return;
      el.gameOver.hidden = false;
      if (s.winner === 'you' || s.spectator) sound.victory();
      else if (s.winner === 'enemy') sound.defeat();
    }, 1500);
  }
  el.gameOver.dataset.result = s.winner === 'enemy' && !s.spectator ? 'loss' : 'win';
  el.goKicker.textContent = `Round ${s.round} · ${s.wins[0]}–${s.wins[1]}`;
  el.goTitle.textContent = resultTitle();
  el.goReason.textContent = reasonText();
  table.renderRematch(s);
}

function renderHover() {
  const s = view.snap;
  const my = isMyTurn();
  let col = my ? view.hoverCol : null;
  const pop = view.action === 'pop' && s.mode === 'popout';
  if (col !== null && pop && !Rules.canPop(s.board, s.mode, col, s.myColor)) col = null;
  if (col !== null && !pop && Rules.dropRow(s.board, s.mode, col) < 0) col = null;
  board3d?.setHover(col, my ? s.myColor : null, { pop });
  board3d?.setMarkers(hintMarkers());
  hover2d();
}

function renderAll() {
  const s = view.snap;
  if (!s) return;
  renderPlayer(el.bottomPlayer, s.myColor, true);
  renderPlayer(el.topPlayer, s.enemyColor, false);
  renderStatus();
  renderMoves();
  renderHover();
  el.waitingBox.hidden = s.phase !== 'lobby';
  el.modeWrap.hidden = s.phase === 'playing';
  el.modeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === (s.options.mode || 'classic'));
    btn.disabled = !s.isHost;
  });
  const playing = s.phase === 'playing' && !s.spectator;
  el.actionWrap.hidden = !(playing && s.mode === 'popout');
  if (s.mode !== 'popout') view.action = 'drop';
  el.actionButtons.forEach((b) => {
    b.classList.toggle('active', b.dataset.action === view.action);
    if (b.dataset.action === 'pop') {
      const any = [...Array(s.shape.cols).keys()].some((c) => Rules.canPop(s.board, s.mode, c, s.myColor));
      b.disabled = !any;
    }
  });
  el.gameActions.hidden = !playing;
  renderGameOver();
  if (isMyTurn() && view.lastTurn !== 'you' && s.history.length) sound.yourTurn();
  if (!view.animating) view.lastTurn = s.turn;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

async function play(col) {
  const s = view.snap;
  if (col === null || col === undefined || !isMyTurn() || view.pending) return;
  const pop = view.action === 'pop' && s.mode === 'popout';
  if (pop && !Rules.canPop(s.board, s.mode, col, s.myColor)) {
    toast('Pick a column with your disc at the bottom.', 'error');
    return;
  }
  if (!pop && Rules.dropRow(s.board, s.mode, col) < 0) {
    toast('That column is full.', 'error');
    sound.error();
    return;
  }
  view.pending = true;
  const res = await client.send(pop ? 'four:pop' : 'four:drop', { col });
  view.pending = false;
  if (res.error) {
    toast(res.error, 'error');
    sound.error();
  }
  if (pop) view.action = 'drop';
  renderAll();
}

function setHoverCol(col) {
  if (view.hoverCol === col) return;
  view.hoverCol = col;
  if (view.snap) renderHover();
}

// ---------------------------------------------------------------------------
// State updates
// ---------------------------------------------------------------------------

async function onState(snap) {
  const prev = view.snap;
  view.snap = snap;
  const fresh = !prev || snap.round !== view.shownRound || snap.history.length < view.shownMoves || snap.mode !== view.mode;
  if (snap.phase === 'playing' && (!prev || prev.phase !== 'playing')) {
    bigText(snap.spectator ? 'GAME ON' : `YOU PLAY ${COLOR_NAME[snap.myColor].toUpperCase()}`, 'Red drops first', 'info');
    sound.joined();
  }
  sound.setMood('calm');

  if (fresh) {
    const hadDiscs = /[ry]/.test(view.board || '');
    view.queue = [];
    view.shownMoves = snap.history.length;
    view.shownRound = snap.round;
    if (hadDiscs && board3d?.visible && snap.mode === view.mode && snap.history.length === 0) {
      // New round on the same rack: pull the slider and let everything fall out.
      view.animating = true;
      renderAll();
      sound.capture();
      await board3d.releaseAll();
      view.animating = false;
      view.queue = [];
      view.shownMoves = view.snap.history.length;
    }
    drawBoard(view.snap.board, view.snap.mode);
    showWin();
  } else if (snap.history.length > view.shownMoves) {
    view.queue.push(...snap.history.slice(view.shownMoves));
    view.shownMoves = snap.history.length;
    runQueue();
  }
  if (!view.animating) {
    if (view.board !== snap.board) drawBoard(snap.board, snap.mode);
    showWin();
  }
  renderAll();
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function savePrefs() {
  store('local', 'four:prefs', JSON.stringify(prefs));
}

const table = setupTable({
  game: 'four',
  title: 'Four in a Row',
  onState,
  onExit() {
    view.snap = null;
    view.shownRound = null;
    view.overShownRound = null;
  },
  isPlaying: (snap) => snap.phase === 'playing' && !snap.spectator,
});
const { client } = table;

el.modeButtons.forEach((btn) =>
  btn.addEventListener('click', async () => {
    const res = await client.send('room:options', { mode: btn.dataset.mode });
    if (res.error) toast(res.error, 'error');
  })
);
el.actionButtons.forEach((btn) =>
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    sound.click();
    view.action = btn.dataset.action;
    renderAll();
  })
);
el.resignBtn.addEventListener('click', async () => {
  if (!window.confirm('Resign this game?')) return;
  const res = await client.send('resign');
  if (res.error) toast(res.error, 'error');
});
el.status.addEventListener('click', () => {
  if (view.snap?.phase === 'over') el.gameOver.hidden = false;
});
$('settingsBtn').addEventListener('click', () => {
  el.hintsToggle.checked = prefs.hints;
});
el.hintsToggle.addEventListener('change', () => {
  prefs.hints = el.hintsToggle.checked;
  savePrefs();
  renderAll();
});

el.board.addEventListener('pointermove', (e) => {
  const cell = e.target.closest('.fr-cell');
  if (cell) setHoverCol(Number(cell.dataset.col));
});
el.board.addEventListener('pointerleave', () => setHoverCol(null));
el.board.addEventListener('click', (e) => {
  const cell = e.target.closest('.fr-cell');
  if (cell) play(Number(cell.dataset.col));
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    table.handleEscape();
    return;
  }
  if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  const s = view.snap;
  if (!s) return;
  const n = Number(event.key);
  if (n >= 1 && n <= s.shape.cols) {
    play(n - 1);
    return;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const d = event.key === 'ArrowLeft' ? -1 : 1;
    const cur = view.hoverCol ?? Math.floor(s.shape.cols / 2);
    setHoverCol(Math.max(0, Math.min(s.shape.cols - 1, cur + d)));
  } else if ((event.key === 'Enter' || event.key === ' ') && view.hoverCol !== null) {
    event.preventDefault();
    play(view.hoverCol);
  }
});

// ---- 3D rack (default) or flat 2D, chosen in Settings ---------------------

function make3d() {
  if (board3d) return board3d;
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const forced = new URLSearchParams(location.search).get('quality');
    const quality = ['low', 'medium', 'high'].includes(forced) ? forced : coarse ? 'medium' : 'high';
    board3d = new FourBoard3D(el.canvas3d, { quality });
    board3d.onColumn = (col) => {
      if (col === null) return;
      setHoverCol(col);
      play(col);
    };
    board3d.onHoverColumn = (col) => setHoverCol(col);
    board3d.onLand = () => sound.clack();
  } catch (error) {
    console.warn('3D board unavailable, using 2D', error);
    board3d = null;
  }
  return board3d;
}

function useView(mode) {
  const three = mode === '3d' && make3d();
  el.board.hidden = Boolean(three);
  board3d?.show(Boolean(three));
  el.frame.classList.toggle('mode-3d', Boolean(three));
  el.viewButtons.forEach((b) => b.classList.toggle('active', b.dataset.view === (three ? '3d' : '2d')));
  if (board3d) board3d.setBoard(view.board || Rules.emptyBoard(view.mode), view.mode);
  showWin();
  if (view.snap) renderAll();
  return Boolean(three);
}

el.viewButtons.forEach((btn) =>
  btn.addEventListener('click', () => {
    prefs.view = btn.dataset.view;
    savePrefs();
    const ok = useView(prefs.view);
    if (prefs.view === '3d' && !ok) toast('3D is not supported on this device.', 'error');
    if (!ok) requestAnimationFrame(() => build2d());
  })
);

view.board = Rules.emptyBoard('classic');
build2d();
useView(prefs.view);
client.autoStart();

// Test hook: `?debug` exposes internals for automated browser tests.
if (new URLSearchParams(location.search).has('debug')) window.fourPage = { view, client, Rules, get board3d() { return board3d; } };
