// Connect 4 rules, shared by the server and the browser.
//
// The board is a string of COLS * ROWS characters, row by row from the top (row 0):
//   '.' empty   'r' red disc   'y' yellow disc
// Modes: classic (7×6, connect 4), popout (7×6, you may pop your own disc out of
// the bottom row instead of dropping), five (9×7, connect 5).

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FourRules = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MODES = {
    classic: { cols: 7, rows: 6, need: 4 },
    popout: { cols: 7, rows: 6, need: 4, pop: true },
    five: { cols: 9, rows: 7, need: 5 },
  };

  const shape = (mode) => MODES[mode] || MODES.classic;
  const opponent = (color) => (color === 'r' ? 'y' : 'r');
  const emptyBoard = (mode) => {
    const { cols, rows } = shape(mode);
    return '.'.repeat(cols * rows);
  };
  const at = (board, mode, col, row) => board[row * shape(mode).cols + col];

  // Lowest empty row in a column, or -1 when it is full.
  function dropRow(board, mode, col) {
    const { cols, rows } = shape(mode);
    if (col < 0 || col >= cols) return -1;
    for (let row = rows - 1; row >= 0; row -= 1) if (board[row * cols + col] === '.') return row;
    return -1;
  }

  function drop(board, mode, col, color) {
    const row = dropRow(board, mode, col);
    if (row < 0) return null;
    const i = row * shape(mode).cols + col;
    return { board: board.slice(0, i) + color + board.slice(i + 1), row };
  }

  function canPop(board, mode, col, color) {
    const { cols, rows, pop } = shape(mode);
    return Boolean(pop) && col >= 0 && col < cols && board[(rows - 1) * cols + col] === color;
  }

  // Removes the bottom disc of a column; everything above slides down one.
  function pop(board, mode, col) {
    const { cols, rows } = shape(mode);
    const cells = board.split('');
    for (let row = rows - 1; row > 0; row -= 1) cells[row * cols + col] = cells[(row - 1) * cols + col];
    cells[col] = '.';
    return cells.join('');
  }

  // Every winning line on the board for a colour: arrays of [col, row].
  function lines(board, mode, color) {
    const { cols, rows, need } = shape(mode);
    const found = [];
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        for (const [dc, dr] of dirs) {
          // Only start at the beginning of a run.
          const pc = col - dc;
          const pr = row - dr;
          if (pc >= 0 && pr >= 0 && pc < cols && pr < rows && board[pr * cols + pc] === color) continue;
          const run = [];
          let c = col;
          let r = row;
          while (c >= 0 && r >= 0 && c < cols && r < rows && board[r * cols + c] === color) {
            run.push([c, r]);
            c += dc;
            r += dr;
          }
          if (run.length >= need) found.push(run);
        }
      }
    }
    return found;
  }

  function full(board) {
    return !board.includes('.');
  }

  function legalMoves(board, mode, color) {
    const { cols } = shape(mode);
    const moves = [];
    for (let col = 0; col < cols; col += 1) {
      if (dropRow(board, mode, col) >= 0) moves.push({ type: 'drop', col });
      if (canPop(board, mode, col, color)) moves.push({ type: 'pop', col });
    }
    return moves;
  }

  return { MODES, shape, opponent, emptyBoard, at, dropRow, drop, canPop, pop, lines, full, legalMoves };
});
