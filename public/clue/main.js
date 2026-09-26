import { store } from '../shared/room-client.js';
import { setupTable, bigText, toast, sound } from '../shared/table-ui.js';
import { ClueBoard3D } from './board3d.js';

const Board = window.ClueBoard;
const { SIZE, SUSPECTS, WEAPONS, ROOMS, CENTER } = Board;
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const el = {
  board: $('board'),
  frame: $('boardFrame'),
  canvas3d: $('board3d'),
  viewButtons: [...document.querySelectorAll('[data-view]')],
  cells: $('cells'),
  roomsLayer: $('roomsLayer'),
  targets: $('targets'),
  tokens: $('tokens'),
  seatStrip: $('seatStrip'),
  status: $('status'),
  statusTitle: $('statusTitle'),
  statusSub: $('statusSub'),
  waitingBox: $('waitingBox'),
  lobbyPlayers: $('lobbyPlayers'),
  startBtn: $('startBtn'),
  startNote: $('startNote'),
  autoNotesWrap: $('autoNotesWrap'),
  autoNotesToggle: $('autoNotesToggle'),
  autoNotesHint: $('autoNotesHint'),
  revealNote: $('revealNote'),
  turnBox: $('turnBox'),
  dice: $('dice'),
  rollBtn: $('rollBtn'),
  passageBtn: $('passageBtn'),
  suggestBtn: $('suggestBtn'),
  accuseBtn: $('accuseBtn'),
  endBtn: $('endBtn'),
  handBox: $('handBox'),
  hand: $('hand'),
  myCharTag: $('myCharTag'),
  tabs: $('tabs'),
  notesPanel: $('notesPanel'),
  logPanel: $('logPanel'),
  gameOver: $('gameOver'),
  goKicker: $('goKicker'),
  goTitle: $('goTitle'),
  goReason: $('goReason'),
  solution: $('solution'),
  rematchBtn: $('rematchBtn'),
  rematchNote: $('rematchNote'),
  picker: $('picker'),
  pickerKicker: $('pickerKicker'),
  pickerTitle: $('pickerTitle'),
  pickerSub: $('pickerSub'),
  pickerSuspects: $('pickerSuspects'),
  pickerWeapons: $('pickerWeapons'),
  pickerRooms: $('pickerRooms'),
  pickerCancel: $('pickerCancel'),
  pickerOk: $('pickerOk'),
  showCard: $('showCard'),
  showSub: $('showSub'),
  showChoices: $('showChoices'),
  reveal: $('reveal'),
  revealKicker: $('revealKicker'),
  revealCard: $('revealCard'),
  revealOk: $('revealOk'),
};

// ---------------------------------------------------------------------------
// Cards and icons
// ---------------------------------------------------------------------------

const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const WEAPON_ICONS = {
  candlestick: svg('<path d="M12 2c1.6 2 1.6 3.4 0 4.6-1.6-1.2-1.6-2.6 0-4.6z" fill="currentColor"/><path d="M10 8h4v9h-4zM7 21h10M9 17h6l1 4H8z"/>'),
  knife: svg('<path d="M4 20l7-7M11 13l9-9c1 3-1 8-6 12z" fill="currentColor"/><path d="M3 21l3-3"/>'),
  pipe: svg('<path d="M5 19L19 5" stroke-width="4"/><path d="M4 17l3 3M17 4l3 3"/>'),
  revolver: svg('<path d="M3 8h15l2 3h-9l-1 3H7l-1 6H3l1-6z" fill="currentColor"/><circle cx="13" cy="14" r="1.6"/>'),
  rope: svg('<circle cx="12" cy="9" r="5"/><circle cx="12" cy="9" r="2.2"/><path d="M12 14c0 3-3 3-3 6M13 14c1 2 3 3 3 6"/>'),
  wrench: svg('<path d="M14 4a5 5 0 0 0-4 7l-7 7 3 3 7-7a5 5 0 0 0 7-4l-3 2-3-1-1-3z" fill="currentColor"/>'),
};
const ROOM_ICON = svg('<path d="M4 20V9l8-5 8 5v11z"/><path d="M10 20v-6h4v6"/>');

const CARDS = new Map([
  ...SUSPECTS.map((s) => [s.id, { kind: 'suspect', label: 'Suspect', name: s.name, color: s.color }]),
  ...WEAPONS.map((w) => [w.id, { kind: 'weapon', label: 'Weapon', name: w.name }]),
  ...ROOMS.map((r) => [r.id, { kind: 'room', label: 'Room', name: r.name, color: r.color }]),
]);
const cardName = (id) => CARDS.get(id)?.name || id;

function cardEl(id, { button = false, big = false } = {}) {
  const info = CARDS.get(id);
  const node = document.createElement(button ? 'button' : 'div');
  if (button) node.type = 'button';
  node.className = `cl-card ${info.kind}${big ? ' big' : ''}`;
  node.dataset.card = id;
  if (info.color) node.style.setProperty('--pc', info.color);
  const kind = document.createElement('span');
  kind.className = 'kind';
  kind.textContent = info.label;
  const art = document.createElement('span');
  art.className = 'art';
  if (info.kind === 'weapon') art.innerHTML = WEAPON_ICONS[id];
  else if (info.kind === 'room') art.innerHTML = ROOM_ICON;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = info.name;
  node.append(kind, art, name);
  return node;
}

// ---------------------------------------------------------------------------
// View state
// ---------------------------------------------------------------------------

const view = {
  snap: null,
  tokenEls: new Map(),
  override: new Map(), // suspect -> [x, y] while a move animates
  weaponRooms: {},
  shownMove: null,
  animating: false,
  pending: false,
  diceKey: null,
  logSeen: null,
  overShownRound: null,
  lastTurnKey: null,
  tab: 'notes',
  picker: null,
  showingFor: null,
  trail: [],
};

const quickCase = () => view.snap?.options?.movement === 'rooms';
const mySeat = () => (view.snap && !view.snap.spectator ? view.snap.seat : null);
const seatInfo = (seat) => view.snap?.seats?.find((s) => s.seat === seat) || null;
const seatName = (seat) => (seat === mySeat() ? 'You' : seatInfo(seat)?.name || 'Someone');
const suspectOf = (id) => SUSPECTS.find((s) => s.id === id);

function isMyTurn() {
  const s = view.snap;
  return Boolean(s && s.phase === 'playing' && !s.spectator && s.turn === s.seat);
}

function myToken() {
  const s = view.snap;
  return s?.myChar ? s.tokens[s.myChar] : null;
}

// ---------------------------------------------------------------------------
// Board construction (static parts)
// ---------------------------------------------------------------------------

function buildBoard() {
  const starts = new Map(SUSPECTS.map((s) => [Board.key(s.start[0], s.start[1]), s.color]));
  const frag = document.createDocumentFragment();
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const cell = document.createElement('div');
      if (Board.isHallway(x, y)) {
        cell.className = `hw${(x + y) % 2 ? ' alt' : ''}`;
        const start = starts.get(Board.key(x, y));
        if (start) {
          cell.classList.add('start');
          cell.style.setProperty('--c', start);
        }
      }
      cell.dataset.k = Board.key(x, y);
      frag.appendChild(cell);
    }
  }
  el.cells.replaceChildren(frag);

  el.roomsLayer.innerHTML = '';
  ROOMS.forEach((r) => {
    const [x, y, w, h] = r.rect;
    const node = document.createElement('div');
    node.className = 'cl-room';
    node.dataset.room = r.id;
    placeRect(node, r.rect);
    node.style.setProperty('--rc', r.color);
    node.style.paddingBottom = `calc(var(--cell) * ${h > 4 ? 1.2 : 0.9})`;
    const name = document.createElement('div');
    name.className = 'rname';
    name.textContent = r.name;
    const weapons = document.createElement('div');
    weapons.className = 'weapons';
    node.append(name, weapons);

    r.doors.forEach(([hx, hy, rx, ry]) => {
      const door = document.createElement('i');
      door.className = 'door';
      const lx = rx - x;
      const ly = ry - y;
      const dx = hx - rx;
      const dy = hy - ry;
      const thick = '4px';
      if (dy !== 0) {
        door.style.left = `calc(var(--cell) * ${lx + 0.12})`;
        door.style.width = 'calc(var(--cell) * 0.76)';
        door.style.height = thick;
        door.style.top = dy > 0 ? `calc(var(--cell) * ${ly + 1} - ${thick})` : '0';
      } else {
        door.style.top = `calc(var(--cell) * ${ly + 0.12})`;
        door.style.height = 'calc(var(--cell) * 0.76)';
        door.style.width = thick;
        door.style.left = dx > 0 ? `calc(var(--cell) * ${lx + 1} - ${thick})` : '0';
      }
      node.appendChild(door);
    });

    if (r.passage) {
      const to = Board.room(r.passage);
      const p = document.createElement('i');
      p.className = 'passage';
      p.title = `Secret passage to the ${to.name}`;
      const right = x > 0;
      const bottom = y > 0;
      p.style.left = right ? `calc(var(--cell) * ${w - 1.25})` : 'calc(var(--cell) * 0.15)';
      p.style.top = bottom ? `calc(var(--cell) * ${h - 1.25})` : 'calc(var(--cell) * 0.15)';
      const arrows = { '1,1': '↘', '-1,-1': '↖', '-1,1': '↙', '1,-1': '↗' };
      p.textContent = arrows[`${Math.sign(to.rect[0] - x)},${Math.sign(to.rect[1] - y)}`] || '⇄';
      node.appendChild(p);
    }
    el.roomsLayer.appendChild(node);
  });

  const center = document.createElement('div');
  center.className = 'cl-center';
  placeRect(center, CENTER);
  center.innerHTML = '<div class="cl-envelope"><i class="seal"></i><span>Case file</span></div>';
  el.roomsLayer.appendChild(center);

  el.tokens.innerHTML = '';
  view.tokenEls.clear();
  SUSPECTS.forEach((s) => {
    const node = document.createElement('div');
    node.className = 'cl-token';
    node.style.setProperty('--c', s.color);
    node.title = s.name;
    node.innerHTML = '<div class="pawn"></div>';
    el.tokens.appendChild(node);
    view.tokenEls.set(s.id, node);
  });
}

function placeRect(node, [x, y, w, h]) {
  node.style.left = `${(x / SIZE) * 100}%`;
  node.style.top = `${(y / SIZE) * 100}%`;
  node.style.width = `${(w / SIZE) * 100}%`;
  node.style.height = `${(h / SIZE) * 100}%`;
}

function placeCell(node, x, y) {
  node.style.left = `${(x / SIZE) * 100}%`;
  node.style.top = `${(y / SIZE) * 100}%`;
}

// Where each token sits inside its room: a row along the bottom of the room.
function roomSlot(roomId, index, count) {
  const [x, y, w, h] = Board.room(roomId).rect;
  const perRow = Math.min(count, w - 1);
  const row = Math.floor(index / perRow);
  const col = index % perRow;
  const inRow = Math.min(perRow, count - row * perRow);
  const spacing = Math.min(1, (w - 0.6) / inRow);
  const startX = x + (w - spacing * inRow) / 2 + (spacing - 1) / 2;
  return [startX + col * spacing, y + h - 1.1 - row * 0.95];
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderTokens(mode = 'glide') {
  const s = view.snap;
  if (!s) return;
  const list3d = [];
  const byRoom = {};
  SUSPECTS.forEach((sp) => {
    const t = s.tokens[sp.id];
    if (t.room && !view.override.has(sp.id)) (byRoom[t.room] ||= []).push(sp.id);
  });
  const turnChar = s.phase === 'playing' ? s.seats.find((x) => x.seat === s.turn)?.suspect : null;
  SUSPECTS.forEach((sp) => {
    const node = view.tokenEls.get(sp.id);
    const t = s.tokens[sp.id];
    let pos;
    if (view.override.has(sp.id)) pos = view.override.get(sp.id);
    else if (t.room) pos = roomSlot(t.room, byRoom[t.room].indexOf(sp.id), byRoom[t.room].length);
    else pos = [t.x, t.y];
    placeCell(node, pos[0], pos[1]);
    node.classList.toggle('mine', sp.id === s.myChar);
    node.classList.toggle('active', sp.id === turnChar && !view.animating);
    list3d.push({ id: sp.id, x: pos[0], y: pos[1], mine: sp.id === s.myChar, active: sp.id === turnChar && !view.animating });
  });
  if (board3d) {
    board3d.setTokens(list3d, view.instant || !board3d.visible ? 'instant' : mode);
    view.instant = false;
  }
}

// Weapons stand in a row across the middle of their room.
function weaponSlot(roomId, index, count) {
  const [x, y, w, h] = Board.room(roomId).rect;
  const spacing = Math.min(1.5, (w - 0.6) / count);
  return [x + (w - spacing * count) / 2 + (spacing - 1) / 2 + index * spacing, y + h / 2 - 0.55];
}

function renderWeapons() {
  const s = view.snap;
  const rooms = new Map(ROOMS.map((r) => [r.id, el.roomsLayer.querySelector(`[data-room="${r.id}"] .weapons`)]));
  rooms.forEach((box) => (box.innerHTML = ''));
  WEAPONS.forEach((w) => {
    const where = s.weapons?.[w.id];
    if (!where) return;
    const icon = document.createElement('span');
    icon.className = 'cl-weapon';
    icon.title = w.name;
    icon.innerHTML = WEAPON_ICONS[w.id];
    if (view.weaponRooms[w.id] && view.weaponRooms[w.id] !== where) icon.classList.add('arrive');
    rooms.get(where)?.appendChild(icon);
  });
  if (board3d) {
    const byRoom = {};
    WEAPONS.forEach((w) => s.weapons?.[w.id] && (byRoom[s.weapons[w.id]] ||= []).push(w.id));
    const positions = {};
    Object.entries(byRoom).forEach(([roomId, ids]) =>
      ids.forEach((id, i) => (positions[id] = weaponSlot(roomId, i, ids.length)))
    );
    board3d.setWeapons(positions, { instant: !board3d.visible });
  }
  view.weaponRooms = { ...(s.weapons || {}) };
}

function renderTrail() {
  board3d?.setTrail(view.trail);
  el.cells.querySelectorAll('.trail').forEach((c) => c.classList.remove('trail'));
  view.trail.forEach(([x, y]) => el.cells.querySelector(`[data-k="${x},${y}"]`)?.classList.add('trail'));
}

function reachableNow() {
  const s = view.snap;
  // Quick case: every other room is one tap away.
  if (quickCase() && isMyTurn() && s.turnPhase === 'start' && !view.animating && !view.pending) {
    const here = myToken()?.room;
    return { squares: new Map(), rooms: new Map(ROOMS.filter((r) => r.id !== here).map((r) => [r.id, []])) };
  }
  if (!isMyTurn() || s.turnPhase !== 'move' || !s.dice || view.animating || view.pending) return null;
  const token = myToken();
  const blocked = new Set();
  Object.entries(s.tokens).forEach(([id, t]) => {
    if (id !== s.myChar && !t.room) blocked.add(Board.key(t.x, t.y));
  });
  const from = token.room ? { room: token.room } : { x: token.x, y: token.y };
  return Board.reachable(from, s.dice[0] + s.dice[1], blocked);
}

function renderTargets() {
  el.targets.innerHTML = '';
  const options = reachableNow();
  board3d?.setTargets(options);
  if (!options) return;
  options.rooms.forEach((_path, roomId) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tgt-room';
    btn.title = `Enter the ${cardName(roomId)}`;
    btn.setAttribute('aria-label', btn.title);
    placeRect(btn, Board.room(roomId).rect);
    btn.addEventListener('click', () => move({ room: roomId }));
    el.targets.appendChild(btn);
  });
  options.squares.forEach((_path, k) => {
    const [x, y] = k.split(',').map(Number);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tgt';
    btn.setAttribute('aria-label', `Move to square ${x + 1}, ${y + 1}`);
    placeCell(btn, x, y);
    btn.addEventListener('click', () => move({ x, y }));
    el.targets.appendChild(btn);
  });
}

function renderSeats() {
  const s = view.snap;
  el.seatStrip.innerHTML = '';
  if (s.phase === 'lobby') return;
  const asking = s.suggestion?.asking;
  s.seats.forEach((seat) => {
    const chip = document.createElement('div');
    chip.className = 'cl-seat';
    chip.classList.toggle('me', seat.seat === mySeat());
    chip.classList.toggle('turn', s.phase === 'playing' && seat.seat === s.turn);
    chip.classList.toggle('asking', s.turnPhase === 'disprove' && seat.seat === asking);
    chip.classList.toggle('out', seat.eliminated || seat.left);
    const dot = document.createElement('i');
    dot.className = 'pawn-dot';
    dot.style.background = suspectOf(seat.suspect)?.color || '#888';
    dot.title = cardName(seat.suspect);
    const name = document.createElement('span');
    name.className = 'pname';
    name.textContent = seat.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = seat.left
      ? 'left'
      : seat.eliminated
        ? 'out'
        : !seat.connected
          ? 'offline'
          : `${suspectOf(seat.suspect)?.short} · ${seat.cards} cards`;
    chip.append(dot, name, meta);
    el.seatStrip.appendChild(chip);
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
  const auto = autoNotesOn();
  el.autoNotesToggle.checked = auto;
  el.autoNotesToggle.disabled = !s.isHost;
  el.autoNotesWrap.classList.toggle('locked', !s.isHost);
  document.querySelectorAll('[data-movement]').forEach((b) => {
    b.classList.toggle('active', b.dataset.movement === (s.options.movement || 'dice'));
    b.disabled = !s.isHost;
  });
  el.autoNotesHint.textContent = auto
    ? 'Your cards and cards shown to you are crossed off for you.'
    : 'Classic style: everyone marks their own notes.';
  const count = s.players.filter(Boolean).length;
  el.startBtn.hidden = !s.isHost;
  el.startBtn.disabled = count < s.minPlayers;
  el.startBtn.textContent = count < s.minPlayers ? 'Start game' : `Start with ${count} players`;
  if (s.isHost) {
    el.startNote.textContent =
      count < s.minPlayers ? 'Share the code — you need at least one more detective.' : `Up to ${s.maxPlayers} players. Start when everyone's in.`;
  } else {
    el.startNote.textContent = `Waiting for ${s.players[hostSeat]?.name || 'the host'} to start the game…`;
  }
}

function renderStatus() {
  const s = view.snap;
  let title = '';
  let sub = '';
  const mine = isMyTurn();
  const turnName = seatInfo(s.turn)?.name || '';
  const sug = s.suggestion;
  if (s.phase === 'lobby') {
    title = 'Gathering suspects';
    sub = `${s.players.filter(Boolean).length} of ${s.maxPlayers} seats filled`;
  } else if (s.phase === 'over') {
    title = 'Case closed';
    sub = 'Tap here to see the solution again.';
  } else if (mine) {
    const token = myToken();
    title = 'Your turn';
    if (s.turnPhase === 'start') {
      if (s.canSuggestHere && token.room) sub = `You were summoned to the ${cardName(token.room)} — suggest here, or roll.`;
      else if (quickCase()) sub = 'Quick case: tap any glowing room to walk straight in.';
      else sub = token.room && Board.room(token.room).passage ? 'Roll the dice or take the secret passage.' : 'Roll the dice to move.';
    } else if (s.turnPhase === 'move') {
      sub = `Move up to ${s.dice[0] + s.dice[1]} squares — tap a glowing square or room.`;
    } else if (s.turnPhase === 'suggest') {
      sub = `You're in the ${cardName(token.room)}. Make a suggestion.`;
    } else if (s.turnPhase === 'disprove') {
      sub = `Waiting for ${seatName(sug?.asking)} to show you a card…`;
    } else {
      sub = 'Accuse if you are sure — otherwise end your turn.';
    }
  } else {
    title = s.spectator ? `${turnName}'s turn` : `${turnName}'s turn`;
    if (s.turnPhase === 'disprove' && sug) {
      sub = sug.asking === mySeat() ? 'You must show a card!' : `${seatName(sug.asking)} is choosing a card to show…`;
    } else if (s.turnPhase === 'move') sub = `Rolled ${s.dice[0] + s.dice[1]} — moving…`;
    else if (s.turnPhase === 'suggest') sub = 'Thinking about a suggestion…';
    else sub = s.spectator ? 'You are watching.' : 'Keep your notes up to date.';
    const me = seatInfo(mySeat());
    if (me?.eliminated) sub = `You made a wrong accusation — you still show cards. ${sub}`;
  }
  el.statusTitle.textContent = title;
  el.statusSub.textContent = sub;
  el.status.classList.toggle('mine', mine);
}

function setDice(values) {
  el.dice.querySelectorAll('.die').forEach((die, i) => {
    die.dataset.v = values ? values[i] : 1;
  });
}

function renderTurnBox() {
  const s = view.snap;
  el.turnBox.hidden = s.phase !== 'playing';
  if (el.turnBox.hidden) return;
  const mine = isMyTurn();
  const token = myToken();
  const phase = s.turnPhase;
  const inRoom = Boolean(token?.room);
  const busy = view.pending || view.animating;
  el.rollBtn.hidden = !(mine && phase === 'start') || quickCase();
  el.passageBtn.hidden = !(mine && phase === 'start' && inRoom && Board.room(token.room).passage);
  if (!el.passageBtn.hidden) el.passageBtn.textContent = `Passage to ${cardName(Board.room(token.room).passage)}`;
  el.suggestBtn.hidden = !(mine && inRoom && (phase === 'suggest' || (phase === 'start' && s.canSuggestHere)));
  el.accuseBtn.hidden = !(mine && phase !== 'disprove');
  el.endBtn.hidden = !(mine && (phase === 'move' || phase === 'suggest' || phase === 'end'));
  [el.rollBtn, el.passageBtn, el.suggestBtn, el.accuseBtn, el.endBtn].forEach((b) => (b.disabled = busy));
  el.endBtn.textContent = phase === 'end' ? 'End turn' : 'Skip & end turn';

  const key = s.dice ? `${s.round}:${s.turn}:${s.dice.join('')}:${s.seats.length}` : null;
  el.dice.classList.toggle('idle', !s.dice);
  if (key && key !== view.diceKey && view.diceKey !== undefined && view.snapCount > 1) {
    rollDiceAnimation(s.dice);
  } else if (!el.dice.querySelector('.rolling')) {
    setDice(s.dice);
  }
  view.diceKey = key;
}

async function rollDiceAnimation(values) {
  const dice = [...el.dice.querySelectorAll('.die')];
  dice.forEach((d) => d.classList.remove('landed'));
  dice.forEach((d) => d.classList.add('rolling'));
  for (let i = 0; i < 7; i += 1) {
    dice.forEach((d) => (d.dataset.v = 1 + Math.floor(Math.random() * 6)));
    if (i % 2 === 0) sound.clack();
    await wait(80);
  }
  dice.forEach((d, i) => {
    d.classList.remove('rolling');
    d.dataset.v = values[i];
    void d.offsetWidth;
    d.classList.add('landed');
  });
  sound.place();
}

function renderHand() {
  const s = view.snap;
  const hand = s.myHand || [];
  el.handBox.hidden = !hand.length;
  if (el.handBox.hidden) return;
  const sig = hand.join(',');
  if (el.hand.dataset.sig !== sig) {
    el.hand.dataset.sig = sig;
    el.hand.replaceChildren(...hand.map((c, i) => {
      const node = cardEl(c);
      node.style.animationDelay = `${i * 60}ms`;
      return node;
    }));
  }
  const me = suspectOf(s.myChar);
  el.myCharTag.innerHTML = '';
  if (me) {
    const dot = document.createElement('i');
    dot.style.background = me.color;
    el.myCharTag.append(dot, `You are ${me.name}`);
  }
}

// ---- detective notes -------------------------------------------------------

const MARKS = ['', 'x', 'maybe', 'yes'];
const MARK_GLYPH = { '': '', x: '✕', maybe: '?', yes: '✓' };

function notesKey() {
  const s = view.snap;
  return `clue:notes:${s.code}:${s.round}`;
}

function loadNotes() {
  try {
    return JSON.parse(store('local', notesKey()) || '{}');
  } catch {
    return {};
  }
}

function saveNotes(notes) {
  store('local', notesKey(), JSON.stringify(notes));
}

const autoNotesOn = () => view.snap?.options?.autoNotes !== false;

// Cards you have proof of: your hand, cards shown to you, and hands of players who left.
// Empty when the host turned auto-fill off.
function autoNotes() {
  const s = view.snap;
  const auto = new Map();
  if (!autoNotesOn()) return auto;
  (s.myHand || []).forEach((c) => auto.set(c, 'your card'));
  (s.shownToMe || []).forEach(({ card, by }) => auto.set(card, `shown by ${seatInfo(by)?.name || '?'}`));
  Object.entries(s.revealed || {}).forEach(([seat, cards]) =>
    cards.forEach((c) => auto.has(c) || auto.set(c, `${seatInfo(Number(seat))?.name || '?'} (left)`))
  );
  return auto;
}

function renderNotes() {
  const s = view.snap;
  if (s.spectator || s.phase === 'lobby') return;
  const notes = loadNotes();
  const auto = autoNotes();
  const groups = [
    ['Suspects', SUSPECTS],
    ['Weapons', WEAPONS],
    ['Rooms', ROOMS],
  ];
  el.notesPanel.innerHTML = '';
  groups.forEach(([title, list]) => {
    const wrap = document.createElement('div');
    const h = document.createElement('h4');
    h.textContent = title;
    const ul = document.createElement('ul');
    list.forEach((item) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      const known = auto.get(item.id);
      const mark = known ? 'x' : notes[item.id] || '';
      btn.className = `cl-note${mark ? ` ${mark}` : ''}`;
      btn.dataset.card = item.id;
      const m = document.createElement('span');
      m.className = 'mark';
      m.textContent = MARK_GLYPH[mark];
      const dot = document.createElement('i');
      dot.className = 'dot';
      dot.style.background = item.color || '#9aa4b2';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.name;
      btn.append(m, dot, name);
      if (known) {
        const src = document.createElement('span');
        src.className = 'src';
        src.textContent = known;
        btn.appendChild(src);
      }
      btn.addEventListener('click', () => {
        if (known) {
          toast(`${item.name}: ${known} — it can't be in the case file.`);
          return;
        }
        const next = MARKS[(MARKS.indexOf(notes[item.id] || '') + 1) % MARKS.length];
        if (next) notes[item.id] = next;
        else delete notes[item.id];
        saveNotes(notes);
        sound.click();
        renderNotes();
      });
      li.appendChild(btn);
      ul.appendChild(li);
    });
    wrap.append(h, ul);
    el.notesPanel.appendChild(wrap);
  });
}

function crossedOff() {
  const notes = loadNotes();
  const auto = autoNotes();
  return (id) => auto.has(id) || notes[id] === 'x';
}

// ---- case log --------------------------------------------------------------

function renderLog() {
  const s = view.snap;
  el.logPanel.innerHTML = '';
  const entries = [...(s.log || [])].reverse();
  if (!entries.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No suggestions yet.';
    el.logPanel.appendChild(li);
    return;
  }
  entries.forEach((e) => {
    const li = document.createElement('li');
    const trio = `${cardName(e.suspect)} · ${cardName(e.weapon)} · ${cardName(e.room)}`;
    if (e.type === 'suggest') {
      li.append(`${seatName(e.by)} suggested ${trio}`);
      const sub = document.createElement('span');
      sub.className = 'sub';
      const passes = e.passes.map(seatName);
      const parts = [];
      if (passes.length) parts.push(`No card: ${passes.join(', ')}.`);
      if (e.shownBy === null || e.shownBy === undefined) parts.push('Nobody could disprove it!');
      sub.append(parts.join(' ') + (parts.length && e.shownBy !== null && e.shownBy !== undefined ? ' ' : ''));
      if (e.shownBy !== null && e.shownBy !== undefined) {
        sub.append(`${seatName(e.shownBy)} showed `);
        if (e.card) {
          const strong = document.createElement('strong');
          strong.className = 'card';
          strong.textContent = cardName(e.card);
          sub.append(strong);
        } else {
          sub.append('a card');
        }
        sub.append('.');
      }
      li.appendChild(sub);
    } else if (e.type === 'accuse') {
      li.className = `accuse${e.correct ? ' right' : ''}`;
      li.append(`${seatName(e.by)} accused ${trio}`);
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = e.correct ? 'Correct — case solved!' : 'Wrong — out of the game.';
      li.appendChild(sub);
    } else if (e.type === 'left') {
      li.append(`${seatInfo(e.seat)?.name || 'A player'} left the game`);
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = `Their cards: ${e.cards.map(cardName).join(', ')}`;
      li.appendChild(sub);
    }
    el.logPanel.appendChild(li);
  });
}

function renderTabs() {
  const s = view.snap;
  el.tabs.hidden = s.phase === 'lobby';
  if (el.tabs.hidden) return;
  const tab = s.spectator ? 'log' : view.tab;
  el.tabs.querySelectorAll('[data-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.disabled = s.spectator && b.dataset.tab === 'notes';
  });
  el.notesPanel.hidden = tab !== 'notes';
  el.logPanel.hidden = tab !== 'log';
  if (tab === 'notes') renderNotes();
  renderLog();
}

// ---- show a card / reveal ----------------------------------------------------

function renderShowCard() {
  const s = view.snap;
  const sug = s.suggestion;
  const must = s.phase === 'playing' && s.turnPhase === 'disprove' && sug?.mustShow?.length ? sug : null;
  if (!must) {
    el.showCard.hidden = true;
    view.showingFor = null;
    return;
  }
  const key = `${s.round}:${sug.by}:${sug.suspect}:${sug.weapon}:${sug.room}:${s.log.length}`;
  if (view.showingFor === key && !el.showCard.hidden) return;
  view.showingFor = key;
  el.showSub.textContent = `${seatName(sug.by)} suggested ${cardName(sug.suspect)} with the ${cardName(sug.weapon)} in the ${cardName(sug.room)}. Choose one card to show them in secret.`;
  el.showChoices.replaceChildren(
    ...sug.mustShow.map((c) => {
      const btn = cardEl(c, { button: true, big: true });
      btn.addEventListener('click', async () => {
        const res = await table.client.send('clue:show', { card: c });
        if (res.error) toast(res.error, 'error');
        else el.showCard.hidden = true;
      });
      return btn;
    })
  );
  el.showCard.hidden = false;
  sound.yourTurn();
}

function onShown(payload) {
  if (payload.card && payload.by !== undefined) {
    el.revealKicker.textContent = `${seatInfo(payload.by)?.name || 'Someone'} shows you…`;
    el.revealCard.replaceChildren(cardEl(payload.card, { big: true }));
    el.revealNote.textContent = autoNotesOn()
      ? "It's been ticked off in your notes."
      : 'Remember to mark it in your notes.';
    el.reveal.hidden = false;
    sound.message();
  } else if (payload.card && payload.to !== undefined) {
    toast(`You showed ${seatInfo(payload.to)?.name || 'them'} the ${cardName(payload.card)}.`);
  } else if (payload.by !== undefined) {
    toast(`${seatInfo(payload.by)?.name} showed ${seatName(payload.to) === 'You' ? 'you' : seatInfo(payload.to)?.name} a card.`);
  }
}

// ---- picker ------------------------------------------------------------------

function openPicker(mode) {
  const s = view.snap;
  const token = myToken();
  view.picker = { mode, suspect: null, weapon: null, room: mode === 'suggest' ? token.room : null };
  el.pickerKicker.textContent = mode === 'suggest' ? 'Suggestion' : 'Accusation';
  el.pickerTitle.textContent = mode === 'suggest' ? `In the ${cardName(token.room)}…` : 'I accuse…';
  el.pickerSub.textContent =
    mode === 'suggest'
      ? 'Pick a suspect and a weapon. The suspect and weapon are moved into this room.'
      : 'Pick the suspect, weapon and room. Get it wrong and you are out of the game!';
  el.pickerOk.textContent = mode === 'suggest' ? 'Suggest' : 'Accuse';
  el.pickerOk.classList.toggle('cl-danger', mode === 'accuse');
  const off = crossedOff();
  const row = (box, list, field) => {
    box.replaceChildren(
      ...list.map((item) => {
        const btn = cardEl(item.id, { button: true });
        btn.classList.toggle('known', off(item.id));
        btn.addEventListener('click', () => {
          view.picker[field] = item.id;
          box.querySelectorAll('.cl-card').forEach((c) => c.classList.toggle('selected', c === btn));
          sound.click();
          updatePickerOk();
        });
        return btn;
      })
    );
  };
  row(el.pickerSuspects, SUSPECTS, 'suspect');
  row(el.pickerWeapons, WEAPONS, 'weapon');
  if (mode === 'accuse') row(el.pickerRooms, ROOMS, 'room');
  else el.pickerRooms.replaceChildren();
  updatePickerOk();
  el.picker.hidden = false;
  if (s.spectator) closePicker();
}

function updatePickerOk() {
  const p = view.picker;
  el.pickerOk.disabled = !(p && p.suspect && p.weapon && p.room);
}

function closePicker() {
  el.picker.hidden = true;
  view.picker = null;
}

async function confirmPicker() {
  const p = view.picker;
  if (!p) return;
  el.pickerOk.disabled = true;
  const res =
    p.mode === 'suggest'
      ? await table.client.send('clue:suggest', { suspect: p.suspect, weapon: p.weapon })
      : await table.client.send('clue:accuse', { suspect: p.suspect, weapon: p.weapon, room: p.room });
  if (res.error) {
    toast(res.error, 'error');
    updatePickerOk();
    return;
  }
  closePicker();
  if (p.mode === 'accuse' && res.correct === false) {
    bigText('WRONG!', 'You are out — but you still show cards.', 'lost');
    sound.defeat();
  }
}

// ---- game over ---------------------------------------------------------------

function renderGameOver() {
  const s = view.snap;
  if (s.phase !== 'over') {
    el.gameOver.hidden = true;
    return;
  }
  const me = mySeat();
  const winner = s.winner;
  if (s.endReason === 'unsolved') {
    el.goKicker.textContent = 'The case goes cold';
    el.goTitle.textContent = 'Unsolved';
    el.goReason.textContent = 'Every detective accused wrongly. Here is what really happened:';
  } else {
    const who = winner === me ? 'You' : seatInfo(winner)?.name || 'Someone';
    el.goKicker.textContent = 'Case closed';
    if (s.endReason === 'solved') {
      el.goTitle.textContent = winner === me ? 'You solved it!' : `${who} solved it`;
      el.goReason.textContent = 'The correct accusation:';
    } else {
      el.goTitle.textContent = winner === me ? 'You win!' : `${who} wins`;
      el.goReason.textContent = 'Last detective standing. The answer was:';
    }
  }
  const sol = s.solution;
  const sig = sol ? `${s.round}:${sol.suspect}${sol.weapon}${sol.room}` : '';
  if (sol && el.solution.dataset.sig !== sig) {
    el.solution.dataset.sig = sig;
    el.solution.replaceChildren(cardEl(sol.suspect), cardEl(sol.weapon), cardEl(sol.room));
  }
  renderRematch();

  if (view.overShownRound !== s.round) {
    view.overShownRound = s.round;
    closePicker();
    el.showCard.hidden = true;
    setTimeout(() => {
      if (view.snap?.phase !== 'over') return;
      el.gameOver.hidden = false;
      if (s.spectator || winner === me) sound.victory();
      else sound.defeat();
    }, 1500);
  }
}

function renderRematch() {
  const s = view.snap;
  const count = s.players.filter(Boolean).length;
  const votes = s.rematchVotes || [];
  el.rematchBtn.hidden = s.spectator;
  el.rematchBtn.classList.remove('pulse');
  if (s.spectator) {
    el.rematchNote.textContent = 'Stick around — the players may start a new case.';
  } else if (count < s.minPlayers) {
    el.rematchBtn.textContent = 'Reopen the room';
    el.rematchBtn.disabled = false;
    el.rematchNote.textContent = 'Everyone else left. Reopen and share the code again.';
  } else if (s.isHost) {
    el.rematchBtn.textContent = `New case with ${count} players`;
    el.rematchBtn.disabled = false;
    el.rematchNote.textContent = votes.length ? `${votes.length} of ${count} ready.` : 'Start whenever everyone is ready.';
  } else if (votes.includes(s.seat)) {
    el.rematchBtn.textContent = 'Ready ✓';
    el.rematchBtn.disabled = true;
    el.rematchNote.textContent = 'Waiting for the host to start the next case…';
  } else {
    el.rematchBtn.textContent = "I'm ready for another";
    el.rematchBtn.disabled = false;
    el.rematchBtn.classList.add('pulse');
    el.rematchNote.textContent = `${votes.length} of ${count} ready.`;
  }
}

async function rematch() {
  const s = view.snap;
  if (!s) return;
  const count = s.players.filter(Boolean).length;
  const res = s.isHost && count >= s.minPlayers ? await table.client.send('room:start') : await table.client.send('rematch');
  if (res.error) toast(res.error, 'error');
}

// ---------------------------------------------------------------------------
// Movement animation
// ---------------------------------------------------------------------------

async function animateMove(move) {
  view.animating = true;
  el.targets.innerHTML = '';
  board3d?.setTargets(null);
  const node = view.tokenEls.get(move.suspect);
  if (move.path && move.path.length) {
    node.classList.remove('jump');
    const hallway = move.path.filter(([x, y]) => Board.isHallway(x, y));
    view.trail = hallway;
    renderTrail();
    for (const [x, y] of move.path) {
      view.override.set(move.suspect, [x, y]);
      renderTokens('hop');
      node.classList.remove('hop');
      void node.offsetWidth;
      node.classList.add('hop');
      if (Board.isHallway(x, y)) sound.clack();
      await wait(150);
    }
    view.override.delete(move.suspect);
    node.classList.add('jump');
    renderTokens(move.to ? 'jump' : 'hop');
    await wait(move.to ? 400 : 60);
    node.classList.remove('jump');
    setTimeout(() => {
      if (view.trail === hallway) {
        view.trail = [];
        renderTrail();
      }
    }, 1400);
  } else {
    node.classList.add('jump');
    renderTokens('jump');
    if (move.summoned) bigText(cardName(move.suspect).toUpperCase(), `is summoned to the ${cardName(move.to)}`, 'info');
    else if (move.passage) bigText('SECRET PASSAGE', `to the ${cardName(move.to)}`, 'info');
    await wait(650);
    node.classList.remove('jump');
  }
  if (move.to) sound.place();
  view.animating = false;
  renderAll();
}

async function move(payload) {
  if (view.pending) return;
  view.pending = true;
  el.targets.innerHTML = '';
  const res = await table.client.send('clue:move', payload);
  view.pending = false;
  if (res.error) {
    toast(res.error, 'error');
    sound.error();
    renderAll();
  }
}

// ---------------------------------------------------------------------------
// State updates
// ---------------------------------------------------------------------------

function announce(prev) {
  const s = view.snap;
  if (s.phase === 'playing' && prev?.phase !== 'playing') {
    const me = suspectOf(s.myChar);
    bigText('A MURDER!', me ? `You are ${me.name}` : 'The investigation begins', 'info');
    sound.joined();
  }
  // New log entries: surprises worth shouting about.
  const log = s.log || [];
  const lastId = log.length ? log[log.length - 1].id : 0;
  if (view.logSeen !== null && s.phase === 'playing') {
    log
      .filter((e) => e.id > view.logSeen)
      .forEach((e) => {
        if (e.type === 'suggest' && (e.shownBy === null || e.shownBy === undefined)) {
          bigText('NO ONE CAN DISPROVE', e.by === mySeat() ? 'Interesting…' : `${seatName(e.by)}'s suggestion`, 'info');
        } else if (e.type === 'accuse' && !e.correct && e.by !== mySeat()) {
          bigText('WRONG ACCUSATION', `${seatName(e.by)} is out`, 'lost');
        }
      });
  }
  view.logSeen = lastId;

  const turnKey = s.phase === 'playing' ? `${s.round}:${s.turn}:${s.log?.length}:${s.turnPhase === 'start'}` : null;
  if (isMyTurn() && s.turnPhase === 'start' && turnKey !== view.lastTurnKey && prev?.phase === 'playing') {
    if (prev.turn !== s.turn) {
      bigText('YOUR TURN', s.canSuggestHere ? 'You were summoned — you may suggest here' : 'Roll the dice', 'info');
      sound.yourTurn();
    }
  }
  view.lastTurnKey = turnKey;
}

function renderAll() {
  const s = view.snap;
  if (!s) return;
  renderTokens();
  renderWeapons();
  renderTargets();
  renderSeats();
  renderLobby();
  renderStatus();
  renderTurnBox();
  renderHand();
  renderTabs();
  renderShowCard();
  renderGameOver();
  if (view.picker && !isMyTurn()) closePicker();
}

function onState(snap, prev) {
  view.snap = snap;
  view.snapCount = (view.snapCount || 0) + 1;
  if (!prev || prev.round !== snap.round) {
    view.shownMove = snap.lastMove?.id ?? null;
    view.override.clear();
    view.instant = true;
    view.weaponRooms = { ...(snap.weapons || {}) };
    view.trail = [];
    renderTrail();
    el.hand.dataset.sig = '';
    el.solution.dataset.sig = '';
    view.logSeen = null;
  }
  sound.setMood(snap.phase === 'playing' ? 'battle' : 'calm');
  announce(prev);

  const lm = snap.lastMove;
  if (lm && lm.id !== view.shownMove) {
    view.shownMove = lm.id;
    renderAll();
    animateMove(lm);
    return;
  }
  renderAll();
}

// ---------------------------------------------------------------------------
// Board view: 3D (default) or flat 2D, chosen in Settings
// ---------------------------------------------------------------------------

const prefs = (() => {
  const defaults = { view: '3d' };
  try {
    return { ...defaults, ...JSON.parse(store('local', 'clue:prefs') || '{}') };
  } catch {
    return defaults;
  }
})();

let board3d = null;

function make3d() {
  if (board3d) return board3d;
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const forced = new URLSearchParams(location.search).get('quality');
    const quality = ['low', 'medium', 'high'].includes(forced) ? forced : coarse ? 'medium' : 'high';
    board3d = new ClueBoard3D(el.canvas3d, { quality });
    board3d.onPick = (target) => move(target);
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
  view.instant = true;
  if (view.snap) renderAll();
  else board3d?.setTokens(SUSPECTS.map((sp) => ({ id: sp.id, x: sp.start[0], y: sp.start[1], mine: false, active: false })), 'instant');
  el.viewButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.view === (three ? '3d' : '2d')));
  return Boolean(three);
}

el.viewButtons.forEach((btn) =>
  btn.addEventListener('click', () => {
    prefs.view = btn.dataset.view;
    store('local', 'clue:prefs', JSON.stringify(prefs));
    const ok = useView(prefs.view);
    if (prefs.view === '3d' && !ok) toast('3D is not supported on this device.', 'error');
  })
);

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const table = setupTable({
  game: 'clue',
  title: 'Clue',
  onState,
  onExit() {
    view.snap = null;
    view.overShownRound = null;
    view.shownMove = null;
    view.logSeen = null;
    view.snapCount = 0;
    closePicker();
    el.showCard.hidden = true;
    el.reveal.hidden = true;
  },
  isPlaying: (snap) => {
    if (snap.phase !== 'playing' || snap.spectator) return false;
    const me = snap.seats.find((x) => x.seat === snap.seat);
    return Boolean(me && !me.eliminated);
  },
  leaveWarning: 'Leave the game? Your cards will be revealed to everyone.',
  onRematch: rematch,
});
const { client } = table;

client.socket.on('clue:shown', onShown);

const act = (event, payload) => async () => {
  if (view.pending) return;
  view.pending = true;
  renderTurnBox();
  const res = await client.send(event, payload);
  view.pending = false;
  if (res.error) {
    toast(res.error, 'error');
    sound.error();
  }
  renderAll();
};

el.startBtn.addEventListener('click', async () => {
  sound.click();
  const res = await client.send('room:start');
  if (res.error) toast(res.error, 'error');
});
el.autoNotesToggle.addEventListener('change', async () => {
  const res = await client.send('room:options', { autoNotes: el.autoNotesToggle.checked });
  if (res.error) {
    toast(res.error, 'error');
    renderLobby();
  }
});
document.getElementById('movementPick').addEventListener('click', async (event) => {
  const b = event.target.closest('[data-movement]');
  if (!b || b.disabled) return;
  const res = await client.send('room:options', { movement: b.dataset.movement });
  if (res.error) toast(res.error, 'error');
});
el.rollBtn.addEventListener('click', act('clue:roll'));
el.passageBtn.addEventListener('click', act('clue:passage'));
el.endBtn.addEventListener('click', act('clue:end'));
el.suggestBtn.addEventListener('click', () => openPicker('suggest'));
el.accuseBtn.addEventListener('click', () => openPicker('accuse'));
el.pickerCancel.addEventListener('click', closePicker);
el.pickerOk.addEventListener('click', confirmPicker);
el.picker.addEventListener('click', (event) => {
  if (event.target === el.picker) closePicker();
});
el.revealOk.addEventListener('click', () => {
  el.reveal.hidden = true;
});
el.tabs.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-tab]');
  if (!btn || btn.disabled) return;
  view.tab = btn.dataset.tab;
  renderTabs();
});
el.status.addEventListener('click', () => {
  if (view.snap?.phase === 'over') el.gameOver.hidden = false;
});

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || table.handleEscape()) return;
  if (!el.reveal.hidden) el.reveal.hidden = true;
  else if (!el.picker.hidden) closePicker();
});

buildBoard();
useView(prefs.view);
client.autoStart();

// Test hook: `?debug` exposes internals for automated browser tests.
if (new URLSearchParams(location.search).has('debug')) window.cluePage = { view, client, Board, get board3d() { return board3d; } };
