// Monopoly: a property-trading board game for 2–6 players. Roll round the board,
// buy streets, build houses and hotels, trade with friends and bankrupt everyone.
// Board data lives in public/shared/tycoon-board.js.

const crypto = require('crypto');
const B = require('../../public/shared/tycoon-board.js');

const PASS_START = 200;
const JAIL_FINE = 50;
const LOG_LIMIT = 60;

const OPTION_TEXT = {
  cash: { 1500: 'Everyone starts with $1,500.', 2500: 'Rich start — everyone gets $2,500.' },
  length: { classic: 'Play until one tycoon is left standing.', short: 'Short game — after 20 rounds the richest player wins.' },
  theme: { classic: 'Edition: Classic Monopoly.', pokemon: 'Edition: Pokémon Monopoly! Catch Pokémon instead of streets.' },
  auction: { on: 'Auctions: property you pass on goes up for auction.', off: 'No auctions: property you pass on stays with the bank.' },
  jackpot: { off: 'Free Parking is just a rest.', on: 'Jackpot! Taxes and fees pile up on Free Parking for whoever lands there.' },
};
const SHORT_ROUNDS = 20;

const die = () => crypto.randomInt(1, 7);
const money = (n) => `$${n.toLocaleString('en-US')}`;

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const live = (state) => state.order.filter((s) => !state.players[s].bankrupt && !state.players[s].gone);

function nextSeat(state, from) {
  const order = state.order;
  let i = order.indexOf(from);
  for (let n = 0; n < order.length; n += 1) {
    i = (i + 1) % order.length;
    const p = state.players[order[i]];
    if (!p.bankrupt && !p.gone) return order[i];
  }
  return from;
}

function log(state, text, seat = null) {
  state.log.push({ text, seat });
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

function event(state, data) {
  state.eventId += 1;
  state.events.push({ id: state.eventId, ...data });
  if (state.events.length > 30) state.events.splice(0, state.events.length - 30);
}

const nm = (state, id) => B.spaceName(id, state.options.theme);
const ownerOf = (state, id) => state.props[id]?.owner ?? null;

function ownsGroup(state, seat, group) {
  return B.groupSpaces(group).every((id) => ownerOf(state, id) === seat);
}

function groupHasBuildings(state, group) {
  return B.groupSpaces(group).some((id) => state.props[id]?.houses > 0);
}

function rentFor(state, space, dice) {
  const prop = state.props[space.id];
  if (!prop || prop.owner === null || prop.mortgaged) return 0;
  if (space.type === 'street') {
    if (prop.houses > 0) return space.rent[prop.houses];
    const full = ownsGroup(state, prop.owner, space.group) && B.groupSpaces(space.group).every((id) => !state.props[id].mortgaged);
    return full ? space.rent[0] * 2 : space.rent[0];
  }
  if (space.type === 'station') {
    const n = B.SPACES.filter((s) => s.type === 'station' && ownerOf(state, s.id) === prop.owner).length;
    return B.STATION_RENT[n];
  }
  if (space.type === 'utility') {
    const n = B.SPACES.filter((s) => s.type === 'utility' && ownerOf(state, s.id) === prop.owner).length;
    return dice * (n === 2 ? 10 : 4);
  }
  return 0;
}

function netWorth(state, seat) {
  const p = state.players[seat];
  let total = p.money;
  Object.entries(state.props).forEach(([id, prop]) => {
    if (prop.owner !== seat) return;
    const space = B.SPACES[id];
    total += prop.mortgaged ? space.price / 2 : space.price;
    if (prop.houses) total += prop.houses * B.GROUPS[space.group].house;
  });
  return total;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

// Sell buildings and mortgage property until the player is out of debt.
function liquidate(ctx, seat) {
  const state = ctx.room.state;
  const p = state.players[seat];
  const mine = Object.keys(state.props)
    .map(Number)
    .filter((id) => state.props[id].owner === seat);
  // Houses first, most expensive first, keeping groups even.
  while (p.money < 0) {
    const withHouses = mine.filter((id) => state.props[id].houses > 0);
    if (!withHouses.length) break;
    withHouses.sort((a, b) => state.props[b].houses - state.props[a].houses || B.GROUPS[B.SPACES[b].group].house - B.GROUPS[B.SPACES[a].group].house);
    const id = withHouses[0];
    const half = B.GROUPS[B.SPACES[id].group].house / 2;
    if (state.props[id].houses === 5 && bankStock(state).houses < 4) {
      // No houses to swap in: the whole hotel goes back to the bank.
      p.money += half * 5;
      state.props[id].houses = 0;
    } else {
      state.props[id].houses -= 1;
      p.money += half;
    }
    log(state, `sells a building on ${nm(state, id)}`, seat);
    event(state, { type: 'build', seat, space: id, houses: state.props[id].houses });
  }
  while (p.money < 0) {
    const free = mine.filter((id) => !state.props[id].mortgaged && !state.props[id].houses);
    if (!free.length) break;
    free.sort((a, b) => B.SPACES[a].price - B.SPACES[b].price);
    const id = free[0];
    state.props[id].mortgaged = true;
    p.money += B.SPACES[id].price / 2;
    log(state, `mortgages ${nm(state, id)}`, seat);
    event(state, { type: 'mortgage', seat, space: id, mortgaged: true });
  }
}

function bankrupt(ctx, seat, creditor) {
  const state = ctx.room.state;
  const p = state.players[seat];
  p.bankrupt = true;
  p.money = 0;
  if (state.offer && (state.offer.from === seat || state.offer.to === seat)) state.offer = null;
  Object.entries(state.props).forEach(([id, prop]) => {
    if (prop.owner !== seat) return;
    if (creditor !== null && creditor !== undefined) {
      prop.owner = creditor;
      prop.houses = 0;
    } else {
      state.props[id] = { owner: null, houses: 0, mortgaged: false };
    }
  });
  if (creditor !== null && creditor !== undefined) state.players[creditor].jailCards += p.jailCards;
  p.jailCards = 0;
  log(state, creditor !== null && creditor !== undefined ? `goes bankrupt! Everything goes to ${state.names[creditor]}.` : 'goes bankrupt!', seat);
  event(state, { type: 'bankrupt', seat, creditor });
  ctx.system(`${state.names[seat]} is bankrupt.`);
  checkWinner(ctx);
}

// Pay money to another player (or the bank when `to` is null). Returns false if bankrupt.
function pay(ctx, from, to, amount, reason, { toPot = false } = {}) {
  const state = ctx.room.state;
  if (amount <= 0) return true;
  const p = state.players[from];
  p.money -= amount;
  if (p.money < 0) liquidate(ctx, from);
  let paid = amount;
  if (p.money < 0) paid = amount + p.money;
  if (to !== null) state.players[to].money += paid;
  else if (toPot && state.options.jackpot === 'on') state.pot += paid;
  event(state, { type: 'pay', from, to, amount: paid, reason });
  if (p.money < 0) {
    bankrupt(ctx, from, to);
    return false;
  }
  return true;
}

function gain(state, seat, amount, reason) {
  state.players[seat].money += amount;
  event(state, { type: 'pay', from: null, to: seat, amount, reason });
}

function checkWinner(ctx) {
  const { room } = ctx;
  const state = room.state;
  const alive = live(state);
  if (alive.length === 1 && room.status === 'active') {
    finishWith(ctx, alive[0], 'last');
    return true;
  }
  return false;
}

function finishWith(ctx, seat, reason) {
  const { room } = ctx;
  const name = room.state.names[seat];
  room.meta.wins = room.meta.wins || {};
  room.meta.wins[name] = (room.meta.wins[name] || 0) + 1;
  room.state.phase = 'over';
  ctx.finish(seat, reason);
  ctx.system(reason === 'rounds' ? `Time's up! ${name} is the richest player.` : `${name} is the last player standing!`);
}


// Tokens picked in the lobby, ignoring seats that have since emptied or clashes.
function validPicks(room) {
  const picks = {};
  const used = new Set();
  Object.entries(room.meta.tokens || {}).forEach(([seat, token]) => {
    if (room.players[seat] && B.themeOf(room.options.theme).tokens.includes(token) && !used.has(token)) {
      picks[seat] = token;
      used.add(token);
    }
  });
  return picks;
}

// Buildings still in the bank.
function bankStock(state) {
  let houses = B.BANK_HOUSES;
  let hotels = B.BANK_HOTELS;
  Object.values(state.props).forEach((p) => {
    if (p.houses === 5) hotels -= 1;
    else houses -= p.houses;
  });
  return { houses, hotels };
}

// ---------------------------------------------------------------------------
// Auctions
// ---------------------------------------------------------------------------

const AUCTION_MS = 12000;

function startAuction(ctx, space) {
  const { room } = ctx;
  const state = room.state;
  const bidders = live(state).filter((s) => state.players[s].money > 0);
  if (!bidders.length) return false;
  state.auction = { space: space.id, high: 0, bidder: null, out: [], bidders, deadline: Date.now() + AUCTION_MS };
  state.phase = 'auction';
  log(state, `puts ${nm(state, space.id)} up for auction`, state.turn);
  event(state, { type: 'auction', space: space.id });
  armAuctionTimer(ctx);
  return true;
}

function armAuctionTimer(ctx) {
  const { room } = ctx;
  clearTimeout(room.meta.auctionTimer);
  const a = room.state.auction;
  if (!a) return;
  room.meta.auctionTimer = setTimeout(() => {
    if (room.state?.auction !== a || room.status !== 'active') return;
    finishAuction(ctx);
    ctx.broadcast();
  }, Math.max(0, a.deadline - Date.now()));
  room.meta.auctionTimer.unref?.();
}

function finishAuction(ctx) {
  const { room } = ctx;
  const state = room.state;
  const a = state.auction;
  clearTimeout(room.meta.auctionTimer);
  state.auction = null;
  const space = B.SPACES[a.space];
  if (a.bidder !== null && state.players[a.bidder] && !state.players[a.bidder].bankrupt) {
    state.players[a.bidder].money -= a.high;
    state.props[space.id].owner = a.bidder;
    log(state, `wins the auction for ${nm(state, space.id)} at ${money(a.high)}`, a.bidder);
    event(state, { type: 'buy', seat: a.bidder, space: space.id, price: a.high, auction: true });
  } else {
    log(state, `Nobody bid on ${nm(state, space.id)}.`);
    event(state, { type: 'unsold', space: space.id });
  }
  state.phase = null;
  afterLanding(state);
}

// Ends early once everyone else has dropped out.
function checkAuction(ctx) {
  const a = ctx.room.state.auction;
  const still = a.bidders.filter((s) => !a.out.includes(s) && s !== a.bidder);
  if (!still.length) finishAuction(ctx);
}

// ---------------------------------------------------------------------------
// Movement and landing
// ---------------------------------------------------------------------------

function sendToJail(ctx, seat) {
  const state = ctx.room.state;
  const p = state.players[seat];
  p.pos = B.JAIL;
  p.jail = 1;
  state.again = false;
  state.doubles = 0;
  log(state, 'goes to Jail!', seat);
  event(state, { type: 'jail', seat });
}

function moveTo(ctx, seat, target, { passStart = true, steps = null } = {}) {
  const state = ctx.room.state;
  const p = state.players[seat];
  const from = p.pos;
  const forward = steps !== null ? steps : (target - from + 40) % 40;
  const path = [];
  for (let i = 1; i <= Math.abs(forward); i += 1) path.push((from + (forward > 0 ? i : -i) + 40) % 40);
  p.pos = (from + forward + 40) % 40;
  event(state, { type: 'move', seat, path });
  if (passStart && forward > 0 && from + forward >= 40) {
    gain(state, seat, PASS_START, 'passed Start');
    log(state, `passes GO and collects ${money(PASS_START)}`, seat);
  }
}

function drawCard(ctx, seat, deck, dice) {
  const state = ctx.room.state;
  const d = state.decks[deck];
  if (!d.pile.length) d.pile = shuffle(B.CARDS[deck].map((_, i) => i).filter((i) => !d.held.includes(i)));
  const index = d.pile.shift();
  const card = B.CARDS[deck][index];
  const p = state.players[seat];
  const text = B.cardText(deck, index, state.options.theme);
  event(state, { type: 'card', seat, deck, text });
  log(state, `draws: “${text}”`, seat);
  const e = card.do;
  if (!e.jailCard) d.pile.push(index);
  if (e.money > 0) gain(state, seat, e.money, 'card');
  if (e.money < 0) pay(ctx, seat, null, -e.money, 'card', { toPot: true });
  if (e.jailCard) {
    p.jailCards += 1;
    d.held.push(index);
    p.heldCards.push({ deck, index });
  }
  if (e.jail) sendToJail(ctx, seat);
  if (e.eachPlayer) {
    live(state)
      .filter((s) => s !== seat)
      .forEach((s) => {
        if (e.eachPlayer < 0) pay(ctx, seat, s, -e.eachPlayer, 'card');
        else pay(ctx, s, seat, e.eachPlayer, 'birthday');
      });
  }
  if (e.repairs) {
    let cost = 0;
    Object.values(state.props).forEach((prop) => {
      if (prop.owner !== seat || !prop.houses) return;
      cost += prop.houses === 5 ? e.repairs[1] : prop.houses * e.repairs[0];
    });
    if (cost) pay(ctx, seat, null, cost, 'repairs', { toPot: true });
  }
  if (e.moveTo !== undefined) {
    moveTo(ctx, seat, e.moveTo);
    land(ctx, seat, dice);
  }
  if (e.back) {
    moveTo(ctx, seat, null, { passStart: false, steps: -e.back });
    land(ctx, seat, dice);
  }
  if (e.nearest) {
    let pos = p.pos;
    do pos = (pos + 1) % 40;
    while (B.SPACES[pos].type !== e.nearest);
    moveTo(ctx, seat, pos);
    land(ctx, seat, dice, { rentTimes: e.rentTimes, diceTimes: e.diceTimes });
  }
}

function land(ctx, seat, dice, { rentTimes = 1, diceTimes = null } = {}) {
  const { room } = ctx;
  const state = room.state;
  const p = state.players[seat];
  if (p.bankrupt || room.status !== 'active') return;
  const space = B.SPACES[p.pos];
  switch (space.type) {
    case 'street':
    case 'station':
    case 'utility': {
      const prop = state.props[space.id];
      if (prop.owner === null) {
        state.phase = 'buy';
        return;
      }
      if (prop.owner === seat || prop.mortgaged) return;
      let rent = diceTimes ? dice * diceTimes : rentFor(state, space, dice);
      rent *= rentTimes;
      log(state, `pays ${money(rent)} rent to ${state.names[prop.owner]} for ${nm(state, space.id)}`, seat);
      pay(ctx, seat, prop.owner, rent, 'rent');
      return;
    }
    case 'tax':
      log(state, `pays ${money(space.amount)} ${nm(state, space.id)}`, seat);
      pay(ctx, seat, null, space.amount, 'tax', { toPot: true });
      return;
    case 'card':
      drawCard(ctx, seat, space.deck, dice);
      return;
    case 'gotojail':
      sendToJail(ctx, seat);
      return;
    case 'rest':
      if (state.options.jackpot === 'on' && state.pot > 0) {
        log(state, `hits the jackpot: ${money(state.pot)}!`, seat);
        gain(state, seat, state.pot, 'jackpot');
        state.pot = 0;
      }
      return;
    default:
  }
}

function afterLanding(state) {
  if (state.phase === 'buy') return;
  state.phase = state.again && !state.players[state.turn].jail ? 'roll' : 'end';
}

function startTurn(ctx, seat) {
  const state = ctx.room.state;
  state.turn = seat;
  state.doubles = 0;
  state.again = false;
  state.dice = null;
  state.phase = state.players[seat].jail ? 'jail' : 'roll';
}

function endTurn(ctx) {
  const { room } = ctx;
  const state = room.state;
  const next = nextSeat(state, state.turn);
  if (state.order.indexOf(next) <= state.order.indexOf(state.turn)) {
    state.round += 1;
    if (state.options.length === 'short' && state.round > SHORT_ROUNDS) {
      const best = live(state).sort((a, b) => netWorth(state, b) - netWorth(state, a))[0];
      finishWith(ctx, best, 'rounds');
      return;
    }
  }
  startTurn(ctx, next);
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function view(ctx, seat) {
  const { room } = ctx;
  const state = room.state;
  const phase = room.status === 'waiting' ? 'lobby' : room.status === 'active' ? 'playing' : 'over';
  const base = { phase, minPlayers: module.exports.minPlayers, maxPlayers: module.exports.maxPlayers, wins: room.meta.wins || {}, tokenPicks: validPicks(room) };
  if (!state) return base;
  return {
    ...base,
    options: state.options,
    order: state.order,
    seats: state.order.map((s) => {
      const p = state.players[s];
      return { seat: s, name: state.names[s], token: p.token, color: p.color, money: p.money, pos: p.pos, jail: p.jail, jailCards: p.jailCards, bankrupt: p.bankrupt, gone: p.gone, worth: netWorth(state, s) };
    }),
    props: state.props,
    turn: phase === 'playing' ? state.turn : null,
    turnPhase: state.phase,
    dice: state.dice,
    doubles: state.doubles,
    again: state.again,
    pot: state.pot,
    round: state.round,
    maxRounds: state.options.length === 'short' ? SHORT_ROUNDS : null,
    offer: state.offer,
    auction: state.auction ? { ...state.auction, left: Math.max(0, state.auction.deadline - Date.now()) } : null,
    bank: bankStock(state),
    events: state.events,
    log: state.log,
    winnerSeat: room.result?.winner ?? null,
    endReason: room.result?.reason || null,
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function myTurn(ctx, seat) {
  const { room } = ctx;
  if (room.status !== 'active') return { error: 'The game is not running.' };
  if (room.state.turn !== seat) return { error: 'Wait for your turn.' };
  return null;
}

function ownedStreet(ctx, seat, id) {
  const state = ctx.room.state;
  const space = B.SPACES[Number(id)];
  if (!space || !B.BUYABLE.has(space.type)) return { error: 'That is not a property.' };
  if (state.props[space.id].owner !== seat) return { error: 'You do not own that.' };
  return { space, prop: state.props[space.id] };
}

function rollAndMove(ctx, seat) {
  const state = ctx.room.state;
  const p = state.players[seat];
  const d = [die(), die()];
  state.dice = d;
  const total = d[0] + d[1];
  const double = d[0] === d[1];
  event(state, { type: 'dice', seat, dice: d });
  if (p.jail) {
    if (double) {
      p.jail = 0;
      log(state, `rolls doubles (${d[0]}+${d[1]}) and walks out of Jail`, seat);
      state.again = false;
    } else if (p.jail >= 3) {
      log(state, `rolls ${d[0]}+${d[1]} — third try, pays the ${money(JAIL_FINE)} fine`, seat);
      p.jail = 0;
      if (!pay(ctx, seat, null, JAIL_FINE, 'jail', { toPot: true })) return;
    } else {
      p.jail += 1;
      log(state, `rolls ${d[0]}+${d[1]} — still in Jail`, seat);
      state.phase = 'end';
      return;
    }
  } else if (double) {
    state.doubles += 1;
    if (state.doubles === 3) {
      log(state, 'rolls a third double — speeding! Off to Jail.', seat);
      sendToJail(ctx, seat);
      state.phase = 'end';
      return;
    }
    state.again = true;
  } else {
    state.again = false;
  }
  log(state, `rolls ${d[0]}+${d[1]}${double ? ' (doubles!)' : ''}`, seat);
  moveTo(ctx, seat, null, { steps: total });
  land(ctx, seat, total);
  if (ctx.room.status !== 'active') return;
  if (state.players[seat].bankrupt) {
    endTurn(ctx);
    return;
  }
  afterLanding(state);
}

module.exports = {
  id: 'monopoly',
  title: 'Monopoly',
  minPlayers: 2,
  maxPlayers: 6,
  manualStart: true,

  defaultOptions() {
    return { cash: 1500, length: 'classic', jackpot: 'off', auction: 'on', theme: 'classic' };
  },

  canChangeOptions(ctx) {
    return ctx.room.status !== 'active';
  },

  applyOptions(ctx, payload) {
    const { options } = ctx.room;
    const cash = Number(payload.cash);
    if ((cash === 1500 || cash === 2500) && cash !== options.cash) {
      options.cash = cash;
      ctx.system(OPTION_TEXT.cash[cash]);
    }
    if (payload.length in OPTION_TEXT.length && payload.length !== options.length) {
      options.length = payload.length;
      ctx.system(OPTION_TEXT.length[payload.length]);
    }
    if (payload.theme in OPTION_TEXT.theme && payload.theme !== options.theme) {
      options.theme = payload.theme;
      // Each edition has its own tokens, so everyone picks again.
      ctx.room.meta.tokens = {};
      ctx.system(OPTION_TEXT.theme[payload.theme]);
    }
    if (payload.auction in OPTION_TEXT.auction && payload.auction !== options.auction) {
      options.auction = payload.auction;
      ctx.system(OPTION_TEXT.auction[payload.auction]);
    }
    if (payload.jackpot in OPTION_TEXT.jackpot && payload.jackpot !== options.jackpot) {
      options.jackpot = payload.jackpot;
      ctx.system(OPTION_TEXT.jackpot[payload.jackpot]);
    }
  },

  start(ctx) {
    const { room } = ctx;
    const order = room.players.map((p, seat) => (p ? seat : null)).filter((s) => s !== null);
    const players = {};
    const names = {};
    // Everyone keeps the token they picked in the lobby; the rest get what's left.
    const picks = validPicks(room);
    const left = B.themeOf(room.options.theme).tokens.filter((t) => !Object.values(picks).includes(t));
    order.forEach((seat, i) => {
      names[seat] = ctx.name(seat);
      const token = picks[seat] || left.shift();
      players[seat] = { money: room.options.cash === 2500 ? 2500 : 1500, pos: 0, jail: 0, jailCards: 0, heldCards: [], bankrupt: false, gone: false, token, color: B.PLAYER_COLORS[i % B.PLAYER_COLORS.length] };
    });
    const props = {};
    B.SPACES.forEach((s) => {
      if (B.BUYABLE.has(s.type)) props[s.id] = { owner: null, houses: 0, mortgaged: false };
    });
    const prev = room.meta.lastWinner;
    const first = order.includes(prev) ? prev : order[crypto.randomInt(order.length)];
    const state = {
      options: { ...room.options },
      order,
      names,
      players,
      props,
      decks: {
        lucky: { pile: shuffle(B.CARDS.lucky.map((_, i) => i)), held: [] },
        town: { pile: shuffle(B.CARDS.town.map((_, i) => i)), held: [] },
      },
      turn: first,
      phase: 'roll',
      dice: null,
      doubles: 0,
      again: false,
      pot: 0,
      round: 1,
      offer: null,
      auction: null,
      events: [],
      eventId: 0,
      log: [],
    };
    ctx.system(`${names[first]} rolls first. Good luck!`);
    return state;
  },

  onFinish(ctx) {
    const { room } = ctx;
    clearTimeout(room.meta.auctionTimer);
    if (room.state) room.state.auction = null;
    if (room.result?.winner !== null && room.result?.winner !== undefined) room.meta.lastWinner = room.result.winner;
  },

  onLeave(ctx, seat) {
    const { room } = ctx;
    const state = room.state;
    if (!state || state.players[seat].bankrupt) return;
    state.players[seat].gone = true;
    const a = state.auction;
    if (a) {
      a.out.push(seat);
      if (a.bidder === seat) {
        a.bidder = null;
        a.high = 0;
      }
    }
    // Their property goes back to the bank.
    bankrupt(ctx, seat, null);
    if (room.status === 'active' && state.auction) checkAuction(ctx);
    if (room.status === 'active' && state.turn === seat) {
      if (state.auction) finishAuction(ctx);
      endTurn(ctx);
    }
  },

  view,

  actions: {
    // Lobby: pick a token.
    'ty:token'(ctx, seat, payload) {
      const { room } = ctx;
      if (room.status === 'active') return { error: 'Tokens are chosen before the game starts.' };
      if (!B.themeOf(room.options.theme).tokens.includes(payload.token)) return { error: 'Unknown token.' };
      const picks = validPicks(room);
      const taken = Object.entries(picks).find(([s, t]) => t === payload.token && Number(s) !== seat);
      if (taken) return { error: `${ctx.name(Number(taken[0]))} already picked that token.` };
      room.meta.tokens = { ...picks, [seat]: payload.token };
      return { ok: true };
    },

    'ty:bid'(ctx, seat, payload) {
      const { room } = ctx;
      const state = room.state;
      const a = state?.auction;
      if (room.status !== 'active' || !a) return { error: 'There is no auction.' };
      if (!a.bidders.includes(seat) || a.out.includes(seat)) return { error: 'You are out of this auction.' };
      const amount = Math.floor(Number(payload.amount));
      if (!(amount > a.high)) return { error: `Bid more than ${money(a.high)}.` };
      if (amount > state.players[seat].money) return { error: 'You cannot bid more cash than you have.' };
      a.high = amount;
      a.bidder = seat;
      a.deadline = Math.max(a.deadline, Date.now() + 6000);
      event(state, { type: 'bid', seat, amount });
      armAuctionTimer(ctx);
      checkAuction(ctx);
      return { ok: true };
    },

    'ty:fold'(ctx, seat) {
      const { room } = ctx;
      const state = room.state;
      const a = state?.auction;
      if (room.status !== 'active' || !a) return { error: 'There is no auction.' };
      if (!a.bidders.includes(seat) || a.out.includes(seat)) return { error: 'You are already out.' };
      if (a.bidder === seat) return { error: 'You are the top bidder.' };
      a.out.push(seat);
      checkAuction(ctx);
      return { ok: true };
    },

    'ty:roll'(ctx, seat) {
      const err = myTurn(ctx, seat);
      if (err) return err;
      const state = ctx.room.state;
      if (state.phase !== 'roll' && state.phase !== 'jail') return { error: 'You cannot roll right now.' };
      rollAndMove(ctx, seat);
      return { ok: true };
    },

    'ty:buy'(ctx, seat) {
      const err = myTurn(ctx, seat);
      if (err) return err;
      const state = ctx.room.state;
      if (state.phase !== 'buy') return { error: 'There is nothing to buy.' };
      const p = state.players[seat];
      const space = B.SPACES[p.pos];
      if (p.money < space.price) return { error: `You need ${money(space.price)}.` };
      p.money -= space.price;
      state.props[space.id].owner = seat;
      log(state, `buys ${nm(state, space.id)} for ${money(space.price)}`, seat);
      event(state, { type: 'buy', seat, space: space.id });
      state.phase = null;
      afterLanding(state);
      return { ok: true };
    },

    'ty:pass'(ctx, seat) {
      const err = myTurn(ctx, seat);
      if (err) return err;
      const state = ctx.room.state;
      if (state.phase !== 'buy') return { error: 'There is nothing to pass on.' };
      const space = B.SPACES[state.players[seat].pos];
      log(state, `passes on ${nm(state, space.id)}`, seat);
      state.phase = null;
      if (state.options.auction !== 'off' && startAuction(ctx, space)) return { ok: true };
      afterLanding(state);
      return { ok: true };
    },

    'ty:end'(ctx, seat) {
      const err = myTurn(ctx, seat);
      if (err) return err;
      const state = ctx.room.state;
      if (state.phase !== 'end') return { error: state.phase === 'buy' ? 'Buy or pass first.' : 'Roll first.' };
      endTurn(ctx);
      return { ok: true };
    },

    'ty:fine'(ctx, seat) {
      const err = myTurn(ctx, seat);
      if (err) return err;
      const state = ctx.room.state;
      const p = state.players[seat];
      if (state.phase !== 'jail') return { error: 'You are not in Jail.' };
      if (p.money < JAIL_FINE) return { error: `You need ${money(JAIL_FINE)}.` };
      pay(ctx, seat, null, JAIL_FINE, 'jail', { toPot: true });
      p.jail = 0;
      state.phase = 'roll';
      log(state, `pays ${money(JAIL_FINE)} to leave Jail`, seat);
      event(state, { type: 'free', seat });
      return { ok: true };
    },

    'ty:jailcard'(ctx, seat) {
      const err = myTurn(ctx, seat);
      if (err) return err;
      const state = ctx.room.state;
      const p = state.players[seat];
      if (state.phase !== 'jail' || !p.jailCards) return { error: 'You have no Get Out of Jail Free card.' };
      p.jailCards -= 1;
      const card = p.heldCards.pop();
      if (card) {
        const d = state.decks[card.deck];
        d.held = d.held.filter((i) => i !== card.index);
        d.pile.push(card.index);
      }
      p.jail = 0;
      state.phase = 'roll';
      log(state, 'uses a Get Out of Jail Free card', seat);
      event(state, { type: 'free', seat });
      return { ok: true };
    },

    'ty:build'(ctx, seat, payload) {
      const err = myTurn(ctx, seat);
      if (err) return err;
      const state = ctx.room.state;
      const res = ownedStreet(ctx, seat, payload.space);
      if (res.error) return res;
      const { space, prop } = res;
      if (space.type !== 'street') return { error: 'You can only build on streets.' };
      if (!ownsGroup(state, seat, space.group)) return { error: 'You need the whole colour set first.' };
      const group = B.groupSpaces(space.group);
      if (group.some((id) => state.props[id].mortgaged)) return { error: 'Pay off the mortgages in this set first.' };
      if (prop.houses >= 5) return { error: 'That already has a hotel.' };
      const min = Math.min(...group.map((id) => state.props[id].houses));
      if (prop.houses > min) return { error: 'Build evenly across the set.' };
      const cost = B.GROUPS[space.group].house;
      if (state.players[seat].money < cost) return { error: `A building costs ${money(cost)}.` };
      const stock = bankStock(state);
      if (prop.houses < 4 && stock.houses <= 0) return { error: 'The bank has run out of houses!' };
      if (prop.houses === 4 && stock.hotels <= 0) return { error: 'The bank has run out of hotels!' };
      state.players[seat].money -= cost;
      prop.houses += 1;
      log(state, `builds ${prop.houses === 5 ? 'a hotel' : 'a house'} on ${nm(state, space.id)}`, seat);
      event(state, { type: 'build', seat, space: space.id, houses: prop.houses });
      return { ok: true };
    },

    'ty:sell'(ctx, seat, payload) {
      const err = myTurn(ctx, seat);
      if (err) return err;
      const state = ctx.room.state;
      const res = ownedStreet(ctx, seat, payload.space);
      if (res.error) return res;
      const { space, prop } = res;
      if (!prop.houses) return { error: 'There is nothing built there.' };
      const group = B.groupSpaces(space.group);
      const max = Math.max(...group.map((id) => state.props[id].houses));
      if (prop.houses < max) return { error: 'Sell evenly across the set.' };
      if (prop.houses === 5 && bankStock(state).houses < 4) return { error: 'The bank needs four houses to swap for your hotel — sell houses elsewhere first.' };
      prop.houses -= 1;
      state.players[seat].money += B.GROUPS[space.group].house / 2;
      log(state, `sells a building on ${nm(state, space.id)}`, seat);
      event(state, { type: 'build', seat, space: space.id, houses: prop.houses });
      return { ok: true };
    },

    'ty:mortgage'(ctx, seat, payload) {
      const err = myTurn(ctx, seat);
      if (err) return err;
      const state = ctx.room.state;
      const res = ownedStreet(ctx, seat, payload.space);
      if (res.error) return res;
      const { space, prop } = res;
      const p = state.players[seat];
      if (prop.mortgaged) {
        const cost = Math.ceil((space.price / 2) * 1.1);
        if (p.money < cost) return { error: `Paying it off costs ${money(cost)}.` };
        p.money -= cost;
        prop.mortgaged = false;
        log(state, `pays off the mortgage on ${nm(state, space.id)}`, seat);
      } else {
        if (space.group && groupHasBuildings(state, space.group)) return { error: 'Sell the buildings in this set first.' };
        prop.mortgaged = true;
        p.money += space.price / 2;
        log(state, `mortgages ${nm(state, space.id)} for ${money(space.price / 2)}`, seat);
      }
      event(state, { type: 'mortgage', seat, space: space.id, mortgaged: prop.mortgaged });
      return { ok: true };
    },

    // Trades: offer some of your property and cash for some of theirs.
    'ty:offer'(ctx, seat, payload) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active') return { error: 'The game is not running.' };
      if (state.offer) return { error: 'Another trade is on the table.' };
      const to = Number(payload.to);
      if (!live(state).includes(to) || to === seat) return { error: 'Pick a player to trade with.' };
      const clean = (list, owner) => {
        const ids = [...new Set((Array.isArray(list) ? list : []).map(Number))];
        for (const id of ids) {
          const space = B.SPACES[id];
          if (!space || !B.BUYABLE.has(space.type) || state.props[id].owner !== owner) return null;
          if (space.group && groupHasBuildings(state, space.group)) return null;
        }
        return ids;
      };
      const give = clean(payload.give, seat);
      const get = clean(payload.get, to);
      if (!give || !get) return { error: 'You can only trade property without buildings.' };
      const giveCash = Math.max(0, Math.floor(Number(payload.giveCash) || 0));
      const getCash = Math.max(0, Math.floor(Number(payload.getCash) || 0));
      if (!give.length && !get.length && !giveCash && !getCash) return { error: 'Put something in the trade.' };
      if (giveCash > state.players[seat].money) return { error: 'You do not have that much cash.' };
      state.offer = { from: seat, to, give, get, giveCash, getCash };
      log(state, `offers ${state.names[to]} a trade`, seat);
      event(state, { type: 'offer', from: seat, to });
      return { ok: true };
    },

    'ty:respond'(ctx, seat, payload) {
      const { room } = ctx;
      const state = room.state;
      const offer = state?.offer;
      if (!offer) return { error: 'There is no trade to answer.' };
      if (payload.cancel && offer.from === seat) {
        state.offer = null;
        log(state, 'withdraws the trade', seat);
        return { ok: true };
      }
      if (offer.to !== seat) return { error: 'That trade is not for you.' };
      state.offer = null;
      if (!payload.accept) {
        log(state, `turns down ${state.names[offer.from]}'s trade`, seat);
        event(state, { type: 'trade', from: offer.from, to: seat, accepted: false });
        return { ok: true };
      }
      const a = state.players[offer.from];
      const b = state.players[seat];
      const stillValid =
        offer.give.every((id) => state.props[id].owner === offer.from) &&
        offer.get.every((id) => state.props[id].owner === seat) &&
        a.money >= offer.giveCash &&
        b.money >= offer.getCash;
      if (!stillValid) return { error: 'That trade is no longer possible.' };
      offer.give.forEach((id) => (state.props[id].owner = seat));
      offer.get.forEach((id) => (state.props[id].owner = offer.from));
      a.money += offer.getCash - offer.giveCash;
      b.money += offer.giveCash - offer.getCash;
      log(state, `accepts ${state.names[offer.from]}'s trade 🤝`, seat);
      event(state, { type: 'trade', from: offer.from, to: seat, accepted: true });
      return { ok: true };
    },

    'ty:giveup'(ctx, seat) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active' || state.players[seat].bankrupt) return { error: 'You are not in the game.' };
      const wasTurn = state.turn === seat;
      bankrupt(ctx, seat, null);
      if (room.status === 'active' && wasTurn) endTurn(ctx);
      return { ok: true };
    },
  },

  _internal: { rentFor, netWorth },
};
