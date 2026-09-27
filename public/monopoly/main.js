import { store } from '../shared/room-client.js';
import { setupTable, bigText, toast, sound } from '../shared/table-ui.js';
import { TycoonBoard3D } from './board3d.js';
import { coinCanvas, coinUrl } from './token-art.js';
import { drawBoard, setArtTheme, SIDE, spaceRect, tokenSpot } from './board-art.js';

const B = window.TycoonBoard;
const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DECK = { lucky: { color: '#f08a2e' }, town: { color: '#3b82e0' } };
let theme = 'classic';
const themeInfo = () => B.themeOf(theme);
// The same coin art as the board pieces.
function tokenIcon(t, color = '#f5c518') {
  return `<img class="coin-icon" src="${coinUrl(t, color)}" alt="" />`;
}
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

const el = {
  canvas3d: $('board3d'),
  board2d: $('board2d'),
  canvas2d: $('board2dCanvas'),
  boardWrap: $('boardWrap'),
  tip: $('tip'),
  diceChip: $('diceChip'),
  potChip: $('potChip'),
  playerStrip: $('playerStrip'),
  status: $('status'),
  statusTitle: $('statusTitle'),
  statusSub: $('statusSub'),
  waitingBox: $('waitingBox'),
  lobbyPlayers: $('lobbyPlayers'),
  startBtn: $('startBtn'),
  startNote: $('startNote'),
  actionBox: $('actionBox'),
  buyCard: $('buyCard'),
  rollBtn: $('rollBtn'),
  buyBtn: $('buyBtn'),
  passBtn: $('passBtn'),
  endBtn: $('endBtn'),
  fineBtn: $('fineBtn'),
  cardBtn: $('cardBtn'),
  tradeBtn: $('tradeBtn'),
  giveUpBtn: $('giveUpBtn'),
  offerBox: $('offerBox'),
  auctionBox: $('auctionBox'),
  tokenPick: $('tokenPick'),
  bankChip: $('bankChip'),
  myBox: $('myBox'),
  myWorth: $('myWorth'),
  myProps: $('myProps'),
  logBox: $('logBox'),
  log: $('log'),
  cardPop: $('cardPop'),
  cardFace: $('cardFace'),
  tradeModal: $('tradeModal'),
  tradeWith: $('tradeWith'),
  tradeGive: $('tradeGive'),
  tradeGet: $('tradeGet'),
  tradeGiveCash: $('tradeGiveCash'),
  tradeGetCash: $('tradeGetCash'),
  tradeSend: $('tradeSend'),
  tradeCancel: $('tradeCancel'),
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
    return { ...defaults, ...JSON.parse(store('local', 'tycoon:prefs') || '{}') };
  } catch {
    return defaults;
  }
})();

let board3d = null;

const view = {
  snap: null,
  lastEvent: 0,
  queue: [],
  animating: false,
  pending: false,
  pos: new Map(), // seat -> shown position
  lastMoney: new Map(),
  overShownRound: null,
  lastTurnKey: null,
  cardResolve: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mySeat = () => (view.snap && !view.snap.spectator ? view.snap.seat : null);
const seatInfo = (seat) => view.snap?.seats?.find((s) => s.seat === seat) || null;
const nameOf = (seat) => (seat === mySeat() ? 'You' : seatInfo(seat)?.name || '?');
const possessive = (seat) => (seat === mySeat() ? 'Your' : `${seatInfo(seat)?.name || '?'}'s`);
const isMyTurn = () => {
  const s = view.snap;
  return Boolean(s && s.phase === 'playing' && !s.spectator && s.turn === s.seat);
};
const inGame = (seat) => {
  const p = seatInfo(seat);
  return p && !p.bankrupt && !p.gone;
};

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function spaceColor(space) {
  if (space.type === 'street') return B.GROUPS[space.group].color;
  if (space.type === 'station') return '#3a4a44';
  if (space.type === 'utility') return '#5a6a8a';
  return '#3a4a44';
}

function currentRent(space) {
  const s = view.snap;
  const prop = s?.props?.[space.id];
  if (!prop || prop.owner === null || prop.mortgaged) return null;
  if (space.type === 'street') {
    if (prop.houses) return space.rent[prop.houses];
    const all = B.groupSpaces(space.group).every((id) => s.props[id].owner === prop.owner && !s.props[id].mortgaged);
    return all ? space.rent[0] * 2 : space.rent[0];
  }
  if (space.type === 'station') {
    const n = B.SPACES.filter((x) => x.type === 'station' && s.props[x.id].owner === prop.owner).length;
    return B.STATION_RENT[n];
  }
  return null;
}

function spaceInfoHtml(id) {
  const space = B.SPACES[id];
  const s = view.snap;
  const prop = s?.props?.[id];
  let rows = '';
  if (space.type === 'street') {
    const labels = ['Rent', 'With 1 house', 'With 2 houses', 'With 3 houses', 'With 4 houses', 'With a hotel'];
    rows = space.rent.map((r, i) => `<span class="${prop && prop.owner !== null && prop.houses === i ? 'on' : ''}">${labels[i]}</span><span class="${prop && prop.owner !== null && prop.houses === i ? 'on' : ''}">${money(r)}</span>`).join('');
    rows += `<span>Full set, no houses</span><span>${money(space.rent[0] * 2)}</span><span>Each building</span><span>${money(B.GROUPS[space.group].house)}</span>`;
  } else if (space.type === 'station') {
    rows = [1, 2, 3, 4].map((n) => `<span>${n} station${n > 1 ? 's' : ''} owned</span><span>${money(B.STATION_RENT[n])}</span>`).join('');
  } else if (space.type === 'utility') {
    rows = '<span>One utility</span><span>4× dice</span><span>Both utilities</span><span>10× dice</span>';
  } else if (space.type === 'tax') {
    rows = `<span>Pay</span><span>${money(space.amount)}</span>`;
  } else {
    const text = { start: 'Collect $200 salary every time you pass GO.', card: 'Draw a card.', jail: 'Just visiting — unless you were sent here.', rest: s?.options?.jackpot === 'on' ? `Collect the jackpot (${money(s?.pot || 0)}).` : 'Take a breather. Nothing happens.', gotojail: 'Go straight to Jail. Do not pass Start.' }[space.type];
    rows = `<span style="grid-column: span 2">${text}</span>`;
  }
  if (space.price) rows += `<span>Price</span><span>${money(space.price)}</span><span>Mortgage</span><span>${money(space.price / 2)}</span>`;
  let owner = '';
  if (prop && prop.owner !== null) {
    const o = seatInfo(prop.owner);
    owner = `<div class="owner" style="color:${o?.color}">Owned by ${escapeHtml(nameOf(prop.owner))}${prop.mortgaged ? ' · mortgaged' : ''}</div>`;
  } else if (space.price) owner = '<div class="owner">For sale</div>';
  const label = space.type === 'street' ? 'TITLE DEED' : space.price ? 'DEED' : '';
  return `<div class="band" style="background:${spaceColor(space)}">${label ? `<small>${label}</small>` : ''}${escapeHtml(space.name)}</div><div class="rows">${rows}</div>${owner}`;
}

function showTip(id, x, y) {
  if (id === null || id === undefined) {
    el.tip.hidden = true;
    return;
  }
  el.tip.innerHTML = spaceInfoHtml(id);
  el.tip.hidden = false;
  const rect = el.boardWrap.getBoundingClientRect();
  el.tip.style.left = `${Math.max(6, Math.min(x - rect.left + 14, rect.width - 220))}px`;
  el.tip.style.top = `${Math.max(6, Math.min(y - rect.top + 14, rect.height - el.tip.offsetHeight - 6))}px`;
}

// ---------------------------------------------------------------------------
// 2D board
// ---------------------------------------------------------------------------

let boardImage = null;
function draw2d() {
  if (el.board2d.hidden || !view.snap) return;
  const size = 1100;
  const canvas = el.canvas2d;
  if (canvas.width !== size) canvas.width = canvas.height = size;
  if (!boardImage) {
    boardImage = document.createElement('canvas');
    boardImage.width = boardImage.height = size;
    drawBoard(boardImage.getContext('2d'), size);
  }
  const ctx = canvas.getContext('2d');
  ctx.drawImage(boardImage, 0, 0);
  const u = size / SIDE;
  const s = view.snap;
  if (s.props) {
    Object.entries(s.props).forEach(([id, prop]) => {
      if (prop.owner === null) return;
      const r = spaceRect(Number(id));
      const color = seatInfo(prop.owner)?.color || '#fff';
      ctx.fillStyle = color;
      const t = 0.12;
      const strip = [[r.x, r.y + r.h - t, r.w, t], [r.x, r.y, t, r.h], [r.x, r.y, r.w, t], [r.x + r.w - t, r.y, t, r.h]][r.side];
      ctx.fillRect(strip[0] * u, strip[1] * u, strip[2] * u, strip[3] * u);
      if (prop.mortgaged) {
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(r.x * u, r.y * u, r.w * u, r.h * u);
      }
      if (prop.houses) {
        const band = [[r.x + r.w / 2, r.y + 0.17], [r.x + r.w - 0.17, r.y + r.h / 2], [r.x + r.w / 2, r.y + r.h - 0.17], [r.x + 0.17, r.y + r.h / 2]][r.side];
        const along = r.side % 2 === 0 ? [1, 0] : [0, 1];
        const list = prop.houses === 5 ? [0] : Array.from({ length: prop.houses }, (_, i) => (i - (prop.houses - 1) / 2) * 0.22);
        list.forEach((off) => {
          ctx.fillStyle = prop.houses === 5 ? '#d6342c' : '#2f9e4f';
          const w = prop.houses === 5 ? 0.36 : 0.16;
          const cx = (band[0] + along[0] * off) * u;
          const cy = (band[1] + along[1] * off) * u;
          ctx.fillRect(cx - (w * u) / 2, cy - 0.07 * u, w * u, 0.14 * u);
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(cx - (w * u) / 2, cy - 0.07 * u, w * u, 0.14 * u);
        });
      }
    });
  }
  const bySpace = new Map();
  view.pos.forEach((pos, seat) => {
    if (!inGame(seat)) return;
    const key = `${pos}:${pos === 10 && seatInfo(seat).jail ? 'j' : ''}`;
    if (!bySpace.has(key)) bySpace.set(key, []);
    bySpace.get(key).push(seat);
  });
  bySpace.forEach((seats, key) => {
    const pos = Number(key.split(':')[0]);
    seats.forEach((seat, i) => {
      const p = seatInfo(seat);
      const spot = tokenSpot(pos, i, seats.length, key.endsWith('j'));
      const d = u * (seat === s.turn ? 0.66 : 0.58);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 6;
      ctx.drawImage(coinCanvas(p.token, p.color, 128), spot.x * u - d / 2, spot.y * u - d / 2, d, d);
      ctx.restore();
    });
  });
}

function spaceAt2d(event) {
  const r = el.canvas2d.getBoundingClientRect();
  const x = ((event.clientX - r.left) / r.width) * SIDE;
  const y = ((event.clientY - r.top) / r.height) * SIDE;
  for (let id = 0; id < 40; id += 1) {
    const q = spaceRect(id);
    if (x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h) return id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderBoard() {
  const s = view.snap;
  if (!s.seats) return;
  const colors = Object.fromEntries(s.seats.map((p) => [p.seat, p.color]));
  if (board3d) {
    board3d.setTokens(s.seats.map((p) => ({ ...p, pos: view.pos.get(p.seat) ?? p.pos })));
    board3d.setProps(s.props, colors);
    board3d.activeSeat = s.phase === 'playing' ? s.turn : null;
  }
  draw2d();
}

function renderPlayers() {
  const s = view.snap;
  el.playerStrip.innerHTML = '';
  if (s.phase === 'lobby' || !s.seats) return;
  s.seats.forEach((p) => {
    const chip = document.createElement('div');
    chip.className = 'ty-player';
    chip.style.setProperty('--pc', p.color);
    chip.classList.toggle('turn', s.phase === 'playing' && p.seat === s.turn);
    chip.classList.toggle('out', p.bankrupt || p.gone);
    const cash = document.createElement('span');
    cash.className = 'cash';
    cash.textContent = p.bankrupt ? 'bankrupt' : money(p.money);
    const before = view.lastMoney.get(p.seat);
    if (before !== undefined && before !== p.money) cash.classList.add(p.money > before ? 'flash-up' : 'flash-down');
    view.lastMoney.set(p.seat, p.money);
    chip.innerHTML = `<span class="tok">${tokenIcon(p.token, p.color)}</span><b>${escapeHtml(p.seat === mySeat() ? `${p.name} (you)` : p.name)}</b>${p.jail ? '<span title="In jail">🔒</span>' : ''}${p.jailCards ? `<span title="Get out of jail free">🎟️${p.jailCards > 1 ? p.jailCards : ''}</span>` : ''}`;
    chip.appendChild(cash);
    // Little squares for every property they own, in board order.
    const owned = Object.entries(s.props || {}).filter(([, pr]) => pr.owner === p.seat);
    if (owned.length) {
      const deeds = document.createElement('span');
      deeds.className = 'deeds';
      owned.forEach(([id, pr]) => {
        const i = document.createElement('i');
        i.style.background = spaceColor(B.SPACES[id]);
        if (pr.mortgaged) i.className = 'm';
        i.title = B.SPACES[id].name;
        deeds.appendChild(i);
      });
      chip.appendChild(deeds);
    }
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
  const picks = s.tokenPicks || {};
  el.tokenPick.innerHTML = '';
  themeInfo().tokens.forEach((t) => {
    const owner = Object.keys(picks).find((seat) => picks[seat] === t);
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.token = t;
    const mine = owner !== undefined && Number(owner) === s.seat;
    b.className = `ty-token${mine ? ' active' : ''}`;
    b.disabled = s.spectator || (owner !== undefined && !mine);
    b.innerHTML = `<span>${tokenIcon(t)}</span><small>${owner !== undefined && !mine ? escapeHtml(s.players[owner]?.name || '') : themeInfo().tokenNames[t]}</small>`;
    el.tokenPick.appendChild(b);
  });
  document.querySelectorAll('#tycoonRules [data-option]').forEach((group) => {
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
  const turn = seatInfo(s.turn);
  el.status.style.setProperty('--pc', s.phase === 'playing' && turn ? turn.color : 'transparent');
  if (s.phase === 'lobby') {
    title = 'Gathering players';
    sub = `${s.players.filter(Boolean).length} of ${s.maxPlayers} seats taken`;
  } else if (s.phase === 'over') {
    title = s.winnerSeat === mySeat() ? 'You win!' : `${nameOf(s.winnerSeat)} wins`;
    sub = 'Tap here to see the results again.';
  } else if (view.animating) {
    title = `${possessive(view.animSeat ?? s.turn)} move`;
  } else if (isMyTurn()) {
    title = 'Your turn';
    sub = {
      roll: s.again ? 'Doubles! Roll again.' : 'Roll the dice.',
      jail: 'You are in Jail: pay $50, use a card, or try for doubles.',
      buy: `Buy ${B.SPACES[turn.pos].name}?`,
      end: 'Build, mortgage or trade — then end your turn.',
      auction: 'Auction in progress!',
    }[s.turnPhase];
  } else {
    title = `${possessive(s.turn)} turn`;
    sub = turn?.jail ? 'In Jail' : '';
  }
  if (s.phase === 'playing' && s.maxRounds) sub = `${sub}${sub ? ' · ' : ''}Round ${Math.min(s.round, s.maxRounds)} of ${s.maxRounds}`;
  el.statusTitle.textContent = title;
  el.statusSub.textContent = sub;
  el.status.classList.toggle('mine', isMyTurn() && !view.animating);
  el.potChip.hidden = !(s.phase === 'playing' && s.options?.jackpot === 'on');
  el.potChip.textContent = `🚗 Jackpot ${money(s.pot || 0)}`;
  el.bankChip.hidden = s.phase !== 'playing' || !s.bank;
  if (s.bank) el.bankChip.innerHTML = `Bank <b>🏠 ${s.bank.houses}</b> <b>🏨 ${s.bank.hotels}</b>`;
}

function renderActions() {
  const s = view.snap;
  const playing = s.phase === 'playing' && !s.spectator && inGame(s.seat);
  el.actionBox.hidden = !playing;
  if (!playing) return;
  const my = isMyTurn() && !view.animating && !view.pending;
  const me = seatInfo(s.seat);
  const phase = s.turnPhase;
  el.rollBtn.hidden = !(isMyTurn() && (phase === 'roll' || phase === 'jail'));
  el.rollBtn.disabled = !my;
  el.rollBtn.textContent = phase === 'jail' ? '🎲 Try for doubles' : s.again ? '🎲 Roll again' : '🎲 Roll';
  el.fineBtn.hidden = !(isMyTurn() && phase === 'jail');
  el.fineBtn.disabled = !my || me.money < 50;
  el.cardBtn.hidden = !(isMyTurn() && phase === 'jail' && me.jailCards);
  el.cardBtn.disabled = !my;
  const buying = isMyTurn() && phase === 'buy' && !view.animating;
  el.buyBtn.hidden = !buying;
  el.passBtn.hidden = !buying;
  el.buyCard.hidden = !buying;
  if (buying) {
    const space = B.SPACES[me.pos];
    el.buyBtn.textContent = `Buy for ${money(space.price)}`;
    el.buyBtn.disabled = !my || me.money < space.price;
    el.passBtn.disabled = !my;
    el.buyCard.innerHTML = `<div class="band" style="background:${spaceColor(space)}">${escapeHtml(space.name)}</div><div class="info"><span>Price ${money(space.price)}</span><span>You have ${money(me.money)}</span></div>`;
  }
  el.endBtn.hidden = !(isMyTurn() && phase === 'end');
  el.endBtn.disabled = !my;
  el.tradeBtn.disabled = Boolean(s.offer) || view.pending;
}

function renderAuction() {
  const s = view.snap;
  const a = s.phase === 'playing' ? s.auction : null;
  el.auctionBox.hidden = !a;
  clearInterval(view.auctionTimer);
  if (!a) return;
  const space = B.SPACES[a.space];
  const me = mySeat();
  const inIt = me !== null && a.bidders.includes(me) && !a.out.includes(me);
  const myCash = seatInfo(me)?.money || 0;
  const leader = a.bidder === null ? 'No bids yet' : `${escapeHtml(nameOf(a.bidder))} ${a.bidder === me ? 'lead' : 'leads'}`;
  const steps = [1, 10, 50, 100];
  const buttons = inIt
    ? steps.map((n) => {
        const amt = (a.high || 0) + n;
        return `<button class="btn btn-secondary" type="button" data-bid="${amt}" ${amt > myCash || a.bidder === me ? 'disabled' : ''}>+$${n}</button>`;
      }).join('') + `<button class="btn btn-ghost" type="button" data-fold="1" ${a.bidder === me ? 'disabled' : ''}>Drop out</button>`
    : `<p class="muted small">${a.out.includes(me) ? 'You dropped out.' : 'Watching the auction.'}</p>`;
  el.auctionBox.innerHTML = `<div class="band" style="background:${spaceColor(space)}"><small>AUCTION</small>${escapeHtml(space.name)}</div>
    <div class="ty-auction-body"><div class="ty-bid"><span>${money(a.high)}</span><small>${leader} · list price ${money(space.price)}</small></div>
    <div class="ty-timer"><i></i></div><div class="ty-bid-buttons">${buttons}</div>
    <p class="muted small">Still in: ${a.bidders.filter((b) => !a.out.includes(b)).map((b) => escapeHtml(nameOf(b))).join(', ')}</p></div>`;
  const bar = el.auctionBox.querySelector('.ty-timer i');
  const tick = () => {
    const left = Math.max(0, a.left - (performance.now() - view.snapAt));
    bar.style.width = `${Math.min(100, (left / 12000) * 100)}%`;
    bar.classList.toggle('hurry', left < 4000);
  };
  tick();
  view.auctionTimer = setInterval(tick, 200);
}

function renderOffer() {
  const s = view.snap;
  const o = s.offer;
  const me = mySeat();
  el.offerBox.hidden = !o || s.phase !== 'playing' || (me !== o.from && me !== o.to);
  if (el.offerBox.hidden) return;
  const list = (ids, cash) => {
    const bits = ids.map((id) => `<span style="color:${spaceColor(B.SPACES[id])}">■</span> ${escapeHtml(B.SPACES[id].name)}`);
    if (cash) bits.push(`<b>${money(cash)}</b>`);
    return bits.length ? bits.join(', ') : 'nothing';
  };
  if (o.to === me) {
    el.offerBox.innerHTML = `<div><b>${escapeHtml(nameOf(o.from))}</b> offers a trade:</div><div>You get: ${list(o.give, o.giveCash)}</div><div>You give: ${list(o.get, o.getCash)}</div><div class="row"><button class="btn btn-primary" data-accept="1" type="button">Accept</button><button class="btn btn-ghost" data-accept="0" type="button">Decline</button></div>`;
  } else {
    el.offerBox.innerHTML = `<div>Waiting for <b>${escapeHtml(nameOf(o.to))}</b> to answer your trade…</div><div>You give: ${list(o.give, o.giveCash)}</div><div>You get: ${list(o.get, o.getCash)}</div><div class="row"><button class="btn btn-ghost" data-cancel="1" type="button">Withdraw offer</button></div>`;
  }
}

function renderMine() {
  const s = view.snap;
  const me = mySeat();
  el.myBox.hidden = !(s.phase !== 'lobby' && me !== null && s.props);
  if (el.myBox.hidden) return;
  const mine = Object.entries(s.props)
    .filter(([, p]) => p.owner === me)
    .map(([id, p]) => ({ space: B.SPACES[id], prop: p }));
  el.myWorth.textContent = `worth ${money(seatInfo(me)?.worth || 0)}`;
  el.myProps.innerHTML = '';
  if (!mine.length) {
    el.myProps.innerHTML = '<p class="muted small">Nothing yet — land on a street to buy it.</p>';
    return;
  }
  const order = Object.keys(B.GROUPS);
  mine.sort((a, b) => (order.indexOf(a.space.group) + 1 || 99) - (order.indexOf(b.space.group) + 1 || 99) || a.space.id - b.space.id);
  const my = isMyTurn() && !view.animating && s.turnPhase !== 'jail';
  mine.forEach(({ space, prop }) => {
    const row = document.createElement('div');
    row.className = 'ty-prop';
    row.classList.toggle('mortgaged', prop.mortgaged);
    const rent = currentRent(space);
    const built = prop.houses === 5 ? '🏨' : '🏠'.repeat(prop.houses);
    row.innerHTML = `<span class="sw" style="background:${spaceColor(space)}"></span><span class="nm">${escapeHtml(space.name)} ${built}<small>${prop.mortgaged ? 'Mortgaged' : rent !== null ? `Rent ${money(rent)}` : space.type === 'utility' ? 'Rent: dice × 4 or 10' : ''}</small></span>`;
    if (space.type === 'street') {
      const full = B.groupSpaces(space.group).every((id) => s.props[id].owner === me);
      const plus = document.createElement('button');
      plus.textContent = '+🏠';
      plus.title = `Build (${money(B.GROUPS[space.group].house)})`;
      plus.dataset.act = 'build';
      plus.dataset.space = space.id;
      plus.disabled = !my || !full || prop.houses >= 5 || prop.mortgaged;
      const minus = document.createElement('button');
      minus.textContent = '−';
      minus.title = 'Sell a building for half price';
      minus.dataset.act = 'sell';
      minus.dataset.space = space.id;
      minus.disabled = !my || !prop.houses;
      row.append(plus, minus);
    }
    const m = document.createElement('button');
    m.textContent = prop.mortgaged ? '↺' : 'M';
    m.title = prop.mortgaged ? `Pay off mortgage (${money(Math.ceil((space.price / 2) * 1.1))})` : `Mortgage for ${money(space.price / 2)}`;
    m.dataset.act = 'mortgage';
    m.dataset.space = space.id;
    m.disabled = !my || prop.houses > 0;
    row.append(m);
    el.myProps.appendChild(row);
  });
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
      li.innerHTML = `${c ? `<i style="background:${c}"></i>` : ''}<b>${escapeHtml(nameOf(e.seat))}</b> ${escapeHtml(e.text)}`;
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
  el.goReason.textContent = s.endReason === 'rounds' ? 'Time is up — the richest player takes it.' : 'Everyone else went bankrupt.';
  el.goResults.innerHTML = '';
  [...s.seats]
    .sort((a, b) => b.worth - a.worth)
    .forEach((p) => {
      const row = document.createElement('div');
      if (p.seat === w) row.className = 'win';
      row.innerHTML = `<span>${tokenIcon(p.token, p.color)} ${escapeHtml(p.name)}${p.seat === mySeat() ? ' (you)' : ''}</span><span>${p.bankrupt ? 'bankrupt' : `worth ${money(p.worth)}`} · ${s.wins?.[p.name] || 0} wins</span>`;
      el.goResults.appendChild(row);
    });
  renderRematch();
  if (view.overShownRound !== s.round && !view.animating) {
    view.overShownRound = s.round;
    bigText(w === mySeat() ? 'YOU WIN!' : `${nameOf(w).toUpperCase()} WINS`, 'Monopoly champion', w === mySeat() || s.spectator ? 'info' : 'hit');
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
    el.rematchNote.textContent = 'Stick around — the players may play again.';
  } else if (count < s.minPlayers) {
    el.rematchBtn.textContent = 'Reopen the room';
    el.rematchBtn.disabled = false;
    el.rematchNote.textContent = 'Everyone else left. Reopen and share the code again.';
  } else if (s.isHost) {
    el.rematchBtn.textContent = `New game for ${count}`;
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

function renderDiceChip(d) {
  el.diceChip.hidden = !d;
  if (d) el.diceChip.innerHTML = `<b>${d[0]}</b><b>${d[1]}</b>${d[0] === d[1] ? ' doubles!' : ` = ${d[0] + d[1]}`}`;
}

function renderAll() {
  const s = view.snap;
  if (!s) return;
  renderBoard();
  renderPlayers();
  renderLobby();
  renderStatus();
  renderActions();
  renderAuction();
  renderOffer();
  renderMine();
  renderLog();
  renderGameOver();
}

// ---------------------------------------------------------------------------
// Events → animations
// ---------------------------------------------------------------------------

function showCard(e) {
  const d = { ...DECK[e.deck], title: themeInfo().decks[e.deck] };
  el.cardFace.innerHTML = `<h3 style="background:${d.color}">${d.title}</h3><div>${escapeHtml(e.text)}</div><div class="who">${escapeHtml(nameOf(e.seat))} drew this card · tap to close</div>`;
  el.cardPop.hidden = false;
  sound.rotate();
  return new Promise((resolve) => {
    const done = () => {
      el.cardPop.hidden = true;
      el.cardPop.removeEventListener('click', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 2600);
    el.cardPop.addEventListener('click', done);
  });
}

async function playEvent(e) {
  const three = board3d?.visible;
  switch (e.type) {
    case 'dice':
      view.animSeat = e.seat;
      renderStatus();
      sound.clack();
      if (three) await board3d.rollDice(e.dice);
      else await wait(300);
      renderDiceChip(e.dice);
      if (e.dice[0] === e.dice[1]) sound.check();
      break;
    case 'move': {
      const fast = e.path.length > 12;
      if (three) {
        board3d.onStep = (id) => {
          view.pos.set(e.seat, id);
          if (id === 0) sound.crown();
          else sound.clack();
        };
        await board3d.moveToken(e.seat, e.path, { fast });
      } else {
        for (const id of e.path) {
          view.pos.set(e.seat, id);
          draw2d();
          sound.clack();
          await wait(fast ? 60 : 130);
        }
      }
      view.pos.set(e.seat, e.path.at(-1));
      break;
    }
    case 'pay': {
      if (e.from === null && e.reason === 'passed Start') {
        bigText('+$200', `${nameOf(e.to)} passed GO`, 'info');
      } else if (e.reason === 'rent') {
        bigText(`RENT ${money(e.amount)}`, `${nameOf(e.from)} → ${nameOf(e.to)}`, e.from === mySeat() ? 'hit' : 'info');
      } else if (e.reason === 'jackpot') {
        bigText('JACKPOT!', `${nameOf(e.to)} collects ${money(e.amount)}`, 'info');
      } else if (e.reason === 'tax') {
        bigText(`TAX ${money(e.amount)}`, nameOf(e.from), 'hit');
      }
      if (e.amount > 0) {
        if (e.to !== null && e.from !== null) sound.capture();
        else sound.place();
        if (three) await board3d.coins(e.from, e.to, e.amount);
        else await wait(200);
      }
      break;
    }
    case 'auction':
      sound.check();
      bigText('AUCTION!', `${B.SPACES[e.space].name} is up for grabs`, 'info');
      await wait(300);
      break;
    case 'bid':
      sound.click();
      break;
    case 'unsold':
      toast(`Nobody bid on ${B.SPACES[e.space].name}.`);
      break;
    case 'buy': {
      const space = B.SPACES[e.space];
      sound.crown();
      bigText(e.auction ? `SOLD! ${money(e.price)}` : 'SOLD!', `${space.name} → ${nameOf(e.seat)}`, 'info');
      if (three) board3d.burst(e.space, spaceColor(space));
      renderBoard();
      await wait(350);
      break;
    }
    case 'card':
      if (three) await board3d.liftCard(e.deck);
      await showCard(e);
      board3d?.dropCard();
      break;
    case 'jail':
      sound.error();
      bigText('JAIL!', `${nameOf(e.seat)} ${e.seat === mySeat() ? 'are' : 'is'} locked up`, 'hit');
      if (three) await board3d.jumpToJail(e.seat);
      view.pos.set(e.seat, 10);
      break;
    case 'free':
      bigText('FREE!', `${nameOf(e.seat)} ${e.seat === mySeat() ? 'walk' : 'walks'} out of Jail`, 'info');
      break;
    case 'build':
      sound.place();
      renderBoard();
      await wait(180);
      break;
    case 'bankrupt':
      sound.defeat();
      bigText('BANKRUPT!', nameOf(e.seat), 'hit');
      await wait(700);
      break;
    case 'offer':
      if (e.to === mySeat()) {
        toast(`${nameOf(e.from)} offers you a trade!`);
        sound.message();
      }
      break;
    case 'trade':
      if (e.accepted) {
        bigText('DEAL!', `${nameOf(e.from)} 🤝 ${nameOf(e.to)}`, 'info');
        sound.crown();
      } else if (e.from === mySeat()) toast(`${nameOf(e.to)} declined your trade.`);
      break;
    default:
      break;
  }
}

async function runQueue() {
  if (view.animating) return;
  view.animating = true;
  renderActions();
  while (view.queue.length) {
    const e = view.queue.shift();
    await playEvent(e);
    renderPlayers();
    if (board3d?.follow && view.snap?.turn !== undefined) board3d.focusOn(view.snap.turn);
  }
  view.animating = false;
  view.animSeat = null;
  syncPositions();
  renderAll();
  announceTurn();
}

function syncPositions() {
  view.snap?.seats?.forEach((p) => view.pos.set(p.seat, p.pos));
}

function announceTurn() {
  const s = view.snap;
  if (!s || s.phase !== 'playing') return;
  const key = `${s.round}:${s.turn}:${s.events.at(-1)?.id}`;
  if (isMyTurn() && (s.turnPhase === 'roll' || s.turnPhase === 'jail') && view.lastTurnKey !== key) {
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
  renderActions();
  const res = await table.client.send(event, payload);
  view.pending = false;
  if (res.error) {
    toast(res.error, 'error');
    sound.error();
  }
  if (!view.animating) renderAll();
  return res;
}

function openTrade() {
  const s = view.snap;
  const others = s.seats.filter((p) => p.seat !== mySeat() && !p.bankrupt && !p.gone);
  if (!others.length) return;
  el.tradeWith.innerHTML = others.map((p) => `<option value="${p.seat}">${escapeHtml(p.name)}</option>`).join('');
  el.tradeGiveCash.value = 0;
  el.tradeGetCash.value = 0;
  fillTradeLists();
  el.tradeModal.hidden = false;
}

function tradeable(owner) {
  const s = view.snap;
  return Object.entries(s.props)
    .filter(([id, p]) => p.owner === owner && !(B.SPACES[id].group && B.groupSpaces(B.SPACES[id].group).some((g) => s.props[g].houses > 0)))
    .map(([id]) => B.SPACES[id]);
}

function fillTradeLists() {
  const other = Number(el.tradeWith.value);
  const fill = (node, spaces) => {
    node.innerHTML = spaces.length
      ? spaces.map((sp) => `<label><input type="checkbox" value="${sp.id}" /><i style="background:${spaceColor(sp)}"></i>${escapeHtml(sp.name)}${view.snap.props[sp.id].mortgaged ? ' (M)' : ''}</label>`).join('')
      : '<p class="none">No property to trade</p>';
  };
  fill(el.tradeGive, tradeable(mySeat()));
  fill(el.tradeGet, tradeable(other));
}

async function sendTrade() {
  const checked = (node) => [...node.querySelectorAll('input:checked')].map((i) => Number(i.value));
  const res = await send('ty:offer', {
    to: Number(el.tradeWith.value),
    give: checked(el.tradeGive),
    get: checked(el.tradeGet),
    giveCash: Number(el.tradeGiveCash.value) || 0,
    getCash: Number(el.tradeGetCash.value) || 0,
  });
  if (res.ok) {
    el.tradeModal.hidden = true;
    toast('Offer sent!');
  }
}

// ---------------------------------------------------------------------------
// State updates
// ---------------------------------------------------------------------------

function useTheme(next) {
  next = next === 'pokemon' ? 'pokemon' : 'classic';
  if (next === theme && view.themeApplied) return;
  theme = next;
  view.themeApplied = true;
  B.applyTheme(theme);
  setArtTheme(theme);
  boardImage = null;
  board3d?.setTheme(theme);
  document.body.classList.toggle('pokemon', theme === 'pokemon');
}

function onState(snap, prev) {
  view.snap = snap;
  view.snapAt = performance.now();
  useTheme(snap.options?.theme);
  const newRound = !prev || prev.round !== snap.round || (prev.phase !== 'playing' && snap.phase === 'playing');
  if (newRound && snap.events) {
    view.queue = [];
    view.lastEvent = snap.events.at(-1)?.id ?? 0;
    view.lastTurnKey = null;
    view.lastMoney.clear();
    view.pos.clear();
    syncPositions();
    renderDiceChip(null);
    if (snap.phase === 'playing' && prev && prev.phase !== 'playing') {
      const me = seatInfo(snap.seat);
      bigText('LET’S DO BUSINESS!', me ? `You play the ${themeInfo().tokenNames[me.token]}` : 'Enjoy the game', 'info');
      sound.joined();
    }
  }
  sound.setMood(snap.phase === 'playing' ? 'battle' : 'calm');
  const fresh = (snap.events || []).filter((e) => e.id > view.lastEvent);
  if (fresh.length) {
    view.lastEvent = fresh.at(-1).id;
    view.queue.push(...fresh);
    runQueue();
  }
  if (!view.animating && !view.queue.length) {
    syncPositions();
    renderAll();
    announceTurn();
  } else {
    renderPlayers();
    renderLobby();
    renderLog();
    renderOffer();
    renderAuction();
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
  game: 'monopoly',
  title: 'Monopoly',
  onState,
  onExit() {
    view.snap = null;
    view.overShownRound = null;
    view.queue = [];
    view.lastEvent = 0;
  },
  isPlaying: (snap) => snap.phase === 'playing' && !snap.spectator,
  leaveWarning: 'Leave the game? Your property goes back to the bank.',
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
    board3d = new TycoonBoard3D(el.canvas3d, { quality });
    board3d.setTheme(theme);
    board3d.follow = prefs.follow;
    board3d.onHover = (id, x, y) => showTip(id, x, y);
    board3d.onSpace = (id, x, y) => {
      showTip(id, x, y);
      clearTimeout(view.tipTimer);
      view.tipTimer = setTimeout(() => (el.tip.hidden = true), 3200);
    };
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

el.rollBtn.addEventListener('click', () => {
  sound.click();
  send('ty:roll');
});
el.buyBtn.addEventListener('click', () => send('ty:buy'));
el.passBtn.addEventListener('click', () => send('ty:pass'));
el.endBtn.addEventListener('click', () => send('ty:end'));
el.fineBtn.addEventListener('click', () => send('ty:fine'));
el.cardBtn.addEventListener('click', () => send('ty:jailcard'));
el.tradeBtn.addEventListener('click', openTrade);
el.giveUpBtn.addEventListener('click', () => {
  if (window.confirm('Give up? Your property goes back to the bank.')) send('ty:giveup');
});
el.tradeWith.addEventListener('change', fillTradeLists);
el.tradeSend.addEventListener('click', sendTrade);
el.tradeCancel.addEventListener('click', () => (el.tradeModal.hidden = true));
el.auctionBox.addEventListener('click', (event) => {
  const b = event.target.closest('button');
  if (!b || b.disabled) return;
  if (b.dataset.fold) send('ty:fold');
  else send('ty:bid', { amount: Number(b.dataset.bid) });
});
el.tokenPick.addEventListener('click', async (event) => {
  const b = event.target.closest('button[data-token]');
  if (!b || b.disabled) return;
  sound.click();
  const res = await client.send('ty:token', { token: b.dataset.token });
  if (res.error) toast(res.error, 'error');
});
el.offerBox.addEventListener('click', (event) => {
  const b = event.target.closest('button');
  if (!b) return;
  if (b.dataset.cancel) send('ty:respond', { cancel: true });
  else send('ty:respond', { accept: b.dataset.accept === '1' });
});
el.myProps.addEventListener('click', (event) => {
  const b = event.target.closest('button[data-act]');
  if (!b || b.disabled) return;
  sound.click();
  send(`ty:${b.dataset.act}`, { space: Number(b.dataset.space) });
});
el.canvas2d.addEventListener('mousemove', (e) => showTip(spaceAt2d(e), e.clientX, e.clientY));
el.canvas2d.addEventListener('mouseleave', () => (el.tip.hidden = true));
el.canvas2d.addEventListener('click', (e) => showTip(spaceAt2d(e), e.clientX, e.clientY));
el.startBtn.addEventListener('click', async () => {
  sound.click();
  const res = await client.send('room:start');
  if (res.error) toast(res.error, 'error');
});
document.getElementById('tycoonRules').addEventListener('click', async (event) => {
  const b = event.target.closest('button[data-value]');
  if (!b || b.disabled) return;
  const key = b.parentElement.dataset.option;
  const value = key === 'cash' ? Number(b.dataset.value) : b.dataset.value;
  const res = await client.send('room:options', { [key]: value });
  if (res.error) toast(res.error, 'error');
});
el.status.addEventListener('click', () => {
  if (view.snap?.phase === 'over') el.gameOver.hidden = false;
});
el.viewButtons.forEach((btn) =>
  btn.addEventListener('click', () => {
    prefs.view = btn.dataset.view;
    store('local', 'tycoon:prefs', JSON.stringify(prefs));
    const ok = useView(prefs.view);
    if (prefs.view === '3d' && !ok) toast('3D is not supported on this device.', 'error');
  })
);
$('settingsBtn').addEventListener('click', () => {
  el.followToggle.checked = prefs.follow;
});
el.followToggle.addEventListener('change', () => {
  prefs.follow = el.followToggle.checked;
  store('local', 'tycoon:prefs', JSON.stringify(prefs));
  if (board3d) board3d.follow = prefs.follow;
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!el.tradeModal.hidden) {
      el.tradeModal.hidden = true;
      return;
    }
    table.handleEscape();
  }
  if (document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if ((event.key === ' ' || event.key === 'Enter') && !el.rollBtn.hidden && !el.rollBtn.disabled) {
    event.preventDefault();
    el.rollBtn.click();
  }
});
document.fonts?.ready.then(() => {
  boardImage = null;
  setArtTheme(theme);
  board3d?.refreshTexture();
  draw2d();
});

useView(prefs.view);
client.autoStart();

// Test hook: `?debug` exposes internals for automated browser tests.
if (new URLSearchParams(location.search).has('debug')) window.tycoonPage = { view, client, B, get board3d() { return board3d; } };
