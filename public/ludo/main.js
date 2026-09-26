import { store } from '../shared/room-client.js';
import { setupTable, bigText, toast, sound } from '../shared/table-ui.js';
import { LudoBoard3D, HEX, drawBoard } from './board3d.js';

const L = window.LudoRules;
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const COLOR_NAME = { red: 'Red', green: 'Green', yellow: 'Yellow', blue: 'Blue' };
const PIPS = {
  1: [[50, 50]],
  2: [[25, 25], [75, 75]],
  3: [[25, 25], [50, 50], [75, 75]],
  4: [[25, 25], [75, 25], [25, 75], [75, 75]],
  5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]],
  6: [[27, 22], [73, 22], [27, 50], [73, 50], [27, 78], [73, 78]],
};

const el = {
  canvas3d: $('board3d'),
  board2d: $('board2d'),
  canvas2d: $('board2dCanvas'),
  tokens2d: $('tokens2d'),
  playerStrip: $('playerStrip'),
  status: $('status'),
  statusTitle: $('statusTitle'),
  statusSub: $('statusSub'),
  waitingBox: $('waitingBox'),
  lobbyPlayers: $('lobbyPlayers'),
  startBtn: $('startBtn'),
  startNote: $('startNote'),
  diceBox: $('diceBox'),
  rollBtn: $('rollBtn'),
  dieFace: $('dieFace'),
  rollNote: $('rollNote'),
  logBox: $('logBox'),
  log: $('log'),
  gameOver: $('gameOver'),
  goKicker: $('goKicker'),
  goTitle: $('goTitle'),
  goReason: $('goReason'),
  goResults: $('goResults'),
  rematchBtn: $('rematchBtn'),
  rematchNote: $('rematchNote'),
  autoToggle: $('autoToggle'),
  viewButtons: [...document.querySelectorAll('[data-view]')],
};

const prefs = (() => {
  const defaults = { view: '3d', autoRoll: false };
  try {
    return { ...defaults, ...JSON.parse(store('local', 'ludo:prefs') || '{}') };
  } catch {
    return defaults;
  }
})();

let board3d = null;

const view = {
  snap: null,
  shown: null, // seats as currently drawn: [{ seat, color, tokens, gone }]
  shownMove: null,
  queue: [],
  animating: false,
  pending: false,
  dieValue: 6,
  overShownRound: null,
  autoTimer: null,
  lastTurnKey: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mySeat = () => (view.snap && !view.snap.spectator ? view.snap.seat : null);
const seatInfo = (seat) => view.snap?.seats?.find((s) => s.seat === seat) || null;
const nameOf = (seat) => (seat === mySeat() ? 'You' : seatInfo(seat)?.name || '?');
const isMyTurn = () => {
  const s = view.snap;
  return Boolean(s && s.phase === 'playing' && !s.spectator && s.turn === s.seat);
};
const cloneSeats = (seats) => (seats || []).map((s) => ({ ...s, tokens: [...s.tokens] }));

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function setDie(n) {
  view.dieValue = n;
  el.dieFace.dataset.n = n;
  el.dieFace.innerHTML = PIPS[n].map(([x, y]) => `<i style="left:${x}%;top:${y}%"></i>`).join('');
}

// ---------------------------------------------------------------------------
// 2D board
// ---------------------------------------------------------------------------

function draw2dBoard() {
  const size = 900;
  el.canvas2d.width = el.canvas2d.height = size;
  drawBoard(el.canvas2d.getContext('2d'), size);
}

function render2d() {
  if (el.board2d.hidden || !view.shown) return;
  const wrap = el.board2d.getBoundingClientRect();
  const r = el.canvas2d.getBoundingClientRect();
  Object.assign(el.tokens2d.style, { left: `${r.left - wrap.left}px`, top: `${r.top - wrap.top}px`, width: `${r.width}px`, height: `${r.height}px`, inset: 'auto' });
  const movable = new Set(movableKeys());
  const nodes = new Map([...el.tokens2d.children].map((n) => [n.dataset.key, n]));
  const counts = new Map();
  view.shown.forEach((s) => {
    if (s.gone) return;
    s.tokens.forEach((p, t) => {
      const key = `${s.seat}:${t}`;
      let node = nodes.get(key);
      if (!node) {
        node = document.createElement('button');
        node.type = 'button';
        node.className = 'ld-tok';
        node.dataset.key = key;
        node.dataset.seat = s.seat;
        node.dataset.token = t;
        node.style.background = `radial-gradient(circle at 35% 30%, #fff8, ${HEX[s.color]} 55%)`;
        el.tokens2d.appendChild(node);
      }
      nodes.delete(key);
      let [x, y] = L.cellOf(s.color, p, t);
      const k = `${x},${y}`;
      const n = counts.get(k) || 0;
      counts.set(k, n + 1);
      if (p >= 0 && p < L.FINISH && n) {
        x += 0.18 * n;
        y -= 0.12 * n;
      }
      node.style.left = `${(x / 15) * 100}%`;
      node.style.top = `${(y / 15) * 100}%`;
      node.classList.toggle('movable', movable.has(key));
    });
  });
  nodes.forEach((n) => n.remove());
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function movableKeys() {
  const s = view.snap;
  if (!isMyTurn() || s.turnPhase !== 'move' || view.animating) return [];
  return s.movable.map((t) => `${s.seat}:${t}`);
}

function renderBoard() {
  if (!view.shown) return;
  board3d?.setPawns(view.shown);
  const me = seatInfo(mySeat());
  board3d?.setMovable(movableKeys(), me?.color);
  render2d();
}

function renderPlayers() {
  const s = view.snap;
  el.playerStrip.innerHTML = '';
  if (s.phase === 'lobby' || !s.seats) return;
  s.seats.forEach((p) => {
    const chip = document.createElement('div');
    chip.className = 'ld-player';
    chip.style.setProperty('--pc', HEX[p.color]);
    chip.classList.toggle('turn', s.phase === 'playing' && p.seat === s.turn);
    chip.classList.toggle('gone', p.gone);
    const name = document.createElement('b');
    name.textContent = p.seat === mySeat() ? `${p.name} (you)` : p.name;
    const pips = document.createElement('span');
    pips.className = 'pips';
    const shownTokens = view.shown?.find((x) => x.seat === p.seat)?.tokens || p.tokens;
    pips.innerHTML = shownTokens.map((t) => `<i class="${t >= L.FINISH ? 'home' : t >= 0 ? 'out' : ''}"></i>`).join('');
    const w = s.wins?.[p.name];
    chip.append(name);
    if (w) {
      const tag = document.createElement('span');
      tag.className = 'muted small';
      tag.textContent = `🏆${w}`;
      chip.append(tag);
    }
    chip.append(pips);
    el.playerStrip.appendChild(chip);
  });
}

function renderLobby() {
  const s = view.snap;
  el.waitingBox.hidden = s.phase !== 'lobby';
  if (el.waitingBox.hidden) return;
  el.lobbyPlayers.innerHTML = '';
  const hostSeat = s.players.findIndex(Boolean);
  s.players.forEach((p, i) => {
    const li = document.createElement('li');
    if (p) {
      li.textContent = i === s.seat && !s.spectator ? `${p.name} (you)` : p.name;
      if (!p.connected) li.textContent += ' · offline';
      if (i === hostSeat) {
        const tag = document.createElement('span');
        tag.className = 'host';
        tag.textContent = 'Host';
        li.appendChild(tag);
      }
    } else {
      li.className = 'empty';
      li.textContent = 'Open seat';
    }
    el.lobbyPlayers.appendChild(li);
  });
  document.querySelectorAll('#ludoRules [data-option]').forEach((group) => {
    group.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', String(s.options[group.dataset.option]) === b.dataset.value);
      b.disabled = !s.isHost;
    });
  });
  const count = s.players.filter(Boolean).length;
  el.startBtn.hidden = !s.isHost;
  el.startBtn.disabled = count < s.minPlayers;
  el.startBtn.textContent = count < s.minPlayers ? 'Start game' : `Start with ${count} players`;
  el.startNote.textContent = s.isHost
    ? count < s.minPlayers
      ? 'Share the code — you need at least one more player.'
      : `Up to ${s.maxPlayers} players. Start when everyone's in.`
    : `Waiting for ${s.players[hostSeat]?.name || 'the host'} to start…`;
}

function renderStatus() {
  const s = view.snap;
  let title = '';
  let sub = '';
  const turnColor = seatInfo(s.turn)?.color;
  el.status.style.setProperty('--pc', s.phase === 'playing' && turnColor ? HEX[turnColor] : 'transparent');
  if (s.phase === 'lobby') {
    title = 'Gathering players';
    sub = `${s.players.filter(Boolean).length} of ${s.maxPlayers} seats taken`;
  } else if (s.phase === 'over') {
    title = s.winnerSeat === mySeat() ? 'You win!' : `${nameOf(s.winnerSeat)} wins`;
    sub = 'Tap here to see the results again.';
  } else if (view.animating) {
    title = `${nameOf(view.animSeat ?? s.turn)} ${view.animSeat === mySeat() ? 'are' : 'is'} moving`;
  } else if (isMyTurn()) {
    const me = seatInfo(mySeat());
    title = `Your turn · ${COLOR_NAME[me.color]}`;
    sub = s.turnPhase === 'roll' ? 'Roll the die!' : `You rolled ${s.roll} — tap a glowing token to move it.`;
  } else {
    title = `${nameOf(s.turn)}'s turn`;
    sub = turnColor ? COLOR_NAME[turnColor] : '';
  }
  el.statusTitle.textContent = title;
  el.statusSub.textContent = sub;
  el.status.classList.toggle('mine', isMyTurn() && !view.animating);
}

function renderDice() {
  const s = view.snap;
  el.diceBox.hidden = s.phase !== 'playing';
  if (el.diceBox.hidden) return;
  const ready = isMyTurn() && s.turnPhase === 'roll' && !view.animating && !view.pending;
  el.rollBtn.disabled = !ready;
  el.rollBtn.classList.toggle('ready', ready);
  const me = seatInfo(mySeat());
  el.rollBtn.style.setProperty('--pc', me ? HEX[me.color] : '#ffd166');
  if (ready) el.rollNote.innerHTML = `<b>Tap to roll</b><br />${s.sixes ? `${s.sixes} six${s.sixes > 1 ? 'es' : ''} so far` : 'Space or Enter works too'}`;
  else if (isMyTurn() && s.turnPhase === 'move') el.rollNote.innerHTML = `<b>You rolled ${s.roll}</b><br />Pick a token to move`;
  else el.rollNote.innerHTML = `<b>${escapeHtml(nameOf(s.turn))}</b><br />${s.turnPhase === 'move' ? 'is choosing a move' : 'is rolling'}`;
}

function renderLog() {
  const s = view.snap;
  el.logBox.hidden = s.phase === 'lobby' || !s.log;
  if (el.logBox.hidden) return;
  el.log.innerHTML = '';
  s.log
    .slice()
    .reverse()
    .forEach((e) => {
      const li = document.createElement('li');
      const c = seatInfo(e.seat)?.color;
      li.innerHTML = `${c ? `<i style="background:${HEX[c]}"></i>` : ''}<b>${escapeHtml(nameOf(e.seat))}</b> ${escapeHtml(e.text)}`;
      el.log.appendChild(li);
    });
}

function renderGameOver() {
  const s = view.snap;
  if (s.phase !== 'over' || !s.seats) {
    el.gameOver.hidden = true;
    return;
  }
  const w = s.winnerSeat;
  el.goKicker.textContent = `Round ${s.round}`;
  el.goTitle.textContent = w === mySeat() ? 'You win!' : `${nameOf(w)} wins!`;
  el.goReason.textContent = s.endReason === 'home' ? 'Every token made it home.' : 'Everyone else left the game.';
  el.goResults.innerHTML = '';
  [...s.seats]
    .sort((a, b) => b.home - a.home)
    .forEach((p) => {
      const row = document.createElement('div');
      if (p.seat === w) row.className = 'win';
      row.innerHTML = `<span style="color:${HEX[p.color]}">● ${escapeHtml(p.name)}${p.seat === mySeat() ? ' (you)' : ''}</span><span>${p.gone ? 'left' : `${p.home}/${p.tokens.length} home`} · ${s.wins?.[p.name] || 0} wins</span>`;
      el.goResults.appendChild(row);
    });
  renderRematch();
  if (view.overShownRound !== s.round && !view.animating) {
    view.overShownRound = s.round;
    const c = seatInfo(w)?.color;
    if (c) board3d?.celebrate(c);
    bigText(w === mySeat() ? 'YOU WIN!' : `${nameOf(w).toUpperCase()} WINS`, 'All tokens home', w === mySeat() || s.spectator ? 'info' : 'hit');
    setTimeout(() => {
      if (view.snap?.phase !== 'over') return;
      el.gameOver.hidden = false;
      if (s.spectator || w === mySeat()) sound.victory();
      else sound.defeat();
    }, 1400);
  }
}

function renderRematch() {
  const s = view.snap;
  const count = s.players.filter(Boolean).length;
  const votes = s.rematchVotes || [];
  el.rematchBtn.hidden = s.spectator;
  el.rematchBtn.classList.remove('pulse');
  if (s.spectator) {
    el.rematchNote.textContent = 'Stick around — the players may race again.';
  } else if (count < s.minPlayers) {
    el.rematchBtn.textContent = 'Reopen the room';
    el.rematchBtn.disabled = false;
    el.rematchNote.textContent = 'Everyone else left. Reopen and share the code again.';
  } else if (s.isHost) {
    el.rematchBtn.textContent = `New race for ${count}`;
    el.rematchBtn.disabled = false;
    el.rematchNote.textContent = votes.length ? `${votes.length} of ${count} ready.` : 'Start whenever everyone is ready.';
  } else if (votes.includes(s.seat)) {
    el.rematchBtn.textContent = 'Ready ✓';
    el.rematchBtn.disabled = true;
    el.rematchNote.textContent = 'Waiting for the host…';
  } else {
    el.rematchBtn.textContent = "I'm in for another";
    el.rematchBtn.disabled = false;
    el.rematchBtn.classList.add('pulse');
    el.rematchNote.textContent = `${votes.length} of ${count} ready.`;
  }
}

function renderAll() {
  const s = view.snap;
  if (!s) return;
  renderBoard();
  renderPlayers();
  renderLobby();
  renderStatus();
  renderDice();
  renderLog();
  renderGameOver();
  scheduleAutoRoll();
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

async function animateRoll(move) {
  const color = view.shown.find((x) => x.seat === move.seat)?.color || 'red';
  el.rollBtn.classList.remove('rolling');
  void el.rollBtn.offsetWidth;
  el.rollBtn.classList.add('rolling');
  sound.clack();
  const spin = setInterval(() => setDie(1 + Math.floor(Math.random() * 6)), 70);
  if (board3d?.visible) await board3d.rollDie(move.roll, color);
  else await wait(500);
  clearInterval(spin);
  setDie(move.roll);
  sound.place();
}

async function playMove(move) {
  view.animating = true;
  view.animSeat = move.seat;
  renderStatus();
  renderDice();
  renderBoard();
  if (move.rollOnly || move.showRoll) await animateRoll(move);
  if (move.forfeit) {
    bigText('THREE SIXES!', `${nameOf(move.seat)} ${move.seat === mySeat() ? 'lose' : 'loses'} the turn`, 'hit');
    sound.error();
    await wait(500);
  } else if (move.none) {
    await wait(350);
    if (move.seat === mySeat()) toast(`Rolled ${move.roll} — no token can move.`);
  } else if (move.rollOnly && move.roll === 6 && move.seat === mySeat()) {
    bigText('SIX!', 'Roll again after you move', 'info');
  }
  if (!move.rollOnly) {
    const seat = view.shown.find((x) => x.seat === move.seat);
    if (seat) {
      if (board3d?.visible) {
        await board3d.movePawn(move.seat, move.token, seat.color, move.from, move.to);
      } else {
        const steps = move.from < 0 ? [0] : Array.from({ length: move.to - move.from }, (_, i) => move.from + i + 1);
        for (const p of steps) {
          seat.tokens[move.token] = p;
          render2d();
          sound.clack();
          await wait(160);
        }
      }
      seat.tokens[move.token] = move.to;
      if (move.from < 0) bigText('OUT!', `${nameOf(move.seat)} ${move.seat === mySeat() ? 'bring' : 'brings'} a token out`, 'info');
      for (const c of move.captured || []) {
        const victim = view.shown.find((x) => x.seat === c.seat);
        sound.capture();
        bigText('BUMPED!', `${nameOf(move.seat)} sent ${nameOf(c.seat) === 'You' ? 'you' : nameOf(c.seat)} home`, c.seat === mySeat() ? 'hit' : 'info');
        if (board3d?.visible) await board3d.bumpPawn(c.seat, c.token, victim.color);
        if (victim) victim.tokens[c.token] = -1;
        render2d();
      }
      if (move.home) {
        sound.crown();
        board3d?.celebrate(seat.color);
        bigText('HOME!', `${nameOf(move.seat)} ${move.seat === mySeat() ? 'get' : 'gets'} a token home`, 'info');
      }
      board3d?.setPawns(view.shown);
      render2d();
    }
  }
  await wait(120);
  view.animating = false;
  view.animSeat = null;
}

async function runQueue() {
  if (view.animating) return;
  while (view.queue.length) {
    await playMove(view.queue.shift());
    renderPlayers();
  }
  view.shown = cloneSeats(view.snap?.seats);
  renderAll();
  announceTurn();
}

function announceTurn() {
  const s = view.snap;
  if (!s || s.phase !== 'playing') return;
  const key = `${s.round}:${s.lastMove?.id}:${s.turn}:${s.turnPhase}`;
  if (isMyTurn() && s.turnPhase === 'roll' && view.lastTurnKey !== key) {
    const fresh = view.lastTurnKey !== null;
    view.lastTurnKey = key;
    if (fresh) sound.yourTurn();
  }
}

function scheduleAutoRoll() {
  clearTimeout(view.autoTimer);
  const s = view.snap;
  if (!prefs.autoRoll || !isMyTurn() || s.turnPhase !== 'roll' || view.animating || view.pending) return;
  view.autoTimer = setTimeout(() => {
    if (isMyTurn() && view.snap.turnPhase === 'roll' && !view.animating) roll();
  }, 700);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function send(event, payload) {
  if (view.pending) return {};
  view.pending = true;
  renderDice();
  const res = await table.client.send(event, payload);
  view.pending = false;
  if (res.error) {
    toast(res.error, 'error');
    sound.error();
  }
  if (!view.animating) renderAll();
  return res;
}

function roll() {
  const s = view.snap;
  if (!isMyTurn() || s.turnPhase !== 'roll' || view.animating) return;
  sound.click();
  send('ludo:roll');
}

function chooseToken(seat, token) {
  const s = view.snap;
  if (!isMyTurn() || s.turnPhase !== 'move' || view.animating || seat !== s.seat) return;
  if (!s.movable.includes(token)) {
    toast('That token cannot move with this roll.', 'error');
    return;
  }
  sound.click();
  send('ludo:move', { token });
}

// ---------------------------------------------------------------------------
// State updates
// ---------------------------------------------------------------------------

function onState(snap, prev) {
  view.snap = snap;
  const newRound = !prev || prev.round !== snap.round || (prev.phase !== 'playing' && snap.phase === 'playing');
  if (newRound) {
    view.queue = [];
    view.shownMove = snap.lastMove?.id ?? null;
    view.shown = cloneSeats(snap.seats);
    view.lastTurnKey = null;
    const me = snap.seats?.find((x) => x.seat === snap.seat);
    board3d?.setOrientation(me?.color || 'blue');
    if (snap.phase === 'playing' && prev && prev.phase !== 'playing') {
      bigText("LET'S RACE!", me ? `You are ${COLOR_NAME[me.color]}` : 'Enjoy the game', 'info');
      sound.joined();
    }
  }
  sound.setMood(snap.phase === 'playing' ? 'battle' : 'calm');
  const lm = snap.lastMove;
  if (lm && lm.id !== view.shownMove) {
    view.shownMove = lm.id;
    view.queue.push(lm);
    runQueue();
  }
  if (!view.animating && !view.queue.length) {
    view.shown = cloneSeats(snap.seats);
    renderAll();
    announceTurn();
  } else {
    renderPlayers();
    renderLog();
    renderLobby();
  }
}

async function rematch() {
  const s = view.snap;
  if (!s) return;
  const count = s.players.filter(Boolean).length;
  const res = s.isHost && count >= s.minPlayers ? await table.client.send('room:start') : await table.client.send('rematch');
  if (res.error) toast(res.error, 'error');
}

const table = setupTable({
  game: 'ludo',
  title: 'Ludo',
  onState,
  onExit() {
    view.snap = null;
    view.shown = null;
    view.overShownRound = null;
    view.queue = [];
  },
  isPlaying: (snap) => snap.phase === 'playing' && !snap.spectator,
  leaveWarning: 'Leave the game? Your tokens leave the board.',
  onRematch: rematch,
});
const { client } = table;

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function make3d() {
  if (board3d) return board3d;
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const forced = new URLSearchParams(location.search).get('quality');
    const quality = ['low', 'medium', 'high'].includes(forced) ? forced : coarse ? 'medium' : 'high';
    board3d = new LudoBoard3D(el.canvas3d, { quality });
    board3d.onToken = (seat, token) => chooseToken(seat, token);
    board3d.onStep = () => sound.clack();
    board3d.onDieBounce = () => sound.clack();
    const me = view.snap?.seats?.find((x) => x.seat === view.snap.seat);
    board3d.setOrientation(me?.color || 'blue');
  } catch (error) {
    console.warn('3D board unavailable, using 2D', error);
    board3d = null;
  }
  return board3d;
}

function useView(mode) {
  const three = mode === '3d' && make3d();
  el.board2d.hidden = Boolean(three);
  board3d?.show(Boolean(three));
  el.viewButtons.forEach((b) => b.classList.toggle('active', b.dataset.view === (three ? '3d' : '2d')));
  if (view.snap) renderAll();
  return Boolean(three);
}

el.rollBtn.addEventListener('click', roll);
el.tokens2d.addEventListener('click', (event) => {
  const b = event.target.closest('.ld-tok');
  if (b) chooseToken(Number(b.dataset.seat), Number(b.dataset.token));
});
el.startBtn.addEventListener('click', async () => {
  sound.click();
  const res = await client.send('room:start');
  if (res.error) toast(res.error, 'error');
});
document.getElementById('ludoRules').addEventListener('click', async (event) => {
  const b = event.target.closest('button[data-value]');
  if (!b || b.disabled) return;
  const key = b.parentElement.dataset.option;
  const value = key === 'tokens' ? Number(b.dataset.value) : b.dataset.value;
  const res = await client.send('room:options', { [key]: value });
  if (res.error) toast(res.error, 'error');
});
el.status.addEventListener('click', () => {
  if (view.snap?.phase === 'over') el.gameOver.hidden = false;
});
el.viewButtons.forEach((btn) =>
  btn.addEventListener('click', () => {
    prefs.view = btn.dataset.view;
    store('local', 'ludo:prefs', JSON.stringify(prefs));
    const ok = useView(prefs.view);
    if (prefs.view === '3d' && !ok) toast('3D is not supported on this device.', 'error');
  })
);
$('settingsBtn').addEventListener('click', () => {
  el.autoToggle.checked = prefs.autoRoll;
});
el.autoToggle.addEventListener('change', () => {
  prefs.autoRoll = el.autoToggle.checked;
  store('local', 'ludo:prefs', JSON.stringify(prefs));
  scheduleAutoRoll();
});
window.addEventListener('resize', render2d);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') table.handleEscape();
  if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if ((event.key === ' ' || event.key === 'Enter') && !el.rollBtn.disabled) {
    event.preventDefault();
    roll();
  }
  const n = Number(event.key);
  if (n >= 1 && n <= 4 && view.snap) chooseToken(view.snap.seat, n - 1);
});

setDie(6);
draw2dBoard();
useView(prefs.view);
client.autoStart();

// Test hook: `?debug` exposes internals for automated browser tests.
if (new URLSearchParams(location.search).has('debug')) window.ludoPage = { view, client, L, get board3d() { return board3d; } };
