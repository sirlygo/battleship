// Chess rules via chess.js, plus optional clocks. Room handling lives in server/rooms.js.

const crypto = require('crypto');
const { Chess } = require('chess.js');

const other = (seat) => (seat === 0 ? 1 : 0);
const COLOR_NAMES = { w: 'White', b: 'Black' };
// Time controls: minutes + increment seconds. 'none' plays without clocks.
const CLOCKS = {
  none: null,
  '3+2': { base: 3 * 60e3, inc: 2e3 },
  '5+0': { base: 5 * 60e3, inc: 0 },
  '10+0': { base: 10 * 60e3, inc: 0 },
  '15+10': { base: 15 * 60e3, inc: 10e3 },
};
// Lets automated tests exercise running out of time without waiting minutes.
if (process.env.CHESS_TEST_CLOCK) CLOCKS.test = { base: 1500, inc: 0 };
const START_COUNTS = { p: 8, n: 2, b: 2, r: 2, q: 1 };

function seatOfColor(state, color) {
  return state.colors[0] === color ? 0 : 1;
}

// Remaining time for each side right now (the side to move is ticking).
function clockNow(state) {
  if (!state.clock) return null;
  const { w, b, running, since } = state.clock;
  const elapsed = running ? Date.now() - since : 0;
  return {
    w: running === 'w' ? Math.max(0, w - elapsed) : w,
    b: running === 'b' ? Math.max(0, b - elapsed) : b,
    running,
  };
}

function clearFlag(state) {
  if (state.flagTimer) clearTimeout(state.flagTimer);
  state.flagTimer = null;
}

// Hands the win to the other side when the running clock hits zero.
function armFlag(ctx) {
  const { room } = ctx;
  const state = room.state;
  clearFlag(state);
  const now = clockNow(state);
  if (!now || !now.running) return;
  state.flagTimer = setTimeout(() => {
    if (room.status !== 'active' || room.state !== state) return;
    const color = state.clock.running;
    state.clock[color] = 0;
    state.clock.running = null;
    const winnerColor = color === 'w' ? 'b' : 'w';
    // A flag only wins if the opponent could still, in theory, checkmate.
    const canMate = hasMatingMaterial(state.chess, winnerColor);
    if (canMate) {
      ctx.finish(seatOfColor(state, winnerColor), 'timeout');
      ctx.system(`${ctx.name(seatOfColor(state, color))} ran out of time.`);
    } else {
      ctx.finish(null, 'timeout-material');
      ctx.system(`${ctx.name(seatOfColor(state, color))} ran out of time, but there is no mating material — draw.`);
    }
    ctx.broadcast();
  }, now[now.running] + 50);
}

function hasMatingMaterial(chess, color) {
  const pieces = chess.board().flat().filter((p) => p && p.color === color).map((p) => p.type);
  if (pieces.some((t) => t === 'q' || t === 'r' || t === 'p')) return true;
  const minors = pieces.filter((t) => t === 'n' || t === 'b').length;
  return minors >= 2;
}

// Pieces each side has lost, from the current position.
function capturedPieces(chess) {
  const counts = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  chess.board().flat().forEach((p) => {
    if (p && p.type !== 'k') counts[p.color][p.type] += 1;
  });
  const lost = { w: [], b: [] };
  ['w', 'b'].forEach((color) => {
    Object.entries(START_COUNTS).forEach(([type, n]) => {
      // Promotions can push a count above the start; never report negatives.
      for (let i = counts[color][type]; i < n; i += 1) lost[color].push(type);
    });
  });
  return lost;
}

function view(ctx, seat, perspective) {
  const { room } = ctx;
  const state = room.state;
  const relativeSeat = (value) => (value === null || value === undefined ? null : value === perspective ? 'you' : 'enemy');
  const chess = state ? state.chess : new Chess();
  const colors = state ? state.colors : ['w', 'b'];
  let winner = null;
  if (room.status === 'over') winner = room.result?.winner === null ? 'draw' : relativeSeat(room.result?.winner);
  const history = state ? state.moves : [];
  const last = history[history.length - 1];

  return {
    phase: room.status === 'waiting' ? 'lobby' : room.status === 'active' ? 'playing' : 'over',
    fen: chess.fen(),
    myColor: colors[perspective],
    enemyColor: colors[other(perspective)],
    turnColor: chess.turn(),
    turn: room.status === 'active' ? relativeSeat(seatOfColor(state, chess.turn())) : null,
    inCheck: room.status !== 'waiting' && chess.inCheck(),
    history: history.map((m) => m.san),
    lastMove: last ? { from: last.from, to: last.to } : null,
    captured: capturedPieces(chess),
    clock: state ? clockNow(state) : null,
    clockSetting: room.options.clock,
    drawOffer: state ? relativeSeat(state.drawOffer) : null,
    winner,
    endReason: room.result?.reason || null,
    rematch: { you: room.rematch.has(perspective), enemy: room.rematch.has(other(perspective)) },
  };
}

module.exports = {
  id: 'chess',
  title: 'Chess',
  minPlayers: 2,
  maxPlayers: 2,

  defaultOptions() {
    return { clock: 'none' };
  },

  canChangeOptions(ctx) {
    return ctx.room.status !== 'active';
  },

  applyOptions(ctx, payload) {
    const { options } = ctx.room;
    if (payload.clock in CLOCKS && payload.clock !== options.clock) {
      options.clock = payload.clock;
      ctx.system(payload.clock === 'none' ? 'Clock: off — take your time.' : `Clock: ${payload.clock} (minutes + seconds per move).`);
    }
  },

  start(ctx) {
    const { room } = ctx;
    const previous = room.meta.colors;
    const colors = previous ? [previous[1], previous[0]] : crypto.randomInt(2) ? ['w', 'b'] : ['b', 'w'];
    room.meta.colors = colors;
    const whiteSeat = colors[0] === 'w' ? 0 : 1;
    ctx.system(`${ctx.name(whiteSeat)} plays White and moves first. ${ctx.name(other(whiteSeat))} plays Black.`);
    const setting = CLOCKS[room.options.clock];
    return {
      chess: new Chess(),
      colors,
      moves: [],
      drawOffer: null,
      // Clocks start once White has made the first move.
      clock: setting ? { w: setting.base, b: setting.base, inc: setting.inc, running: null, since: 0 } : null,
      flagTimer: null,
    };
  },

  onLeave(ctx, seat) {
    ctx.finish(other(seat), 'forfeit');
  },

  onFinish(ctx) {
    const state = ctx.room.state;
    if (!state) return;
    clearFlag(state);
    if (state.clock && state.clock.running) {
      const now = clockNow(state);
      state.clock.w = now.w;
      state.clock.b = now.b;
      state.clock.running = null;
    }
  },

  view,

  actions: {
    move(ctx, seat, payload) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active') return { error: 'The game is not running.' };
      const color = state.colors[seat];
      if (state.chess.turn() !== color) return { error: 'Wait for your turn.' };

      const from = typeof payload.from === 'string' ? payload.from : '';
      const to = typeof payload.to === 'string' ? payload.to : '';
      const promotion = ['q', 'r', 'b', 'n'].includes(payload.promotion) ? payload.promotion : 'q';

      // Charge the mover's clock before anything else.
      if (state.clock && state.clock.running === color) {
        const now = clockNow(state);
        if (now[color] <= 0) return { error: 'Your time is up.' };
        state.clock[color] = now[color];
      }

      let move;
      try {
        move = state.chess.move({ from, to, promotion });
      } catch {
        move = null;
      }
      if (!move) return { error: 'That move is not legal.' };

      state.moves.push({ san: move.san, from: move.from, to: move.to, color });
      state.drawOffer = null;

      if (state.clock) {
        if (state.moves.length > 1) state.clock[color] += state.clock.inc;
        state.clock.running = state.chess.turn();
        state.clock.since = Date.now();
      }

      const chess = state.chess;
      if (chess.isCheckmate()) {
        ctx.finish(seat, 'checkmate');
        ctx.system(`Checkmate! ${ctx.name(seat)} wins.`);
      } else if (chess.isStalemate()) {
        ctx.finish(null, 'stalemate');
        ctx.system('Stalemate — draw.');
      } else if (chess.isInsufficientMaterial()) {
        ctx.finish(null, 'material');
        ctx.system('Draw — not enough material to checkmate.');
      } else if (chess.isThreefoldRepetition()) {
        ctx.finish(null, 'repetition');
        ctx.system('Draw by threefold repetition.');
      } else if (chess.isDrawByFiftyMoves()) {
        ctx.finish(null, 'fifty');
        ctx.system('Draw — 50 moves without a capture or pawn move.');
      } else {
        armFlag(ctx);
      }
      return { ok: true, san: move.san };
    },

    resign(ctx, seat) {
      if (ctx.room.status !== 'active') return { error: 'The game is not running.' };
      ctx.finish(other(seat), 'resign');
      ctx.system(`${ctx.name(seat)} resigned.`);
      return { ok: true };
    },

    'draw:offer'(ctx, seat) {
      const { room } = ctx;
      if (room.status !== 'active') return { error: 'The game is not running.' };
      if (room.state.drawOffer === other(seat)) {
        ctx.finish(null, 'agreement');
        ctx.system('Draw agreed.');
        return { ok: true };
      }
      room.state.drawOffer = seat;
      ctx.system(`${ctx.name(seat)} offers a draw.`);
      return { ok: true };
    },

    'draw:decline'(ctx, seat) {
      const { room } = ctx;
      if (room.status !== 'active' || room.state.drawOffer !== other(seat)) return { error: 'There is no draw offer.' };
      room.state.drawOffer = null;
      ctx.system(`${ctx.name(seat)} declined the draw.`);
      return { ok: true };
    },
  },

  COLOR_NAMES,
};
