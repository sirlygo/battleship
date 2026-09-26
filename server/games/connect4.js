// Connect 4 on top of the shared rules in public/shared/four-rules.js.

const crypto = require('crypto');
const Rules = require('../../public/shared/four-rules.js');

const other = (seat) => (seat === 0 ? 1 : 0);
const COLOR_NAMES = { r: 'Red', y: 'Yellow' };
const MAX_PLIES = 240; // Pop Out games can shuffle forever; call it a draw eventually.

const MODE_TEXT = {
  classic: 'Game mode: Classic — line up four to win.',
  popout: 'Game mode: Pop Out — you may pop one of your discs out of the bottom row instead of dropping.',
  five: 'Game mode: Five in a Row — a bigger 9×7 rack, and you need five.',
};

function seatOfColor(state, color) {
  return state.colors[0] === color ? 0 : 1;
}

function view(ctx, seat, perspective) {
  const { room } = ctx;
  const state = room.state;
  const relativeSeat = (value) => (value === null || value === undefined ? null : value === perspective ? 'you' : 'enemy');
  const mode = state ? state.mode : room.options.mode;
  const colors = state ? state.colors : ['r', 'y'];
  let winner = null;
  if (room.status === 'over') winner = room.result?.winner === null ? 'draw' : relativeSeat(room.result?.winner);
  return {
    phase: room.status === 'waiting' ? 'lobby' : room.status === 'active' ? 'playing' : 'over',
    mode,
    shape: Rules.shape(mode),
    board: state ? state.board : Rules.emptyBoard(mode),
    myColor: colors[perspective],
    enemyColor: colors[other(perspective)],
    turnColor: state?.turnColor || 'r',
    turn: room.status === 'active' ? relativeSeat(seatOfColor(state, state.turnColor)) : null,
    history: state ? state.history : [],
    winLine: state?.winLine || null,
    wins: room.meta.wins ? [room.meta.wins[perspective], room.meta.wins[other(perspective)]] : [0, 0],
    winner,
    endReason: room.result?.reason || null,
    rematch: { you: room.rematch.has(perspective), enemy: room.rematch.has(other(perspective)) },
  };
}

function finishWin(ctx, seat, line, reason) {
  const { room } = ctx;
  room.state.winLine = line;
  room.meta.wins = room.meta.wins || [0, 0];
  room.meta.wins[seat] += 1;
  ctx.finish(seat, reason);
  ctx.system(`${ctx.name(seat)} wins with ${Rules.shape(room.state.mode).need} in a row!`);
}

function afterMove(ctx, seat) {
  const { room } = ctx;
  const state = room.state;
  const color = state.colors[seat];
  const enemy = Rules.opponent(color);
  const mine = Rules.lines(state.board, state.mode, color);
  const theirs = Rules.lines(state.board, state.mode, enemy);
  // A pop can complete lines for both players; the player who popped wins.
  if (mine.length) return finishWin(ctx, seat, mine[0], 'line');
  if (theirs.length) return finishWin(ctx, other(seat), theirs[0], 'popped');
  if (!Rules.legalMoves(state.board, state.mode, enemy).length) {
    ctx.finish(null, 'full');
    ctx.system('The rack is full — it’s a draw.');
    return;
  }
  if (state.history.length >= MAX_PLIES) {
    ctx.finish(null, 'long');
    ctx.system('Draw — the game went on too long.');
    return;
  }
  state.turnColor = enemy;
}

module.exports = {
  id: 'connect4',
  title: 'Connect 4',
  minPlayers: 2,
  maxPlayers: 2,

  defaultOptions() {
    return { mode: 'classic' };
  },

  canChangeOptions(ctx) {
    return ctx.room.status !== 'active';
  },

  applyOptions(ctx, payload) {
    const { options } = ctx.room;
    if (payload.mode in MODE_TEXT && payload.mode !== options.mode) {
      options.mode = payload.mode;
      ctx.system(MODE_TEXT[payload.mode]);
    }
  },

  start(ctx) {
    const { room } = ctx;
    // Colours swap every round; the first round is random. Red drops first.
    const previous = room.meta.colors;
    const colors = previous ? [previous[1], previous[0]] : crypto.randomInt(2) ? ['r', 'y'] : ['y', 'r'];
    room.meta.colors = colors;
    const redSeat = colors[0] === 'r' ? 0 : 1;
    ctx.system(`${ctx.name(redSeat)} plays Red and drops first. ${ctx.name(other(redSeat))} plays Yellow.`);
    const mode = room.options.mode in MODE_TEXT ? room.options.mode : 'classic';
    return { mode, board: Rules.emptyBoard(mode), colors, turnColor: 'r', history: [], winLine: null };
  },

  onLeave(ctx, seat) {
    ctx.finish(other(seat), 'forfeit');
  },

  view,

  actions: {
    'four:drop'(ctx, seat, payload) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active') return { error: 'The game is not running.' };
      const color = state.colors[seat];
      if (state.turnColor !== color) return { error: 'Wait for your turn.' };
      const col = Number(payload.col);
      if (!Number.isInteger(col)) return { error: 'Pick a column.' };
      const result = Rules.drop(state.board, state.mode, col, color);
      if (!result) return { error: 'That column is full.' };
      state.board = result.board;
      state.history.push({ type: 'drop', col, row: result.row, color });
      afterMove(ctx, seat);
      return { ok: true };
    },

    'four:pop'(ctx, seat, payload) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active') return { error: 'The game is not running.' };
      const color = state.colors[seat];
      if (state.turnColor !== color) return { error: 'Wait for your turn.' };
      const col = Number(payload.col);
      if (!Rules.canPop(state.board, state.mode, col, color)) return { error: 'You can only pop your own disc from the bottom row.' };
      state.board = Rules.pop(state.board, state.mode, col);
      state.history.push({ type: 'pop', col, color });
      afterMove(ctx, seat);
      return { ok: true };
    },

    resign(ctx, seat) {
      if (ctx.room.status !== 'active') return { error: 'The game is not running.' };
      ctx.room.meta.wins = ctx.room.meta.wins || [0, 0];
      ctx.room.meta.wins[other(seat)] += 1;
      ctx.finish(other(seat), 'resign');
      ctx.system(`${ctx.name(seat)} resigned.`);
      return { ok: true };
    },
  },

  COLOR_NAMES,
};
