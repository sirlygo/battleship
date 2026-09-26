// Risk: world domination on the map in public/shared/risk-map.js.
// Rooms, seats and chat are handled by server/rooms.js.

const crypto = require('crypto');
const MAP = require('../../public/shared/risk-map.js');

const TERRITORIES = MAP.territories.map((t) => t.id);
const BY_ID = Object.fromEntries(MAP.territories.map((t) => [t.id, t]));
const NAME = (id) => BY_ID[id]?.name || id;
const START_ARMIES = { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 };
const CARD_TYPES = ['infantry', 'cavalry', 'artillery'];
const PROGRESSIVE = [4, 6, 8, 10, 12, 15];
const FIXED = { infantry: 4, cavalry: 6, artillery: 8, mixed: 10 };
const MAX_LOG = 150;
const MAX_BLITZ_ROUNDS = 200;

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const die = () => crypto.randomInt(6) + 1;
const rollDice = (n) => Array.from({ length: n }, die).sort((a, b) => b - a);

function makeDeck() {
  const cards = TERRITORIES.map((t, i) => ({ id: i + 1, territory: t, type: CARD_TYPES[i % 3] }));
  cards.push({ id: 43, territory: null, type: 'wild' }, { id: 44, territory: null, type: 'wild' });
  return shuffle(cards);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function owned(state, seat) {
  return TERRITORIES.filter((t) => state.owner[t] === seat);
}

function alive(state) {
  return state.order.filter((s) => !state.left.includes(s) && owned(state, s).length > 0);
}

function reinforcementsFor(state, seat) {
  const mine = owned(state, seat);
  let total = Math.max(3, Math.floor(mine.length / 3));
  const bonuses = [];
  MAP.continents.forEach((c) => {
    if (c.territories.every((t) => state.owner[t] === seat)) {
      total += c.bonus;
      bonuses.push(c.id);
    }
  });
  return { total, bonuses, count: mine.length };
}

function setValue(state, cards) {
  if (state.options.cards === 'fixed') {
    const types = cards.map((c) => c.type).filter((t) => t !== 'wild');
    const uniq = new Set(types);
    if (uniq.size === 1 && types.length === 3) return FIXED[types[0]];
    if (types.length < 3 && uniq.size === 1) return FIXED[types[0]];
    return FIXED.mixed;
  }
  const n = state.tradeCount;
  return n < PROGRESSIVE.length ? PROGRESSIVE[n] : 15 + (n - PROGRESSIVE.length + 1) * 5;
}

function validSet(cards) {
  if (cards.length !== 3) return false;
  const wild = cards.filter((c) => c.type === 'wild').length;
  if (wild >= 1) return true;
  const types = new Set(cards.map((c) => c.type));
  return types.size === 1 || types.size === 3;
}

function hasSet(hand) {
  for (let i = 0; i < hand.length; i += 1)
    for (let j = i + 1; j < hand.length; j += 1)
      for (let k = j + 1; k < hand.length; k += 1) if (validSet([hand[i], hand[j], hand[k]])) return true;
  return false;
}

function log(state, entry) {
  state.log.push({ id: state.logId++, ...entry });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

function connected(state, seat, from, to) {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const t = queue.shift();
    if (t === to) return true;
    BY_ID[t].adj.forEach((n) => {
      if (!seen.has(n) && state.owner[n] === seat) {
        seen.add(n);
        queue.push(n);
      }
    });
  }
  return false;
}

function beginTurn(ctx, seat) {
  const { state } = ctx.room;
  state.turn = seat;
  state.phase = 'reinforce';
  state.conquered = false;
  state.pendingMove = null;
  state.fortified = false;
  const r = reinforcementsFor(state, seat);
  state.reinforcements = r.total;
  state.bonuses = r.bonuses;
  state.turnNumber += 1;
}

function advanceTurn(ctx) {
  const { state } = ctx.room;
  const living = alive(state);
  if (!living.length) return;
  const idx = state.order.indexOf(state.turn);
  for (let i = 1; i <= state.order.length; i += 1) {
    const next = state.order[(idx + i) % state.order.length];
    if (living.includes(next)) {
      beginTurn(ctx, next);
      return;
    }
  }
}

function drawCard(state, seat) {
  if (!state.deck.length) {
    state.deck = shuffle(state.discard);
    state.discard = [];
  }
  const card = state.deck.pop();
  if (card) state.hands[seat].push(card);
  return card;
}

function checkWinner(ctx) {
  const { state } = ctx.room;
  const living = alive(state);
  if (living.length === 1) {
    const winner = living[0];
    const all = owned(state, winner).length === TERRITORIES.length;
    ctx.finish(winner, all ? 'domination' : 'last-standing');
    ctx.system(`${state.names[winner]} ${all ? 'conquers the world' : 'is the last commander standing'}!`);
    return true;
  }
  if (!living.length) {
    ctx.finish(null, 'abandoned');
    return true;
  }
  return false;
}

// Shorter win conditions chosen by the host.
function checkGoal(ctx, seat) {
  const { state } = ctx.room;
  const goal = state.options.goal || 'world';
  if (goal === 'half' && owned(state, seat).length >= 24) {
    ctx.finish(seat, 'goal-half');
    ctx.system(`${state.names[seat]} holds half the world and wins!`);
    return true;
  }
  if (goal === 'continents') {
    const held = MAP.continents.filter((c) => c.territories.every((t) => state.owner[t] === seat));
    if (held.length >= 3) {
      ctx.finish(seat, 'goal-continents');
      ctx.system(`${state.names[seat]} controls ${held.map((c) => c.name).join(', ')} and wins!`);
      return true;
    }
  }
  return false;
}

function finishTurn(ctx, seat) {
  const { state } = ctx.room;
  if (state.conquered) {
    drawCard(state, seat);
  }
  advanceTurn(ctx);
}

function parseCount(value, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function view(ctx, seat) {
  const { room } = ctx;
  const state = room.state;
  const base = {
    phase: room.status === 'waiting' ? 'lobby' : room.status === 'active' ? 'playing' : 'over',
    minPlayers: 2,
    maxPlayers: 6,
  };
  if (!state) {
    return {
      ...base,
      owner: {},
      armies: {},
      seats: room.players.map((p, i) => (p ? { seat: i, name: p.name, color: null } : null)).filter(Boolean),
    };
  }
  const over = room.status === 'over';
  const me = seat !== null && state.order.includes(seat) ? seat : null;
  return {
    ...base,
    seats: state.order.map((s) => ({
      seat: s,
      name: state.names[s],
      color: state.colors[s],
      territories: owned(state, s).length,
      armies: owned(state, s).reduce((sum, t) => sum + state.armies[t], 0),
      cards: state.hands[s].length,
      income: reinforcementsFor(state, s).total,
      eliminated: !state.left.includes(s) && owned(state, s).length === 0,
      left: state.left.includes(s),
      connected: Boolean(room.players[s]?.connected),
      ready: state.stage === 'setup' ? state.ready.includes(s) : undefined,
    })),
    stage: state.stage, // 'setup' | 'turns'
    goal: state.options.goal || 'world',
    turn: state.turn,
    turnPhase: state.phase,
    turnNumber: state.turnNumber,
    owner: state.owner,
    armies: state.armies,
    setupLeft: me !== null && state.stage === 'setup' ? state.setupLeft[me] : 0,
    reinforcements: state.stage === 'turns' ? state.reinforcements : 0,
    bonuses: state.bonuses,
    pendingMove: state.pendingMove,
    conquered: state.conquered,
    fortified: state.fortified,
    myCards: me !== null ? state.hands[me] : [],
    mustTrade: me !== null && state.turn === me && state.phase === 'reinforce' && state.hands[me].length >= 5,
    nextTrade: setValue(state, [{ type: 'infantry' }, { type: 'cavalry' }, { type: 'artillery' }]),
    tradeCount: state.tradeCount,
    lastBattle: state.lastBattle,
    log: state.log,
    winner: over && room.result ? room.result.winner : null,
    endReason: room.result ? room.result.reason : null,
  };
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const COLORS = ['#e0413b', '#3b82e0', '#3fb35a', '#e8c53a', '#9b59d0', '#f08a2e'];

function requireTurn(ctx, seat, phases) {
  const { room } = ctx;
  const state = room.state;
  if (room.status !== 'active' || state.stage !== 'turns') return 'The game has not started.';
  if (state.turn !== seat) return 'It is not your turn.';
  if (phases && !phases.includes(state.phase)) {
    if (state.phase === 'occupy') return 'Move armies into the territory you conquered first.';
    if (state.phase === 'reinforce') return 'Place your reinforcements first.';
    return 'You cannot do that now.';
  }
  return null;
}

function startTurns(ctx) {
  const { state } = ctx.room;
  state.stage = 'turns';
  beginTurn(ctx, state.order[0]);
  ctx.system(`All armies are deployed. ${state.names[state.order[0]]} moves first.`);
}

module.exports = {
  id: 'risk',
  title: 'Risk',
  minPlayers: 2,
  maxPlayers: 6,
  manualStart: true,

  defaultOptions() {
    return { fortify: 'connected', cards: 'progressive', setup: 'manual', goal: 'world' };
  },

  canChangeOptions(ctx) {
    return ctx.room.status !== 'active';
  },

  applyOptions(ctx, payload) {
    const { options } = ctx.room;
    const set = (key, allowed, message) => {
      if (allowed.includes(payload[key]) && payload[key] !== options[key]) {
        options[key] = payload[key];
        ctx.system(message(payload[key]));
      }
    };
    set('fortify', ['connected', 'adjacent'], (v) =>
      v === 'connected' ? 'Rule: fortify along any chain of your territories.' : 'Rule: fortify to a neighbouring territory only.'
    );
    set('cards', ['progressive', 'fixed'], (v) =>
      v === 'progressive' ? 'Rule: card sets are worth more each time (4, 6, 8, 10…).' : 'Rule: card sets have fixed values (4/6/8, mixed 10).'
    );
    set('goal', ['world', 'half', 'continents'], (v) =>
      ({
        world: 'Goal: World domination — knock everyone out.',
        half: 'Goal: Half the world — first to hold 24 territories wins.',
        continents: 'Goal: Three continents — first to hold 3 whole continents wins.',
      })[v]
    );
    set('setup', ['manual', 'auto'], (v) =>
      v === 'manual' ? 'Setup: everyone places their starting armies.' : 'Setup: starting armies are placed automatically.'
    );
  },

  start(ctx) {
    const { room } = ctx;
    const seats = shuffle(room.players.map((p, i) => (p ? i : null)).filter((s) => s !== null));
    const names = {};
    const colors = {};
    seats.forEach((s, i) => {
      names[s] = room.players[s].name;
      colors[s] = COLORS[i];
    });
    const owner = {};
    const armies = {};
    shuffle(TERRITORIES).forEach((t, i) => {
      owner[t] = seats[i % seats.length];
      armies[t] = 1;
    });
    const total = START_ARMIES[seats.length] || 20;
    const setupLeft = Object.fromEntries(seats.map((s) => [s, total - TERRITORIES.filter((t) => owner[t] === s).length]));
    const state = {
      order: seats,
      names,
      colors,
      owner,
      armies,
      options: { ...room.options },
      stage: 'setup',
      setupLeft,
      ready: [],
      turn: null,
      phase: null,
      turnNumber: 0,
      reinforcements: 0,
      bonuses: [],
      conquered: false,
      fortified: false,
      pendingMove: null,
      hands: Object.fromEntries(seats.map((s) => [s, []])),
      deck: makeDeck(),
      discard: [],
      tradeCount: 0,
      left: [],
      lastBattle: null,
      battleId: 1,
      log: [],
      logId: 1,
    };
    room.state = state;
    ctx.system(
      `The war begins! ${seats.map((s) => names[s]).join(', ')}. Territories are dealt and each commander has ${total} armies.`
    );
    if (state.options.setup === 'auto') {
      seats.forEach((s) => {
        const mine = owned(state, s);
        for (let i = 0; i < state.setupLeft[s]; i += 1) armies[mine[crypto.randomInt(mine.length)]] += 1;
        state.setupLeft[s] = 0;
      });
      startTurns(ctx);
    }
    return state;
  },

  onLeave(ctx, seat) {
    const { state } = ctx.room;
    if (!state.order.includes(seat) || state.left.includes(seat)) return;
    state.left.push(seat);
    // Their armies stay on the map as neutral territories that never attack.
    TERRITORIES.forEach((t) => {
      if (state.owner[t] === seat) state.owner[t] = null;
    });
    state.discard.push(...state.hands[seat]);
    state.hands[seat] = [];
    log(state, { type: 'left', seat });
    ctx.system(`${state.names[seat]} left — their armies hold their ground as neutrals.`);
    if (checkWinner(ctx)) return;
    if (state.stage === 'setup') {
      state.ready = state.ready.filter((s) => s !== seat);
      if (alive(state).every((s) => state.ready.includes(s))) startTurns(ctx);
    } else if (state.turn === seat) {
      advanceTurn(ctx);
    }
  },

  view,

  actions: {
    // Starting armies: everyone places at once, then confirms.
    'risk:setup'(ctx, seat, payload) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active' || state.stage !== 'setup' || !state.order.includes(seat)) return { error: 'Setup is over.' };
      if (state.ready.includes(seat)) return { error: 'You have already deployed.' };
      const placements = payload?.placements || {};
      let sum = 0;
      for (const [t, n] of Object.entries(placements)) {
        if (state.owner[t] !== seat) return { error: `You do not hold ${NAME(t)}.` };
        const c = parseCount(n, 0, 200);
        if (c === null) return { error: 'Invalid number of armies.' };
        sum += c;
      }
      if (sum !== state.setupLeft[seat]) return { error: `Place exactly ${state.setupLeft[seat]} armies.` };
      Object.entries(placements).forEach(([t, n]) => (state.armies[t] += Number(n)));
      state.setupLeft[seat] = 0;
      state.ready.push(seat);
      ctx.system(`${state.names[seat]} has deployed.`);
      if (alive(state).every((s) => state.ready.includes(s))) startTurns(ctx);
      return { ok: true };
    },

    'risk:trade'(ctx, seat, payload) {
      const err = requireTurn(ctx, seat, ['reinforce']);
      if (err) return { error: err };
      const { state } = ctx.room;
      const ids = Array.isArray(payload?.cards) ? payload.cards.map(Number) : [];
      const hand = state.hands[seat];
      const cards = ids.map((id) => hand.find((c) => c.id === id));
      if (new Set(ids).size !== 3 || cards.some((c) => !c)) return { error: 'Pick three of your cards.' };
      if (!validSet(cards)) return { error: 'That is not a set: three of a kind, one of each, or any with a wild.' };
      const value = setValue(state, cards);
      state.tradeCount += 1;
      state.hands[seat] = hand.filter((c) => !ids.includes(c.id));
      state.discard.push(...cards);
      state.reinforcements += value;
      // +2 armies on a traded territory you hold.
      const bonus = cards.find((c) => c.territory && state.owner[c.territory] === seat);
      if (bonus) state.armies[bonus.territory] += 2;
      log(state, { type: 'trade', seat, value, bonus: bonus?.territory || null });
      ctx.system(`${state.names[seat]} trades cards for ${value} armies${bonus ? ` (+2 in ${NAME(bonus.territory)})` : ''}.`);
      return { ok: true, value };
    },

    // Reinforcements are staged in the browser and sent together.
    'risk:place'(ctx, seat, payload) {
      const err = requireTurn(ctx, seat, ['reinforce']);
      if (err) return { error: err };
      const { state } = ctx.room;
      if (state.hands[seat].length >= 5) return { error: 'You hold 5 or more cards — trade a set first.' };
      const placements = payload?.placements || {};
      let sum = 0;
      for (const [t, n] of Object.entries(placements)) {
        if (state.owner[t] !== seat) return { error: `You do not hold ${NAME(t)}.` };
        const c = parseCount(n, 0, 100000);
        if (c === null) return { error: 'Invalid number of armies.' };
        sum += c;
      }
      if (sum !== state.reinforcements) return { error: `Place all ${state.reinforcements} armies.` };
      Object.entries(placements).forEach(([t, n]) => (state.armies[t] += Number(n)));
      log(state, { type: 'reinforce', seat, placements, total: sum });
      state.reinforcements = 0;
      state.phase = 'attack';
      return { ok: true };
    },

    'risk:attack'(ctx, seat, payload) {
      const err = requireTurn(ctx, seat, ['attack']);
      if (err) return { error: err };
      const { state } = ctx.room;
      const { from, to } = payload || {};
      if (state.owner[from] !== seat) return { error: 'Attack from a territory you hold.' };
      if (!BY_ID[to] || state.owner[to] === seat) return { error: 'Pick an enemy territory to attack.' };
      if (!BY_ID[from].adj.includes(to)) return { error: `${NAME(from)} does not border ${NAME(to)}.` };
      if (state.armies[from] < 2) return { error: 'You need at least 2 armies to attack.' };
      const blitz = Boolean(payload.blitz);
      const wanted = parseCount(payload.dice ?? 3, 1, 3) || 3;
      const defender = state.owner[to];
      const rounds = [];
      let attackerLost = 0;
      let defenderLost = 0;
      let used = 0;
      for (let r = 0; r < (blitz ? MAX_BLITZ_ROUNDS : 1); r += 1) {
        const aDice = Math.min(blitz ? 3 : wanted, state.armies[from] - 1);
        if (aDice < 1 || state.armies[to] < 1) break;
        const dDice = Math.min(2, state.armies[to]);
        const a = rollDice(aDice);
        const d = rollDice(dDice);
        let aLoss = 0;
        let dLoss = 0;
        for (let i = 0; i < Math.min(a.length, d.length); i += 1) {
          if (a[i] > d[i]) dLoss += 1;
          else aLoss += 1;
        }
        state.armies[from] -= aLoss;
        state.armies[to] -= dLoss;
        attackerLost += aLoss;
        defenderLost += dLoss;
        used = aDice;
        rounds.push({ a, d, aLoss, dLoss });
      }
      const conquered = state.armies[to] === 0;
      const battle = {
        id: state.battleId++,
        attacker: seat,
        defender,
        from,
        to,
        rounds: rounds.slice(-6),
        totalRounds: rounds.length,
        attackerLost,
        defenderLost,
        conquered,
        blitz,
      };
      state.lastBattle = battle;
      log(state, { type: 'battle', seat, defender, from, to, attackerLost, defenderLost, conquered, rounds: rounds.length });
      if (conquered) {
        state.owner[to] = seat;
        state.conquered = true;
        state.pendingMove = { from, to, min: Math.min(used, state.armies[from] - 1), max: state.armies[from] - 1 };
        state.phase = 'occupy';
        ctx.system(`${state.names[seat]} conquers ${NAME(to)}!`);
        // Knocked a player out: take their cards.
        if (defender !== null && owned(state, defender).length === 0) {
          state.hands[seat].push(...state.hands[defender]);
          state.hands[defender] = [];
          log(state, { type: 'eliminated', seat: defender, by: seat });
          ctx.system(`${state.names[defender]} has been eliminated by ${state.names[seat]}!`);
          if (state.pendingMove.max === state.pendingMove.min) {
            state.armies[to] = state.pendingMove.min;
            state.armies[from] -= state.pendingMove.min;
            state.pendingMove = null;
            state.phase = 'attack';
          }
          if (checkWinner(ctx)) return { ok: true, battle };
          // Six or more cards after a knockout: trade right away.
          if (state.hands[seat].length >= 6) {
            if (state.pendingMove) {
              const pm = state.pendingMove;
              state.armies[pm.to] = pm.max;
              state.armies[pm.from] -= pm.max;
              state.pendingMove = null;
            }
            state.phase = 'reinforce';
            state.reinforcements = 0;
          }
        }
        // Only one possible amount to move: do it for them.
        if (state.pendingMove && state.pendingMove.min === state.pendingMove.max) {
          const pm = state.pendingMove;
          state.armies[pm.to] = pm.min;
          state.armies[pm.from] -= pm.min;
          state.pendingMove = null;
          state.phase = 'attack';
        }
      }
      ctx.emit('risk:battle', () => battle);
      if (conquered && ctx.room.status === 'active') checkGoal(ctx, seat);
      return { ok: true, battle };
    },

    'risk:occupy'(ctx, seat, payload) {
      const err = requireTurn(ctx, seat, ['occupy']);
      if (err) return { error: err };
      const { state } = ctx.room;
      const pm = state.pendingMove;
      const n = parseCount(payload?.count, pm.min, pm.max);
      if (n === null) return { error: `Move between ${pm.min} and ${pm.max} armies.` };
      state.armies[pm.to] = n;
      state.armies[pm.from] -= n;
      state.pendingMove = null;
      state.phase = 'attack';
      return { ok: true };
    },

    'risk:endAttack'(ctx, seat) {
      const err = requireTurn(ctx, seat, ['attack']);
      if (err) return { error: err };
      ctx.room.state.phase = 'fortify';
      return { ok: true };
    },

    'risk:fortify'(ctx, seat, payload) {
      const err = requireTurn(ctx, seat, ['fortify']);
      if (err) return { error: err };
      const { state } = ctx.room;
      const { from, to } = payload || {};
      if (state.owner[from] !== seat || state.owner[to] !== seat || from === to) return { error: 'Move between two of your territories.' };
      const ok =
        state.options.fortify === 'adjacent' ? BY_ID[from].adj.includes(to) : connected(state, seat, from, to);
      if (!ok) {
        return {
          error: state.options.fortify === 'adjacent' ? 'You can only fortify a neighbouring territory.' : 'Those territories are not connected through yours.',
        };
      }
      const n = parseCount(payload.count, 1, state.armies[from] - 1);
      if (n === null) return { error: 'Leave at least one army behind.' };
      state.armies[from] -= n;
      state.armies[to] += n;
      log(state, { type: 'fortify', seat, from, to, count: n });
      finishTurn(ctx, seat);
      return { ok: true };
    },

    'risk:endTurn'(ctx, seat) {
      const err = requireTurn(ctx, seat, ['attack', 'fortify']);
      if (err) return { error: err };
      finishTurn(ctx, seat);
      return { ok: true };
    },
  },

  // exported for tests
  _internal: { validSet, hasSet, reinforcementsFor, MAP },
};
