import { RoomClient, toast, copyText, shareTarget, shareWarning, onShareInfo, store } from '../shared/room-client.js';
import { sound } from '../shared/audio.js';

const Rules = window.CheckersRules;
const SIZE = Rules.SIZE;
const COLOR_NAME = { b: 'Black', r: 'Red' };
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const el = {
  lobby: $('lobby'),
  room: $('room'),
  nameInput: $('nameInput'),
  hostBtn: $('hostBtn'),
  joinForm: $('joinForm'),
  codeInput: $('codeInput'),
  lobbyError: $('lobbyError'),
  roomChip: $('roomChip'),
  roomCodeLabel: $('roomCodeLabel'),
  watchers: $('watchers'),
  watchersCount: $('watchersCount'),
  board: $('board'),
  squares: $('squares'),
  pieces: $('pieces'),
  topPlayer: $('topPlayer'),
  bottomPlayer: $('bottomPlayer'),
  status: $('status'),
  statusTitle: $('statusTitle'),
  statusSub: $('statusSub'),
  waitingBox: $('waitingBox'),
  waitingCode: $('waitingCode'),
  shareUrl: $('shareUrl'),
  shareWarning: $('shareWarning'),
  copyCodeBtn: $('copyCodeBtn'),
  copyLinkBtn: $('copyLinkBtn'),
  forcedWrap: $('forcedWrap'),
  forcedToggle: $('forcedToggle'),
  drawBox: $('drawBox'),
  drawText: $('drawText'),
  acceptDrawBtn: $('acceptDrawBtn'),
  declineDrawBtn: $('declineDrawBtn'),
  gameActions: $('gameActions'),
  drawBtn: $('drawBtn'),
  resignBtn: $('resignBtn'),
  moveList: $('moveList'),
  settingsBtn: $('settingsBtn'),
  settings: $('settings'),
  settingsClose: $('settingsClose'),
  volEffects: $('volEffects'),
  volMusic: $('volMusic'),
  hintsToggle: $('hintsToggle'),
  numbersToggle: $('numbersToggle'),
  chatBtn: $('chatBtn'),
  chatBadge: $('chatBadge'),
  chat: $('chat'),
  chatClose: $('chatClose'),
  chatLog: $('chatLog'),
  chatForm: $('chatForm'),
  chatInput: $('chatInput'),
  leaveBtn: $('leaveBtn'),
  gameOver: $('gameOver'),
  goKicker: $('goKicker'),
  goTitle: $('goTitle'),
  goReason: $('goReason'),
  rematchBtn: $('rematchBtn'),
  rematchNote: $('rematchNote'),
  goViewBtn: $('goViewBtn'),
  goLeaveBtn: $('goLeaveBtn'),
  bigText: $('bigText'),
  net: $('netStatus'),
};

const prefs = (() => {
  const defaults = { hints: true, numbers: false };
  try {
    return { ...defaults, ...JSON.parse(store('local', 'checkers:prefs') || '{}') };
  } catch {
    return defaults;
  }
})();

const view = {
  snap: null,
  flip: false,
  pieces: new Map(), // square index -> { el, piece }
  shownMoves: 0,
  shownRound: null,
  animating: false,
  queue: [],
  selection: [],
  pending: false,
  chatOpen: false,
  unread: 0,
  overShownRound: null,
  lastTurn: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const idx = (x, y) => y * SIZE + x;
const squareNumber = (x, y) => y * 4 + Math.floor(x / 2) + 1;
const screenX = (x) => (view.flip ? SIZE - 1 - x : x);
const screenY = (y) => (view.flip ? SIZE - 1 - y : y);

function bigText(title, sub = '', kind = 'info') {
  el.bigText.innerHTML = '';
  const node = document.createElement('div');
  node.className = `big big-${kind}`;
  const t = document.createElement('div');
  t.className = 'big-title';
  t.textContent = title;
  node.appendChild(t);
  if (sub) {
    const s = document.createElement('div');
    s.className = 'big-sub';
    s.textContent = sub;
    node.appendChild(s);
  }
  el.bigText.appendChild(node);
  setTimeout(() => node.remove(), 1700);
}

function nameFor(color) {
  const s = view.snap;
  if (!s) return COLOR_NAME[color];
  const seat = s.perspective;
  const mine = s.myColor === color;
  const player = s.players[mine ? seat : seat === 0 ? 1 : 0];
  return player?.name || COLOR_NAME[color];
}

function isMyTurn() {
  const s = view.snap;
  return Boolean(s && !s.spectator && s.phase === 'playing' && s.turn === 'you');
}

function legalMoves() {
  const s = view.snap;
  if (!isMyTurn()) return [];
  return Rules.legalMoves(s.board, s.myColor, s.options);
}

function notation(move) {
  const sep = move.captures.length ? 'x' : '-';
  return move.path.map(([x, y]) => squareNumber(x, y)).join(sep);
}

// ---------------------------------------------------------------------------
// Board rendering
// ---------------------------------------------------------------------------

function buildSquares() {
  el.squares.innerHTML = '';
  for (let sy = 0; sy < SIZE; sy += 1) {
    for (let sx = 0; sx < SIZE; sx += 1) {
      const x = view.flip ? SIZE - 1 - sx : sx;
      const y = view.flip ? SIZE - 1 - sy : sy;
      const sq = document.createElement('div');
      const dark = (x + y) % 2 === 1;
      sq.className = `sq ${dark ? 'dark' : 'light'}`;
      if (dark) {
        sq.dataset.x = x;
        sq.dataset.y = y;
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = squareNumber(x, y);
        sq.appendChild(num);
      }
      el.squares.appendChild(sq);
    }
  }
}

function squareEl(x, y) {
  return el.squares.children[screenY(y) * SIZE + screenX(x)];
}

function placePiece(node, x, y) {
  node.style.setProperty('--x', screenX(x));
  node.style.setProperty('--y', screenY(y));
}

function makePiece(piece, x, y, { appear = false } = {}) {
  const node = document.createElement('div');
  node.className = `pc ${Rules.colorOf(piece)}${Rules.isKing(piece) ? ' king' : ''}${appear ? ' appear' : ''}`;
  const body = document.createElement('div');
  body.className = 'body';
  node.appendChild(body);
  placePiece(node, x, y);
  el.pieces.appendChild(node);
  return node;
}

// Rebuilds every piece from a board string (no animation between moves).
function syncPieces(board, { appear = false } = {}) {
  el.pieces.innerHTML = '';
  view.pieces.clear();
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const piece = board[idx(x, y)];
      if (piece === '.') continue;
      view.pieces.set(idx(x, y), { el: makePiece(piece, x, y, { appear }), piece });
    }
  }
}

function shownBoard() {
  let board = '';
  for (let i = 0; i < SIZE * SIZE; i += 1) board += view.pieces.get(i)?.piece || '.';
  return board;
}

function spark(x, y) {
  const node = document.createElement('div');
  node.className = 'spark';
  placePiece(node, x, y);
  el.pieces.appendChild(node);
  setTimeout(() => node.remove(), 600);
}

async function animateMove(move) {
  const [sx, sy] = move.path[0];
  const entry = view.pieces.get(idx(sx, sy));
  if (!entry) return;
  view.pieces.delete(idx(sx, sy));
  entry.el.classList.add('moving');
  for (let i = 1; i < move.path.length; i += 1) {
    const [x, y] = move.path[i];
    placePiece(entry.el, x, y);
    await wait(210);
    const captured = move.captures[i - 1];
    if (captured) {
      const [cx, cy] = captured;
      const victim = view.pieces.get(idx(cx, cy));
      if (victim) {
        view.pieces.delete(idx(cx, cy));
        victim.el.classList.add('taken-out');
        setTimeout(() => victim.el.remove(), 480);
      }
      spark(cx, cy);
      sound.capture();
    } else {
      sound.clack();
    }
  }
  entry.el.classList.remove('moving');
  const [ex, ey] = move.path[move.path.length - 1];
  if (move.promoted) {
    entry.piece = entry.piece.toUpperCase();
    entry.el.classList.add('king', 'crowned');
    sound.crown();
  }
  view.pieces.set(idx(ex, ey), entry);
  await wait(120);
}

async function runQueue() {
  if (view.animating) return;
  view.animating = true;
  while (view.queue.length) {
    const move = view.queue.shift();
    await animateMove(move);
    renderHighlights();
  }
  view.animating = false;
  // Make sure what we show matches the server exactly.
  if (view.snap && shownBoard() !== view.snap.board) syncPieces(view.snap.board);
  renderAll();
}

function renderHighlights() {
  const s = view.snap;
  [...el.squares.children].forEach((sq) => sq.classList.remove('last', 'target', 'jump', 'path'));
  view.pieces.forEach((p) => p.el.classList.remove('movable', 'selected'));
  if (!s) return;

  const last = s.history[s.history.length - 1];
  if (last && !view.animating) last.path.forEach(([x, y]) => squareEl(x, y).classList.add('last'));

  if (!isMyTurn() || view.animating || view.pending) return;
  const moves = legalMoves();
  if (!view.selection.length) {
    if (!prefs.hints) return;
    const starts = new Set(moves.map((m) => idx(m.path[0][0], m.path[0][1])));
    starts.forEach((i) => view.pieces.get(i)?.el.classList.add('movable'));
    return;
  }
  const [sx, sy] = view.selection[0];
  view.pieces.get(idx(sx, sy))?.el.classList.add('selected');
  view.selection.slice(1).forEach(([x, y]) => squareEl(x, y).classList.add('path'));
  candidates(moves).forEach((m) => {
    const step = m.path[view.selection.length];
    if (!step) return;
    const sq = squareEl(step[0], step[1]);
    sq.classList.add('target');
    if (m.captures.length) sq.classList.add('jump');
  });
}

function candidates(moves) {
  const sel = view.selection;
  return moves.filter((m) => sel.every(([x, y], i) => m.path[i] && m.path[i][0] === x && m.path[i][1] === y));
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function handleSquare(x, y) {
  const s = view.snap;
  if (!s || s.phase !== 'playing') return;
  if (s.spectator) return;
  if (!isMyTurn()) {
    toast(`Waiting for ${nameFor(s.enemyColor)} to move.`);
    return;
  }
  if (view.animating || view.pending) return;

  const moves = legalMoves();
  const piece = s.board[idx(x, y)];
  const ownPiece = Rules.colorOf(piece) === s.myColor;

  // (Re)select a piece at the start of a move.
  if (ownPiece && view.selection.length <= 1) {
    const fromHere = moves.filter((m) => m.path[0][0] === x && m.path[0][1] === y);
    if (fromHere.length) {
      view.selection = [[x, y]];
      sound.click();
    } else {
      view.selection = [];
      const mustJump = s.options.forcedCapture && moves.some((m) => m.captures.length);
      toast(mustJump ? 'You must capture — pick a piece that can jump.' : "That piece can't move right now.", 'error');
      sound.error();
    }
    renderHighlights();
    return;
  }
  if (!view.selection.length) return;

  const cands = candidates(moves);
  const next = cands.filter((m) => {
    const step = m.path[view.selection.length];
    return step && step[0] === x && step[1] === y;
  });
  if (next.length) {
    view.selection.push([x, y]);
    const done = next.find((m) => m.path.length === view.selection.length);
    if (done) submit(done);
    else {
      sound.clack();
      renderHighlights();
    }
    return;
  }
  // Tapping the final square of a multi-jump directly also works.
  const finals = cands.filter((m) => {
    const end = m.path[m.path.length - 1];
    return end[0] === x && end[1] === y;
  });
  if (finals.length === 1) {
    submit(finals[0]);
    return;
  }
  view.selection = [];
  renderHighlights();
}

async function submit(move) {
  view.pending = true;
  view.selection = [];
  renderHighlights();
  const res = await client.send('move', { path: move.path });
  view.pending = false;
  if (res.error) {
    toast(res.error, 'error');
    sound.error();
    renderHighlights();
  }
}

el.squares.addEventListener('click', (event) => {
  const sq = event.target.closest('.sq.dark');
  if (!sq) {
    view.selection = [];
    renderHighlights();
    return;
  }
  handleSquare(Number(sq.dataset.x), Number(sq.dataset.y));
});

// ---------------------------------------------------------------------------
// UI rendering
// ---------------------------------------------------------------------------

function renderPlayer(node, color, isBottom) {
  const s = view.snap;
  const seatIsMine = color === s.myColor;
  const seat = seatIsMine ? s.perspective : s.perspective === 0 ? 1 : 0;
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
  // Pieces this player has captured.
  const taken = document.createElement('span');
  taken.className = 'taken';
  const enemy = Rules.opponent(color);
  for (let i = 0; i < s.captured[enemy]; i += 1) {
    const pip = document.createElement('i');
    pip.className = enemy;
    taken.appendChild(pip);
  }
  node.appendChild(taken);
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
    const mustJump = s.options.forcedCapture && legalMoves().some((m) => m.captures.length);
    if (s.spectator) {
      title = `${nameFor(s.turnColor)} to move`;
      sub = `${COLOR_NAME[s.turnColor]} · you are spectating`;
    } else if (s.turn === 'you') {
      title = 'Your move';
      sub = mustJump ? 'You must capture — highlighted pieces can jump.' : 'Tap a piece, then a highlighted square.';
      mine = true;
    } else {
      title = `${nameFor(s.enemyColor)} is thinking…`;
      sub = `You play ${COLOR_NAME[s.myColor]}.`;
    }
    const left = s.drawPlies - s.quietPlies;
    if (left <= 20) sub += ` Draw in ${Math.ceil(left / 2)} moves without a capture.`;
  } else if (s.phase === 'over') {
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
  if (s.spectator) {
    const color = s.winner === 'you' ? s.myColor : s.enemyColor;
    return `${nameFor(color)} wins`;
  }
  return s.winner === 'you' ? 'Victory!' : 'Defeat';
}

function reasonText() {
  const s = view.snap;
  const loserColor = s.winner === 'you' ? s.enemyColor : s.myColor;
  const loser = nameFor(loserColor);
  switch (s.endReason) {
    case 'captured':
      return `All of ${loser}'s pieces were captured.`;
    case 'blocked':
      return `${loser} has no moves left.`;
    case 'resign':
      return `${loser} resigned.`;
    case 'forfeit':
      return `${loser} left the game.`;
    case 'agreement':
      return 'Both players agreed to a draw.';
    case 'quiet':
      return '40 moves each without a capture or a new king.';
    default:
      return '';
  }
}

function renderMoves() {
  const s = view.snap;
  el.moveList.innerHTML = '';
  // Black always moves first, so moves pair up naturally.
  for (let i = 0; i < s.history.length; i += 2) {
    const li = document.createElement('li');
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = `${i / 2 + 1}.`;
    const a = document.createElement('span');
    a.textContent = notation(s.history[i]);
    const b = document.createElement('span');
    b.textContent = s.history[i + 1] ? notation(s.history[i + 1]) : '';
    if (i === s.history.length - 1) a.className = 'latest';
    if (i + 1 === s.history.length - 1) b.className = 'latest';
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
    setTimeout(() => {
      if (view.snap?.phase !== 'over') return;
      el.gameOver.hidden = false;
      if (s.winner === 'you' || s.spectator) sound.victory();
      else if (s.winner === 'enemy') sound.defeat();
    }, 700);
  }
  el.gameOver.dataset.result = s.winner === 'enemy' && !s.spectator ? 'loss' : 'win';
  el.goKicker.textContent = `Round ${s.round}`;
  el.goTitle.textContent = resultTitle();
  el.goReason.textContent = reasonText();
  const opponent = s.players.find((p, i) => p && i !== s.perspective);
  el.rematchBtn.hidden = s.spectator;
  if (s.spectator) {
    el.rematchNote.textContent = 'Stick around — the players may start a rematch.';
  } else if (!opponent) {
    el.rematchBtn.textContent = 'Find a new opponent';
    el.rematchBtn.disabled = false;
    el.rematchNote.textContent = 'Reopen the room and share the code again.';
  } else if (s.rematch.you) {
    el.rematchBtn.textContent = 'Rematch requested';
    el.rematchBtn.disabled = true;
    el.rematchNote.textContent = `Waiting for ${opponent.name}…`;
  } else {
    el.rematchBtn.textContent = s.rematch.enemy ? 'Accept rematch' : 'Rematch (swap colours)';
    el.rematchBtn.disabled = false;
    el.rematchNote.textContent = s.rematch.enemy ? `${opponent.name} wants a rematch!` : '';
  }
}

function renderAll() {
  const s = view.snap;
  if (!s) return;
  el.roomCodeLabel.textContent = s.code;
  el.waitingCode.textContent = s.code;
  el.watchers.hidden = s.spectators.length === 0;
  el.watchersCount.textContent = s.spectators.length;
  el.watchers.title = `Watching: ${s.spectators.join(', ')}`;

  const { url, scope } = shareTarget();
  el.shareUrl.textContent = url.replace(/^https?:\/\//, '');
  el.shareWarning.hidden = scope === 'public';
  el.shareWarning.textContent = shareWarning(scope);

  renderPlayer(el.bottomPlayer, s.myColor, true);
  renderPlayer(el.topPlayer, s.enemyColor, false);
  renderStatus();
  renderMoves();
  renderHighlights();

  el.waitingBox.hidden = s.phase !== 'lobby';
  el.forcedWrap.hidden = s.phase === 'playing';
  el.forcedToggle.checked = s.options.forcedCapture;
  el.forcedToggle.disabled = !s.isHost;
  el.forcedWrap.classList.toggle('locked', !s.isHost);

  const playing = s.phase === 'playing' && !s.spectator;
  el.gameActions.hidden = !playing;
  el.drawBtn.disabled = s.drawOffer === 'you';
  el.drawBtn.textContent = s.drawOffer === 'you' ? 'Draw offered' : 'Offer draw';
  el.drawBox.hidden = !(playing && s.drawOffer === 'enemy');
  if (!el.drawBox.hidden) el.drawText.textContent = `${nameFor(s.enemyColor)} offers a draw.`;

  el.board.parentElement.parentElement.classList.toggle('show-numbers', prefs.numbers);
  renderGameOver();

  if (isMyTurn() && view.lastTurn !== 'you' && !view.animating) {
    if (s.history.length) sound.yourTurn();
  }
  if (!view.animating) view.lastTurn = s.turn;
}

// ---------------------------------------------------------------------------
// State updates
// ---------------------------------------------------------------------------

function onState(snap) {
  const prev = view.snap;
  view.snap = snap;
  const flip = snap.myColor === 'b';
  const fresh = !prev || snap.round !== view.shownRound || snap.history.length < view.shownMoves || flip !== view.flip;

  if (!prev || prev.phase !== snap.phase) {
    view.selection = [];
    if (snap.phase === 'playing' && (!prev || prev.phase !== 'playing')) {
      bigText(snap.spectator ? 'GAME ON' : `YOU PLAY ${COLOR_NAME[snap.myColor].toUpperCase()}`, 'Black moves first', 'info');
      sound.joined();
    }
  }
  sound.setMood('calm');

  if (fresh) {
    view.flip = flip;
    view.queue = [];
    buildSquares();
    syncPieces(snap.board, { appear: snap.phase === 'playing' && snap.history.length === 0 });
    view.shownMoves = snap.history.length;
    view.shownRound = snap.round;
  } else if (snap.history.length > view.shownMoves) {
    view.queue.push(...snap.history.slice(view.shownMoves));
    view.shownMoves = snap.history.length;
    view.selection = [];
    runQueue();
  }
  if (!view.animating && shownBoard() !== snap.board) syncPieces(snap.board);
  renderAll();
}

// ---------------------------------------------------------------------------
// Chat, settings, lobby
// ---------------------------------------------------------------------------

function setChatOpen(open) {
  view.chatOpen = open;
  el.chat.hidden = !open;
  el.chatBtn.classList.toggle('active', open);
  if (open) {
    view.unread = 0;
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
  }
  el.chatBadge.hidden = view.unread === 0;
  el.chatBadge.textContent = view.unread > 9 ? '9+' : String(view.unread);
}

function addChat(entry, { quiet = false } = {}) {
  const row = document.createElement('div');
  row.className = `msg msg-${entry.kind}${entry.mine ? ' mine' : ''}`;
  if (entry.kind !== 'system') {
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = `${entry.mine ? 'You' : entry.name}${entry.spectator ? ' · watching' : ''}`;
    row.appendChild(who);
  }
  const text = document.createElement('span');
  text.className = 'text';
  text.textContent = entry.message;
  row.appendChild(text);
  el.chatLog.appendChild(row);
  while (el.chatLog.children.length > 120) el.chatLog.firstElementChild.remove();
  el.chatLog.scrollTop = el.chatLog.scrollHeight;
  if (!quiet && entry.kind === 'user' && !entry.mine) {
    if (!view.chatOpen) {
      view.unread += 1;
      setChatOpen(false);
      toast(`${entry.name}: ${entry.message}`, 'chat');
    }
    sound.message();
  }
}

function syncSettingsUi() {
  el.volEffects.value = Math.round(sound.volumes.effects * 100);
  el.volMusic.value = Math.round(sound.volumes.music * 100);
  [el.volEffects, el.volMusic].forEach((input) => {
    input.style.setProperty('--fill', `${input.value}%`);
    input.nextElementSibling.textContent = `${input.value}%`;
  });
  el.hintsToggle.checked = prefs.hints;
  el.numbersToggle.checked = prefs.numbers;
}

function savePrefs() {
  store('local', 'checkers:prefs', JSON.stringify(prefs));
}

const client = new RoomClient('checkers', {
  onEnter() {
    el.lobby.hidden = true;
    el.room.hidden = false;
    el.lobbyError.textContent = '';
    el.chatLog.innerHTML = '';
  },
  onExit(message) {
    view.snap = null;
    view.shownRound = null;
    view.overShownRound = null;
    el.room.hidden = true;
    el.lobby.hidden = false;
    el.gameOver.hidden = true;
    setChatOpen(false);
    el.lobbyError.textContent = message;
    sound.setMood('calm');
  },
  onState,
  onChat: (entry) => addChat(entry),
  onChatHistory(entries) {
    el.chatLog.innerHTML = '';
    entries.forEach((entry) => addChat(entry, { quiet: true }));
  },
  onConnection(connected) {
    el.net.hidden = connected || !client.code;
  },
  onError(message) {
    el.lobbyError.textContent = message;
  },
});

onShareInfo(() => view.snap && renderAll());

el.nameInput.value = client.name;
el.nameInput.addEventListener('input', () => {
  client.name = el.nameInput.value;
});
el.codeInput.addEventListener('input', () => {
  el.codeInput.value = el.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
});
const invited = new URLSearchParams(location.search).get('room');
if (invited) {
  el.codeInput.value = invited.toUpperCase().slice(0, 5);
  el.joinForm.classList.add('invited');
}

el.hostBtn.addEventListener('click', async () => {
  sound.click();
  el.hostBtn.disabled = true;
  const res = await client.host();
  el.hostBtn.disabled = false;
  if (res.error) el.lobbyError.textContent = res.error;
});
el.joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  sound.click();
  const res = await client.join(el.codeInput.value);
  if (res.error && !res.game) el.lobbyError.textContent = res.error;
});

el.roomChip.addEventListener('click', async () => {
  const ok = await copyText(client.code);
  toast(ok ? `Room code ${client.code} copied.` : `Room code: ${client.code}`);
});
el.copyCodeBtn.addEventListener('click', async () => {
  const ok = await copyText(client.code);
  toast(ok ? `Code copied. Friends open ${shareTarget().url.replace(/^https?:\/\//, '')}` : `Room code: ${client.code}`);
});
el.copyLinkBtn.addEventListener('click', async () => {
  const link = client.inviteLink();
  if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: 'Checkers', text: `Play checkers with me — room ${client.code}`, url: link });
      return;
    } catch {
      /* fall back to copying */
    }
  }
  const ok = await copyText(link);
  toast(ok ? 'Invite link copied.' : link);
});

el.forcedToggle.addEventListener('change', async () => {
  const res = await client.send('room:options', { forcedCapture: el.forcedToggle.checked });
  if (res.error) toast(res.error, 'error');
});

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

el.rematchBtn.addEventListener('click', async () => {
  sound.click();
  const res = await client.send('rematch');
  if (res.error) toast(res.error, 'error');
});
el.goViewBtn.addEventListener('click', () => {
  el.gameOver.hidden = true;
});
el.status.addEventListener('click', () => {
  if (view.snap?.phase === 'over') el.gameOver.hidden = false;
});
const leave = () => {
  const playing = view.snap?.phase === 'playing' && !view.snap.spectator;
  if (!playing || window.confirm('Leave the game? Your opponent wins by forfeit.')) client.leave();
};
el.leaveBtn.addEventListener('click', leave);
el.goLeaveBtn.addEventListener('click', () => client.leave());

el.chatBtn.addEventListener('click', () => setChatOpen(!view.chatOpen));
el.chatClose.addEventListener('click', () => setChatOpen(false));
el.chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = el.chatInput.value.trim();
  if (!message) return;
  el.chatInput.value = '';
  const res = await client.send('chat', { message });
  if (res.error) toast(res.error, 'error');
});

el.settingsBtn.addEventListener('click', () => {
  syncSettingsUi();
  el.settings.hidden = false;
});
el.settingsClose.addEventListener('click', () => {
  el.settings.hidden = true;
});
el.settings.addEventListener('click', (event) => {
  if (event.target === el.settings) el.settings.hidden = true;
});
[
  [el.volEffects, 'effects'],
  [el.volMusic, 'music'],
].forEach(([input, bus]) => {
  input.addEventListener('input', () => {
    sound.setVolume(bus, Number(input.value) / 100);
    if (sound.muted && Number(input.value) > 0) sound.setMuted(false);
    syncSettingsUi();
  });
});
el.volEffects.addEventListener('change', () => sound.clack());
el.hintsToggle.addEventListener('change', () => {
  prefs.hints = el.hintsToggle.checked;
  savePrefs();
  renderHighlights();
});
el.numbersToggle.addEventListener('change', () => {
  prefs.numbers = el.numbersToggle.checked;
  savePrefs();
  renderAll();
});

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!el.settings.hidden) el.settings.hidden = true;
  else if (view.chatOpen) setChatOpen(false);
  else {
    view.selection = [];
    renderHighlights();
  }
});

buildSquares();
syncPieces(Rules.initialBoard());
client.autoStart();

// Test hook: `?debug` exposes internals for automated browser tests.
if (new URLSearchParams(location.search).has('debug')) window.checkers = { view, client, Rules };
