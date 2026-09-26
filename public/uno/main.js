import { store } from '../shared/room-client.js';
import { setupTable, bigText, toast, sound } from '../shared/table-ui.js';
import { cardUrl, cardLabel, COLOR_HEX, COLOR_NAME, resetArt } from './card-art.js';
import { ClashTable3D } from './table3d.js';

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const COLOR_ORDER = { r: 0, y: 1, g: 2, b: 3, w: 4 };
const VALUE_ORDER = (v) => (/^\d$/.test(v) ? Number(v) : { skip: 10, rev: 11, d2: 12, wild: 13, w4: 14 }[v]);

const el = {
  canvas3d: $('table3d'),
  table2d: $('table2d'),
  deck2d: $('deck2d'),
  pile2d: $('pile2d'),
  dir2d: $('dir2d'),
  colorChip: $('colorChip'),
  catchBtn: $('catchBtn'),
  playerStrip: $('playerStrip'),
  handBar: $('handBar'),
  hand: $('hand'),
  drawBtn: $('drawBtn'),
  passBtn: $('passBtn'),
  callBtn: $('callBtn'),
  status: $('status'),
  statusTitle: $('statusTitle'),
  statusSub: $('statusSub'),
  waitingBox: $('waitingBox'),
  lobbyPlayers: $('lobbyPlayers'),
  startBtn: $('startBtn'),
  startNote: $('startNote'),
  logBox: $('logBox'),
  log: $('log'),
  colorPicker: $('colorPicker'),
  targetPicker: $('targetPicker'),
  targets: $('targets'),
  gameOver: $('gameOver'),
  goKicker: $('goKicker'),
  goTitle: $('goTitle'),
  goReason: $('goReason'),
  goResults: $('goResults'),
  rematchBtn: $('rematchBtn'),
  rematchNote: $('rematchNote'),
  sortToggle: $('sortToggle'),
  viewButtons: [...document.querySelectorAll('[data-view]')],
};

const prefs = (() => {
  const defaults = { view: '3d', sort: true };
  try {
    return { ...defaults, ...JSON.parse(store('local', 'clash:prefs') || '{}') };
  } catch {
    return defaults;
  }
})();

let table3d = null;

const view = {
  snap: null,
  lastEvent: 0,
  round: null,
  queue: [],
  animating: false,
  shownTop: null, // card on top of the pile as drawn
  shownColor: null,
  handIds: new Set(),
  pending: false,
  pendingCard: null,
  overShownRound: null,
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

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderPlayers() {
  const s = view.snap;
  el.playerStrip.innerHTML = '';
  if (s.phase === 'lobby' || !s.seats) return;
  s.seats.forEach((p) => {
    const chip = document.createElement('div');
    chip.className = 'cc-player';
    chip.classList.toggle('turn', s.phase === 'playing' && p.seat === s.turn);
    chip.classList.toggle('gone', p.gone);
    chip.classList.toggle('last', !p.gone && p.cards === 1);
    const name = document.createElement('b');
    name.textContent = p.seat === mySeat() ? `${p.name} (you)` : p.name;
    const wins = document.createElement('span');
    wins.className = 'wins';
    const w = s.wins?.[p.name] || 0;
    wins.textContent = w ? `🏆${w}` : '';
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = p.gone ? 'left' : String(p.cards);
    chip.append(name, wins, count);
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
  document.querySelectorAll('#clashRules [data-option]').forEach((group) => {
    group.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', (s.options[group.dataset.option] || '') === b.dataset.value);
      b.disabled = !s.isHost;
    });
  });
  const count = s.players.filter(Boolean).length;
  el.startBtn.hidden = !s.isHost;
  el.startBtn.disabled = count < s.minPlayers;
  el.startBtn.textContent = count < s.minPlayers ? 'Start game' : `Deal for ${count} players`;
  el.startNote.textContent = s.isHost
    ? count < s.minPlayers
      ? 'Share the code — you need at least one more player.'
      : `Up to ${s.maxPlayers} players. Deal when everyone's in.`
    : `Waiting for ${s.players[hostSeat]?.name || 'the host'} to deal…`;
}

function modeText(s) {
  const bits = [];
  if (s.mode === 'stack') bits.push('Stacking');
  if (s.mode === 'sevenzero') bits.push('Seven-Zero');
  if (s.drawRule === 'match') bits.push('draw till it fits');
  return bits.join(' · ');
}

function renderStatus() {
  const s = view.snap;
  let title = '';
  let sub = '';
  el.status.style.setProperty('--pc', 'transparent');
  if (s.phase === 'lobby') {
    title = 'Gathering players';
    sub = `${s.players.filter(Boolean).length} of ${s.maxPlayers} seats taken`;
  } else if (s.phase === 'over') {
    title = s.winnerSeat === mySeat() ? 'You win!' : `${nameOf(s.winnerSeat)} wins`;
    sub = 'Tap here to see the results again.';
  } else if (isMyTurn()) {
    title = 'Your turn';
    if (s.pendingDraw) sub = `Stack a draw card or take ${s.pendingDraw}.`;
    else if (s.drawn) sub = 'You drew a card that fits — play it or keep it.';
    else if (s.playableIds.length) sub = `Play a ${COLOR_NAME[s.color]} card or a ${cardLabel(s.top).replace(/^\w+ /, '')}.`;
    else sub = 'Nothing fits — draw a card.';
  } else {
    title = `${nameOf(s.turn)}'s turn`;
    sub = s.pendingDraw ? `${s.pendingDraw} cards stacked up!` : '';
  }
  if (s.phase === 'playing') {
    const m = modeText(s);
    if (m) sub = sub ? `${sub} (${m})` : m;
  }
  el.statusTitle.textContent = title;
  el.statusSub.textContent = sub;
  el.status.classList.toggle('mine', isMyTurn());
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
      const who = e.seat === null ? '' : `<b>${escapeHtml(nameOf(e.seat))}</b> `;
      li.innerHTML = `${who}${escapeHtml(e.text)}`;
      el.log.appendChild(li);
    });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function sortedHand(hand) {
  if (!prefs.sort) return hand;
  return [...hand].sort((a, b) => COLOR_ORDER[a.color] - COLOR_ORDER[b.color] || VALUE_ORDER(a.value) - VALUE_ORDER(b.value));
}

function renderHand() {
  const s = view.snap;
  const playing = s.phase === 'playing' && !s.spectator;
  el.handBar.hidden = !(playing || (s.phase === 'over' && !s.spectator && s.hand?.length));
  if (el.handBar.hidden) return;
  const my = isMyTurn() && !view.animating;
  el.hand.classList.toggle('my-turn', my);
  const ok = new Set(s.playableIds || []);
  const hand = sortedHand(s.hand || []);
  const before = view.handIds;
  el.hand.innerHTML = '';
  hand.forEach((card, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card';
    b.dataset.id = card.id;
    b.title = cardLabel(card);
    b.setAttribute('aria-label', cardLabel(card));
    b.style.backgroundImage = `url(${cardUrl(card)})`;
    const mid = (hand.length - 1) / 2;
    b.style.setProperty('--tilt', `${(i - mid) * Math.min(2.2, 18 / Math.max(hand.length, 1))}deg`);
    if (ok.has(card.id)) b.classList.add('ok');
    if (!before.has(card.id) && before.size) b.classList.add('new');
    el.hand.appendChild(b);
  });
  view.handIds = new Set(hand.map((c) => c.id));
  fitHand();
  // Buttons
  el.drawBtn.hidden = !playing;
  el.drawBtn.disabled = !my || Boolean(s.drawn);
  el.drawBtn.textContent = s.pendingDraw && my ? `Take ${s.pendingDraw}` : 'Draw';
  el.passBtn.hidden = !(my && s.drawn);
  const me = seatInfo(mySeat());
  const n = s.hand?.length || 0;
  el.callBtn.hidden = !playing || !me || me.called || !((n === 2 && my && ok.size) || (n === 1 && s.catchable === mySeat()));
}

function fitHand() {
  const cards = el.hand.children.length;
  if (!cards) return;
  const width = el.hand.clientWidth - 24;
  const cardW = el.hand.firstElementChild.getBoundingClientRect().width || 80;
  const need = cards * cardW;
  const overlap = need > width ? -Math.min(cardW * 0.72, (need - width) / Math.max(cards - 1, 1)) : 4;
  el.hand.style.setProperty('--overlap', `${overlap}px`);
}

function renderTable() {
  const s = view.snap;
  const inGame = s.phase !== 'lobby' && s.top;
  el.colorChip.hidden = !inGame;
  if (inGame) {
    const color = view.animating ? view.shownColor || s.color : s.color;
    el.colorChip.innerHTML = `<i style="background:${COLOR_HEX[color]};color:${COLOR_HEX[color]}"></i>${COLOR_NAME[color]} · ${s.direction === 1 ? '↻' : '↺'}`;
  }
  const catchable = s.phase === 'playing' && !s.spectator && s.catchable !== null && s.catchable !== undefined && s.catchable !== mySeat();
  el.catchBtn.hidden = !catchable;
  if (catchable) el.catchBtn.textContent = `Catch ${nameOf(s.catchable)}! 🫵`;
  const deckActive = isMyTurn() && !s.drawn && !view.animating;
  table3d?.setDeckActive(deckActive);
  el.deck2d.classList.toggle('active', deckActive);
  if (!inGame) return;
  // Seats and counts come from the latest state; the pile follows the animation.
  table3d?.setSeats(s.seats, mySeat(), s.turn);
  table3d?.setDeck(s.deckCount);
  table3d?.setDirection(s.direction);
  if (!view.animating) {
    view.shownTop = s.top;
    view.shownColor = s.color;
    table3d?.setPile(s.top, s.discardCount);
    table3d?.setColor(s.color);
  }
  el.deck2d.style.backgroundImage = `url(${cardUrl(null)})`;
  el.pile2d.style.backgroundImage = `url(${cardUrl(view.shownTop || s.top)})`;
  el.pile2d.style.boxShadow = `0 0 0 4px ${COLOR_HEX[view.shownColor || s.color]}, 0 10px 24px rgba(0,0,0,0.5)`;
  el.dir2d.textContent = s.direction === 1 ? '↻ clockwise' : '↺ counter-clockwise';
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
  el.goReason.textContent = s.endReason === 'empty' ? `${nameOf(w)} played the last card.` : 'Everyone else left the table.';
  el.goResults.innerHTML = '';
  [...s.seats]
    .sort((a, b) => (a.gone - b.gone) || a.cards - b.cards)
    .forEach((p) => {
      const row = document.createElement('div');
      if (p.seat === w) row.className = 'win';
      row.innerHTML = `<span>${escapeHtml(p.name)}${p.seat === mySeat() ? ' (you)' : ''}</span><span>${p.gone ? 'left' : p.seat === w ? '🏆 out!' : `${p.cards} card${p.cards === 1 ? '' : 's'} left`} · ${s.wins?.[p.name] || 0} wins</span>`;
      el.goResults.appendChild(row);
    });
  renderRematch();
  if (view.overShownRound !== s.round && !view.animating) {
    view.overShownRound = s.round;
    bigText(w === mySeat() ? 'YOU WIN!' : `${nameOf(w).toUpperCase()} WINS`, 'Out of cards', w === mySeat() || s.spectator ? 'info' : 'hit');
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
    el.rematchNote.textContent = 'Stick around — the players may deal again.';
  } else if (count < s.minPlayers) {
    el.rematchBtn.textContent = 'Reopen the room';
    el.rematchBtn.disabled = false;
    el.rematchNote.textContent = 'Everyone else left. Reopen and share the code again.';
  } else if (s.isHost) {
    el.rematchBtn.textContent = `Deal again for ${count}`;
    el.rematchBtn.disabled = false;
    el.rematchNote.textContent = votes.length ? `${votes.length} of ${count} ready.` : 'Deal whenever everyone is ready.';
  } else if (votes.includes(s.seat)) {
    el.rematchBtn.textContent = 'Ready ✓';
    el.rematchBtn.disabled = true;
    el.rematchNote.textContent = 'Waiting for the host to deal…';
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
  renderPlayers();
  renderLobby();
  renderStatus();
  renderTable();
  renderHand();
  renderLog();
  renderGameOver();
}

// ---------------------------------------------------------------------------
// Events → animations
// ---------------------------------------------------------------------------

async function playEvent(e) {
  const me = mySeat();
  switch (e.type) {
    case 'play': {
      sound.clack();
      if (table3d?.visible) await table3d.playCard(e.seat, e.card, e.color);
      else {
        el.pile2d.classList.remove('pop');
        void el.pile2d.offsetWidth;
        el.pile2d.classList.add('pop');
        await wait(260);
      }
      view.shownTop = e.card;
      view.shownColor = e.color;
      renderTable();
      const who = nameOf(e.seat);
      if (e.card.value === 'skip') bigText('SKIP!', who === 'You' ? 'You skipped the next player' : `${who} skipped a turn`, 'hit');
      else if (e.card.value === 'rev') {
        table3d?.spinRing();
        bigText('REVERSE!', 'Play changes direction', 'info');
        sound.rotate();
      } else if (e.card.value === 'd2') bigText('+2', `${who} ${who === 'You' ? 'hit' : 'hits'} the next player`, 'hit');
      else if (e.card.value === 'w4') bigText('WILD +4', `Colour: ${COLOR_NAME[e.color]}`, 'hit');
      else if (e.card.value === 'wild') bigText('WILD!', `Colour: ${COLOR_NAME[e.color]}`, 'info');
      if (e.card.color === 'w') sound.crown();
      break;
    }
    case 'draw':
      if (!e.count) break;
      sound.place();
      if (table3d?.visible) await table3d.drawTo(e.seat, e.count);
      else await wait(200);
      if (e.count >= 2 && e.seat === me) bigText(`+${e.count}`, 'Cards for you!', 'hit');
      break;
    case 'swap':
      bigText('HAND SWAP!', `${nameOf(e.seat)} ⇄ ${nameOf(e.target)}`, 'info');
      sound.rotate();
      if (table3d?.visible) await table3d.swap(e.seat, e.target);
      else await wait(500);
      break;
    case 'rotate':
      bigText('PASS IT ON!', 'Every hand moves along', 'info');
      sound.rotate();
      table3d?.spinRing();
      await wait(700);
      break;
    case 'call':
      bigText('UNO!', nameOf(e.seat), 'info');
      sound.check();
      break;
    case 'caught':
      bigText('CAUGHT!', `${nameOf(e.target)} forgot to call it`, 'hit');
      sound.capture();
      break;
    default:
      break;
  }
}

async function runQueue() {
  if (view.animating) return;
  view.animating = true;
  renderAll();
  while (view.queue.length) {
    await playEvent(view.queue.shift());
    renderPlayers();
  }
  view.animating = false;
  renderAll();
  announceTurn();
}

function announceTurn() {
  const s = view.snap;
  if (!s || s.phase !== 'playing') return;
  const key = `${s.round}:${s.events.at(-1)?.id}`;
  if (isMyTurn() && view.lastTurnKey !== key && !view.animating) {
    view.lastTurnKey = key;
    sound.yourTurn();
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function send(event, payload) {
  if (view.pending) return {};
  view.pending = true;
  const res = await table.client.send(event, payload);
  view.pending = false;
  if (res.error) {
    toast(res.error, 'error');
    sound.error();
  }
  renderAll();
  return res;
}

function choose(modal) {
  return new Promise((resolve) => {
    modal.hidden = false;
    const done = (value) => {
      modal.hidden = true;
      modal.removeEventListener('click', onClick);
      resolve(value);
    };
    const onClick = (event) => {
      const b = event.target.closest('button');
      if (event.target === modal || b?.id?.endsWith('Cancel')) return done(null);
      if (b?.dataset.color) return done(b.dataset.color);
      if (b?.dataset.seat) return done(Number(b.dataset.seat));
      return undefined;
    };
    modal.addEventListener('click', onClick);
  });
}

async function playCard(id, node) {
  const s = view.snap;
  if (!isMyTurn() || view.animating) return;
  const card = s.hand.find((c) => c.id === id);
  if (!card) return;
  if (!s.playableIds.includes(id)) {
    node?.classList.remove('shake');
    void node?.offsetWidth;
    node?.classList.add('shake');
    sound.error();
    return;
  }
  const payload = { id };
  if (card.color === 'w') {
    const color = await choose(el.colorPicker);
    if (!color) return;
    payload.color = color;
  }
  if (card.value === '7' && s.mode === 'sevenzero') {
    el.targets.innerHTML = '';
    s.seats
      .filter((p) => !p.gone && p.seat !== mySeat())
      .forEach((p) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-secondary';
        b.dataset.seat = p.seat;
        b.innerHTML = `<span>${escapeHtml(p.name)}</span><span>${p.cards} cards</span>`;
        el.targets.appendChild(b);
      });
    const target = await choose(el.targetPicker);
    if (target === null) return;
    payload.target = target;
  }
  sound.click();
  await send('clash:play', payload);
}

// ---------------------------------------------------------------------------
// State updates
// ---------------------------------------------------------------------------

function onState(snap, prev) {
  view.snap = snap;
  const newRound = !prev || prev.round !== snap.round || (prev.phase !== 'playing' && snap.phase === 'playing');
  if (newRound && snap.events) {
    view.queue = [];
    view.handIds = new Set();
    view.lastEvent = snap.events.at(-1)?.id ?? 0;
    view.lastTurnKey = null;
    if (snap.phase === 'playing' && prev && prev.phase !== 'playing') {
      bigText('SHUFFLE UP!', 'Seven cards each', 'info');
      sound.joined();
      // Deal animation: a few cards to every seat.
      if (table3d?.visible) {
        renderAll();
        snap.seats.forEach((p, i) => setTimeout(() => table3d.drawTo(p.seat, 4), i * 120));
      }
    }
  }
  sound.setMood(snap.phase === 'playing' ? 'battle' : 'calm');
  const fresh = (snap.events || []).filter((e) => e.id > view.lastEvent);
  if (fresh.length) {
    view.lastEvent = fresh.at(-1).id;
    view.queue.push(...fresh);
    runQueue();
  }
  if (!view.animating) {
    renderAll();
    announceTurn();
  } else {
    renderPlayers();
    renderStatus();
    renderHand();
    renderLog();
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
  game: 'uno',
  title: 'UNO',
  onState,
  onExit() {
    view.snap = null;
    view.overShownRound = null;
    view.queue = [];
    view.lastEvent = 0;
  },
  isPlaying: (snap) => snap.phase === 'playing' && !snap.spectator,
  leaveWarning: 'Leave the game? Your cards go back into the deck.',
  onRematch: rematch,
});
const { client } = table;

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function make3d() {
  if (table3d) return table3d;
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const forced = new URLSearchParams(location.search).get('quality');
    const quality = ['low', 'medium', 'high'].includes(forced) ? forced : coarse ? 'medium' : 'high';
    table3d = new ClashTable3D(el.canvas3d, { quality });
    table3d.onDeck = () => el.drawBtn.click();
  } catch (error) {
    console.warn('3D table unavailable, using 2D', error);
    table3d = null;
  }
  return table3d;
}

function useView(mode) {
  const three = mode === '3d' && make3d();
  el.table2d.hidden = Boolean(three);
  table3d?.show(Boolean(three));
  el.viewButtons.forEach((b) => b.classList.toggle('active', b.dataset.view === (three ? '3d' : '2d')));
  if (view.snap) renderAll();
  return Boolean(three);
}

el.hand.addEventListener('click', (event) => {
  const b = event.target.closest('.card');
  if (b) playCard(b.dataset.id, b);
});
el.drawBtn.addEventListener('click', () => {
  if (!isMyTurn() || view.snap.drawn) return;
  sound.click();
  send('clash:draw');
});
el.deck2d.addEventListener('click', () => el.drawBtn.click());
el.passBtn.addEventListener('click', () => send('clash:pass'));
el.callBtn.addEventListener('click', () => send('clash:call'));
el.catchBtn.addEventListener('click', () => send('clash:catch'));
el.startBtn.addEventListener('click', async () => {
  sound.click();
  const res = await client.send('room:start');
  if (res.error) toast(res.error, 'error');
});
document.getElementById('clashRules').addEventListener('click', async (event) => {
  const b = event.target.closest('button[data-value]');
  if (!b || b.disabled) return;
  const res = await client.send('room:options', { [b.parentElement.dataset.option]: b.dataset.value });
  if (res.error) toast(res.error, 'error');
});
el.status.addEventListener('click', () => {
  if (view.snap?.phase === 'over') el.gameOver.hidden = false;
});
el.viewButtons.forEach((btn) =>
  btn.addEventListener('click', () => {
    prefs.view = btn.dataset.view;
    store('local', 'clash:prefs', JSON.stringify(prefs));
    const ok = useView(prefs.view);
    if (prefs.view === '3d' && !ok) toast('3D is not supported on this device.', 'error');
  })
);
$('settingsBtn').addEventListener('click', () => {
  el.sortToggle.checked = prefs.sort;
});
el.sortToggle.addEventListener('change', () => {
  prefs.sort = el.sortToggle.checked;
  store('local', 'clash:prefs', JSON.stringify(prefs));
  renderAll();
});
window.addEventListener('resize', fitHand);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!el.colorPicker.hidden || !el.targetPicker.hidden) return;
    table.handleEscape();
  }
  if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (event.key === 'd' || event.key === 'D') el.drawBtn.click();
});
document.fonts?.ready.then(() => {
  resetArt();
  if (table3d) table3d.texCache.clear();
  if (view.snap) renderAll();
});

useView(prefs.view);
client.autoStart();

// Test hook: `?debug` exposes internals for automated browser tests.
if (new URLSearchParams(location.search).has('debug')) window.clashPage = { view, client, get table3d() { return table3d; } };
