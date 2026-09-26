// Clue: rules on top of the shared board in public/shared/clue-board.js.
// Rooms, seats and chat are handled by server/rooms.js.

const crypto = require('crypto');
const Board = require('../../public/shared/clue-board.js');

const SUSPECT_IDS = Board.SUSPECTS.map((s) => s.id);
const WEAPON_IDS = Board.WEAPONS.map((w) => w.id);
const ROOM_IDS = Board.ROOMS.map((r) => r.id);
const CARD_NAMES = Object.fromEntries(
  [...Board.SUSPECTS, ...Board.WEAPONS, ...Board.ROOMS].map((c) => [c.id, c.name])
);
const MAX_LOG = 200;

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const roll = () => crypto.randomInt(6) + 1;

function seatOfSuspect(state, suspect) {
  const entry = Object.entries(state.chars).find(([, id]) => id === suspect);
  return entry ? Number(entry[0]) : null;
}

function activeSeats(state) {
  return state.order.filter((s) => !state.eliminated.includes(s) && !state.left.includes(s));
}

function log(state, entry) {
  state.log.push({ id: state.logId++, ...entry });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

function blockedSquares(state, except) {
  const blocked = new Set();
  Object.entries(state.tokens).forEach(([suspect, t]) => {
    if (suspect !== except && !t.room) blocked.add(Board.key(t.x, t.y));
  });
  return blocked;
}

function beginTurn(ctx, seat) {
  const { state } = ctx.room;
  state.turn = seat;
  state.phase = 'start';
  state.dice = null;
  state.moved = false;
}

function advanceTurn(ctx) {
  const { state } = ctx.room;
  state.summoned = state.summoned.filter((s) => s !== state.turn);
  const active = activeSeats(state);
  if (!active.length) return;
  const idx = state.order.indexOf(state.turn);
  for (let i = 1; i <= state.order.length; i += 1) {
    const next = state.order[(idx + i) % state.order.length];
    if (active.includes(next)) {
      beginTurn(ctx, next);
      return;
    }
  }
}

// Ends the game if only one detective (or none) is still in it.
function checkLastStanding(ctx) {
  const { state } = ctx.room;
  const active = activeSeats(state);
  if (active.length === 1) {
    ctx.finish(active[0], 'last-standing');
    ctx.system(`${state.names[active[0]]} is the last detective standing and wins!`);
    return true;
  }
  if (!active.length) {
    ctx.finish(null, 'unsolved');
    ctx.system('Every accusation was wrong — the case goes unsolved.');
    return true;
  }
  return false;
}

// Walks the table from the suggester's left until someone can disprove.
function continueDisprove(ctx) {
  const { state } = ctx.room;
  const sug = state.suggestion;
  const cards = [sug.suspect, sug.weapon, sug.room];
  while (sug.queue.length) {
    const seat = sug.queue[0];
    if (state.left.includes(seat)) {
      sug.queue.shift();
      continue;
    }
    const matches = state.hands[seat].filter((c) => cards.includes(c));
    if (!matches.length) {
      sug.passes.push(seat);
      sug.queue.shift();
      continue;
    }
    sug.asking = seat;
    if (matches.length === 1) {
      showCard(ctx, seat, matches[0]);
      return;
    }
    state.phase = 'disprove';
    return;
  }
  sug.asking = null;
  state.phase = 'end';
  log(state, { type: 'suggest', by: sug.by, suspect: sug.suspect, weapon: sug.weapon, room: sug.room, passes: sug.passes, shownBy: null });
  ctx.system(`No one could disprove ${state.names[sug.by]}'s suggestion!`);
}

function showCard(ctx, seat, card) {
  const { state } = ctx.room;
  const sug = state.suggestion;
  sug.asking = null;
  sug.shownBy = seat;
  state.shown[sug.by].push({ card, by: seat });
  state.phase = 'end';
  log(state, {
    type: 'suggest',
    by: sug.by,
    suspect: sug.suspect,
    weapon: sug.weapon,
    room: sug.room,
    passes: sug.passes,
    shownBy: seat,
    card,
  });
  ctx.emit('clue:shown', (viewer) =>
    viewer === sug.by ? { by: seat, card } : viewer === seat ? { to: sug.by, card } : { by: seat, to: sug.by }
  );
}

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
      tokens: Object.fromEntries(Board.SUSPECTS.map((s) => [s.id, { room: null, x: s.start[0], y: s.start[1] }])),
      weapons: {},
      seats: room.players.map((p, i) => (p ? { seat: i, name: p.name, suspect: null } : null)).filter(Boolean),
    };
  }
  const over = room.status === 'over';
  const sug = state.suggestion;
  const cards = sug ? [sug.suspect, sug.weapon, sug.room] : [];
  return {
    ...base,
    seats: state.order.map((s) => ({
      seat: s,
      name: state.names[s],
      suspect: state.chars[s],
      cards: state.hands[s].length,
      eliminated: state.eliminated.includes(s),
      left: state.left.includes(s),
      connected: Boolean(room.players[s]?.connected),
    })),
    turn: state.turn,
    turnPhase: state.phase,
    dice: state.dice,
    tokens: state.tokens,
    weapons: state.weapons,
    lastMove: state.lastMove,
    canSuggestHere: seat !== null && state.summoned.includes(seat),
    suggestion: sug
      ? {
          by: sug.by,
          suspect: sug.suspect,
          weapon: sug.weapon,
          room: sug.room,
          asking: sug.asking,
          passes: sug.passes,
          shownBy: sug.shownBy,
          mustShow: seat !== null && sug.asking === seat ? state.hands[seat].filter((c) => cards.includes(c)) : null,
        }
      : null,
    myHand: seat !== null && state.hands[seat] ? state.hands[seat] : [],
    myChar: seat !== null ? state.chars[seat] || null : null,
    shownToMe: seat !== null && state.shown[seat] ? state.shown[seat] : [],
    revealed: Object.fromEntries(state.left.map((s) => [s, state.hands[s]])),
    log: state.log.map((e) => {
      if (e.type !== 'suggest' || !e.card) return e;
      const privy = over || seat === e.by || seat === e.shownBy;
      return privy ? e : { ...e, card: null };
    }),
    solution: over ? state.solution : null,
    winner: room.result ? room.result.winner : null,
    endReason: room.result ? room.result.reason : null,
  };
}

module.exports = {
  id: 'clue',
  title: 'Clue',
  minPlayers: 2,
  maxPlayers: 6,
  manualStart: true,

  defaultOptions() {
    return { autoNotes: true, movement: 'dice' };
  },

  canChangeOptions(ctx) {
    return ctx.room.status !== 'active';
  },

  applyOptions(ctx, payload) {
    const { options } = ctx.room;
    if (['dice', 'rooms'].includes(payload.movement) && payload.movement !== options.movement) {
      options.movement = payload.movement;
      ctx.system(
        payload.movement === 'rooms'
          ? 'Game mode: Quick case — skip the dice and walk straight into any room.'
          : 'Game mode: Classic — roll the dice and walk the halls.'
      );
    }
    if (typeof payload.autoNotes === 'boolean' && payload.autoNotes !== options.autoNotes) {
      options.autoNotes = payload.autoNotes;
      ctx.system(
        payload.autoNotes
          ? 'Setting: detective notes fill in automatically.'
          : 'Setting: detective notes are manual — mark your own cards.'
      );
    }
  },

  start(ctx) {
    const { room } = ctx;
    const seats = room.players.map((p, i) => (p ? i : null)).filter((s) => s !== null);
    // Characters in the classic order; Miss Scarlet always moves first.
    const shuffledSeats = shuffle(seats);
    const chars = {};
    const names = {};
    shuffledSeats.forEach((s, i) => {
      chars[s] = SUSPECT_IDS[i];
      names[s] = room.players[s].name;
    });
    const order = SUSPECT_IDS.map((id) => shuffledSeats.find((s) => chars[s] === id)).filter((s) => s !== undefined);

    const solution = {
      suspect: SUSPECT_IDS[crypto.randomInt(SUSPECT_IDS.length)],
      weapon: WEAPON_IDS[crypto.randomInt(WEAPON_IDS.length)],
      room: ROOM_IDS[crypto.randomInt(ROOM_IDS.length)],
    };
    const deck = shuffle(
      [...SUSPECT_IDS, ...WEAPON_IDS, ...ROOM_IDS].filter((c) => ![solution.suspect, solution.weapon, solution.room].includes(c))
    );
    const hands = Object.fromEntries(order.map((s) => [s, []]));
    deck.forEach((card, i) => hands[order[i % order.length]].push(card));

    const weaponRooms = shuffle(ROOM_IDS);
    const state = {
      order,
      chars,
      names,
      hands,
      solution,
      tokens: Object.fromEntries(Board.SUSPECTS.map((s) => [s.id, { room: null, x: s.start[0], y: s.start[1] }])),
      weapons: Object.fromEntries(WEAPON_IDS.map((w, i) => [w, weaponRooms[i]])),
      turn: order[0],
      phase: 'start',
      dice: null,
      moved: false,
      summoned: [],
      suggestion: null,
      eliminated: [],
      left: [],
      shown: Object.fromEntries(order.map((s) => [s, []])),
      log: [],
      logId: 1,
      lastMove: null,
      moveId: 1,
    };
    room.state = state;
    ctx.system(
      `A body has been found! ${order.map((s) => `${names[s]} is ${CARD_NAMES[chars[s]]}`).join(', ')}. ${names[order[0]]} goes first.`
    );
    return state;
  },

  onLeave(ctx, seat) {
    const { state } = ctx.room;
    if (!state.order.includes(seat) || state.left.includes(seat)) return;
    state.left.push(seat);
    log(state, { type: 'left', seat, cards: state.hands[seat] });
    ctx.system(`${state.names[seat]} left the game — their cards are now visible to everyone.`);
    if (checkLastStanding(ctx)) return;
    if (state.suggestion && state.suggestion.asking === seat && state.phase === 'disprove') {
      state.suggestion.queue.shift();
      continueDisprove(ctx);
    }
    if (state.turn === seat) advanceTurn(ctx);
  },

  view,

  actions: {
    'clue:roll'(ctx, seat) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active' || state.turn !== seat) return { error: 'It is not your turn.' };
      if (state.phase !== 'start') return { error: 'You have already moved this turn.' };
      if (room.options.movement === 'rooms') return { error: 'Quick case: pick a room to walk into.' };
      state.dice = [roll(), roll()];
      state.phase = 'move';
      return { ok: true, dice: state.dice };
    },

    'clue:passage'(ctx, seat) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active' || state.turn !== seat || state.phase !== 'start') return { error: 'You cannot do that now.' };
      const token = state.tokens[state.chars[seat]];
      const passage = token.room && Board.room(token.room).passage;
      if (!passage) return { error: 'There is no secret passage here.' };
      state.lastMove = { id: state.moveId++, suspect: state.chars[seat], from: token.room, to: passage, passage: true };
      state.tokens[state.chars[seat]] = { room: passage, x: null, y: null };
      state.moved = true;
      state.phase = 'suggest';
      ctx.system(`${state.names[seat]} took the secret passage to the ${CARD_NAMES[passage]}.`);
      return { ok: true };
    },

    'clue:move'(ctx, seat, payload) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active' || state.turn !== seat) return { error: 'It is not your turn.' };
      // Quick case: go straight to any other room, no dice.
      if (room.options.movement === 'rooms' && state.phase === 'start') {
        const suspect = state.chars[seat];
        const token = state.tokens[suspect];
        if (typeof payload.room !== 'string' || !Board.room(payload.room) || payload.room === token.room) {
          return { error: 'Pick a different room.' };
        }
        state.lastMove = { id: state.moveId++, suspect, from: token.room || [token.x, token.y], to: payload.room, quick: true };
        state.tokens[suspect] = { room: payload.room, x: null, y: null };
        state.moved = true;
        state.phase = 'suggest';
        return { ok: true };
      }
      if (state.phase !== 'move') return { error: 'Roll the dice first.' };
      const suspect = state.chars[seat];
      const token = state.tokens[suspect];
      const from = token.room ? { room: token.room } : { x: token.x, y: token.y };
      const options = Board.reachable(from, state.dice[0] + state.dice[1], blockedSquares(state, suspect));
      let path;
      let dest;
      if (typeof payload.room === 'string' && options.rooms.has(payload.room)) {
        path = options.rooms.get(payload.room);
        dest = { room: payload.room, x: null, y: null };
      } else if (Number.isInteger(payload.x) && Number.isInteger(payload.y) && options.squares.has(Board.key(payload.x, payload.y))) {
        path = options.squares.get(Board.key(payload.x, payload.y));
        dest = { room: null, x: payload.x, y: payload.y };
      } else {
        return { error: 'You cannot reach that square with this roll.' };
      }
      state.lastMove = { id: state.moveId++, suspect, from: token.room || [token.x, token.y], path, to: dest.room };
      state.tokens[suspect] = dest;
      state.moved = true;
      state.phase = dest.room ? 'suggest' : 'end';
      return { ok: true };
    },

    'clue:suggest'(ctx, seat, payload) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active' || state.turn !== seat) return { error: 'It is not your turn.' };
      const token = state.tokens[state.chars[seat]];
      const summonedHere = state.phase === 'start' && state.summoned.includes(seat);
      if (!token.room || !(state.phase === 'suggest' || summonedHere)) {
        return { error: 'You can only make a suggestion in the room you just entered.' };
      }
      if (!SUSPECT_IDS.includes(payload.suspect) || !WEAPON_IDS.includes(payload.weapon)) {
        return { error: 'Pick a suspect and a weapon.' };
      }
      const where = token.room;
      // The accused suspect and the weapon are brought into the room.
      const moved = state.tokens[payload.suspect];
      if (moved.room !== where) {
        state.lastMove = { id: state.moveId++, suspect: payload.suspect, from: moved.room || [moved.x, moved.y], to: where, summoned: true };
        state.tokens[payload.suspect] = { room: where, x: null, y: null };
        const summonedSeat = seatOfSuspect(state, payload.suspect);
        if (summonedSeat !== null && summonedSeat !== seat && !state.summoned.includes(summonedSeat)) {
          state.summoned.push(summonedSeat);
        }
      }
      state.weapons[payload.weapon] = where;
      state.summoned = state.summoned.filter((s) => s !== seat);

      const idx = state.order.indexOf(seat);
      const queue = [];
      for (let i = 1; i < state.order.length; i += 1) queue.push(state.order[(idx + i) % state.order.length]);
      state.suggestion = {
        by: seat,
        suspect: payload.suspect,
        weapon: payload.weapon,
        room: where,
        queue,
        passes: [],
        asking: null,
        shownBy: null,
      };
      ctx.system(
        `${state.names[seat]} suggests ${CARD_NAMES[payload.suspect]} with the ${CARD_NAMES[payload.weapon]} in the ${CARD_NAMES[where]}.`
      );
      continueDisprove(ctx);
      return { ok: true };
    },

    'clue:show'(ctx, seat, payload) {
      const { room } = ctx;
      const state = room.state;
      const sug = state.suggestion;
      if (room.status !== 'active' || state.phase !== 'disprove' || !sug || sug.asking !== seat) {
        return { error: 'Nobody is waiting for you to show a card.' };
      }
      const matches = state.hands[seat].filter((c) => [sug.suspect, sug.weapon, sug.room].includes(c));
      if (!matches.includes(payload.card)) return { error: 'Show one of the matching cards.' };
      showCard(ctx, seat, payload.card);
      return { ok: true };
    },

    'clue:accuse'(ctx, seat, payload) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active' || state.turn !== seat) return { error: 'You can only accuse on your turn.' };
      if (state.phase === 'disprove') return { error: 'Wait until your suggestion has been answered.' };
      const { suspect, weapon } = payload;
      const where = payload.room;
      if (!SUSPECT_IDS.includes(suspect) || !WEAPON_IDS.includes(weapon) || !ROOM_IDS.includes(where)) {
        return { error: 'An accusation needs a suspect, a weapon and a room.' };
      }
      const correct = suspect === state.solution.suspect && weapon === state.solution.weapon && where === state.solution.room;
      log(state, { type: 'accuse', by: seat, suspect, weapon, room: where, correct });
      const text = `${CARD_NAMES[suspect]} with the ${CARD_NAMES[weapon]} in the ${CARD_NAMES[where]}`;
      if (correct) {
        ctx.finish(seat, 'solved');
        ctx.system(`${state.names[seat]} accuses ${text} — and is RIGHT! Case closed.`);
        return { ok: true, correct: true };
      }
      state.eliminated.push(seat);
      ctx.system(`${state.names[seat]} accuses ${text} — wrong! They are out, but still show cards.`);
      if (!checkLastStanding(ctx)) advanceTurn(ctx);
      return { ok: true, correct: false };
    },

    'clue:end'(ctx, seat) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active' || state.turn !== seat) return { error: 'It is not your turn.' };
      if (state.phase === 'disprove') return { error: 'Wait until your suggestion has been answered.' };
      advanceTurn(ctx);
      return { ok: true };
    },
  },

  CARD_NAMES,
};
