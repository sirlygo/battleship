// Checkers rules on top of the shared rules engine in public/shared/checkers-rules.js.

const crypto = require('crypto');
const Rules = require('../../public/shared/checkers-rules.js');

const other = (seat) => (seat === 0 ? 1 : 0);
const COLOR_NAMES = { b: 'Black', r: 'Red' };

function seatOfColor(state, color) {
  return state.colors[0] === color ? 0 : 1;
}

function parsePath(raw) {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 13) return null;
  const path = raw.map((p) => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : null));
  const ok = path.every((p) => p && Number.isInteger(p[0]) && Number.isInteger(p[1]));
  return ok ? path : null;
}

function view(ctx, seat, perspective) {
  const { room } = ctx;
  const state = room.state;
  const relativeSeat = (value) => (value === null || value === undefined ? null : value === perspective ? 'you' : 'enemy');
  const board = state ? state.board : Rules.initialBoard();
  const colors = state ? state.colors : ['r', 'b'];
  let winner = null;
  if (room.status === 'over') winner = room.result?.winner === null ? 'draw' : relativeSeat(room.result?.winner);

  return {
    phase: room.status === 'waiting' ? 'lobby' : room.status === 'active' ? 'playing' : 'over',
    board,
    myColor: colors[perspective],
    enemyColor: colors[other(perspective)],
    turnColor: state?.turnColor || 'b',
    turn: room.status === 'active' ? relativeSeat(seatOfColor(state, state.turnColor)) : null,
    history: state ? state.history : [],
    quietPlies: state ? state.quietPlies : 0,
    drawPlies: Rules.DRAW_PLIES,
    drawOffer: state ? relativeSeat(state.drawOffer) : null,
    captured: {
      b: 12 - Rules.countPieces(board, 'b'),
      r: 12 - Rules.countPieces(board, 'r'),
    },
    winner,
    endReason: room.result?.reason || null,
    rematch: { you: room.rematch.has(perspective), enemy: room.rematch.has(other(perspective)) },
  };
}

module.exports = {
  id: 'checkers',
  title: 'Checkers',
  minPlayers: 2,
  maxPlayers: 2,

  defaultOptions() {
    return { forcedCapture: true, mode: 'classic' };
  },

  canChangeOptions(ctx) {
    return ctx.room.status !== 'active';
  },

  applyOptions(ctx, payload) {
    const { options } = ctx.room;
    if (typeof payload.forcedCapture === 'boolean' && payload.forcedCapture !== options.forcedCapture) {
      options.forcedCapture = payload.forcedCapture;
      ctx.system(payload.forcedCapture ? 'Rule change: captures are mandatory.' : 'Rule change: captures are optional.');
    }
    const MODES = {
      classic: 'Game mode: Classic — capture them all.',
      giveaway: 'Game mode: Giveaway — the first to lose all their pieces (or get stuck) wins!',
      kings: 'Game mode: All Kings — every piece starts crowned.',
    };
    if (payload.mode in MODES && payload.mode !== options.mode) {
      options.mode = payload.mode;
      ctx.system(MODES[payload.mode]);
    }
  },

  start(ctx) {
    const { room } = ctx;
    // Colours swap every round; the first round is random. Black moves first.
    const previous = room.meta.colors;
    const colors = previous ? [previous[1], previous[0]] : crypto.randomInt(2) ? ['b', 'r'] : ['r', 'b'];
    room.meta.colors = colors;
    const blackSeat = colors[0] === 'b' ? 0 : 1;
    ctx.system(`${ctx.name(blackSeat)} plays Black and moves first. ${ctx.name(other(blackSeat))} plays Red.`);
    const mode = room.options.mode || 'classic';
    return {
      board: mode === 'kings' ? Rules.initialBoard().toUpperCase() : Rules.initialBoard(),
      colors,
      turnColor: 'b',
      history: [],
      quietPlies: 0,
      drawOffer: null,
    };
  },

  onLeave(ctx, seat) {
    ctx.finish(other(seat), 'forfeit');
  },

  view,

  actions: {
    move(ctx, seat, payload) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active') return { error: 'The game is not running.' };
      const color = state.colors[seat];
      if (state.turnColor !== color) return { error: 'Wait for your turn.' };
      const path = parsePath(payload.path);
      if (!path) return { error: 'Invalid move.' };

      const legal = Rules.legalMoves(state.board, color, room.options);
      const move = legal.find((m) => Rules.samePath(m.path, path));
      if (!move) {
        const mustCapture = room.options.forcedCapture && legal.some((m) => m.captures.length);
        return { error: mustCapture ? 'You must take a capture.' : 'That move is not allowed.' };
      }

      const { board, promoted } = Rules.applyMove(state.board, move);
      state.board = board;
      state.history.push({ color, path: move.path, captures: move.captures, promoted });
      state.quietPlies = move.captures.length || promoted ? 0 : state.quietPlies + 1;
      state.drawOffer = null;

      if (promoted) ctx.system(`${ctx.name(seat)} crowned a king!`);
      const next = Rules.opponent(color);
      if (!Rules.legalMoves(board, next, room.options).length) {
        const wiped = Rules.countPieces(board, next) === 0;
        if (room.options.mode === 'giveaway') {
          // Giveaway: running out of pieces or moves is the goal.
          ctx.finish(other(seat), 'giveaway');
          ctx.system(`${ctx.name(other(seat))} wins Giveaway — ${wiped ? 'all their pieces are gone' : 'they have no moves left'}!`);
        } else {
          ctx.finish(seat, wiped ? 'captured' : 'blocked');
          ctx.system(`${ctx.name(seat)} wins — ${wiped ? 'every piece captured' : 'no moves left for the opponent'}!`);
        }
      } else if (state.quietPlies >= Rules.DRAW_PLIES) {
        ctx.finish(null, 'quiet');
        ctx.system('Draw — 40 moves each without a capture or a new king.');
      } else {
        state.turnColor = next;
      }
      return { ok: true };
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
