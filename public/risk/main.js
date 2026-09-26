import { store } from '../shared/room-client.js';
import { setupTable, bigText, toast, sound } from '../shared/table-ui.js';
import { RiskBoard3D } from './board3d.js';

const MAP = window.RiskMap;
const T = MAP.territories;
const BY_ID = Object.fromEntries(T.map((t) => [t.id, t]));
const CONT = Object.fromEntries(MAP.continents.map((c) => [c.id, c]));
const NEUTRAL = '#8a8f98';
const SVGNS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const el = {
  map: $('map'),
  canvas3d: $('board3d'),
  viewButtons: [...document.querySelectorAll('[data-view]')],
  mapWrap: $('mapWrap'),
  playerStrip: $('playerStrip'),
  battle: $('battle'),
  battleTitle: $('battleTitle'),
  battleSub: $('battleSub'),
  attDice: $('attDice'),
  defDice: $('defDice'),
  hoverTip: $('hoverTip'),
  status: $('status'),
  statusTitle: $('statusTitle'),
  statusSub: $('statusSub'),
  steps: $('steps'),
  waitingBox: $('waitingBox'),
  lobbyPlayers: $('lobbyPlayers'),
  rulesBox: $('rulesBox'),
  startBtn: $('startBtn'),
  startNote: $('startNote'),
  actionBox: $('actionBox'),
  actionText: $('actionText'),
  countRow: $('countRow'),
  countRange: $('countRange'),
  countMinus: $('countMinus'),
  countPlus: $('countPlus'),
  countOut: $('countOut'),
  diceRow: $('diceRow'),
  primaryBtn: $('primaryBtn'),
  secondaryBtn: $('secondaryBtn'),
  tertiaryBtn: $('tertiaryBtn'),
  cardsBox: $('cardsBox'),
  cards: $('cards'),
  tradeInfo: $('tradeInfo'),
  tradeBtn: $('tradeBtn'),
  continentsBox: $('continentsBox'),
  continents: $('continents'),
  logBox: $('logBox'),
  log: $('log'),
  gameOver: $('gameOver'),
  goKicker: $('goKicker'),
  goTitle: $('goTitle'),
  goReason: $('goReason'),
  goStats: $('goStats'),
  rematchBtn: $('rematchBtn'),
  rematchNote: $('rematchNote'),
  namesToggle: $('namesToggle'),
};

const prefs = (() => {
  const defaults = { names: true, view: '3d' };
  try {
    return { ...defaults, ...JSON.parse(store('local', 'risk:prefs') || '{}') };
  } catch {
    return defaults;
  }
})();

let board3d = null;

const view = {
  snap: null,
  staged: {}, // territory -> armies staged for setup/reinforce
  selected: null,
  target: null,
  dice: 3,
  count: 1,
  pickedCards: new Set(),
  pending: false,
  shownArmies: {},
  shownOwner: {},
  battleQueue: [],
  battleBusy: false,
  overShownRound: null,
  lastTurnKey: null,
  logSeen: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mySeat = () => (view.snap && !view.snap.spectator ? view.snap.seat : null);
const seatInfo = (seat) => view.snap?.seats?.find((s) => s.seat === seat) || null;
const colorOf = (seat) => (seat === null || seat === undefined ? NEUTRAL : seatInfo(seat)?.color || NEUTRAL);
const nameOf = (seat) => (seat === null || seat === undefined ? 'Neutral' : seat === mySeat() ? 'You' : seatInfo(seat)?.name || '?');
const isMyTurn = () => {
  const s = view.snap;
  return Boolean(s && s.phase === 'playing' && s.stage === 'turns' && !s.spectator && s.turn === s.seat);
};
const inSetup = () => {
  const s = view.snap;
  return Boolean(s && s.phase === 'playing' && s.stage === 'setup' && !s.spectator && s.setupLeft > 0);
};
const stagedTotal = () => Object.values(view.staged).reduce((a, b) => a + b, 0);
const placeBudget = () => (inSetup() ? view.snap.setupLeft : isMyTurn() && view.snap.turnPhase === 'reinforce' ? view.snap.reinforcements : 0);
const placing = () => inSetup() || (isMyTurn() && view.snap.turnPhase === 'reinforce');

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  const t = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  r = Math.round((t - r) * p + r);
  g = Math.round((t - g) * p + g);
  b = Math.round((t - b) * p + b);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function svg(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVGNS, tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  parent?.appendChild(node);
  return node;
}

// Territories reachable for fortifying from `from`.
function fortifyTargets(from) {
  const s = view.snap;
  const me = s.seat;
  if (s.options.fortify === 'adjacent') return new Set(BY_ID[from].adj.filter((n) => s.owner[n] === me));
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const t = queue.shift();
    BY_ID[t].adj.forEach((n) => {
      if (!seen.has(n) && s.owner[n] === me) {
        seen.add(n);
        queue.push(n);
      }
    });
  }
  seen.delete(from);
  return seen;
}

// ---------------------------------------------------------------------------
// Map construction
// ---------------------------------------------------------------------------

const nodes = {}; // territory -> { path, badge, circle, text, plus, label }

function buildMap() {
  const m = el.map;
  m.innerHTML = '';
  const defs = svg('defs', {}, m);
  defs.innerHTML = `
    <radialGradient id="ocean" cx="50%" cy="45%" r="75%">
      <stop offset="0%" stop-color="#1d4a6b"/>
      <stop offset="70%" stop-color="#11304a"/>
      <stop offset="100%" stop-color="#0a1c2c"/>
    </radialGradient>
    <pattern id="waves" width="36" height="18" patternUnits="userSpaceOnUse">
      <path d="M0 9 Q9 3 18 9 T36 9" fill="none" stroke="rgba(160,210,255,0.07)" stroke-width="1"/>
    </pattern>
    <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
      <path d="M50 0H0V50" fill="none" stroke="rgba(160,210,255,0.06)" stroke-width="0.6"/>
    </pattern>
    <filter id="landShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="3" stdDeviation="3.5" flood-color="#000" flood-opacity="0.55"/>
    </filter>
    <filter id="paper" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.16 0"/>
      <feComposite in2="SourceGraphic" operator="in"/>
    </filter>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <marker id="arrowHead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M0 0L10 5L0 10z" fill="#ffd166"/>
    </marker>`;
  svg('rect', { width: 1000, height: 600, fill: 'url(#ocean)' }, m);
  svg('rect', { width: 1000, height: 600, fill: 'url(#waves)' }, m);
  svg('rect', { width: 1000, height: 600, fill: 'url(#grid)' }, m);

  // Sea routes (dashed); Alaska–Kamchatka wraps around the edges.
  const links = svg('g', { class: 'rk-links' }, m);
  MAP.links.forEach(([a, b]) => {
    const A = BY_ID[a].label;
    const B = BY_ID[b].label;
    if (Math.abs(A[0] - B[0]) > 500) {
      const [west, east] = A[0] < B[0] ? [A, B] : [B, A];
      svg('line', { x1: west[0], y1: west[1], x2: 0, y2: west[1] - 6 }, links);
      svg('line', { x1: east[0], y1: east[1], x2: 1000, y2: east[1] - 6 }, links);
    } else {
      svg('line', { x1: A[0], y1: A[1], x2: B[0], y2: B[1] }, links);
    }
  });

  // Continent outlines under the territories.
  const land = svg('g', { class: 'rk-land', filter: 'url(#landShadow)' }, m);
  MAP.continents.forEach((c) => {
    svg('path', { d: c.path, fill: shade(c.color, -0.55), stroke: c.color, 'stroke-width': 5, 'stroke-linejoin': 'round' }, land);
  });

  const terrs = svg('g', { class: 'rk-terrs' }, m);
  T.forEach((t) => {
    const path = svg('path', { d: t.path, class: 'rk-t', 'data-id': t.id }, terrs);
    nodes[t.id] = { path };
  });
  // Paper grain over the land.
  const grain = svg('g', { filter: 'url(#paper)', 'pointer-events': 'none' }, m);
  MAP.continents.forEach((c) => svg('path', { d: c.path, fill: '#fff' }, grain));

  svg('g', { id: 'fxUnder' }, m);
  const labels = svg('g', { class: 'rk-names', 'pointer-events': 'none' }, m);
  const badges = svg('g', { class: 'rk-badges', 'pointer-events': 'none' }, m);
  T.forEach((t) => {
    const [x, y] = t.label;
    const name = svg('text', { x, y: y + 20, class: 'rk-name' }, labels);
    name.textContent = t.name;
    const g = svg('g', { class: 'rk-badge', transform: `translate(${x} ${y})` }, badges);
    const circle = svg('circle', { r: 11 }, g);
    const text = svg('text', { y: 4 }, g);
    const plus = svg('g', { class: 'rk-plus', transform: 'translate(12 -11)' }, g);
    svg('circle', { r: 8 }, plus);
    const plusText = svg('text', { y: 3.5 }, plus);
    nodes[t.id] = { ...nodes[t.id], badge: g, circle, text, plus, plusText, name };
  });
  svg('g', { id: 'fx' }, m);
  el.map.classList.toggle('hide-names', !prefs.names);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderMap() {
  const s = view.snap;
  if (!s) return;
  const me = mySeat();
  const selectable = selectableSet();
  const targets = targetSet();
  const list3d = [];
  T.forEach((t) => {
    const n = nodes[t.id];
    const owner = s.owner[t.id];
    const color = owner === undefined ? shade(CONT[t.continent].color, -0.35) : colorOf(owner);
    n.path.style.fill = color;
    n.path.classList.toggle('mine', owner === me && me !== null);
    n.path.classList.toggle('selectable', selectable.has(t.id));
    n.path.classList.toggle('target', targets.has(t.id));
    n.path.classList.toggle('selected', view.selected === t.id);
    n.path.classList.toggle('targeted', view.target === t.id);
    const dim = Boolean((view.selected || placing()) && selectable.size) && !selectable.has(t.id) && !targets.has(t.id) && view.selected !== t.id;
    n.path.classList.toggle('dim', dim);

    const armies = (s.armies[t.id] ?? 0) + (view.staged[t.id] || 0);
    n.circle.style.fill = owner === undefined ? '#333' : shade(color, -0.25);
    n.circle.style.stroke = owner === undefined ? '#777' : shade(color, 0.55);
    n.text.textContent = owner === undefined ? '' : String(armies);
    n.badge.classList.toggle('big', armies >= 10);
    const staged = view.staged[t.id] || 0;
    n.plus.style.display = staged ? '' : 'none';
    n.plusText.textContent = `+${staged}`;
    list3d.push({
      id: t.id,
      color,
      armies,
      staged,
      owned: owner !== undefined,
      selected: view.selected === t.id,
      target: targets.has(t.id),
      targeted: view.target === t.id,
      selectable: selectable.has(t.id),
      dim,
      hl: view.hlContinent === t.continent,
    });
    // Pop the badge when armies change.
    const prevArmies = view.shownArmies[t.id];
    if (prevArmies !== undefined && prevArmies !== s.armies[t.id]) {
      n.badge.classList.remove('pop');
      void n.badge.getBoundingClientRect();
      n.badge.classList.add('pop');
    }
    if (view.shownOwner[t.id] !== undefined && view.shownOwner[t.id] !== owner) {
      n.path.classList.remove('flip');
      void n.path.getBoundingClientRect();
      n.path.classList.add('flip');
    }
  });
  view.shownArmies = { ...s.armies };
  view.shownOwner = { ...s.owner };
  board3d?.update(list3d);
  renderArrow();
}

function renderArrow() {
  const fx = document.getElementById('fxUnder');
  fx.innerHTML = '';
  board3d?.setArrow(view.selected && view.target ? view.selected : null, view.target, view.snap?.turnPhase === 'fortify');
  if (!view.selected || !view.target) return;
  const A = BY_ID[view.selected].label;
  const B = BY_ID[view.target].label;
  const dx = B[0] - A[0];
  const dy = B[1] - A[1];
  const len = Math.hypot(dx, dy);
  if (len < 1 || len > 500) return;
  const ux = dx / len;
  const uy = dy / len;
  const mx = (A[0] + B[0]) / 2 - uy * len * 0.18;
  const my = (A[1] + B[1]) / 2 + ux * len * 0.18;
  svg('path', {
    d: `M${A[0] + ux * 13} ${A[1] + uy * 13} Q${mx} ${my} ${B[0] - ux * 15} ${B[1] - uy * 15}`,
    class: `rk-arrow ${view.snap.turnPhase === 'fortify' ? 'friendly' : ''}`,
    'marker-end': 'url(#arrowHead)',
  }, fx);
}

// Territories the player can click right now.
function selectableSet() {
  const s = view.snap;
  const me = mySeat();
  const out = new Set();
  if (!s || s.phase !== 'playing' || me === null) return out;
  const mine = T.filter((t) => s.owner[t.id] === me).map((t) => t.id);
  if (placing()) mine.forEach((t) => out.add(t));
  else if (isMyTurn() && s.turnPhase === 'attack') {
    mine.filter((t) => s.armies[t] > 1 && BY_ID[t].adj.some((n) => s.owner[n] !== me)).forEach((t) => out.add(t));
  } else if (isMyTurn() && s.turnPhase === 'fortify') {
    mine.filter((t) => s.armies[t] > 1 && fortifyTargets(t).size).forEach((t) => out.add(t));
  }
  return out;
}

function targetSet() {
  const s = view.snap;
  const me = mySeat();
  if (!view.selected || !isMyTurn()) return new Set();
  if (s.turnPhase === 'attack') return new Set(BY_ID[view.selected].adj.filter((n) => s.owner[n] !== me));
  if (s.turnPhase === 'fortify') return fortifyTargets(view.selected);
  return new Set();
}

function renderPlayers() {
  const s = view.snap;
  el.playerStrip.innerHTML = '';
  if (s.phase === 'lobby') return;
  s.seats.forEach((p) => {
    const chip = document.createElement('div');
    chip.className = 'rk-player';
    chip.style.setProperty('--pc', p.color);
    chip.classList.toggle('turn', s.stage === 'turns' && s.phase === 'playing' && p.seat === s.turn);
    chip.classList.toggle('me', p.seat === mySeat());
    chip.classList.toggle('out', p.eliminated || p.left);
    const name = document.createElement('span');
    name.className = 'pname';
    name.textContent = p.name + (p.seat === mySeat() ? ' (you)' : '');
    const meta = document.createElement('span');
    meta.className = 'meta';
    if (p.left) meta.textContent = 'left';
    else if (p.eliminated) meta.textContent = 'eliminated';
    else if (s.stage === 'setup') meta.textContent = p.ready ? 'deployed ✓' : 'deploying…';
    else meta.textContent = `${p.territories} lands · ${p.armies} armies · ${p.cards} cards${p.connected ? '' : ' · offline'}`;
    chip.append(name, meta);
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
  el.rulesBox.querySelectorAll('[data-option]').forEach((group) => {
    group.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', s.options[group.dataset.option] === b.dataset.value);
      b.disabled = !s.isHost;
    });
  });
  const count = s.players.filter(Boolean).length;
  el.startBtn.hidden = !s.isHost;
  el.startBtn.disabled = count < s.minPlayers;
  el.startBtn.textContent = count < s.minPlayers ? 'Start game' : `Start with ${count} players`;
  el.startNote.textContent = s.isHost
    ? count < s.minPlayers
      ? 'Share the code — you need at least one opponent.'
      : `Up to ${s.maxPlayers} players. Start when everyone's in.`
    : `Waiting for ${s.players[hostSeat]?.name || 'the host'} to start the game…`;
}

function renderStatus() {
  const s = view.snap;
  let title = '';
  let sub = '';
  const turnName = seatInfo(s.turn)?.name || '';
  if (s.phase === 'lobby') {
    title = 'Assembling armies';
    sub = `${s.players.filter(Boolean).length} of ${s.maxPlayers} commanders`;
  } else if (s.phase === 'over') {
    title = 'War is over';
    sub = 'Tap here to see the result again.';
  } else if (s.stage === 'setup') {
    title = 'Deploy your armies';
    const waiting = s.seats.filter((p) => !p.ready && !p.left && !p.eliminated).map((p) => p.name);
    sub = inSetup()
      ? `Tap your territories to place ${s.setupLeft - stagedTotal()} more.`
      : waiting.length
        ? `Waiting for ${waiting.join(', ')}…`
        : 'Starting…';
  } else if (isMyTurn()) {
    title = 'Your turn';
    sub = {
      reinforce: `Place ${s.reinforcements - stagedTotal()} reinforcements on your territories.`,
      attack: 'Tap one of your territories, then an enemy next to it.',
      occupy: 'Choose how many armies move into your new territory.',
      fortify: 'Move armies once between your territories, or end your turn.',
    }[s.turnPhase];
  } else {
    title = `${turnName}'s turn`;
    sub = {
      reinforce: 'Reinforcing…',
      attack: 'Attacking…',
      occupy: 'Moving in…',
      fortify: 'Fortifying…',
    }[s.turnPhase];
    if (s.spectator) sub += ' You are watching.';
  }
  const goalHint = { half: 'Goal: first to 24 territories.', continents: 'Goal: first to hold 3 continents.' }[s.goal];
  if (goalHint && s.phase === 'playing') sub = `${sub} ${goalHint}`;
  el.statusTitle.textContent = title;
  el.statusSub.textContent = sub;
  el.status.classList.toggle('mine', isMyTurn() || inSetup());
  el.status.style.setProperty('--pc', s.stage === 'turns' ? colorOf(s.turn) : 'transparent');

  el.steps.hidden = !(s.phase === 'playing' && s.stage === 'turns');
  const step = s.turnPhase === 'occupy' ? 'attack' : s.turnPhase;
  el.steps.querySelectorAll('li').forEach((li) => {
    li.classList.toggle('active', li.dataset.step === step);
    li.classList.toggle('done', ['reinforce', 'attack', 'fortify'].indexOf(li.dataset.step) < ['reinforce', 'attack', 'fortify'].indexOf(step));
  });
}

function setButtons(primary, secondary, tertiary) {
  [[el.primaryBtn, primary], [el.secondaryBtn, secondary], [el.tertiaryBtn, tertiary]].forEach(([btn, cfg]) => {
    btn.hidden = !cfg;
    if (!cfg) return;
    btn.textContent = cfg.label;
    btn.disabled = Boolean(cfg.disabled) || view.pending;
    btn.onclick = cfg.onClick;
  });
}

function showCount(min, max, value) {
  el.countRow.hidden = false;
  el.countRange.min = min;
  el.countRange.max = max;
  view.count = Math.max(min, Math.min(max, value));
  el.countRange.value = view.count;
  el.countOut.textContent = view.count;
  el.countRange.disabled = min === max;
}

function renderAction() {
  const s = view.snap;
  el.countRow.hidden = true;
  el.diceRow.hidden = true;
  let show = s.phase === 'playing' && !s.spectator;
  if (!show) {
    el.actionBox.hidden = true;
    return;
  }
  const me = mySeat();
  if (placing()) {
    const budget = placeBudget();
    const left = budget - stagedTotal();
    const where = Object.entries(view.staged).filter(([, n]) => n > 0);
    el.actionText.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'rk-big-num';
    head.innerHTML = `<strong>${left}</strong> <span>to place</span>`;
    el.actionText.appendChild(head);
    if (s.stage === 'turns' && s.turnPhase === 'reinforce') {
      const r = seatInfo(me);
      const detail = document.createElement('p');
      detail.className = 'muted small';
      const bonusNames = (s.bonuses || []).map((c) => `${CONT[c].name} +${CONT[c].bonus}`);
      detail.textContent = `${r.territories} territories → ${Math.max(3, Math.floor(r.territories / 3))}${bonusNames.length ? ` · ${bonusNames.join(' · ')}` : ''}${s.reinforcements > r.income ? ' · cards' : ''}`;
      el.actionText.appendChild(detail);
    }
    if (where.length) {
      const list = document.createElement('p');
      list.className = 'rk-staged small';
      list.textContent = where.map(([t, n]) => `${BY_ID[t].name} +${n}`).join(' · ');
      el.actionText.appendChild(list);
    }
    const tip = document.createElement('p');
    tip.className = 'muted small';
    tip.textContent = 'Tap to add one · right-click or long-press to remove';
    el.actionText.appendChild(tip);
    const mustTrade = s.mustTrade;
    setButtons(
      {
        label: s.stage === 'setup' ? 'Deploy armies' : 'Confirm reinforcements',
        disabled: left !== 0 || mustTrade,
        onClick: confirmPlacement,
      },
      { label: 'Auto-place', disabled: left === 0, onClick: autoPlace },
      { label: 'Undo all', disabled: !where.length, onClick: () => ((view.staged = {}), renderAll()) }
    );
    if (mustTrade) {
      const warn = document.createElement('p');
      warn.className = 'rk-warn small';
      warn.textContent = 'You hold 5 or more cards — trade a set before placing.';
      el.actionText.appendChild(warn);
    }
    el.actionBox.hidden = false;
    return;
  }
  if (!isMyTurn()) {
    el.actionBox.hidden = true;
    return;
  }
  el.actionBox.hidden = false;
  if (s.turnPhase === 'occupy') {
    const pm = s.pendingMove;
    el.actionText.textContent = `Move armies from ${BY_ID[pm.from].name} into ${BY_ID[pm.to].name}.`;
    showCount(pm.min, pm.max, view.count >= pm.min && view.count <= pm.max ? view.count : pm.max);
    setButtons({ label: 'Move in', onClick: () => send('risk:occupy', { count: view.count }) }, null, null);
    return;
  }
  if (s.turnPhase === 'attack') {
    if (view.selected && view.target) {
      const a = s.armies[view.selected];
      const d = s.armies[view.target];
      el.actionText.innerHTML = '';
      const line = document.createElement('div');
      line.className = 'rk-vsline';
      line.innerHTML = `<span style="--pc:${colorOf(me)}">${BY_ID[view.selected].name} <b>${a}</b></span><i>⚔</i><span style="--pc:${colorOf(s.owner[view.target])}">${BY_ID[view.target].name} <b>${d}</b></span>`;
      el.actionText.appendChild(line);
      el.diceRow.hidden = false;
      const maxDice = Math.min(3, a - 1);
      el.diceRow.querySelectorAll('[data-dice]').forEach((b) => {
        const n = Number(b.dataset.dice);
        b.disabled = n > maxDice || view.pending;
        b.classList.toggle('btn-primary', n === Math.min(maxDice, 3));
        b.classList.toggle('btn-secondary', n !== Math.min(maxDice, 3));
      });
      setButtons(
        { label: 'Blitz ⚡', onClick: () => attack(true) },
        { label: 'Cancel', onClick: () => ((view.target = null), renderAll()) },
        { label: 'End attacks', onClick: () => send('risk:endAttack') }
      );
      return;
    }
    el.actionText.textContent = view.selected
      ? `Attacking from ${BY_ID[view.selected].name}. Tap a glowing enemy territory.`
      : 'Pick one of your glowing territories to attack from.';
    setButtons(
      { label: 'End attacks', onClick: () => send('risk:endAttack') },
      view.selected ? { label: 'Cancel', onClick: () => ((view.selected = null), renderAll()) } : null,
      null
    );
    return;
  }
  if (s.turnPhase === 'fortify') {
    if (view.selected && view.target) {
      el.actionText.textContent = `Move armies from ${BY_ID[view.selected].name} to ${BY_ID[view.target].name}. This ends your turn.`;
      showCount(1, s.armies[view.selected] - 1, s.armies[view.selected] - 1);
      setButtons(
        { label: 'Fortify & end turn', onClick: () => send('risk:fortify', { from: view.selected, to: view.target, count: view.count }) },
        { label: 'Cancel', onClick: () => ((view.target = null), renderAll()) },
        null
      );
      return;
    }
    el.actionText.textContent = view.selected
      ? `Move from ${BY_ID[view.selected].name}: tap one of your highlighted territories.`
      : s.options.fortify === 'adjacent'
        ? 'Optionally move armies to a neighbouring territory of yours.'
        : 'Optionally move armies along a chain of your territories.';
    setButtons(
      { label: s.conquered ? 'End turn & take a card' : 'End turn', onClick: () => send('risk:endTurn') },
      view.selected ? { label: 'Cancel', onClick: () => ((view.selected = null), renderAll()) } : null,
      null
    );
    return;
  }
  el.actionBox.hidden = true;
}

const CARD_ICON = {
  infantry: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2.6"/><path d="M8 22l1.5-8L7 11l2-3h6l2 3-2.5 3L16 22h-2.5L12 16l-1.5 6z"/></svg>',
  cavalry: '<svg viewBox="0 0 24 24"><path d="M4 20l2-6 2-2 1-4 3-3h3l1 2 3 1-1 2-3-.5-1 3 3 2 1 5h-2l-1-3-4-1-2 2-1 2z"/></svg>',
  artillery: '<svg viewBox="0 0 24 24"><circle cx="8" cy="17" r="4"/><circle cx="8" cy="17" r="1.3" fill="#1b1410"/><path d="M9 13l12-7 1.3 2.2L11 15z"/><path d="M2 21h13"/></svg>',
  wild: '<svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.3 5.9 20.6l1.4-6.8L2.2 9.1l6.9-.8z"/></svg>',
};

function validSet(cards) {
  if (cards.length !== 3) return false;
  if (cards.some((c) => c.type === 'wild')) return true;
  const types = new Set(cards.map((c) => c.type));
  return types.size === 1 || types.size === 3;
}

function renderCards() {
  const s = view.snap;
  const cards = s.myCards || [];
  el.cardsBox.hidden = s.phase === 'lobby' || s.spectator || s.stage !== 'turns';
  if (el.cardsBox.hidden) return;
  el.tradeInfo.textContent = s.options.cards === 'fixed' ? 'sets: 4 / 6 / 8 · mixed 10' : `next set: ${s.nextTrade} armies`;
  view.pickedCards.forEach((id) => {
    if (!cards.some((c) => c.id === id)) view.pickedCards.delete(id);
  });
  el.cards.innerHTML = '';
  if (!cards.length) {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = 'Conquer a territory on your turn to earn a card.';
    el.cards.appendChild(p);
  }
  const canTrade = isMyTurn() && s.turnPhase === 'reinforce';
  cards.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `rk-card ${c.type}`;
    b.classList.toggle('picked', view.pickedCards.has(c.id));
    const owned = c.territory && s.owner[c.territory] === mySeat();
    b.innerHTML = `${CARD_ICON[c.type]}<span class="t">${c.territory ? BY_ID[c.territory].name : 'Wild'}</span><span class="k">${c.type}${owned ? ' · +2' : ''}</span>`;
    b.disabled = !canTrade;
    b.addEventListener('click', () => {
      if (view.pickedCards.has(c.id)) view.pickedCards.delete(c.id);
      else if (view.pickedCards.size < 3) view.pickedCards.add(c.id);
      sound.click();
      renderCards();
    });
    el.cards.appendChild(b);
  });
  const picked = cards.filter((c) => view.pickedCards.has(c.id));
  el.tradeBtn.hidden = !canTrade || cards.length < 3;
  el.tradeBtn.disabled = !validSet(picked) || view.pending;
  el.tradeBtn.textContent = picked.length === 3 && !validSet(picked) ? 'Not a valid set' : 'Trade set';
}

function renderContinents() {
  const s = view.snap;
  el.continentsBox.hidden = s.phase === 'lobby';
  if (el.continentsBox.hidden) return;
  el.continents.innerHTML = '';
  MAP.continents.forEach((c) => {
    const owners = new Set(c.territories.map((t) => s.owner[t]));
    const holder = owners.size === 1 ? [...owners][0] : undefined;
    const mine = c.territories.filter((t) => s.owner[t] === mySeat()).length;
    const li = document.createElement('li');
    li.style.setProperty('--cc', c.color);
    li.innerHTML = `<i></i><span class="n">${c.name}</span><span class="b">+${c.bonus}</span>`;
    const tag = document.createElement('span');
    tag.className = 'h';
    if (holder !== undefined && holder !== null) {
      tag.textContent = nameOf(holder);
      tag.style.color = colorOf(holder);
    } else if (mySeat() !== null) {
      tag.textContent = `${mine}/${c.territories.length}`;
    }
    li.appendChild(tag);
    li.addEventListener('mouseenter', () => highlightContinent(c.id, true));
    li.addEventListener('mouseleave', () => highlightContinent(c.id, false));
    el.continents.appendChild(li);
  });
}

function highlightContinent(id, on) {
  view.hlContinent = on ? id : null;
  if (board3d) renderMap();
  CONT[id].territories.forEach((t) => nodes[t].path.classList.toggle('continent-hl', on));
}

function renderLog() {
  const s = view.snap;
  el.logBox.hidden = s.phase === 'lobby' || !s.log?.length;
  if (el.logBox.hidden) return;
  el.log.innerHTML = '';
  [...s.log].reverse().slice(0, 12).forEach((e) => {
    const li = document.createElement('li');
    const who = (seat) => `<b style="color:${colorOf(seat)}">${nameOf(seat)}</b>`;
    if (e.type === 'battle') {
      li.innerHTML = `${who(e.seat)} attacked ${BY_ID[e.to].name} from ${BY_ID[e.from].name}: −${e.attackerLost} / −${e.defenderLost}${e.conquered ? ' — <strong>conquered</strong>' : ''}`;
    } else if (e.type === 'reinforce') {
      li.innerHTML = `${who(e.seat)} reinforced with ${e.total} armies`;
    } else if (e.type === 'trade') {
      li.innerHTML = `${who(e.seat)} traded cards for ${e.value} armies`;
    } else if (e.type === 'fortify') {
      li.innerHTML = `${who(e.seat)} moved ${e.count} from ${BY_ID[e.from].name} to ${BY_ID[e.to].name}`;
    } else if (e.type === 'eliminated') {
      li.innerHTML = `${who(e.by)} eliminated ${who(e.seat)}!`;
      li.className = 'big';
    } else if (e.type === 'left') {
      li.innerHTML = `${who(e.seat)} left the war`;
    }
    el.log.appendChild(li);
  });
}

function renderGameOver() {
  const s = view.snap;
  if (s.phase !== 'over') {
    el.gameOver.hidden = true;
    return;
  }
  const me = mySeat();
  const w = s.winner;
  el.goKicker.textContent =
    { domination: 'World domination', 'goal-half': 'Half the world', 'goal-continents': 'Three continents' }[s.endReason] || 'Victory';
  el.goTitle.textContent = w === null || w === undefined ? 'Stalemate' : w === me ? 'You win!' : `${seatInfo(w)?.name} wins`;
  el.goReason.textContent =
    s.endReason === 'domination'
      ? 'Every territory on the map is under one flag.'
      : s.endReason === 'last-standing'
        ? 'The last commander standing.'
        : s.endReason === 'goal-half'
          ? 'First to hold 24 territories.'
          : s.endReason === 'goal-continents'
            ? 'First to hold three whole continents.'
            : '';
  el.goStats.innerHTML = '';
  [...s.seats]
    .sort((a, b) => b.territories - a.territories)
    .forEach((p) => {
      const li = document.createElement('li');
      li.style.setProperty('--pc', p.color);
      li.innerHTML = `<i></i><span>${p.name}</span><span class="muted">${p.left ? 'left' : p.eliminated ? 'eliminated' : `${p.territories} territories`}</span>`;
      el.goStats.appendChild(li);
    });
  renderRematch();
  if (view.overShownRound !== s.round) {
    view.overShownRound = s.round;
    setTimeout(() => {
      if (view.snap?.phase !== 'over') return;
      el.gameOver.hidden = false;
      if (s.spectator || w === me) sound.victory();
      else sound.defeat();
    }, 1600);
  }
}

function renderRematch() {
  const s = view.snap;
  const count = s.players.filter(Boolean).length;
  const votes = s.rematchVotes || [];
  el.rematchBtn.hidden = s.spectator;
  el.rematchBtn.classList.remove('pulse');
  if (s.spectator) {
    el.rematchNote.textContent = 'Stick around — the players may start another war.';
  } else if (count < s.minPlayers) {
    el.rematchBtn.textContent = 'Reopen the room';
    el.rematchBtn.disabled = false;
    el.rematchNote.textContent = 'Everyone else left. Reopen and share the code again.';
  } else if (s.isHost) {
    el.rematchBtn.textContent = `New war with ${count} players`;
    el.rematchBtn.disabled = false;
    el.rematchNote.textContent = votes.length ? `${votes.length} of ${count} ready.` : 'Start whenever everyone is ready.';
  } else if (votes.includes(s.seat)) {
    el.rematchBtn.textContent = 'Ready ✓';
    el.rematchBtn.disabled = true;
    el.rematchNote.textContent = 'Waiting for the host to start…';
  } else {
    el.rematchBtn.textContent = "I'm ready for another";
    el.rematchBtn.disabled = false;
    el.rematchBtn.classList.add('pulse');
    el.rematchNote.textContent = `${votes.length} of ${count} ready.`;
  }
}

function renderAll() {
  const s = view.snap;
  if (!s) return;
  renderMap();
  renderPlayers();
  renderLobby();
  renderStatus();
  renderAction();
  renderCards();
  renderContinents();
  renderLog();
  renderGameOver();
}

// ---------------------------------------------------------------------------
// Battles
// ---------------------------------------------------------------------------

function floatText(tid, text, cls) {
  const [x, y] = BY_ID[tid].label;
  const g = svg('text', { x, y: y - 14, class: `rk-float ${cls}` }, document.getElementById('fx'));
  g.textContent = text;
  setTimeout(() => g.remove(), 1300);
  board3d?.floatText(tid, text);
}

function dieFace(value, cls) {
  const d = document.createElement('div');
  d.className = `rk-die ${cls}`;
  d.dataset.v = value;
  for (let i = 0; i < 9; i += 1) d.appendChild(document.createElement('i'));
  return d;
}

async function playBattle(b) {
  const round = b.rounds[b.rounds.length - 1];
  if (!round) return;
  const att = seatInfo(b.attacker);
  el.battleTitle.innerHTML = `<b style="color:${colorOf(b.attacker)}">${nameOf(b.attacker)}</b> ${BY_ID[b.from].name} → ${BY_ID[b.to].name}`;
  el.battleSub.textContent = '';
  el.attDice.replaceChildren(...round.a.map((v) => dieFace(1, 'att rolling')));
  el.defDice.replaceChildren(...round.d.map((v) => dieFace(1, 'def rolling')));
  el.battle.hidden = false;
  el.battle.classList.remove('out');
  sound.fire();
  const faces = [...el.battle.querySelectorAll('.rk-die')];
  for (let i = 0; i < 6; i += 1) {
    faces.forEach((f) => (f.dataset.v = 1 + Math.floor(Math.random() * 6)));
    await wait(70);
  }
  [...el.attDice.children].forEach((f, i) => {
    f.classList.remove('rolling');
    f.dataset.v = round.a[i];
  });
  [...el.defDice.children].forEach((f, i) => {
    f.classList.remove('rolling');
    f.dataset.v = round.d[i];
  });
  // Mark which dice won each comparison.
  for (let i = 0; i < Math.min(round.a.length, round.d.length); i += 1) {
    const attWon = round.a[i] > round.d[i];
    el.attDice.children[i].classList.add(attWon ? 'win' : 'lose');
    el.defDice.children[i].classList.add(attWon ? 'lose' : 'win');
  }
  sound.clack();
  if (b.attackerLost) floatText(b.from, `−${b.attackerLost}`, 'loss');
  if (b.defenderLost) floatText(b.to, `−${b.defenderLost}`, 'loss');
  nodes[b.to].path.classList.add('hit');
  board3d?.hit(b.to);
  setTimeout(() => nodes[b.to].path.classList.remove('hit'), 500);
  el.battleSub.textContent =
    b.totalRounds > 1
      ? `Blitz · ${b.totalRounds} rolls · attacker −${b.attackerLost}, defender −${b.defenderLost}`
      : `Attacker −${b.attackerLost} · defender −${b.defenderLost}`;
  if (b.conquered) {
    sound.explosion(true);
    await wait(250);
    bigText('CONQUERED', `${BY_ID[b.to].name} falls to ${att?.name || '?'}`, 'hit');
  } else if (b.attackerLost > b.defenderLost) {
    sound.splash();
  } else {
    sound.explosion(false);
  }
  await wait(b.conquered ? 1200 : 900);
  el.battle.classList.add('out');
  await wait(250);
  el.battle.hidden = true;
}

async function runBattles() {
  if (view.battleBusy) return;
  view.battleBusy = true;
  while (view.battleQueue.length) await playBattle(view.battleQueue.shift());
  view.battleBusy = false;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function send(event, payload) {
  if (view.pending) return null;
  view.pending = true;
  renderAction();
  const res = await table.client.send(event, payload);
  view.pending = false;
  if (res.error) {
    toast(res.error, 'error');
    sound.error();
  }
  renderAll();
  return res;
}

async function confirmPlacement() {
  const s = view.snap;
  const placements = { ...view.staged };
  const res = await send(s.stage === 'setup' ? 'risk:setup' : 'risk:place', { placements });
  if (res && !res.error) {
    view.staged = {};
    sound.place();
    renderAll();
  }
}

function autoPlace() {
  const s = view.snap;
  const me = mySeat();
  const mine = T.filter((t) => s.owner[t.id] === me).map((t) => t.id);
  // Favour borders facing the most enemy armies.
  const threat = (t) => BY_ID[t].adj.filter((n) => s.owner[n] !== me).reduce((sum, n) => sum + (s.armies[n] || 0), 0);
  const border = mine.filter((t) => threat(t) > 0).sort((a, b) => threat(b) - threat(a));
  const pool = border.length ? border.slice(0, Math.max(3, Math.ceil(border.length / 2))) : mine;
  let left = placeBudget() - stagedTotal();
  let i = 0;
  while (left > 0) {
    const t = pool[i % pool.length];
    view.staged[t] = (view.staged[t] || 0) + 1;
    left -= 1;
    i += 1;
  }
  sound.clack();
  renderAll();
}

function attack(blitz) {
  const payload = { from: view.selected, to: view.target, dice: view.dice, blitz };
  send('risk:attack', payload).then((res) => {
    if (!res || res.error) return;
    const s = view.snap;
    if (res.battle?.conquered) {
      view.target = null;
      view.selected = s.turnPhase === 'occupy' ? view.selected : null;
    } else if (s.armies[view.selected] < 2) {
      view.selected = null;
      view.target = null;
    }
    renderAll();
  });
}

function onTerritoryClick(tid, remove = false) {
  const s = view.snap;
  if (!s || s.phase !== 'playing' || view.pending) return;
  const me = mySeat();
  if (placing()) {
    if (s.owner[tid] !== me) return;
    if (remove) {
      if (view.staged[tid]) {
        view.staged[tid] -= 1;
        if (!view.staged[tid]) delete view.staged[tid];
      }
    } else if (stagedTotal() < placeBudget()) {
      view.staged[tid] = (view.staged[tid] || 0) + 1;
      sound.clack();
    } else {
      toast('All armies placed — confirm, or right-click to take some back.');
    }
    renderAll();
    return;
  }
  if (!isMyTurn()) return;
  if (s.turnPhase === 'attack' || s.turnPhase === 'fortify') {
    if (view.selected && targetSet().has(tid)) {
      view.target = tid;
      sound.click();
    } else if (selectableSet().has(tid)) {
      view.selected = view.selected === tid ? null : tid;
      view.target = null;
      sound.click();
    } else {
      view.selected = null;
      view.target = null;
    }
    renderAll();
  }
}

// ---------------------------------------------------------------------------
// State updates
// ---------------------------------------------------------------------------

function announce(prev) {
  const s = view.snap;
  if (s.phase === 'playing' && prev?.phase !== 'playing') {
    bigText('TO WAR!', s.stage === 'setup' ? 'Deploy your starting armies' : 'The battle for the world begins', 'info');
    sound.joined();
  }
  const key = s.phase === 'playing' && s.stage === 'turns' ? `${s.round}:${s.turnNumber}` : null;
  if (key && key !== view.lastTurnKey && isMyTurn() && prev) {
    bigText('YOUR TURN', `${s.reinforcements} reinforcements`, 'info');
    sound.yourTurn();
  }
  if (key !== view.lastTurnKey) {
    view.selected = null;
    view.target = null;
    view.staged = {};
  }
  view.lastTurnKey = key;
  // Eliminations
  const log = s.log || [];
  if (view.logSeen !== null) {
    log.filter((e) => e.id > view.logSeen && e.type === 'eliminated').forEach((e) => {
      bigText('ELIMINATED', `${nameOf(e.seat)} ${e.seat === mySeat() ? 'are' : 'is'} out of the war`, 'sunk');
    });
  }
  view.logSeen = log.length ? log[log.length - 1].id : 0;
}

function onState(snap, prev) {
  view.snap = snap;
  if (!prev || prev.round !== snap.round) {
    view.shownArmies = {};
    view.shownOwner = {};
    view.staged = {};
    view.logSeen = null;
    view.selected = null;
    view.target = null;
  }
  // Drop a stale selection.
  if (view.selected && snap.owner?.[view.selected] !== mySeat()) view.selected = null;
  if (view.target && view.selected === null) view.target = null;
  if (view.selected && view.target && !targetSetSafe().has(view.target)) view.target = null;
  if (snap.stage === 'setup' && !(snap.setupLeft > 0)) view.staged = {};
  sound.setMood(snap.phase === 'playing' ? 'battle' : 'calm');
  announce(prev);
  renderAll();
}

function targetSetSafe() {
  try {
    return targetSet();
  } catch {
    return new Set();
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

async function rematch() {
  const s = view.snap;
  if (!s) return;
  const count = s.players.filter(Boolean).length;
  const res = s.isHost && count >= s.minPlayers ? await table.client.send('room:start') : await table.client.send('rematch');
  if (res.error) toast(res.error, 'error');
}

const table = setupTable({
  game: 'risk',
  title: 'Risk',
  onState,
  onExit() {
    view.snap = null;
    view.overShownRound = null;
    view.staged = {};
    view.selected = null;
    view.target = null;
  },
  isPlaying: (snap) => {
    if (snap.phase !== 'playing' || snap.spectator) return false;
    const me = snap.seats.find((x) => x.seat === snap.seat);
    return Boolean(me && !me.eliminated);
  },
  leaveWarning: 'Leave the war? Your armies will stay on the map as neutrals.',
  onRematch: rematch,
});
const { client } = table;

client.socket.on('risk:battle', (battle) => {
  view.battleQueue.push(battle);
  runBattles();
});

buildMap();

// ---- 3D board (default) or flat 2D map, chosen in Settings ----------------

function make3d() {
  if (board3d) return board3d;
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const forced = new URLSearchParams(location.search).get('quality');
    const quality = ['low', 'medium', 'high'].includes(forced) ? forced : coarse ? 'medium' : 'high';
    board3d = new RiskBoard3D(el.canvas3d, { quality });
    board3d.setShowNames(prefs.names);
    board3d.onPick = (tid, remove) => {
      if (tid) onTerritoryClick(tid, remove);
      else if (view.selected) {
        view.selected = null;
        view.target = null;
        renderAll();
      }
    };
    board3d.onHover = (tid, x, y) => showTip(tid, x, y);
  } catch (error) {
    console.warn('3D board unavailable, using 2D', error);
    board3d = null;
  }
  return board3d;
}

function useView(mode) {
  const three = mode === '3d' && make3d();
  el.map.toggleAttribute('hidden', Boolean(three));
  board3d?.show(Boolean(three));
  el.mapWrap.classList.toggle('mode-3d', Boolean(three));
  $('zoomHint').hidden = !three;
  if (three) setTimeout(() => ($('zoomHint').hidden = true), 6000);
  el.viewButtons.forEach((b) => b.classList.toggle('active', b.dataset.view === (three ? '3d' : '2d')));
  if (view.snap) renderAll();
  return Boolean(three);
}

function showTip(tid, clientX, clientY) {
  if (!tid || !view.snap) {
    el.hoverTip.hidden = true;
    return;
  }
  const t = BY_ID[tid];
  const s = view.snap;
  const owner = s.owner[t.id];
  el.hoverTip.hidden = false;
  el.hoverTip.innerHTML = `<b>${t.name}</b><span>${CONT[t.continent].name}</span>${owner !== undefined ? `<span style="color:${colorOf(owner)}">${nameOf(owner)} · ${s.armies[t.id]} armies</span>` : ''}`;
  const rect = el.mapWrap.getBoundingClientRect();
  el.hoverTip.style.left = `${clientX - rect.left + el.mapWrap.scrollLeft + 14}px`;
  el.hoverTip.style.top = `${clientY - rect.top + el.mapWrap.scrollTop + 14}px`;
}

el.viewButtons.forEach((btn) =>
  btn.addEventListener('click', () => {
    prefs.view = btn.dataset.view;
    store('local', 'risk:prefs', JSON.stringify(prefs));
    const ok = useView(prefs.view);
    if (prefs.view === '3d' && !ok) toast('3D is not supported on this device.', 'error');
  })
);
useView(prefs.view);

// Map input: click to select/place, right-click or long-press to remove a staged army.
let pressTimer = null;
let longPressed = false;
el.map.addEventListener('click', (event) => {
  const path = event.target.closest?.('.rk-t');
  if (longPressed) {
    longPressed = false;
    return;
  }
  if (path) onTerritoryClick(path.dataset.id, event.shiftKey);
  else if (view.selected) {
    view.selected = null;
    view.target = null;
    renderAll();
  }
});
el.map.addEventListener('contextmenu', (event) => {
  const path = event.target.closest?.('.rk-t');
  if (!path || !placing()) return;
  event.preventDefault();
  onTerritoryClick(path.dataset.id, true);
});
el.map.addEventListener('pointerdown', (event) => {
  const path = event.target.closest?.('.rk-t');
  if (!path || event.pointerType === 'mouse') return;
  pressTimer = setTimeout(() => {
    longPressed = true;
    onTerritoryClick(path.dataset.id, true);
  }, 480);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) =>
  el.map.addEventListener(ev, () => clearTimeout(pressTimer))
);
el.map.addEventListener('pointermove', (event) => {
  const path = event.target.closest?.('.rk-t');
  if (!path || event.pointerType !== 'mouse' || !view.snap) {
    el.hoverTip.hidden = true;
    return;
  }
  const t = BY_ID[path.dataset.id];
  const s = view.snap;
  const owner = s.owner[t.id];
  el.hoverTip.hidden = false;
  el.hoverTip.innerHTML = `<b>${t.name}</b><span>${CONT[t.continent].name}</span>${owner !== undefined ? `<span style="color:${colorOf(owner)}">${nameOf(owner)} · ${s.armies[t.id]} armies</span>` : ''}`;
  const rect = el.mapWrap.getBoundingClientRect();
  el.hoverTip.style.left = `${event.clientX - rect.left + el.mapWrap.scrollLeft + 14}px`;
  el.hoverTip.style.top = `${event.clientY - rect.top + el.mapWrap.scrollTop + 14}px`;
});
el.map.addEventListener('pointerleave', () => (el.hoverTip.hidden = true));

el.diceRow.addEventListener('click', (event) => {
  const b = event.target.closest('[data-dice]');
  if (!b || b.disabled) return;
  view.dice = Number(b.dataset.dice);
  attack(false);
});
el.countRange.addEventListener('input', () => {
  view.count = Number(el.countRange.value);
  el.countOut.textContent = view.count;
});
el.countMinus.addEventListener('click', () => {
  el.countRange.value = Number(el.countRange.value) - 1;
  el.countRange.dispatchEvent(new Event('input'));
});
el.countPlus.addEventListener('click', () => {
  el.countRange.value = Number(el.countRange.value) + 1;
  el.countRange.dispatchEvent(new Event('input'));
});
el.tradeBtn.addEventListener('click', async () => {
  const res = await send('risk:trade', { cards: [...view.pickedCards] });
  if (res && !res.error) {
    view.pickedCards.clear();
    bigText(`+${res.value} ARMIES`, 'Cards traded', 'info');
    sound.crown?.();
    renderAll();
  }
});
el.startBtn.addEventListener('click', async () => {
  sound.click();
  const res = await client.send('room:start');
  if (res.error) toast(res.error, 'error');
});
el.rulesBox.addEventListener('click', async (event) => {
  const b = event.target.closest('button[data-value]');
  if (!b || b.disabled) return;
  const option = b.parentElement.dataset.option;
  const res = await client.send('room:options', { [option]: b.dataset.value });
  if (res.error) toast(res.error, 'error');
});
el.status.addEventListener('click', () => {
  if (view.snap?.phase === 'over') el.gameOver.hidden = false;
});
$('settingsBtn').addEventListener('click', () => {
  el.namesToggle.checked = prefs.names;
});
el.namesToggle.addEventListener('change', () => {
  prefs.names = el.namesToggle.checked;
  store('local', 'risk:prefs', JSON.stringify(prefs));
  el.map.classList.toggle('hide-names', !prefs.names);
  board3d?.setShowNames(prefs.names);
});
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || table.handleEscape()) return;
  view.selected = null;
  view.target = null;
  renderAll();
});

client.autoStart();

// Test hook: `?debug` exposes internals for automated browser tests.
if (new URLSearchParams(location.search).has('debug')) window.riskPage = { view, client, MAP, get board3d() { return board3d; } };
