import { store } from '../shared/room-client.js';
import { setupTable, bigText, toast, sound } from '../shared/table-ui.js';
import { LifeBoard3D, TYPE_COLORS } from './board3d.js';

const B = window.LifeBoard;
const SP = B.spaces;
const CAREER = Object.fromEntries(B.CAREERS.map((c) => [c.id, c]));
const HOUSE = Object.fromEntries(B.HOUSES.map((h) => [h.id, h]));
const SVGNS = 'http://www.w3.org/2000/svg';
const PET_ICON = { dog: '🐶', cat: '🐱', bunny: '🐰', parrot: '🦜' };
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const el = {
  canvas3d: $('board3d'),
  board2d: $('board2d'),
  boardWrap: $('boardWrap'),
  hoverTip: $('hoverTip'),
  zoomHint: $('zoomHint'),
  playerStrip: $('playerStrip'),
  status: $('status'),
  statusTitle: $('statusTitle'),
  statusSub: $('statusSub'),
  waitingBox: $('waitingBox'),
  lobbyPlayers: $('lobbyPlayers'),
  startBtn: $('startBtn'),
  startNote: $('startNote'),
  spinBox: $('spinBox'),
  wheel: $('wheel'),
  spinBtn: $('spinBtn'),
  spinResult: $('spinResult'),
  choiceBox: $('choiceBox'),
  choicePrompt: $('choicePrompt'),
  choices: $('choices'),
  meBox: $('meBox'),
  meStats: $('meStats'),
  repayBtn: $('repayBtn'),
  logBox: $('logBox'),
  log: $('log'),
  gameOver: $('gameOver'),
  goKicker: $('goKicker'),
  goTitle: $('goTitle'),
  goReason: $('goReason'),
  goResults: $('goResults'),
  rematchBtn: $('rematchBtn'),
  rematchNote: $('rematchNote'),
  followToggle: $('followToggle'),
  viewButtons: [...document.querySelectorAll('[data-view]')],
};

const prefs = (() => {
  const defaults = { view: '3d', follow: true };
  try {
    return { ...defaults, ...JSON.parse(store('local', 'life:prefs') || '{}') };
  } catch {
    return defaults;
  }
})();

let board3d = null;

const view = {
  snap: null,
  shownMove: null,
  queue: [],
  animating: false,
  animSeat: null,
  animPos: null,
  pending: false,
  wheelAngle: 0,
  overShownRound: null,
  lastTurnKey: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (k) => {
  const sign = k < 0 ? '−' : '';
  const a = Math.abs(k);
  return a >= 1000 ? `${sign}$${(a / 1000).toFixed(a % 1000 === 0 ? 0 : 2).replace(/0$/, '')}M` : `${sign}$${a}K`;
};
const mySeat = () => (view.snap && !view.snap.spectator ? view.snap.seat : null);
const seatInfo = (seat) => view.snap?.seats?.find((s) => s.seat === seat) || null;
const nameOf = (seat) => (seat === mySeat() ? 'You' : seatInfo(seat)?.name || '?');
const isMyTurn = () => {
  const s = view.snap;
  return Boolean(s && s.phase === 'playing' && !s.spectator && s.turn === s.seat);
};

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

const WHEEL_COLORS = ['#e0413b', '#f08a2e', '#e8c53a', '#3fb35a', '#2fb7a8', '#3b82e0', '#6a5ae0', '#9b59d0', '#e05aa8', '#8a8f98'];

function buildWheel() {
  const w = el.wheel;
  w.innerHTML = '';
  const g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('id', 'wheelSpin');
  for (let i = 0; i < 10; i += 1) {
    const a0 = ((i * 36 - 90) * Math.PI) / 180;
    const a1 = (((i + 1) * 36 - 90) * Math.PI) / 180;
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', `M0 0 L${Math.cos(a0) * 96} ${Math.sin(a0) * 96} A96 96 0 0 1 ${Math.cos(a1) * 96} ${Math.sin(a1) * 96}Z`);
    path.setAttribute('fill', WHEEL_COLORS[i]);
    path.setAttribute('stroke', '#fff');
    path.setAttribute('stroke-width', '2');
    g.appendChild(path);
    const am = (((i + 0.5) * 36 - 90) * Math.PI) / 180;
    const t = document.createElementNS(SVGNS, 'text');
    t.setAttribute('x', Math.cos(am) * 70);
    t.setAttribute('y', Math.sin(am) * 70 + 7);
    t.setAttribute('transform', `rotate(${(i + 0.5) * 36} ${Math.cos(am) * 70} ${Math.sin(am) * 70})`);
    t.textContent = String(i + 1);
    g.appendChild(t);
  }
  const hub = document.createElementNS(SVGNS, 'circle');
  hub.setAttribute('r', 30);
  hub.setAttribute('fill', '#1b2632');
  hub.setAttribute('stroke', '#fff');
  hub.setAttribute('stroke-width', 3);
  w.append(g, hub);
}

async function spinWheel(n, boost = null) {
  const g = document.getElementById('wheelSpin');
  const center = (n - 0.5) * 36;
  const current = view.wheelAngle % 360;
  let target = view.wheelAngle - current + 360 * 4 + (360 - center);
  if (target - view.wheelAngle < 360 * 3) target += 360;
  view.wheelAngle = target;
  g.style.transition = 'transform 2.1s cubic-bezier(0.15, 0.7, 0.2, 1)';
  g.style.transform = `rotate(${target}deg)`;
  el.spinResult.textContent = '';
  // Clicks while it spins.
  const start = performance.now();
  while (performance.now() - start < 1900) {
    const t = (performance.now() - start) / 1900;
    sound.clack();
    await wait(40 + t * t * 260);
  }
  await wait(250);
  el.spinResult.textContent = boost && boost !== n ? `${n}! → ${boost} spaces` : `${n}!`;
  el.spinResult.classList.remove('pop');
  void el.spinResult.offsetWidth;
  el.spinResult.classList.add('pop');
}

// ---------------------------------------------------------------------------
// 2D board (fallback)
// ---------------------------------------------------------------------------

const cars2d = new Map();

function build2d() {
  const svg = el.board2d;
  svg.innerHTML = '';
  const mk = (tag, attrs, parent = svg) => {
    const n = document.createElementNS(SVGNS, tag);
    Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, v));
    parent.appendChild(n);
    return n;
  };
  mk('rect', { x: -11, y: -8, width: 22, height: 16, rx: 0.4, fill: '#5faa45' });
  SP.forEach((s) => s.next.forEach((n) => mk('line', { x1: s.x, y1: s.z, x2: SP[n].x, y2: SP[n].z, stroke: '#5a5f66', 'stroke-width': 0.4 })));
  SP.forEach((s) => {
    const color = s.type === 'money' && s.amount < 0 ? '#d65a3a' : TYPE_COLORS[s.type];
    const r = s.type === 'stop' ? 0.42 : s.lane ? 0.3 : 0.36;
    if (s.type === 'stop') {
      const pts = Array.from({ length: 8 }, (_, i) => {
        const a = (Math.PI / 4) * i + Math.PI / 8;
        return `${s.x + Math.cos(a) * r},${s.z + Math.sin(a) * r}`;
      }).join(' ');
      mk('polygon', { points: pts, fill: color, stroke: '#fff', 'stroke-width': 0.05 });
    } else {
      mk('circle', { cx: s.x, cy: s.z, r, fill: color, stroke: '#fff', 'stroke-width': 0.05 });
    }
    const label = { payday: '$', life: '❤', learn: '📘', pet: '🐾', choice: '?', sue: '⚖', baby: '👶', twins: '👶👶', start: 'GO', stop: 'STOP' }[s.type] ??
      (s.type === 'money' ? `${s.amount > 0 ? '+' : '−'}${Math.abs(s.amount)}` : '');
    const t = mk('text', { x: s.x, y: s.z + 0.1, 'font-size': s.type === 'stop' ? 0.2 : 0.26, 'text-anchor': 'middle', fill: '#fff', 'font-weight': 700 });
    t.textContent = label;
    t.style.pointerEvents = 'none';
  });
  mk('g', { id: 'cars2d' });
}

function render2dCars(list) {
  const layer = document.getElementById('cars2d');
  if (!layer) return;
  const bySpace = {};
  list.forEach((p) => (bySpace[p.pos] ||= []).push(p.seat));
  list.forEach((p) => {
    let c = cars2d.get(p.seat);
    if (!c) {
      c = document.createElementNS(SVGNS, 'g');
      c.innerHTML = `<rect x="-0.26" y="-0.14" width="0.52" height="0.28" rx="0.08" fill="${p.color}" stroke="#fff" stroke-width="0.04"/>`;
      c.style.transition = 'transform 0.22s ease';
      layer.appendChild(c);
      cars2d.set(p.seat, c);
    }
    const s = SP[p.pos];
    const same = bySpace[p.pos];
    const off = same.length > 1 ? (same.indexOf(p.seat) - (same.length - 1) / 2) * 0.24 : 0;
    const nx = -Math.sin(s.angle);
    const nz = Math.cos(s.angle);
    c.setAttribute('transform', `translate(${s.x + nx * off} ${s.z + nz * off}) rotate(${(s.angle * 180) / Math.PI})`);
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function carList() {
  const s = view.snap;
  if (!s || s.phase === 'lobby') return [];
  return s.seats
    .filter((p) => !p.left)
    .map((p) => ({
      seat: p.seat,
      color: p.color,
      pos: view.animSeat === p.seat && view.animPos !== null ? view.animPos : p.pos,
      married: p.married,
      kids: p.kids,
      pets: p.pets || [],
    }));
}

function renderBoard() {
  const list = carList();
  board3d?.setCars(list, view.animating ? view.animSeat : null);
  render2dCars(list);
  const s = view.snap;
  const fork = s?.pending?.kind === 'fork' && !view.animating ? s.pending.options.map((o) => o.value) : [];
  board3d?.setHighlight(fork);
}

function renderPlayers() {
  const s = view.snap;
  el.playerStrip.innerHTML = '';
  if (s.phase === 'lobby') return;
  s.seats.forEach((p) => {
    const chip = document.createElement('div');
    chip.className = 'lf-player';
    chip.style.setProperty('--pc', p.color);
    chip.classList.toggle('turn', s.phase === 'playing' && p.seat === s.turn);
    chip.classList.toggle('out', p.left);
    chip.classList.toggle('retired', p.retired);
    const top = document.createElement('div');
    top.className = 'row1';
    top.innerHTML = `<b>${p.name}${p.seat === mySeat() ? ' (you)' : ''}</b><span class="lp">${s.scoring === 'money' ? fmt(p.money - p.loans * B.LOAN_REPAY) : `${p.points} LP`}</span>`;
    const meters = document.createElement('div');
    meters.className = 'lf-meters';
    meters.innerHTML = `<span class="m-w" title="Wealth">💰 ${fmt(p.money)}</span><span class="m-k" title="Knowledge">📘 ${p.knowledge}</span><span class="m-h" title="Happiness">❤ ${p.happiness}</span>`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const bits = [];
    if (p.left) bits.push('left');
    else {
      bits.push(p.career ? `${CAREER[p.career].name} ${fmt(p.salary)}` : p.degree ? 'in college' : 'no job yet');
      if (p.loans) bits.push(`${p.loans} loan${p.loans > 1 ? 's' : ''}`);
      if (p.married) bits.push('💍');
      if (p.kids) bits.push(`👶×${p.kids}`);
      if (p.house) bits.push('🏠');
      if (p.pets?.length) bits.push(p.pets.map((x) => PET_ICON[x]).join(''));
      if (p.retired) bits.push(`retired #${p.retireRank}`);
    }
    meta.textContent = bits.join(' · ');
    chip.append(top, meters, meta);
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
  document.querySelectorAll('#lifeRules [data-option]').forEach((group) => {
    group.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', (s.options[group.dataset.option] || '') === b.dataset.value);
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
    : `Waiting for ${s.players[hostSeat]?.name || 'the host'} to start the game…`;
}

function renderStatus() {
  const s = view.snap;
  let title = '';
  let sub = '';
  if (s.phase === 'lobby') {
    title = 'Getting ready';
    sub = `${s.players.filter(Boolean).length} of ${s.maxPlayers} drivers`;
  } else if (s.phase === 'over') {
    title = 'Everyone has retired';
    sub = 'Tap here to see the results again.';
  } else if (view.animating) {
    title = `${nameOf(view.animSeat)} ${view.animSeat === mySeat() ? 'are' : 'is'} on the move`;
    sub = '';
  } else if (isMyTurn()) {
    title = 'Your turn';
    sub = s.turnPhase === 'choice' ? s.pending.prompt : 'Spin the wheel!';
  } else {
    title = `${seatInfo(s.turn)?.name}'s turn`;
    sub = s.turnPhase === 'choice' ? 'Making a choice…' : 'Spinning…';
  }
  el.statusTitle.textContent = title;
  el.statusSub.textContent = sub;
  el.status.classList.toggle('mine', isMyTurn() && !view.animating);
  el.status.style.setProperty('--pc', s.phase === 'playing' ? seatInfo(s.turn)?.color || 'transparent' : 'transparent');
}

function renderSpin() {
  const s = view.snap;
  el.spinBox.hidden = s.phase !== 'playing';
  const canSpin = isMyTurn() && s.turnPhase === 'spin' && !view.animating && !view.pending;
  el.spinBtn.disabled = !canSpin;
  el.spinBtn.classList.toggle('ready', canSpin);
}

function optionCard(opt, kind) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `lf-option ${kind}`;
  if (kind === 'career') {
    const c = CAREER[opt.value];
    b.innerHTML = `<span class="k">${opt.value === 'keep' ? 'Current job' : c?.degree ? 'Degree career' : 'Career'}</span><b>${opt.label.replace(/^Keep /, '')}</b><span class="v">${fmt(opt.salary)} salary</span>`;
  } else if (kind === 'house') {
    if (opt.value === 'skip') b.innerHTML = `<span class="k">No thanks</span><b>Keep renting</b><span class="v">Save your cash</span>`;
    else b.innerHTML = `<span class="k">House</span><b>${opt.label}</b><span class="v">Buy ${fmt(opt.price)}</span><span class="s">Sells for ${fmt(opt.low)}–${fmt(opt.high)}</span>`;
  } else if (kind === 'dilemma') {
    const fx = opt.fx || {};
    const chips = [];
    if (fx.risk) chips.push(`<i class="c-risk">🎲 −${fmt(fx.risk.cost)} · spin ${fx.risk.need}+ wins ${fmt(fx.risk.win)}</i>`);
    if (fx.money) chips.push(`<i class="${fx.money > 0 ? 'c-up' : 'c-down'}">💰 ${fx.money > 0 ? '+' : ''}${fmt(fx.money)}</i>`);
    if (fx.know) chips.push(`<i class="c-know">📘 +${fx.know}</i>`);
    if (fx.happy) chips.push(`<i class="${fx.happy > 0 ? 'c-happy' : 'c-down'}">❤ ${fx.happy > 0 ? '+' : ''}${fx.happy}</i>`);
    if (fx.pet) chips.push(`<i class="c-happy">${PET_ICON[fx.pet]} new pet</i>`);
    if (fx.raise) chips.push(`<i class="c-up">💼 salary +${fmt(fx.raise)}</i>`);
    if (!chips.length) chips.push('<i>nothing changes</i>');
    b.innerHTML = `<span class="k">Option ${opt.value.toUpperCase()}</span><b>${opt.label}</b><span class="fx">${chips.join('')}</span>`;
  } else if (kind === 'sue') {
    const p = seatInfo(opt.value);
    b.style.setProperty('--pc', p?.color || '#888');
    b.innerHTML = `<span class="k">Sue</span><b>${opt.label}</b><span class="v">${fmt(p?.money ?? 0)} cash</span>`;
  } else {
    const first = SP[opt.value];
    b.innerHTML = `<span class="k">Go</span><b>${opt.label}</b><span class="s">${first?.text || ''}</span>`;
  }
  return b;
}

function renderChoice() {
  const s = view.snap;
  const p = s.pending;
  el.choiceBox.hidden = !(s.phase === 'playing' && s.turnPhase === 'choice' && p && !view.animating);
  if (el.choiceBox.hidden) return;
  const mine = p.seat === mySeat();
  el.choicePrompt.textContent = mine ? p.prompt : `${seatInfo(p.seat)?.name} is deciding: ${p.prompt}`;
  el.choices.innerHTML = '';
  p.options.forEach((opt) => {
    const b = optionCard(opt, p.kind);
    b.disabled = !mine || view.pending;
    b.addEventListener('click', () => choose(opt.value));
    el.choices.appendChild(b);
  });
}

function renderMe() {
  const s = view.snap;
  const me = seatInfo(mySeat());
  el.meBox.hidden = !me || s.phase === 'lobby';
  if (el.meBox.hidden) return;
  const rows = [
    ['Cash', fmt(me.money)],
    ['Career', me.career ? `${CAREER[me.career].name}` : me.degree ? 'Student' : '—'],
    ['Salary', me.salary ? fmt(me.salary) : '—'],
    ['Loans', me.loans ? `${me.loans} (${fmt(me.loans * B.LOAN_REPAY)} to repay)` : 'none'],
    ['Family', `${me.married ? 'Married' : 'Single'}${me.kids ? ` · ${me.kids} ${me.kids === 1 ? 'kid' : 'kids'}` : ''}`],
    ['Home', me.house ? HOUSE[me.house].name : 'Renting'],
    ['Pets', me.pets?.length ? me.pets.map((x) => `${PET_ICON[x]} ${x}`).join(', ') : 'none yet'],
    ['📘 Knowledge', String(me.knowledge)],
    ['❤ Happiness', String(me.happiness)],
    ['Life Points', `${me.points} LP`],
  ];
  el.meStats.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  el.repayBtn.hidden = !me.loans || s.phase !== 'playing';
  el.repayBtn.disabled = me.money < B.LOAN_REPAY || view.pending;
}

function renderLog() {
  const s = view.snap;
  el.logBox.hidden = s.phase === 'lobby' || !s.log?.length;
  if (el.logBox.hidden) return;
  el.log.innerHTML = '';
  [...s.log]
    .reverse()
    .slice(0, 14)
    .forEach((e) => {
      const li = document.createElement('li');
      li.innerHTML = `<b style="color:${seatInfo(e.seat)?.color}">${nameOf(e.seat)}</b> ${e.text}`;
      if (e.amount > 0) li.classList.add('up');
      if (e.amount < 0) li.classList.add('down');
      el.log.appendChild(li);
    });
}

function renderGameOver() {
  const s = view.snap;
  if (s.phase !== 'over' || !s.results) {
    el.gameOver.hidden = true;
    return;
  }
  const me = mySeat();
  const w = s.results[0]?.seat;
  el.goKicker.textContent = 'Retirement day';
  el.goTitle.textContent = w === me ? 'You win!' : `${seatInfo(w)?.name} wins`;
  const byMoney = s.scoring === 'money';
  el.goReason.textContent = byMoney
    ? 'Houses are sold and loans repaid — the richest retiree wins.'
    : `Houses are sold and loans repaid. Every ${fmt(B.MONEY_PER_POINT)} is 1 Life Point, plus Knowledge and Happiness.`;
  el.goResults.innerHTML = '';
  const top = Math.max(...s.results.map((r) => r.total), 1);
  s.results.forEach((r, i) => {
    const p = seatInfo(r.seat);
    const card = document.createElement('div');
    card.className = 'lf-result';
    card.style.setProperty('--pc', p?.color || '#888');
    const pct = (v) => `${(Math.max(0, v) / top) * 100}%`;
    card.innerHTML = `<div class="head"><span class="rank">${i + 1}</span><b>${p?.name}</b><span class="total">${byMoney ? fmt(r.total) : `${r.total} LP`}</span></div>
      ${byMoney ? '' : `<div class="lf-bar"><span class="w" style="width:${pct(r.wealth)}"></span><span class="k" style="width:${pct(r.knowledge)}"></span><span class="h" style="width:${pct(r.happiness)}"></span></div>
      <div class="lf-split"><span>💰 ${r.wealth}</span><span>📘 ${r.knowledge}</span><span>❤ ${r.happiness}</span></div>`}
      <ul>${r.lines.map((l) => `<li><span>${l.label}</span><span class="${l.amount < 0 ? 'down' : ''}">${fmt(l.amount)}</span></li>`).join('')}<li><span>Net worth</span><span>${fmt(r.net)}</span></li></ul>`;
    el.goResults.appendChild(card);
  });
  renderRematch();
  if (view.overShownRound !== s.round && !view.animating) {
    view.overShownRound = s.round;
    setTimeout(() => {
      if (view.snap?.phase !== 'over') return;
      el.gameOver.hidden = false;
      if (s.spectator || w === me) sound.victory();
      else sound.defeat();
    }, 900);
  }
}

function renderRematch() {
  const s = view.snap;
  const count = s.players.filter(Boolean).length;
  const votes = s.rematchVotes || [];
  el.rematchBtn.hidden = s.spectator;
  el.rematchBtn.classList.remove('pulse');
  if (s.spectator) {
    el.rematchNote.textContent = 'Stick around — the players may start another game.';
  } else if (count < s.minPlayers) {
    el.rematchBtn.textContent = 'Reopen the room';
    el.rematchBtn.disabled = false;
    el.rematchNote.textContent = 'Everyone else left. Reopen and share the code again.';
  } else if (s.isHost) {
    el.rematchBtn.textContent = `New game with ${count} players`;
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
  renderBoard();
  renderPlayers();
  renderLobby();
  renderStatus();
  renderSpin();
  renderChoice();
  renderMe();
  renderLog();
  renderGameOver();
}

// ---------------------------------------------------------------------------
// Move animation
// ---------------------------------------------------------------------------

async function playMove(move, before) {
  view.animating = true;
  view.animSeat = move.seat;
  const startPos = before?.seats?.find((p) => p.seat === move.seat)?.pos ?? move.path[0];
  view.animPos = startPos;
  renderAll();
  if (move.spin) await spinWheel(move.spin, move.boost);
  const stepsBy = new Map();
  move.events.forEach((e) => (stepsBy.get(e.at) || stepsBy.set(e.at, []).get(e.at)).push(e));
  const shownEvents = new Set();
  const showEvents = (at, final) => {
    (stepsBy.get(at) || []).forEach((e) => {
      if (shownEvents.has(e)) return;
      const passing = /^Passed payday|^Your pet/.test(e.text);
      if (!final && !passing) return;
      shownEvents.add(e);
      const bits = [];
      if (e.amount) bits.push({ t: `💰 ${e.amount > 0 ? '+' : ''}${fmt(e.amount)}`, c: e.amount < 0 ? '#ff8a7a' : '#7dffb0' });
      if (e.know) bits.push({ t: `📘 +${e.know}`, c: '#8ec5ff' });
      if (e.happy) bits.push({ t: `❤ ${e.happy > 0 ? '+' : ''}${e.happy}`, c: e.happy > 0 ? '#ff9ec7' : '#ff8a7a' });
      if (e.pet) bits.push({ t: `${PET_ICON[e.pet]} New pet!`, c: '#ffe08a' });
      bits.forEach((b, i) => setTimeout(() => board3d?.floatText(at, b.t, b.c), i * 280));
      const party = e.marry || e.retire || e.baby || e.house || e.pet || e.career || e.amount >= 100;
      if (party) {
        board3d?.confetti(at, e.retire || e.marry ? 120 : 70);
        if (e.marry || e.retire || e.baby) board3d?.celebrate(move.seat);
      }
      if (e.amount > 0) sound.crown?.();
      else if (e.amount < 0) sound.error();
      else sound.place();
      if (e.marry) bigText('JUST MARRIED', `${nameOf(move.seat)} tied the knot`, 'info');
      else if (e.retire) bigText('RETIRED!', e.text, 'info');
      else if (e.baby) bigText(e.baby === 2 ? 'TWINS!' : "IT'S A BABY!", nameOf(move.seat), 'info');
      else if (e.career) bigText('NEW CAREER', e.text.replace(/^Becomes an? /, ''), 'info');
      else if (e.house) bigText('HOME SWEET HOME', HOUSE[e.house]?.name || '', 'info');
      else if (e.pet) bigText('NEW BEST FRIEND', `A ${e.pet} joins the family`, 'info');
      else if (e.sue !== undefined) bigText('LAWSUIT!', e.text, 'hit');
      else if (Math.abs(e.amount) >= 100) bigText(e.amount > 0 ? 'JACKPOT!' : 'OUCH!', e.text, e.amount > 0 ? 'info' : 'hit');
    });
  };
  // Events at the starting square (e.g. college costs) show first.
  showEvents(startPos, true);
  if (move.path.length) {
    if (board3d?.visible) {
      const steps = [...move.path];
      const driving = board3d.driveCar(move.seat, steps);
      // Track progress for payday floaters and the 2D board.
      for (const id of steps) {
        await wait(230);
        view.animPos = id;
        render2dCars(carList());
        showEvents(id, false);
      }
      await driving;
    } else {
      for (const id of move.path) {
        view.animPos = id;
        render2dCars(carList());
        showEvents(id, false);
        sound.clack();
        await wait(220);
      }
    }
  }
  const end = move.path.length ? move.path[move.path.length - 1] : startPos;
  showEvents(end, true);
  stepsBy.forEach((list, at) => showEvents(at, true));
  await wait(move.events.length ? 700 : 250);
  view.animating = false;
  view.animSeat = null;
  view.animPos = null;
}

async function runQueue() {
  if (view.animating) return;
  while (view.queue.length) {
    const { move, before } = view.queue.shift();
    await playMove(move, before);
  }
  renderAll();
  announceTurn();
}

function announceTurn() {
  const s = view.snap;
  if (!s || s.phase !== 'playing') return;
  const key = `${s.round}:${s.turnNumber}`;
  if (key !== view.lastTurnKey && isMyTurn() && s.turnPhase === 'spin') {
    if (view.lastTurnKey !== null) {
      bigText('YOUR TURN', 'Spin the wheel!', 'info');
      sound.yourTurn();
    }
  }
  view.lastTurnKey = key;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function send(event, payload) {
  if (view.pending) return null;
  view.pending = true;
  renderSpin();
  const res = await table.client.send(event, payload);
  view.pending = false;
  if (res.error) {
    toast(res.error, 'error');
    sound.error();
  }
  if (!view.animating) renderAll();
  return res;
}

function choose(value) {
  sound.click();
  send('life:choose', { value });
}

// ---------------------------------------------------------------------------
// State updates
// ---------------------------------------------------------------------------

function onState(snap, prev) {
  view.snap = snap;
  if (!prev || prev.round !== snap.round) {
    view.shownMove = snap.lastMove?.id ?? null;
    view.queue = [];
    view.lastTurnKey = null;
    if (snap.phase === 'playing' && prev && prev.phase !== 'playing') {
      bigText("LET'S GO!", 'Spin to start your life', 'info');
      sound.joined();
    }
  }
  sound.setMood(snap.phase === 'playing' ? 'battle' : 'calm');
  const lm = snap.lastMove;
  if (lm && lm.id !== view.shownMove) {
    view.shownMove = lm.id;
    view.queue.push({ move: lm, before: prev });
    runQueue();
  }
  if (!view.animating) {
    renderAll();
    announceTurn();
  } else {
    renderPlayers();
    renderMe();
    renderLog();
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
  game: 'life',
  title: 'The Game of Life',
  onState,
  onExit() {
    view.snap = null;
    view.overShownRound = null;
    view.shownMove = null;
    view.queue = [];
  },
  isPlaying: (snap) => snap.phase === 'playing' && !snap.spectator,
  leaveWarning: 'Leave the game? You will drop out of the race to retirement.',
  onRematch: rematch,
});
const { client } = table;

function make3d() {
  if (board3d) return board3d;
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const forced = new URLSearchParams(location.search).get('quality');
    const quality = ['low', 'medium', 'high'].includes(forced) ? forced : coarse ? 'medium' : 'high';
    board3d = new LifeBoard3D(el.canvas3d, { quality });
    board3d.follow = prefs.follow;
    board3d.onHover = (id, x, y) => showTip(id, x, y);
    board3d.onTap = (id, x, y) => {
      showTip(id, x, y);
      setTimeout(() => (el.hoverTip.hidden = true), 2200);
    };
  } catch (error) {
    console.warn('3D board unavailable, using 2D', error);
    board3d = null;
  }
  return board3d;
}

function useView(mode) {
  const three = mode === '3d' && make3d();
  el.board2d.toggleAttribute('hidden', Boolean(three));
  board3d?.show(Boolean(three));
  el.viewButtons.forEach((b) => b.classList.toggle('active', b.dataset.view === (three ? '3d' : '2d')));
  el.zoomHint.hidden = !three;
  if (three) setTimeout(() => (el.zoomHint.hidden = true), 6000);
  if (view.snap) renderAll();
  return Boolean(three);
}

function showTip(id, clientX, clientY) {
  if (id === null || id === undefined) {
    el.hoverTip.hidden = true;
    return;
  }
  const s = SP[id];
  const kind = { payday: 'Payday', money: 'Money', life: '❤ Happiness', learn: '📘 Knowledge', pet: '🐾 Pet', choice: 'Decision card', stop: 'STOP', sue: 'Lawsuit', baby: 'Baby', twins: 'Twins', start: 'Start' }[s.type];
  el.hoverTip.innerHTML = `<b>${kind}</b><span>${s.text}</span>`;
  el.hoverTip.hidden = false;
  const rect = el.boardWrap.getBoundingClientRect();
  el.hoverTip.style.left = `${Math.min(clientX - rect.left + 14, rect.width - 200)}px`;
  el.hoverTip.style.top = `${clientY - rect.top + 14}px`;
}

buildWheel();
build2d();
useView(prefs.view);

el.board2d.addEventListener('mousemove', (e) => {
  const pt = el.board2d.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const p = pt.matrixTransform(el.board2d.getScreenCTM().inverse());
  const hit = SP.find((s) => Math.hypot(s.x - p.x, s.z - p.y) < 0.4);
  showTip(hit ? hit.id : null, e.clientX, e.clientY);
});
el.board2d.addEventListener('mouseleave', () => (el.hoverTip.hidden = true));

document.getElementById('lifeRules').addEventListener('click', async (event) => {
  const b = event.target.closest('button[data-value]');
  if (!b || b.disabled) return;
  const res = await client.send('room:options', { [b.parentElement.dataset.option]: b.dataset.value });
  if (res.error) toast(res.error, 'error');
});
el.spinBtn.addEventListener('click', () => {
  sound.click();
  send('life:spin');
});
el.repayBtn.addEventListener('click', () => send('life:repay'));
el.startBtn.addEventListener('click', async () => {
  sound.click();
  const res = await client.send('room:start');
  if (res.error) toast(res.error, 'error');
});
el.status.addEventListener('click', () => {
  if (view.snap?.phase === 'over') el.gameOver.hidden = false;
});
el.viewButtons.forEach((btn) =>
  btn.addEventListener('click', () => {
    prefs.view = btn.dataset.view;
    store('local', 'life:prefs', JSON.stringify(prefs));
    const ok = useView(prefs.view);
    if (prefs.view === '3d' && !ok) toast('3D is not supported on this device.', 'error');
  })
);
$('settingsBtn').addEventListener('click', () => {
  el.followToggle.checked = prefs.follow;
});
el.followToggle.addEventListener('change', () => {
  prefs.follow = el.followToggle.checked;
  store('local', 'life:prefs', JSON.stringify(prefs));
  if (board3d) board3d.follow = prefs.follow;
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') table.handleEscape();
  if ((event.key === ' ' || event.key === 'Enter') && !el.spinBtn.disabled && document.activeElement === document.body) {
    event.preventDefault();
    el.spinBtn.click();
  }
});

client.autoStart();

// Test hook: `?debug` exposes internals for automated browser tests.
if (new URLSearchParams(location.search).has('debug')) window.lifePage = { view, client, B, get board3d() { return board3d; } };
