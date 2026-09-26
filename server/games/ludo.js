// Ludo for 2–4 players: roll, race your tokens round the board and bump rivals
// back to their yard. Rules helpers live in public/shared/ludo-rules.js.

const crypto = require('crypto');
const L = require('../../public/shared/ludo-rules.js');

const OPTION_TEXT = {
  tokens: { 4: 'Full game — four tokens each.', 2: 'Quick game — two tokens each.' },
  safe: { stars: 'Start squares and stars are safe.', none: 'Cutthroat — no square is safe!' },
  leave: { six: 'Roll a 6 to leave your yard.', one: 'Roll a 1 or a 6 to leave your yard.' },
};

function roll() {
  return crypto.randomInt(1, 7);
}

function livePlayers(state) {
  return state.order.filter((seat) => !state.gone[seat]);
}

function nextSeat(state, from) {
  const order = state.order;
  let i = order.indexOf(from);
  for (let n = 0; n < order.length; n += 1) {
    i = (i + 1) % order.length;
    if (!state.gone[order[i]]) return order[i];
  }
  return from;
}

// Legal moves for the player to act with the current roll.
function legalMoves(state, seat) {
  const moves = [];
  state.tokens[seat].forEach((progress, token) => {
    const to = L.target(progress, state.roll, state.options);
    // Your own tokens may share a square; nothing blocks the way.
    if (to !== null) moves.push({ token, from: progress, to });
  });
  return moves;
}

function view(ctx, seat) {
  const { room } = ctx;
  const state = room.state;
  const phase = room.status === 'waiting' ? 'lobby' : room.status === 'active' ? 'playing' : 'over';
  const base = { phase, minPlayers: module.exports.minPlayers, maxPlayers: module.exports.maxPlayers, wins: room.meta.wins || {} };
  if (!state) return base;
  const myTurn = phase === 'playing' && state.turn === seat;
  return {
    ...base,
    options: state.options,
    order: state.order,
    seats: state.order.map((s) => ({ seat: s, name: state.names[s], color: state.colors[s], tokens: state.tokens[s], gone: Boolean(state.gone[s]), home: state.tokens[s].filter((p) => p >= L.FINISH).length })),
    turn: phase === 'playing' ? state.turn : null,
    turnPhase: state.turnPhase,
    roll: state.roll,
    sixes: state.sixes,
    movable: myTurn && state.turnPhase === 'move' ? legalMoves(state, seat).map((m) => m.token) : [],
    lastMove: state.lastMove,
    log: state.log,
    winnerSeat: room.result?.winner ?? null,
    endReason: room.result?.reason || null,
  };
}

function log(state, text, seat = null) {
  state.log.push({ text, seat });
  if (state.log.length > 40) state.log.splice(0, state.log.length - 40);
}

function endTurn(state) {
  state.turn = nextSeat(state, state.turn);
  state.turnPhase = 'roll';
  state.sixes = 0;
  state.roll = null;
}

// Apply a move and work out whether the player rolls again.
function applyMove(ctx, seat, move, { rolled = false } = {}) {
  const { room } = ctx;
  const state = room.state;
  const color = state.colors[seat];
  const opts = state.options;
  state.tokens[seat][move.token] = move.to;
  const captured = [];
  if (move.to >= 0 && move.to < L.TRACK_LEN - 1 && !L.isSafe(move.to, color, opts)) {
    const square = L.trackIndex(color, move.to);
    state.order.forEach((other) => {
      if (other === seat || state.gone[other]) return;
      const oc = state.colors[other];
      state.tokens[other].forEach((p, t) => {
        if (p >= 0 && p < L.TRACK_LEN - 1 && L.trackIndex(oc, p) === square) {
          state.tokens[other][t] = -1;
          captured.push({ seat: other, token: t, from: p });
        }
      });
    });
  }
  const home = move.to >= L.FINISH;
  state.moveId += 1;
  state.lastMove = { id: state.moveId, seat, token: move.token, from: move.from, to: move.to, roll: state.roll, showRoll: rolled, captured, home };
  const name = ctx.name(seat);
  if (move.from < 0) log(state, 'brings a token out', seat);
  else if (home) log(state, 'gets a token home! 🏠', seat);
  else log(state, `moves ${state.roll}`, seat);
  captured.forEach((c) => log(state, `bumps ${state.names[c.seat]} back to the yard!`, seat));

  if (state.tokens[seat].every((p) => p >= L.FINISH)) {
    room.meta.wins = room.meta.wins || {};
    room.meta.wins[name] = (room.meta.wins[name] || 0) + 1;
    ctx.finish(seat, 'home');
    ctx.system(`${name} got every token home and wins!`);
    return;
  }
  // Bonus roll for a 6, a capture or getting a token home.
  if (state.roll === 6 || captured.length || home) {
    state.turnPhase = 'roll';
    state.roll = null;
    state.bonus = true;
  } else {
    endTurn(state);
  }
}

module.exports = {
  id: 'ludo',
  title: 'Ludo',
  minPlayers: 2,
  maxPlayers: 4,
  manualStart: true,

  defaultOptions() {
    return { tokens: 4, safe: 'stars', leave: 'six' };
  },

  canChangeOptions(ctx) {
    return ctx.room.status !== 'active';
  },

  applyOptions(ctx, payload) {
    const { options } = ctx.room;
    const tokens = Number(payload.tokens);
    if ((tokens === 2 || tokens === 4) && tokens !== options.tokens) {
      options.tokens = tokens;
      ctx.system(OPTION_TEXT.tokens[tokens]);
    }
    if (payload.safe in OPTION_TEXT.safe && payload.safe !== options.safe) {
      options.safe = payload.safe;
      ctx.system(OPTION_TEXT.safe[payload.safe]);
    }
    if (payload.leave in OPTION_TEXT.leave && payload.leave !== options.leave) {
      options.leave = payload.leave;
      ctx.system(OPTION_TEXT.leave[payload.leave]);
    }
  },

  start(ctx) {
    const { room } = ctx;
    const order = room.players.map((p, seat) => (p ? seat : null)).filter((s) => s !== null);
    const palette = L.colorsFor(order.length);
    const colors = {};
    const names = {};
    const tokens = {};
    order.forEach((seat, i) => {
      colors[seat] = palette[i];
      names[seat] = ctx.name(seat);
      tokens[seat] = new Array(room.options.tokens === 2 ? 2 : 4).fill(-1);
    });
    // Board order: play goes clockwise round the board.
    order.sort((a, b) => L.COLORS.indexOf(colors[a]) - L.COLORS.indexOf(colors[b]));
    const prev = room.meta.lastWinner;
    const turn = order.includes(prev) ? prev : order[crypto.randomInt(order.length)];
    ctx.system(`${ctx.name(turn)} rolls first.`);
    return {
      options: { ...room.options },
      order,
      colors,
      names,
      tokens,
      gone: {},
      turn,
      turnPhase: 'roll',
      roll: null,
      sixes: 0,
      bonus: false,
      moveId: 0,
      lastMove: null,
      log: [],
    };
  },

  onFinish(ctx) {
    const { room } = ctx;
    if (room.result?.winner !== null && room.result?.winner !== undefined) room.meta.lastWinner = room.result.winner;
  },

  onLeave(ctx, seat) {
    const state = ctx.room.state;
    if (!state || state.gone[seat]) return;
    state.gone[seat] = true;
    log(state, 'left the game', seat);
    const live = livePlayers(state);
    if (live.length === 1) {
      ctx.finish(live[0], 'last');
      ctx.system(`${ctx.name(live[0])} wins — everyone else left.`);
      return;
    }
    if (state.turn === seat) endTurn(state);
  },

  view,

  actions: {
    'ludo:roll'(ctx, seat) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active') return { error: 'The game is not running.' };
      if (state.turn !== seat) return { error: 'Wait for your turn.' };
      if (state.turnPhase !== 'roll') return { error: 'Move a token first.' };
      state.roll = roll();
      state.moveId += 1;
      const rollInfo = { id: state.moveId, seat, roll: state.roll, rollOnly: true };
      if (state.roll === 6) state.sixes += 1;
      if (state.sixes === 3) {
        log(state, 'rolls a third 6 in a row — turn over!', seat);
        state.lastMove = { ...rollInfo, forfeit: true };
        endTurn(state);
        return { ok: true };
      }
      const moves = legalMoves(state, seat);
      if (!moves.length) {
        log(state, `rolls ${state.roll} — no move`, seat);
        state.lastMove = { ...rollInfo, none: true };
        // A 6 still earns another roll even if nothing could move.
        if (state.roll === 6) {
          state.turnPhase = 'roll';
          state.roll = null;
        } else endTurn(state);
        return { ok: true };
      }
      // Only one real choice (a single token, or every option is leaving the yard): move it.
      const distinct = new Set(moves.map((m) => (m.from < 0 ? 'yard' : `t${m.token}`)));
      state.lastMove = rollInfo;
      if (distinct.size === 1) {
        applyMove(ctx, seat, moves[0], { rolled: true });
        return { ok: true };
      }
      state.turnPhase = 'move';
      return { ok: true };
    },

    'ludo:move'(ctx, seat, payload) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active') return { error: 'The game is not running.' };
      if (state.turn !== seat) return { error: 'Wait for your turn.' };
      if (state.turnPhase !== 'move') return { error: 'Roll the die first.' };
      const move = legalMoves(state, seat).find((m) => m.token === Number(payload.token));
      if (!move) return { error: 'That token cannot move.' };
      applyMove(ctx, seat, move);
      return { ok: true };
    },
  },
};
