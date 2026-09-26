// Ludo board and rules, shared by the server and the browser.
//
// The board is the classic 15×15 cross. Squares are [col, row] with row 0 at the top.
// A token's progress is -1 in the yard, 0–50 on the shared track (counted from its
// own start square), 51–55 in its home column, and 56 once it is home.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LudoRules = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const TRACK = [
    [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
    [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
    [7, 0],
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
    [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
    [14, 7],
    [14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
    [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
    [7, 14],
    [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
    [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
    [0, 7],
    [0, 6],
  ];
  const TRACK_LEN = TRACK.length; // 52
  const HOME_COL = 5;
  const FINISH = TRACK_LEN - 1 + HOME_COL + 1; // 56

  // Colours in board order (clockwise from the top-left yard).
  const COLORS = ['red', 'green', 'yellow', 'blue'];
  const START = { red: 0, green: 13, yellow: 26, blue: 39 };
  const HOME_PATH = {
    red: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
    green: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
    yellow: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
    blue: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
  };
  const HOME_CELL = { red: [6.35, 7], green: [7, 6.35], yellow: [7.65, 7], blue: [7, 7.65] };
  // Yard corners (top-left of the 6×6 yard) and the four token spots inside.
  const YARD = { red: [0, 0], green: [9, 0], yellow: [9, 9], blue: [0, 9] };
  const YARD_SPOTS = [[1.75, 1.75], [3.25, 1.75], [1.75, 3.25], [3.25, 3.25]];
  const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47]); // start squares and stars
  const STARS = new Set([8, 21, 34, 47]);

  // Which colours play for a given number of players (opposite corners for two).
  function colorsFor(count) {
    if (count === 2) return ['red', 'yellow'];
    if (count === 3) return ['red', 'green', 'yellow'];
    return COLORS.slice(0, 4);
  }

  const trackIndex = (color, progress) => (START[color] + progress) % TRACK_LEN;

  // Board position (col, row centre) of a token.
  function cellOf(color, progress, tokenIndex = 0) {
    if (progress < 0) {
      const [yx, yy] = YARD[color];
      const [sx, sy] = YARD_SPOTS[tokenIndex % 4];
      return [yx + sx, yy + sy];
    }
    if (progress < TRACK_LEN - 1) {
      const [x, y] = TRACK[trackIndex(color, progress)];
      return [x + 0.5, y + 0.5];
    }
    if (progress < FINISH) {
      const [x, y] = HOME_PATH[color][progress - (TRACK_LEN - 1)];
      return [x + 0.5, y + 0.5];
    }
    const [hx, hy] = HOME_CELL[color];
    return [hx + 0.5 + ((tokenIndex % 2) - 0.5) * 0.35, hy + 0.5 + (Math.floor(tokenIndex / 2) - 0.5) * 0.35];
  }

  // Can this token move with this roll? Returns the new progress, or null.
  function target(progress, roll, options) {
    if (progress < 0) return (options.leave === 'one' ? roll === 6 || roll === 1 : roll === 6) ? 0 : null;
    if (progress >= FINISH) return null;
    const to = progress + roll;
    return to <= FINISH ? to : null;
  }

  function isSafe(progress, color, options) {
    if (progress < 0 || progress >= TRACK_LEN - 1) return true;
    return options.safe !== 'none' && SAFE.has(trackIndex(color, progress));
  }

  return {
    TRACK,
    TRACK_LEN,
    HOME_COL,
    FINISH,
    COLORS,
    START,
    HOME_PATH,
    HOME_CELL,
    YARD,
    YARD_SPOTS,
    SAFE,
    STARS,
    colorsFor,
    trackIndex,
    cellOf,
    target,
    isSafe,
  };
});
