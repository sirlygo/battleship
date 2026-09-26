// Clue mansion board and movement rules, shared by the server and the browser.
//
// The board is a 24 × 24 grid. Rooms are rectangles; everything else is
// hallway except the locked centre (where the case file sits). Doors connect a
// hallway square to the room next to it. Moving one square costs one step;
// stepping through a door into a room costs one step and ends the move.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClueBoard = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const SIZE = 24;

  const SUSPECTS = [
    { id: 'scarlet', name: 'Miss Scarlet', short: 'Scarlet', color: '#d62839', start: [16, 0] },
    { id: 'mustard', name: 'Colonel Mustard', short: 'Mustard', color: '#e8b10b', start: [23, 7] },
    { id: 'white', name: 'Mrs. White', short: 'White', color: '#f2f2ee', start: [16, 23] },
    { id: 'green', name: 'Mr. Green', short: 'Green', color: '#2d9a4e', start: [7, 23] },
    { id: 'peacock', name: 'Mrs. Peacock', short: 'Peacock', color: '#2f64c8', start: [0, 17] },
    { id: 'plum', name: 'Professor Plum', short: 'Plum', color: '#7c3fa3', start: [0, 5] },
  ];

  const WEAPONS = [
    { id: 'candlestick', name: 'Candlestick' },
    { id: 'knife', name: 'Knife' },
    { id: 'pipe', name: 'Lead Pipe' },
    { id: 'revolver', name: 'Revolver' },
    { id: 'rope', name: 'Rope' },
    { id: 'wrench', name: 'Wrench' },
  ];

  // x, y, w, h in squares; doors are [hallwayX, hallwayY, roomX, roomY].
  const ROOMS = [
    { id: 'study', name: 'Study', rect: [0, 0, 7, 4], doors: [[6, 4, 6, 3]], passage: 'kitchen', color: '#5b3a6b' },
    { id: 'hall', name: 'Hall', rect: [9, 0, 6, 7], doors: [[11, 7, 11, 6], [12, 7, 12, 6], [8, 4, 9, 4]], color: '#7a5230' },
    { id: 'lounge', name: 'Lounge', rect: [17, 0, 7, 6], doors: [[17, 6, 17, 5]], passage: 'conservatory', color: '#8a3b3b' },
    { id: 'library', name: 'Library', rect: [0, 6, 7, 5], doors: [[7, 8, 6, 8], [3, 11, 3, 10]], color: '#3b5a3f' },
    { id: 'billiard', name: 'Billiard Room', rect: [0, 12, 6, 5], doors: [[1, 11, 1, 12], [6, 15, 5, 15]], color: '#2f6b55' },
    { id: 'dining', name: 'Dining Room', rect: [16, 9, 8, 7], doors: [[17, 8, 17, 9], [15, 12, 16, 12]], color: '#6b4a24' },
    { id: 'conservatory', name: 'Conservatory', rect: [0, 19, 6, 5], doors: [[4, 18, 4, 19], [6, 20, 5, 20]], passage: 'lounge', color: '#3f6b6b' },
    { id: 'ballroom', name: 'Ballroom', rect: [8, 17, 8, 7], doors: [[7, 19, 8, 19], [16, 19, 15, 19], [9, 16, 9, 17], [14, 16, 14, 17]], color: '#5a4a7a' },
    { id: 'kitchen', name: 'Kitchen', rect: [18, 18, 6, 6], doors: [[19, 17, 19, 18]], passage: 'study', color: '#6b5a3a' },
  ];

  const CENTER = [9, 9, 6, 6];

  const inRect = ([rx, ry, rw, rh], x, y) => x >= rx && y >= ry && x < rx + rw && y < ry + rh;
  const key = (x, y) => `${x},${y}`;

  function roomAt(x, y) {
    return ROOMS.find((r) => inRect(r.rect, x, y)) || null;
  }

  function isHallway(x, y) {
    return x >= 0 && y >= 0 && x < SIZE && y < SIZE && !roomAt(x, y) && !inRect(CENTER, x, y);
  }

  function room(id) {
    return ROOMS.find((r) => r.id === id) || null;
  }

  /**
   * Where a token can go this turn.
   * @param {{room?: string, x?: number, y?: number}} from  a room id or a hallway square
   * @param {number} steps  dice total
   * @param {Set<string>} blocked  hallway squares holding other tokens
   * @returns {{squares: Map<string, number[][]>, rooms: Map<string, number[][]>}} destination -> path
   */
  function reachable(from, steps, blocked = new Set()) {
    const squares = new Map();
    const rooms = new Map();
    const queue = [];
    const seen = new Map();

    const push = (x, y, dist, path) => {
      const k = key(x, y);
      if (seen.has(k) && seen.get(k) <= dist) return;
      seen.set(k, dist);
      queue.push({ x, y, dist, path });
    };

    if (from.room) {
      // Leaving a room: step out through any door not blocked by a token.
      room(from.room).doors.forEach(([hx, hy]) => {
        if (!blocked.has(key(hx, hy))) push(hx, hy, 1, [[hx, hy]]);
      });
    } else {
      push(from.x, from.y, 0, []);
    }

    while (queue.length) {
      queue.sort((a, b) => a.dist - b.dist);
      const { x, y, dist, path } = queue.shift();
      if (seen.get(key(x, y)) < dist) continue;
      if (dist > 0 && !squares.has(key(x, y))) squares.set(key(x, y), path);
      if (dist >= steps) continue;

      // Doors from this hallway square into rooms.
      ROOMS.forEach((r) => {
        if (r.id === from.room) return; // no re-entering the room you just left
        r.doors.forEach(([hx, hy, rx, ry]) => {
          if (hx === x && hy === y && !rooms.has(r.id)) rooms.set(r.id, [...path, [rx, ry]]);
        });
      });

      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        if (!isHallway(nx, ny) || blocked.has(key(nx, ny))) return;
        push(nx, ny, dist + 1, [...path, [nx, ny]]);
      });
    }
    return { squares, rooms };
  }

  return { SIZE, SUSPECTS, WEAPONS, ROOMS, CENTER, roomAt, isHallway, room, reachable, key };
});
