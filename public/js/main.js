import { BattleScene, wait } from './scene.js';
import { sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const ROWS = 'ABCDEFGHIJ';
const BOARD_SIZE = 10;
const DEFAULT_FLEET = [
  { name: 'Carrier', length: 5 },
  { name: 'Battleship', length: 4 },
  { name: 'Cruiser', length: 3 },
  { name: 'Submarine', length: 3 },
  { name: 'Destroyer', length: 2 },
];

// ---------------------------------------------------------------------------
// Storage helpers (storage can throw in private mode — never rely on it)
// ---------------------------------------------------------------------------

function store(kind, key, value) {
  try {
    const s = kind === 'session' ? sessionStorage : localStorage;
    if (value === undefined) return s.getItem(key);
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    /* ignore */
  }
  return null;
}

function getToken() {
  let token = store('session', 'battleship:token');
  if (!token) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    store('session', 'battleship:token', token);
  }
  return token;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const socket = io();
const token = getToken();
const scene = new BattleScene($('scene'));
const isCoarse = window.matchMedia('(pointer: coarse)').matches;

const app = {
  code: null,
  snap: null,
  placement: { round: null, ships: new Map(), selected: null, dir: 'h', hover: null, preview: null },
  aim: null,
  hover: null,
  firing: false,
  queue: [],
  playing: false,
  manualView: null,
  chatOpen: false,
  unread: 0,
  lastTurn: null,
  turnCuePending: false,
  gameOverShownRound: null,
  holdSunk: new Set(),
  dockPlaced: new Set(),
  demo: null,
};

const el = {
  lobby: $('lobby'),
  hud: $('hud'),
  nameInput: $('nameInput'),
  hostBtn: $('hostBtn'),
  joinForm: $('joinForm'),
  codeInput: $('codeInput'),
  lobbyError: $('lobbyError'),
  inviteNote: $('inviteNote'),
  roomChip: $('roomChip'),
  roomCodeLabel: $('roomCodeLabel'),
  myName: $('myName'),
  enemyName: $('enemyName'),
  myPips: $('myPips'),
  enemyPips: $('enemyPips'),
  muteBtn: $('muteBtn'),
  chatBtn: $('chatBtn'),
  chatBadge: $('chatBadge'),
  leaveBtn: $('leaveBtn'),
  banner: $('banner'),
  bannerTitle: $('bannerTitle'),
  bannerSub: $('bannerSub'),
  alert: $('alert'),
  panelWaiting: $('panelWaiting'),
  waitingCode: $('waitingCode'),
  copyCodeBtn: $('copyCodeBtn'),
  copyLinkBtn: $('copyLinkBtn'),
  bonusToggle: $('bonusToggle'),
  bonusToggleWrap: $('bonusToggleWrap'),
  rulesText: $('rulesText'),
  panelPlacement: $('panelPlacement'),
  dock: $('dock'),
  placementActions: $('placementActions'),
  rotateBtn: $('rotateBtn'),
  randomBtn: $('randomBtn'),
  clearBtn: $('clearBtn'),
  readyBtn: $('readyBtn'),
  readyWait: $('readyWait'),
  readyWaitText: $('readyWaitText'),
  editFleetBtn: $('editFleetBtn'),
  placementRules: $('placementRules'),
  panelBattle: $('panelBattle'),
  statShots: $('statShots'),
  statHits: $('statHits'),
  statAcc: $('statAcc'),
  viewBtn: $('viewBtn'),
  fireBtn: $('fireBtn'),
  chat: $('chat'),
  chatLog: $('chatLog'),
  chatForm: $('chatForm'),
  chatInput: $('chatInput'),
  chatClose: $('chatClose'),
  toasts: $('toasts'),
  bigText: $('bigText'),
  gameOver: $('gameOver'),
  goKicker: $('goKicker'),
  goTitle: $('goTitle'),
  goReason: $('goReason'),
  goStats: $('goStats'),
  rematchBtn: $('rematchBtn'),
  rematchNote: $('rematchNote'),
  goLeaveBtn: $('goLeaveBtn'),
  goViewBtn: $('goViewBtn'),
  net: $('netStatus'),
  flash: $('screenFlash'),
};

const coord = (x, y) => `${ROWS[y]}${x + 1}`;
const fleetSpec = () => app.snap?.fleet || DEFAULT_FLEET;

// ---------------------------------------------------------------------------
// Fleet geometry helpers
// ---------------------------------------------------------------------------

function shipCells(ship) {
  const cells = [];
  for (let i = 0; i < ship.length; i += 1) {
    cells.push({ x: ship.x + (ship.dir === 'h' ? i : 0), y: ship.y + (ship.dir === 'v' ? i : 0) });
  }
  return cells;
}

function inBounds(ship) {
  return shipCells(ship).every(({ x, y }) => x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE);
}

function occupiedBy(ships, exceptName) {
  const set = new Set();
  ships.forEach((ship) => {
    if (ship.name === exceptName) return;
    shipCells(ship).forEach(({ x, y }) => set.add(`${x},${y}`));
  });
  return set;
}

function canPlace(ship, ships) {
  if (!inBounds(ship)) return false;
  const taken = occupiedBy(ships, ship.name);
  return shipCells(ship).every(({ x, y }) => !taken.has(`${x},${y}`));
}

function anchorShip(spec, cell, dir) {
  const back = Math.floor((spec.length - 1) / 2);
  let x = cell.x - (dir === 'h' ? back : 0);
  let y = cell.y - (dir === 'v' ? back : 0);
  if (dir === 'h') x = Math.max(0, Math.min(BOARD_SIZE - spec.length, x));
  if (dir === 'v') y = Math.max(0, Math.min(BOARD_SIZE - spec.length, y));
  return { name: spec.name, length: spec.length, x, y, dir };
}

function randomFleet(spec = fleetSpec()) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const ships = [];
    let ok = true;
    for (const s of spec) {
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries += 1) {
        const dir = Math.random() < 0.5 ? 'h' : 'v';
        const ship = {
          name: s.name,
          length: s.length,
          dir,
          x: Math.floor(Math.random() * (dir === 'h' ? BOARD_SIZE - s.length + 1 : BOARD_SIZE)),
          y: Math.floor(Math.random() * (dir === 'v' ? BOARD_SIZE - s.length + 1 : BOARD_SIZE)),
        };
        if (canPlace(ship, ships)) {
          ships.push(ship);
          placed = true;
        }
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return ships;
  }
  return [];
}

function shipAt(ships, x, y) {
  return ships.find((ship) => shipCells(ship).some((c) => c.x === x && c.y === y)) || null;
}

// ---------------------------------------------------------------------------
// Feedback: toasts, big text
// ---------------------------------------------------------------------------

function toast(message, kind = 'info') {
  const node = document.createElement('div');
  node.className = `toast toast-${kind}`;
  node.textContent = message;
  el.toasts.appendChild(node);
  while (el.toasts.children.length > 3) el.toasts.firstElementChild.remove();
  setTimeout(() => node.classList.add('out'), 2600);
  setTimeout(() => node.remove(), 3000);
}

function bigText(title, sub = '', kind = 'hit') {
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

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

function inviteLink() {
  return `${location.origin}${location.pathname}?room=${app.code}`;
}

// ---------------------------------------------------------------------------
// Lobby demo (ambient battle behind the title screen)
// ---------------------------------------------------------------------------

function startDemo() {
  stopDemo();
  const demo = {
    ships: { self: randomFleet(DEFAULT_FLEET), enemy: randomFleet(DEFAULT_FLEET) },
    shots: { self: [], enemy: [] },
    timer: null,
    alive: true,
  };
  app.demo = demo;
  scene.setShips('self', demo.ships.self);
  scene.setShips('enemy', demo.ships.enemy);
  scene.setShots('self', []);
  scene.setShots('enemy', []);
  scene.setActiveBoard(null);
  scene.setView('lobby');

  const fireOne = async () => {
    if (!demo.alive) return;
    const board = Math.random() < 0.5 ? 'self' : 'enemy';
    const shots = demo.shots[board];
    if (shots.length > 26) {
      demo.shots[board] = [];
      scene.setShots(board, []);
    }
    const taken = new Set(demo.shots[board].map((s) => `${s.x},${s.y}`));
    const shipCellsList = demo.ships[board].flatMap(shipCells).filter((c) => !taken.has(`${c.x},${c.y}`));
    let target;
    if (shipCellsList.length && Math.random() < 0.4) {
      target = shipCellsList[Math.floor(Math.random() * shipCellsList.length)];
    } else {
      do {
        target = { x: Math.floor(Math.random() * BOARD_SIZE), y: Math.floor(Math.random() * BOARD_SIZE) };
      } while (taken.has(`${target.x},${target.y}`));
    }
    const result = shipAt(demo.ships[board], target.x, target.y) ? 'hit' : 'miss';
    scene.markPending(board, target.x, target.y);
    await scene.playShot({ board, ...target, result });
    scene.clearPending(board, target.x, target.y);
    if (!demo.alive) return;
    demo.shots[board].push({ ...target, result });
    scene.setShots(board, demo.shots[board]);
    demo.timer = setTimeout(fireOne, 1400 + Math.random() * 1600);
  };
  demo.timer = setTimeout(fireOne, 1200);
}

function stopDemo() {
  if (!app.demo) return;
  app.demo.alive = false;
  clearTimeout(app.demo.timer);
  app.demo = null;
  scene.clearBoard('self');
  scene.clearBoard('enemy');
}

// ---------------------------------------------------------------------------
// Room entry / exit
// ---------------------------------------------------------------------------

function playerName() {
  const name = el.nameInput.value.trim().slice(0, 16);
  store('local', 'battleship:name', name || null);
  return name;
}

function enterRoom(code) {
  app.code = code;
  store('session', 'battleship:room', code);
  const url = new URL(location.href);
  url.searchParams.set('room', code);
  history.replaceState(null, '', url);
  stopDemo();
  el.lobby.hidden = true;
  el.hud.hidden = false;
  el.lobbyError.textContent = '';
}

function exitRoom(message) {
  app.code = null;
  app.snap = null;
  app.queue = [];
  app.holdSunk.clear();
  app.playing = false;
  app.firing = false;
  app.aim = null;
  app.manualView = null;
  app.gameOverShownRound = null;
  app.lastTurn = null;
  app.placement = { round: null, ships: new Map(), selected: null, dir: 'h', hover: null, preview: null };
  store('session', 'battleship:room', null);
  const url = new URL(location.href);
  url.searchParams.delete('room');
  history.replaceState(null, '', url);
  el.chatLog.innerHTML = '';
  setChatOpen(false);
  app.unread = 0;
  el.gameOver.hidden = true;
  el.hud.hidden = true;
  el.lobby.hidden = false;
  el.lobbyError.textContent = message || '';
  scene.setGhost(null);
  scene.setHover(null);
  startDemo();
}

function hostGame() {
  sound.click();
  el.hostBtn.disabled = true;
  socket.emit('room:create', { name: playerName(), token }, (res) => {
    el.hostBtn.disabled = false;
    if (!res?.ok) {
      el.lobbyError.textContent = res?.error || 'Could not create a room.';
      sound.error();
      return;
    }
    enterRoom(res.code);
  });
}

function joinGame(rawCode) {
  const code = rawCode.trim().toUpperCase();
  if (code.length !== 5) {
    el.lobbyError.textContent = 'Room codes are 5 characters.';
    sound.error();
    return;
  }
  sound.click();
  socket.emit('room:join', { code, name: playerName(), token }, (res) => {
    if (!res?.ok) {
      el.lobbyError.textContent = res?.error || 'Could not join that room.';
      sound.error();
      return;
    }
    enterRoom(res.code);
  });
}

function leaveGame() {
  socket.emit('room:leave');
  exitRoom('');
}

// ---------------------------------------------------------------------------
// Snapshot handling
// ---------------------------------------------------------------------------

function onState(snap) {
  const prev = app.snap;
  app.snap = snap;

  // New placement round → reset local layout (or restore a submitted one).
  if (snap.phase === 'placement' && app.placement.round !== snap.round) {
    app.placement.round = snap.round;
    app.placement.ships = new Map();
    snap.me.ships.forEach((s) => app.placement.ships.set(s.name, { ...s }));
    app.placement.selected = nextUnplaced();
    app.placement.dir = 'h';
    app.dockPlaced = new Set(app.placement.ships.keys());
    app.manualView = null;
  }

  if (!prev || prev.phase !== snap.phase) {
    app.manualView = null;
    app.aim = null;
    if (snap.phase === 'placement') scene.scanBoard('self');
    if (snap.phase === 'battle') {
      scene.scanBoard('enemy');
      setTimeout(() => scene.scanBoard('self'), 350);
    }
    if (snap.phase === 'placement' && prev && (prev.phase === 'lobby' || prev.phase === 'over')) {
      sound.joined();
      bigText(snap.round > 1 ? `ROUND ${snap.round}` : 'DEPLOY YOUR FLEET', 'Position all five ships, then hit Ready', 'info');
    }
    if (snap.phase === 'battle') {
      bigText('BATTLE STATIONS', snap.turn === 'you' ? 'You fire first' : `${snap.enemy?.name} fires first`, 'info');
    }
  }

  if (snap.phase === 'battle' && snap.turn !== app.lastTurn && snap.turn === 'you') {
    app.turnCuePending = true;
  }
  app.lastTurn = snap.turn;

  if (snap.phase !== 'over') el.gameOver.hidden = true;
  renderAll();
}

function nextUnplaced() {
  const spec = fleetSpec();
  const found = spec.find((s) => !app.placement.ships.has(s.name));
  return found ? found.name : null;
}

function placementEditable() {
  return app.snap?.phase === 'placement' && !app.snap.me.ready;
}

function myTurnReady() {
  return (
    app.snap?.phase === 'battle' &&
    app.snap.turn === 'you' &&
    !app.firing &&
    !app.playing &&
    app.queue.length === 0
  );
}

function autoView() {
  const s = app.snap;
  if (!s) return 'lobby';
  switch (s.phase) {
    case 'placement':
      return 'self';
    case 'battle':
      return s.turn === 'you' ? 'enemy' : 'self';
    case 'over':
      return 'finale';
    default:
      return 'overview';
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderAll() {
  renderScene();
  renderHud();
  if (!app.playing && app.turnCuePending && myTurnReady()) {
    app.turnCuePending = false;
    sound.yourTurn();
    if (app.snap.me.stats.shots > 0) bigText('YOUR TURN', 'Pick a target', 'turn');
  }
  maybeShowGameOver();
}

function currentSelfShips() {
  const s = app.snap;
  if (!s || s.phase === 'lobby') return [];
  if (placementEditable()) return [...app.placement.ships.values()];
  // Don't show a ship as sunk until the shell that sinks it has landed.
  return s.me.ships.map((ship) => (app.holdSunk.has(`self:${ship.name}`) ? { ...ship, sunk: false } : ship));
}

function currentEnemyShips() {
  const s = app.snap;
  if (!s?.enemy || s.phase === 'placement' || s.phase === 'lobby') return [];
  const animating = app.playing || app.queue.length > 0;
  return s.enemy.ships.filter((ship) => {
    if (app.holdSunk.has(`enemy:${ship.name}`)) return false;
    // At game over the whole enemy fleet is revealed — wait for the final shot first.
    return !(animating && !ship.sunk);
  });
}

function renderScene() {
  const s = app.snap;
  if (!s) return;
  scene.setShips('self', currentSelfShips());
  scene.setShips('enemy', currentEnemyShips());
  scene.setShots('self', s.phase === 'lobby' ? [] : s.me.shotsReceived);
  scene.setShots('enemy', s.phase === 'lobby' ? [] : s.enemy?.shotsReceived || []);

  let active = null;
  if (s.phase === 'placement') active = 'self';
  if (s.phase === 'battle') active = s.turn === 'you' ? 'enemy' : 'self';
  scene.setActiveBoard(active);

  if (!app.playing) scene.setView(app.manualView || autoView());
  renderCursor();
}

function renderCursor() {
  const s = app.snap;
  const p = app.placement;
  if (!s) {
    scene.setGhost(null);
    scene.setHover(null);
    return;
  }

  if (placementEditable()) {
    const hover = p.preview || app.hover;
    const spec = fleetSpec().find((f) => f.name === p.selected);
    if (hover && hover.board === 'self' && spec) {
      const ship = anchorShip(spec, hover, p.dir);
      scene.setGhost({ ...ship, valid: canPlace(ship, [...p.ships.values()]) });
      scene.setHover(null);
    } else {
      scene.setGhost(null);
      scene.setHover(hover && hover.board === 'self' ? hover : null);
    }
    return;
  }

  scene.setGhost(null);
  if (s.phase === 'battle' && s.turn === 'you') {
    const target = app.aim || app.hover;
    if (target && target.board === 'enemy') {
      const shot = (s.enemy?.shotsReceived || []).some((c) => c.x === target.x && c.y === target.y);
      scene.setHover(target, shot ? 'blocked' : 'aim');
      return;
    }
  }
  scene.setHover(null);
}

function renderPips(container, spec, sunkNames) {
  while (container.children.length > spec.length) container.lastElementChild.remove();
  spec.forEach((ship, i) => {
    let pip = container.children[i];
    if (!pip) {
      pip = document.createElement('span');
      pip.className = 'pip';
      pip.addEventListener('animationend', () => pip.classList.remove('sinking'));
      container.appendChild(pip);
    }
    pip.title = ship.name;
    pip.style.setProperty('--len', ship.length);
    const sunk = sunkNames.has(ship.name);
    if (sunk && !pip.classList.contains('sunk')) pip.classList.add('sinking');
    pip.classList.toggle('sunk', sunk);
  });
}

// Restart a CSS animation class whenever the element's value changes.
function setAnimated(node, text, className = 'pop') {
  if (node.textContent === String(text)) return;
  node.textContent = text;
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}

function screenFlash(kind) {
  el.flash.className = 'screen-flash';
  void el.flash.offsetWidth;
  el.flash.className = `screen-flash flash-${kind}`;
}

function renderHud() {
  const s = app.snap;
  if (!s) return;

  el.roomCodeLabel.textContent = s.code;
  el.waitingCode.textContent = s.code;
  el.myName.textContent = s.me.name;
  el.enemyName.textContent = s.enemy ? s.enemy.name : 'Waiting…';
  el.enemyName.parentElement.classList.toggle('absent', !s.enemy);
  el.enemyName.parentElement.classList.toggle('offline', Boolean(s.enemy && !s.enemy.connected));

  const spec = fleetSpec();
  renderPips(el.myPips, spec, new Set(s.me.ships.filter((x) => x.sunk).map((x) => x.name)));
  renderPips(el.enemyPips, spec, new Set((s.enemy?.ships || []).filter((x) => x.sunk).map((x) => x.name)));

  // Panels
  el.panelWaiting.hidden = s.phase !== 'lobby';
  el.panelPlacement.hidden = s.phase !== 'placement';
  el.panelBattle.hidden = s.phase !== 'battle';

  // Rules
  el.bonusToggle.checked = s.rules.bonusShot;
  el.bonusToggle.disabled = !s.isHost;
  el.bonusToggleWrap.classList.toggle('locked', !s.isHost);
  const rulesLabel = s.rules.bonusShot ? 'Hits earn a bonus shot' : 'Turns alternate every shot';
  el.rulesText.textContent = s.isHost ? 'You are the host — set the rules.' : `Host rules: ${rulesLabel.toLowerCase()}.`;
  el.placementRules.textContent = `Rule: ${rulesLabel}`;

  // Opponent connection
  if (s.enemy && !s.enemy.connected && s.phase !== 'over') {
    el.alert.hidden = false;
    el.alert.textContent = `${s.enemy.name} lost connection — holding their seat for a moment…`;
  } else {
    el.alert.hidden = true;
  }

  renderBanner();
  if (s.phase === 'placement') renderPlacementPanel();
  if (s.phase === 'battle') renderBattlePanel();
}

function renderBanner() {
  const s = app.snap;
  let title = '';
  let sub = '';
  let kind = 'neutral';
  if (s.phase === 'lobby') {
    title = 'Waiting for an opponent';
    sub = `Share room code ${s.code}`;
  } else if (s.phase === 'placement') {
    if (!s.me.ready) {
      title = 'Deploy your fleet';
      sub = app.placement.selected
        ? `Placing ${app.placement.selected} — ${isCoarse ? 'tap to preview, tap again to drop' : 'click to drop, R or right-click to rotate'}`
        : 'All ships in position. Hit Ready when you are happy.';
      kind = 'friendly';
    } else {
      title = s.enemy?.ready ? 'Both fleets ready' : `Waiting for ${s.enemy?.name || 'opponent'}`;
      sub = 'The battle begins once both fleets are deployed';
    }
  } else if (s.phase === 'battle') {
    if (s.turn === 'you') {
      title = 'Your turn — fire!';
      sub = isCoarse ? 'Tap a square to aim, tap again to fire' : 'Pick a square in enemy waters';
      kind = 'hostile';
    } else {
      title = `${s.enemy?.name || 'Enemy'} is aiming…`;
      sub = 'Brace for incoming fire';
      kind = 'friendly';
    }
  } else if (s.phase === 'over') {
    title = s.winner === 'you' ? 'Victory' : 'Defeat';
    sub = s.winner === 'you' ? 'The enemy fleet is at the bottom of the sea' : 'Your fleet has been sunk';
    kind = s.winner === 'you' ? 'friendly' : 'hostile';
  }
  if (el.bannerTitle.textContent !== title) {
    el.banner.classList.remove('banner-in');
    void el.banner.offsetWidth;
    el.banner.classList.add('banner-in');
  }
  el.bannerTitle.textContent = title;
  el.bannerSub.textContent = sub;
  el.banner.dataset.kind = kind;
}

function renderPlacementPanel() {
  const s = app.snap;
  const p = app.placement;
  const editable = placementEditable();
  el.dock.innerHTML = '';
  fleetSpec().forEach((spec) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dock-ship';
    if (p.ships.has(spec.name)) btn.classList.add('placed');
    if (p.ships.has(spec.name) && !app.dockPlaced.has(spec.name)) btn.classList.add('pop');
    if (p.selected === spec.name) btn.classList.add('selected');
    btn.disabled = !editable;
    const name = document.createElement('span');
    name.className = 'dock-name';
    name.textContent = spec.name;
    const bar = document.createElement('span');
    bar.className = 'dock-bar';
    for (let i = 0; i < spec.length; i += 1) bar.appendChild(document.createElement('i'));
    btn.append(name, bar);
    btn.addEventListener('click', () => selectShip(spec.name));
    el.dock.appendChild(btn);
  });

  app.dockPlaced = new Set(p.ships.keys());
  const allPlaced = p.ships.size === fleetSpec().length;
  el.placementActions.hidden = !editable;
  el.readyBtn.disabled = !allPlaced;
  el.rotateBtn.textContent = p.dir === 'h' ? '↻ Horizontal' : '↻ Vertical';
  el.readyWait.hidden = editable;
  if (!editable) {
    el.readyWaitText.textContent = s.enemy?.ready
      ? 'Both fleets ready — launching…'
      : `Fleet locked. Waiting for ${s.enemy?.name || 'opponent'} to deploy…`;
  }
}

function renderBattlePanel() {
  const s = app.snap;
  const shots = s.me.stats.shots;
  const hits = s.me.stats.hits;
  setAnimated(el.statShots, shots);
  setAnimated(el.statHits, hits);
  setAnimated(el.statAcc, shots ? `${Math.round((hits / shots) * 100)}%` : '—');
  const viewing = app.manualView || autoView();
  el.viewBtn.textContent = viewing === 'enemy' ? 'View my fleet' : 'View enemy waters';
  const showFire = isCoarse && s.turn === 'you' && Boolean(app.aim);
  el.fireBtn.hidden = !showFire;
  if (showFire) el.fireBtn.textContent = `Fire at ${coord(app.aim.x, app.aim.y)}`;
}

function maybeShowGameOver() {
  const s = app.snap;
  if (!s || s.phase !== 'over' || app.playing || app.queue.length) return;
  const first = app.gameOverShownRound !== s.round;
  if (first) {
    app.gameOverShownRound = s.round;
    const won = s.winner === 'you';
    setTimeout(() => {
      if (app.snap?.phase !== 'over') return;
      el.gameOver.hidden = false;
      if (won) {
        sound.victory();
        scene.celebrate('enemy');
      } else {
        sound.defeat();
      }
    }, 900);
  }

  const won = s.winner === 'you';
  el.gameOver.dataset.result = won ? 'win' : 'loss';
  el.goKicker.textContent = `Round ${s.round}`;
  el.goTitle.textContent = won ? 'Victory!' : 'Defeat';
  if (s.endReason === 'forfeit') {
    el.goReason.textContent = won ? 'Your opponent abandoned the battle.' : 'You left the battle.';
  } else {
    el.goReason.textContent = won
      ? `You sank ${s.enemy?.name || 'the enemy'}'s entire fleet.`
      : `${s.enemy?.name || 'The enemy'} sank your entire fleet.`;
  }

  const row = (label, a, b) => `<tr><th>${label}</th><td>${a}</td><td>${b}</td></tr>`;
  const acc = (st) => (st.shots ? `${Math.round((st.hits / st.shots) * 100)}%` : '—');
  const es = s.enemy?.stats || { shots: 0, hits: 0 };
  const table = document.createElement('table');
  table.innerHTML = `<thead><tr><th></th><td>You</td><td></td></tr></thead><tbody>${[
    row('Shots', s.me.stats.shots, es.shots),
    row('Hits', s.me.stats.hits, es.hits),
    row('Accuracy', acc(s.me.stats), acc(es)),
    row('Ships left', s.me.shipsRemaining, s.enemy ? s.enemy.shipsRemaining : '—'),
  ].join('')}</tbody>`;
  table.querySelector('thead td:last-child').textContent = s.enemy?.name || 'Opponent';
  el.goStats.innerHTML = '';
  el.goStats.appendChild(table);

  if (!s.enemy) {
    el.rematchBtn.textContent = 'Find a new opponent';
    el.rematchBtn.disabled = false;
    el.rematchNote.textContent = 'Reopen this room and share the code again.';
  } else if (s.rematch.you) {
    el.rematchBtn.textContent = 'Rematch requested';
    el.rematchBtn.disabled = true;
    el.rematchNote.textContent = `Waiting for ${s.enemy.name} to accept…`;
  } else {
    el.rematchBtn.textContent = s.rematch.enemy ? 'Accept rematch' : 'Rematch';
    el.rematchBtn.disabled = false;
    el.rematchNote.textContent = s.rematch.enemy ? `${s.enemy.name} wants a rematch!` : '';
  }
  el.rematchBtn.classList.toggle('pulse', Boolean(s.rematch.enemy && !s.rematch.you));
}

// ---------------------------------------------------------------------------
// Placement actions
// ---------------------------------------------------------------------------

function selectShip(name) {
  if (!placementEditable()) return;
  const p = app.placement;
  if (p.ships.has(name)) {
    p.dir = p.ships.get(name).dir;
    p.ships.delete(name);
  }
  p.selected = name;
  p.preview = null;
  sound.click();
  renderAll();
}

function rotateShip() {
  if (!placementEditable()) return;
  app.placement.dir = app.placement.dir === 'h' ? 'v' : 'h';
  sound.rotate();
  renderAll();
}

function randomizeFleet() {
  if (!placementEditable()) return;
  const p = app.placement;
  p.ships = new Map(randomFleet().map((s) => [s.name, s]));
  p.selected = null;
  p.preview = null;
  sound.place();
  renderAll();
}

function clearFleet() {
  if (!placementEditable()) return;
  const p = app.placement;
  p.ships = new Map();
  p.selected = nextUnplaced();
  p.preview = null;
  sound.click();
  renderAll();
}

function submitFleet() {
  if (!placementEditable()) return;
  const ships = [...app.placement.ships.values()].map(({ name, x, y, dir }) => ({ name, x, y, dir }));
  el.readyBtn.disabled = true;
  socket.emit('fleet:submit', { ships }, (res) => {
    if (!res?.ok) {
      toast(res?.error || 'Could not deploy fleet.', 'error');
      sound.error();
      el.readyBtn.disabled = false;
      return;
    }
    app.placement.preview = null;
    sound.joined();
  });
}

function editFleet() {
  socket.emit('fleet:unready', null, (res) => {
    if (!res?.ok) toast(res?.error || 'Too late to reposition.', 'error');
  });
}

function handlePlacementClick(cell, event) {
  const p = app.placement;
  if (!cell || cell.board !== 'self') {
    p.preview = null;
    renderAll();
    return;
  }
  const placed = [...p.ships.values()];
  const touch = event.pointerType !== 'mouse';
  const existing = shipAt(placed, cell.x, cell.y);
  const spec = fleetSpec().find((f) => f.name === p.selected);

  // Clicking a placed ship picks it back up so it can be moved or rotated.
  if (existing) {
    p.ships.delete(existing.name);
    p.selected = existing.name;
    p.dir = existing.dir;
    p.preview = touch ? cell : null;
    sound.click();
    renderAll();
    return;
  }

  if (!spec) return;

  if (touch && (!p.preview || p.preview.x !== cell.x || p.preview.y !== cell.y)) {
    p.preview = cell;
    renderAll();
    return;
  }

  const ship = anchorShip(spec, cell, p.dir);
  if (!canPlace(ship, placed)) {
    sound.error();
    toast('That spot overlaps another ship.', 'error');
    return;
  }
  p.ships.set(ship.name, ship);
  p.selected = nextUnplaced();
  p.preview = null;
  sound.place();
  renderAll();
}

// ---------------------------------------------------------------------------
// Battle actions
// ---------------------------------------------------------------------------

function fireAt(target) {
  if (!myTurnReady()) return;
  const shots = app.snap.enemy?.shotsReceived || [];
  if (shots.some((c) => c.x === target.x && c.y === target.y)) {
    toast(`Already fired at ${coord(target.x, target.y)}.`, 'error');
    sound.error();
    return;
  }
  app.firing = true;
  app.aim = null;
  renderAll();
  socket.emit('fire', { x: target.x, y: target.y }, (res) => {
    app.firing = false;
    if (!res?.ok) {
      toast(res?.error || 'Shot failed.', 'error');
      sound.error();
    }
    renderAll();
  });
}

function handleBattleClick(cell, event) {
  const s = app.snap;
  if (s.turn !== 'you') {
    if (cell?.board === 'enemy' && !app.playing) toast(`Wait for ${s.enemy?.name || 'the enemy'} to fire.`);
    return;
  }
  if (!cell || cell.board !== 'enemy') {
    if (cell?.board === 'self' && !app.playing) {
      app.manualView = 'enemy';
      renderAll();
    }
    return;
  }
  if (event.pointerType !== 'mouse') {
    if (!app.aim || app.aim.x !== cell.x || app.aim.y !== cell.y) {
      app.aim = cell;
      sound.click();
      renderAll();
      return;
    }
  }
  fireAt(cell);
}

function toggleView() {
  const s = app.snap;
  if (!s || s.phase === 'lobby') return;
  const current = app.manualView || autoView();
  app.manualView = current === 'enemy' ? 'self' : 'enemy';
  if (app.manualView === autoView()) app.manualView = null;
  sound.click();
  renderAll();
}

// ---------------------------------------------------------------------------
// Shot animation queue
// ---------------------------------------------------------------------------

function describeShipAt(x, y) {
  const ship = shipAt(app.snap?.me.ships || [], x, y);
  return ship ? ship.name : 'ship';
}

async function processQueue() {
  if (app.playing) return;
  app.playing = true;
  renderAll();
  while (app.queue.length) {
    while (app.queue.length) {
      const ev = app.queue.shift();
      app.manualView = null;
      if (scene.view !== ev.board) {
        scene.setView(ev.board);
        await wait(650);
      }
      sound.fire();
      await scene.playShot(ev);
      scene.clearPending(ev.board, ev.x, ev.y);
      if (ev.sunkShip) app.holdSunk.delete(`${ev.board}:${ev.sunkShip.name}`);
      announceShot(ev);
      renderScene();
    }
    await wait(750);
  }
  app.playing = false;
  renderAll();
}

function announceShot(ev) {
  const s = app.snap;
  const where = coord(ev.x, ev.y);
  const enemyName = s?.enemy?.name || 'Enemy';
  const bonus = s?.rules.bonusShot && !ev.gameOver;
  if (ev.result === 'miss') {
    sound.splash();
    if (ev.by === 'you') bigText('MISS', where, 'miss');
    else toast(`${enemyName} missed at ${where}.`);
    return;
  }
  if (ev.result === 'sunk') {
    sound.sunk();
    screenFlash(ev.by === 'you' ? 'strike' : 'damage');
    if (ev.by === 'you') bigText('SUNK!', `Enemy ${ev.sunkShip?.name || 'ship'} destroyed`, 'sunk');
    else bigText(`${(ev.sunkShip?.name || 'SHIP').toUpperCase()} LOST`, `${enemyName} sank your ${ev.sunkShip?.name}`, 'lost');
    return;
  }
  sound.explosion();
  screenFlash(ev.by === 'you' ? 'strike' : 'damage');
  if (ev.by === 'you') bigText('HIT!', bonus ? `${where} — fire again!` : where, 'hit');
  else bigText('YOU\'RE HIT', `${enemyName} struck your ${describeShipAt(ev.x, ev.y)} at ${where}`, 'lost');
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function setChatOpen(open) {
  app.chatOpen = open;
  el.chat.hidden = !open;
  el.chatBtn.classList.toggle('active', open);
  if (open) {
    app.unread = 0;
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
    if (!isCoarse) el.chatInput.focus();
  }
  el.chatBadge.hidden = app.unread === 0;
  el.chatBadge.textContent = app.unread > 9 ? '9+' : String(app.unread);
}

function addChat(entry, { quiet = false } = {}) {
  const row = document.createElement('div');
  row.className = `msg msg-${entry.kind}${entry.mine ? ' mine' : ''}`;
  if (entry.kind !== 'system') {
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = entry.mine ? 'You' : entry.name;
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
    if (!app.chatOpen) {
      app.unread += 1;
      el.chatBadge.hidden = false;
      el.chatBadge.textContent = app.unread > 9 ? '9+' : String(app.unread);
      toast(`${entry.name}: ${entry.message}`, 'chat');
    }
    sound.message();
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function syncMuteButton() {
  el.muteBtn.classList.toggle('muted', sound.muted);
  el.muteBtn.setAttribute('aria-pressed', String(sound.muted));
  el.muteBtn.title = sound.muted ? 'Sound off' : 'Sound on';
}

function bindUi() {
  el.nameInput.value = store('local', 'battleship:name') || '';
  const params = new URLSearchParams(location.search);
  const invited = (params.get('room') || '').toUpperCase().slice(0, 5);
  if (invited) {
    el.codeInput.value = invited;
    el.inviteNote.hidden = false;
    el.inviteNote.textContent = `You've been invited to room ${invited}. Pick a callsign and join!`;
    el.joinForm.classList.add('invited');
  }

  el.hostBtn.addEventListener('click', hostGame);
  el.joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    joinGame(el.codeInput.value);
  });
  el.codeInput.addEventListener('input', () => {
    el.codeInput.value = el.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  });

  el.roomChip.addEventListener('click', async () => {
    if (!app.code) return;
    const ok = await copyText(app.code);
    toast(ok ? `Room code ${app.code} copied.` : `Room code: ${app.code}`);
  });
  el.copyCodeBtn.addEventListener('click', async () => {
    const ok = await copyText(app.code);
    toast(ok ? 'Room code copied.' : `Room code: ${app.code}`);
  });
  el.copyLinkBtn.addEventListener('click', async () => {
    const link = inviteLink();
    if (navigator.share && isCoarse) {
      try {
        await navigator.share({ title: 'Battleship', text: `Join my Battleship game — room ${app.code}`, url: link });
        return;
      } catch {
        /* fall back to copying */
      }
    }
    const ok = await copyText(link);
    toast(ok ? 'Invite link copied.' : link);
  });
  el.bonusToggle.addEventListener('change', () => {
    socket.emit('room:rules', { bonusShot: el.bonusToggle.checked }, (res) => {
      if (!res?.ok) toast(res?.error || 'Could not change rules.', 'error');
    });
  });

  el.muteBtn.addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    syncMuteButton();
  });
  el.chatBtn.addEventListener('click', () => setChatOpen(!app.chatOpen));
  el.chatClose.addEventListener('click', () => setChatOpen(false));
  el.leaveBtn.addEventListener('click', () => {
    const inBattle = app.snap?.phase === 'battle';
    if (!inBattle || window.confirm('Leave the battle? Your opponent will win by forfeit.')) leaveGame();
  });

  el.rotateBtn.addEventListener('click', rotateShip);
  el.randomBtn.addEventListener('click', randomizeFleet);
  el.clearBtn.addEventListener('click', clearFleet);
  el.readyBtn.addEventListener('click', submitFleet);
  el.editFleetBtn.addEventListener('click', editFleet);
  el.viewBtn.addEventListener('click', toggleView);
  el.fireBtn.addEventListener('click', () => app.aim && fireAt(app.aim));

  el.rematchBtn.addEventListener('click', () => {
    sound.click();
    socket.emit('rematch', null, (res) => {
      if (!res?.ok) toast(res?.error || 'Rematch failed.', 'error');
    });
  });
  el.goLeaveBtn.addEventListener('click', leaveGame);
  el.goViewBtn.addEventListener('click', () => {
    el.gameOver.hidden = true;
    toast('Tap the banner at the top to reopen the results.');
  });
  el.banner.addEventListener('click', () => {
    if (app.snap?.phase === 'over') el.gameOver.hidden = false;
  });

  el.chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = el.chatInput.value.trim();
    if (!message) return;
    socket.emit('chat', { message }, (res) => {
      if (!res?.ok) toast(res?.error || 'Message not sent.', 'error');
    });
    el.chatInput.value = '';
  });

  window.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (event.key === 'Escape') document.activeElement.blur();
      return;
    }
    const key = event.key.toLowerCase();
    if (key === 'r') rotateShip();
    if (key === 'v') toggleView();
    if (key === 'escape') {
      if (app.chatOpen) setChatOpen(false);
      else if (placementEditable()) {
        app.placement.selected = null;
        renderAll();
      }
      app.aim = null;
    }
    if (key === 'enter' && app.code) {
      event.preventDefault();
      setChatOpen(true);
      el.chatInput.focus();
    }
  });

  scene.on('hover', (cell) => {
    const same = cell && app.hover && cell.board === app.hover.board && cell.x === app.hover.x && cell.y === app.hover.y;
    if (same || (!cell && !app.hover)) return;
    app.hover = cell;
    if (app.snap) renderCursor();
  });
  scene.on('click', (cell, event) => {
    const s = app.snap;
    if (!s) return;
    if (placementEditable()) handlePlacementClick(cell, event);
    else if (s.phase === 'battle') handleBattleClick(cell, event);
  });
  scene.on('rotate', rotateShip);

  syncMuteButton();
}

function bindSocket() {
  socket.on('connect', () => {
    el.net.hidden = true;
    const saved = store('session', 'battleship:room');
    if (!saved) return;
    socket.emit('room:resume', { code: saved, token }, (res) => {
      if (res?.ok) {
        if (app.code !== res.code) {
          el.chatLog.innerHTML = '';
          enterRoom(res.code);
        }
      } else if (app.code) {
        exitRoom('That battle has ended. Host or join a new game.');
      } else {
        store('session', 'battleship:room', null);
      }
    });
  });
  socket.on('disconnect', () => {
    if (app.code) el.net.hidden = false;
  });

  socket.on('state', (snap) => {
    if (!app.code) return;
    onState(snap);
  });

  socket.on('shot', (ev) => {
    if (!app.code) return;
    const board = ev.by === 'you' ? 'enemy' : 'self';
    scene.markPending(board, ev.x, ev.y);
    if (ev.sunkShip) app.holdSunk.add(`${board}:${ev.sunkShip.name}`);
    app.queue.push({ ...ev, board });
    processQueue();
  });

  socket.on('chatHistory', (entries) => {
    el.chatLog.innerHTML = '';
    entries.forEach((entry) => addChat(entry, { quiet: true }));
  });
  socket.on('chat', (entry) => {
    if (!app.code) return;
    addChat(entry);
  });
}

bindUi();
bindSocket();
startDemo();

// Test hook: `?debug` exposes internals for automated browser tests.
if (new URLSearchParams(location.search).has('debug')) {
  window.battleship = { app, scene };
}
