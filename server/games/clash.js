// Color Clash: a colour-matching card game for 2–8 players.
// Match the top card by colour or symbol, play action cards on your friends,
// and be the first to empty your hand. Call "Last card!" when you're down to one.

const crypto = require('crypto');

const COLORS = ['r', 'y', 'g', 'b'];
const COLOR_NAMES = { r: 'Red', y: 'Yellow', g: 'Green', b: 'Blue' };
const HAND_SIZE = 7;
const CATCH_PENALTY = 2;
const LOG_LIMIT = 40;

const MODES = {
  classic: 'Game mode: Classic.',
  stack: 'Game mode: Stacking — answer a +2 with a +2 (or a +4 with a +4) and pass the pile on!',
  sevenzero: 'Game mode: Seven-Zero — a 7 swaps hands with a player you choose; a 0 passes every hand along.',
};
const DRAWS = {
  one: 'Draw rule: draw one card, then play it or pass.',
  match: 'Draw rule: keep drawing until you get a card you can play.',
};

const LABEL = { skip: 'Skip', rev: 'Reverse', d2: '+2', wild: 'Wild', w4: 'Wild +4' };

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function buildDeck() {
  const deck = [];
  let n = 0;
  const add = (color, value) => deck.push({ id: `c${(n += 1)}`, color, value });
  COLORS.forEach((color) => {
    add(color, '0');
    for (let v = 1; v <= 9; v += 1) {
      add(color, String(v));
      add(color, String(v));
    }
    ['skip', 'rev', 'd2'].forEach((v) => {
      add(color, v);
      add(color, v);
    });
  });
  for (let i = 0; i < 4; i += 1) {
    add('w', 'wild');
    add('w', 'w4');
  }
  return shuffle(deck);
}

const cardName = (card, chosen) => {
  if (card.color === 'w') return chosen ? `${LABEL[card.value]} (${COLOR_NAMES[chosen]})` : LABEL[card.value];
  return `${COLOR_NAMES[card.color]} ${LABEL[card.value] || card.value}`;
};

function seatsInPlay(state) {
  return state.order.filter((seat) => state.hands[seat] && !state.gone[seat]);
}

function nextSeat(state, from, steps = 1) {
  const live = seatsInPlay(state);
  if (!live.length) return from;
  // Walk the fixed seat order in the current direction, skipping players who left.
  const order = state.order;
  let i = order.indexOf(from);
  let moved = 0;
  while (moved < steps) {
    i = (i + state.direction + order.length) % order.length;
    if (live.includes(order[i])) moved += 1;
  }
  return order[i];
}

function top(state) {
  return state.discard[state.discard.length - 1];
}

// Can this card go on the pile right now?
function playable(state, card) {
  const t = top(state);
  if (state.pendingDraw > 0) {
    // Stacking: only a matching draw card can answer a pending draw.
    if (state.mode !== 'stack') return false;
    if (t.value === 'd2') return card.value === 'd2' || card.value === 'w4';
    if (t.value === 'w4') return card.value === 'w4';
    return false;
  }
  if (card.color === 'w') return true;
  return card.color === state.color || card.value === t.value;
}

function drawCards(state, seat, count) {
  const got = [];
  for (let i = 0; i < count; i += 1) {
    if (!state.deck.length) {
      // Reshuffle the discard pile (except the top card) into a new deck.
      const keep = state.discard.pop();
      state.deck = shuffle(state.discard);
      state.discard = [keep];
      if (!state.deck.length) break;
    }
    const card = state.deck.pop();
    state.hands[seat].push(card);
    got.push(card);
  }
  return got;
}

function log(state, text, seat = null) {
  state.log.push({ text, seat });
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

function event(state, data) {
  state.eventId += 1;
  state.events.push({ id: state.eventId, ...data });
  if (state.events.length > 12) state.events.splice(0, state.events.length - 12);
}

function view(ctx, seat) {
  const { room } = ctx;
  const state = room.state;
  const phase = room.status === 'waiting' ? 'lobby' : room.status === 'active' ? 'playing' : 'over';
  const base = {
    phase,
    minPlayers: module.exports.minPlayers,
    maxPlayers: module.exports.maxPlayers,
    wins: room.meta.wins || {},
  };
  if (!state) return base;
  const me = seat !== null && state.hands[seat] ? seat : null;
  const hand = me !== null ? state.hands[me] : [];
  const myTurn = phase === 'playing' && state.turn === me;
  return {
    ...base,
    mode: state.mode,
    drawRule: state.drawRule,
    order: state.order,
    seats: state.order.map((s) => ({
      seat: s,
      name: state.names[s],
      cards: state.hands[s] ? state.hands[s].length : 0,
      gone: Boolean(state.gone[s]),
      called: state.called[s] || false,
    })),
    hand,
    playableIds: myTurn ? hand.filter((c) => (state.drawn ? c.id === state.drawn : playable(state, c))).map((c) => c.id) : [],
    top: top(state),
    discardCount: state.discard.length,
    deckCount: state.deck.length,
    color: state.color,
    direction: state.direction,
    turn: phase === 'playing' ? state.turn : null,
    drawn: myTurn ? state.drawn : null,
    pendingDraw: state.pendingDraw,
    catchable: state.catchable,
    events: state.events,
    log: state.log,
    winnerSeat: room.result?.winner ?? null,
    endReason: room.result?.reason || null,
  };
}

function winRound(ctx, seat) {
  const { room } = ctx;
  room.meta.wins = room.meta.wins || {};
  const name = ctx.name(seat);
  room.meta.wins[name] = (room.meta.wins[name] || 0) + 1;
  ctx.finish(seat, 'empty');
  ctx.system(`${name} played their last card and wins!`);
}

// Move the turn on after a card (or a pass), applying skips.
function advance(state, skip = 0) {
  state.drawn = null;
  state.turn = nextSeat(state, state.turn, 1 + skip);
}

function applyCard(ctx, seat, card, payload) {
  const state = ctx.room.state;
  const live = seatsInPlay(state);
  state.discard.push(card);
  state.color = card.color === 'w' ? payload.color : card.color;
  log(state, `played ${cardName(card, card.color === 'w' ? state.color : null)}`, seat);
  event(state, { type: 'play', seat, card, color: state.color });

  if (state.hands[seat].length === 0) {
    winRound(ctx, seat);
    return;
  }
  // One card left without calling it: anyone can catch them until the next play.
  if (state.hands[seat].length === 1 && !state.called[seat]) state.catchable = seat;
  if (state.hands[seat].length > 1) state.called[seat] = false;

  let skip = 0;
  switch (card.value) {
    case 'skip':
      skip = 1;
      log(state, `skips ${ctx.name(nextSeat(state, seat))}`, seat);
      break;
    case 'rev':
      if (live.length === 2) skip = 1;
      else state.direction *= -1;
      log(state, live.length === 2 ? 'reverses — go again!' : 'reverses the direction', seat);
      break;
    case 'd2':
    case 'w4': {
      const amount = card.value === 'd2' ? 2 : 4;
      if (state.mode === 'stack') {
        state.pendingDraw += amount;
      } else {
        const victim = nextSeat(state, seat);
        drawCards(state, victim, amount);
        state.called[victim] = false;
        log(state, `draws ${amount} and misses a turn`, victim);
        event(state, { type: 'draw', seat: victim, count: amount });
        skip = 1;
      }
      break;
    }
    case '7':
      if (state.mode === 'sevenzero') {
        const target = Number(payload.target);
        const other = live.includes(target) && target !== seat ? target : nextSeat(state, seat);
        [state.hands[seat], state.hands[other]] = [state.hands[other], state.hands[seat]];
        [state.called[seat], state.called[other]] = [false, false];
        log(state, `swaps hands with ${ctx.name(other)}`, seat);
        event(state, { type: 'swap', seat, target: other });
        if (state.hands[seat].length === 0) return winRound(ctx, seat);
        state.catchable = null;
      }
      break;
    case '0':
      if (state.mode === 'sevenzero') {
        // Every hand passes to the next player in the current direction.
        const hands = live.map((s) => state.hands[s]);
        live.forEach((s, i) => {
          const from = (i - state.direction + live.length) % live.length;
          state.hands[s] = hands[from];
          state.called[s] = false;
        });
        log(state, 'passes every hand along', seat);
        event(state, { type: 'rotate', seat, direction: state.direction });
        state.catchable = null;
      }
      break;
    default:
      break;
  }
  advance(state, skip);
}

module.exports = {
  id: 'clash',
  title: 'Color Clash',
  minPlayers: 2,
  maxPlayers: 8,
  manualStart: true,

  defaultOptions() {
    return { mode: 'classic', draw: 'one' };
  },

  canChangeOptions(ctx) {
    return ctx.room.status !== 'active';
  },

  applyOptions(ctx, payload) {
    const { options } = ctx.room;
    if (payload.mode in MODES && payload.mode !== options.mode) {
      options.mode = payload.mode;
      ctx.system(MODES[payload.mode]);
    }
    if (payload.draw in DRAWS && payload.draw !== options.draw) {
      options.draw = payload.draw;
      ctx.system(DRAWS[payload.draw]);
    }
  },

  start(ctx) {
    const { room } = ctx;
    const order = room.players.map((p, seat) => (p ? seat : null)).filter((s) => s !== null);
    const deck = buildDeck();
    const hands = {};
    const names = {};
    order.forEach((seat) => {
      hands[seat] = deck.splice(-HAND_SIZE);
      names[seat] = ctx.name(seat);
    });
    // Flip a plain number card to start the pile.
    const [card] = deck.splice(deck.findIndex((c) => /^\d$/.test(c.value)), 1);
    // The previous winner goes first; otherwise a random player.
    const prev = room.meta.lastWinner;
    const turn = order.includes(prev) ? prev : order[crypto.randomInt(order.length)];
    const state = {
      mode: room.options.mode in MODES ? room.options.mode : 'classic',
      drawRule: room.options.draw in DRAWS ? room.options.draw : 'one',
      order,
      names,
      hands,
      gone: {},
      called: {},
      deck,
      discard: [card],
      color: card.color,
      direction: 1,
      turn,
      drawn: null,
      pendingDraw: 0,
      catchable: null,
      events: [],
      eventId: 0,
      log: [],
    };
    event(state, { type: 'deal' });
    log(state, `starts with ${cardName(card)}`, null);
    ctx.system(`${ctx.name(turn)} goes first.`);
    return state;
  },

  onFinish(ctx) {
    const { room } = ctx;
    if (room.result?.winner !== null && room.result?.winner !== undefined) room.meta.lastWinner = room.result.winner;
  },

  onLeave(ctx, seat) {
    const { room } = ctx;
    const state = room.state;
    if (!state || !state.hands[seat]) return;
    // Their cards go back under the deck.
    state.deck.unshift(...shuffle(state.hands[seat]));
    state.hands[seat] = [];
    state.gone[seat] = true;
    if (state.catchable === seat) state.catchable = null;
    log(state, 'left the table', seat);
    const live = seatsInPlay(state);
    if (live.length === 1) {
      room.meta.lastWinner = live[0];
      winRound(ctx, live[0]);
      return;
    }
    if (state.turn === seat) {
      state.drawn = null;
      state.turn = nextSeat(state, seat);
    }
  },

  view,

  actions: {
    'clash:play'(ctx, seat, payload) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active') return { error: 'The game is not running.' };
      if (state.turn !== seat) return { error: 'Wait for your turn.' };
      const hand = state.hands[seat];
      const idx = hand.findIndex((c) => c.id === payload.id);
      if (idx === -1) return { error: 'That card is not in your hand.' };
      const card = hand[idx];
      if (state.drawn && card.id !== state.drawn) return { error: 'You can only play the card you just drew (or pass).' };
      if (!playable(state, card)) {
        return { error: state.pendingDraw ? `Stack a draw card or take ${state.pendingDraw}.` : 'That card does not match.' };
      }
      if (card.color === 'w' && !COLORS.includes(payload.color)) return { error: 'Pick a colour for your wild card.' };
      if (card.value === '7' && state.mode === 'sevenzero') {
        const live = seatsInPlay(state);
        if (!(live.includes(Number(payload.target)) && Number(payload.target) !== seat)) return { error: 'Pick a player to swap hands with.' };
      }
      hand.splice(idx, 1);
      if (payload.call && hand.length === 1) state.called[seat] = true;
      if (state.catchable !== null && state.catchable !== seat) state.catchable = null;
      applyCard(ctx, seat, card, payload);
      return { ok: true };
    },

    'clash:draw'(ctx, seat) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active') return { error: 'The game is not running.' };
      if (state.turn !== seat) return { error: 'Wait for your turn.' };
      if (state.drawn) return { error: 'You already drew — play that card or pass.' };
      if (state.catchable !== null && state.catchable !== seat) state.catchable = null;
      state.called[seat] = false;
      if (state.pendingDraw > 0) {
        const n = state.pendingDraw;
        state.pendingDraw = 0;
        drawCards(state, seat, n);
        log(state, `takes the whole stack: ${n} cards`, seat);
        event(state, { type: 'draw', seat, count: n });
        advance(state);
        return { ok: true };
      }
      if (state.drawRule === 'match') {
        let got = [];
        let tries = 0;
        do {
          got = drawCards(state, seat, 1);
          tries += 1;
        } while (got.length && !playable(state, got[0]) && tries < 40);
        const last = got[0];
        event(state, { type: 'draw', seat, count: tries });
        log(state, `draws ${tries} card${tries > 1 ? 's' : ''}`, seat);
        if (last && playable(state, last)) state.drawn = last.id;
        else advance(state);
        return { ok: true, drew: tries };
      }
      const [card] = drawCards(state, seat, 1);
      event(state, { type: 'draw', seat, count: card ? 1 : 0 });
      log(state, 'draws a card', seat);
      if (card && playable(state, card)) state.drawn = card.id;
      else advance(state);
      return { ok: true };
    },

    'clash:pass'(ctx, seat) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active') return { error: 'The game is not running.' };
      if (state.turn !== seat) return { error: 'Wait for your turn.' };
      if (!state.drawn) return { error: 'Draw a card first.' };
      log(state, 'keeps the card and passes', seat);
      advance(state);
      return { ok: true };
    },

    // Say "Last card!" — before playing your second-to-last card, or right after.
    'clash:call'(ctx, seat) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active') return { error: 'The game is not running.' };
      const n = state.hands[seat]?.length || 0;
      if (n > 2 || (n === 2 && state.turn !== seat)) return { error: 'You can call it when you are about to have one card left.' };
      state.called[seat] = true;
      if (state.catchable === seat) state.catchable = null;
      log(state, 'calls “Last card!”', seat);
      event(state, { type: 'call', seat });
      return { ok: true };
    },

    'clash:catch'(ctx, seat) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active') return { error: 'The game is not running.' };
      const target = state.catchable;
      if (target === null || target === seat) return { error: 'Nobody to catch right now.' };
      state.catchable = null;
      drawCards(state, target, CATCH_PENALTY);
      log(state, `caught ${state.names[target]} with one card! +${CATCH_PENALTY}`, seat);
      event(state, { type: 'caught', seat, target });
      event(state, { type: 'draw', seat: target, count: CATCH_PENALTY });
      return { ok: true };
    },
  },

  _internal: { buildDeck, playable, nextSeat },
};
