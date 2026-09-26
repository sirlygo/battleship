// Checkers (American / English draughts) rules, shared by the server and the browser.
//
// The board is a 64-character string, row by row from the top (y = 0):
//   '.' empty   'b' black man   'B' black king   'r' red man   'R' red king
// Black starts at the top and moves down; red starts at the bottom and moves up.
// Black moves first. Pieces only stand on dark squares, where (x + y) is odd.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CheckersRules = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const SIZE = 8;
  const DRAW_PLIES = 80; // 40 moves each without a capture or a new king

  const index = (x, y) => y * SIZE + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
  const colorOf = (piece) => (piece === 'b' || piece === 'B' ? 'b' : piece === 'r' || piece === 'R' ? 'r' : null);
  const isKing = (piece) => piece === 'B' || piece === 'R';
  const opponent = (color) => (color === 'b' ? 'r' : 'b');
  const kingRow = (color) => (color === 'b' ? SIZE - 1 : 0);

  function initialBoard() {
    let board = '';
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const dark = (x + y) % 2 === 1;
        if (dark && y < 3) board += 'b';
        else if (dark && y > 4) board += 'r';
        else board += '.';
      }
    }
    return board;
  }

  function at(board, x, y) {
    return board[index(x, y)];
  }

  function directions(piece) {
    if (isKing(piece)) return [[1, 1], [-1, 1], [1, -1], [-1, -1]];
    return colorOf(piece) === 'b' ? [[1, 1], [-1, 1]] : [[1, -1], [-1, -1]];
  }

  function setAt(board, x, y, piece) {
    const i = index(x, y);
    return board.slice(0, i) + piece + board.slice(i + 1);
  }

  // Every complete jump sequence starting from (x, y). A man that reaches the
  // far row is crowned and its turn ends there.
  function jumpSequences(board, x, y) {
    const piece = at(board, x, y);
    const color = colorOf(piece);
    const results = [];

    const explore = (b, cx, cy, path, captures) => {
      let extended = false;
      const current = at(b, cx, cy);
      for (const [dx, dy] of directions(current)) {
        const mx = cx + dx;
        const my = cy + dy;
        const tx = cx + dx * 2;
        const ty = cy + dy * 2;
        if (!inside(tx, ty)) continue;
        const middle = at(b, mx, my);
        if (colorOf(middle) !== opponent(color) || at(b, tx, ty) !== '.') continue;
        extended = true;
        let next = setAt(b, cx, cy, '.');
        next = setAt(next, mx, my, '.');
        const crowned = !isKing(current) && ty === kingRow(color);
        next = setAt(next, tx, ty, crowned ? current.toUpperCase() : current);
        const nextPath = [...path, [tx, ty]];
        const nextCaptures = [...captures, [mx, my]];
        if (crowned) results.push({ path: nextPath, captures: nextCaptures });
        else explore(next, tx, ty, nextPath, nextCaptures);
      }
      if (!extended && captures.length) results.push({ path, captures });
    };

    explore(board, x, y, [[x, y]], []);
    return results;
  }

  function simpleMoves(board, x, y) {
    const piece = at(board, x, y);
    const moves = [];
    for (const [dx, dy] of directions(piece)) {
      const tx = x + dx;
      const ty = y + dy;
      if (inside(tx, ty) && at(board, tx, ty) === '.') moves.push({ path: [[x, y], [tx, ty]], captures: [] });
    }
    return moves;
  }

  // All legal moves for `color`. With forced captures on, any available jump
  // must be taken (and must be completed).
  function legalMoves(board, color, { forcedCapture = true } = {}) {
    const jumps = [];
    const steps = [];
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        if (colorOf(at(board, x, y)) !== color) continue;
        jumps.push(...jumpSequences(board, x, y));
        steps.push(...simpleMoves(board, x, y));
      }
    }
    if (jumps.length && forcedCapture) return jumps;
    return [...jumps, ...steps];
  }

  function samePath(a, b) {
    return a.length === b.length && a.every(([x, y], i) => b[i][0] === x && b[i][1] === y);
  }

  // Applies a legal move; returns the new board plus what happened.
  function applyMove(board, move) {
    const [sx, sy] = move.path[0];
    const [ex, ey] = move.path[move.path.length - 1];
    const piece = at(board, sx, sy);
    const color = colorOf(piece);
    let next = setAt(board, sx, sy, '.');
    move.captures.forEach(([cx, cy]) => {
      next = setAt(next, cx, cy, '.');
    });
    const promoted = !isKing(piece) && ey === kingRow(color);
    next = setAt(next, ex, ey, promoted ? piece.toUpperCase() : piece);
    return { board: next, promoted };
  }

  function countPieces(board, color) {
    let n = 0;
    for (const piece of board) if (colorOf(piece) === color) n += 1;
    return n;
  }

  return {
    SIZE,
    DRAW_PLIES,
    initialBoard,
    at,
    colorOf,
    isKing,
    opponent,
    legalMoves,
    applyMove,
    samePath,
    countPieces,
  };
});
