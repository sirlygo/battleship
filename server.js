const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build')));

const BOARD_SIZE = 10;
const SHIPS = [
  { name: 'Carrier', length: 5 },
  { name: 'Battleship', length: 4 },
  { name: 'Cruiser', length: 3 },
  { name: 'Submarine', length: 3 },
  { name: 'Destroyer', length: 2 },
];

const ROOM_CODE_LENGTH = 5;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECONNECT_GRACE_MS = 45 * 1000;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const MAX_CHAT_MESSAGES = 100;
const MAX_CHAT_LENGTH = 200;
const MAX_NAME_LENGTH = 16;

const rooms = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
      code += ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

function normalizeCode(raw) {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

function sanitizeName(raw, fallback) {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return cleaned || fallback;
}

function sanitizeToken(raw) {
  if (typeof raw !== 'string') return null;
  return /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : null;
}

function cellKey(x, y) {
  return `${x},${y}`;
}

function reply(callback, payload) {
  if (typeof callback === 'function') callback(payload);
}

function createPlayer({ token, socketId, name }) {
  return {
    token,
    socketId,
    name,
    connected: true,
    ready: false,
    ships: [],
    shotsReceived: new Map(),
    stats: { shots: 0, hits: 0 },
    disconnectTimer: null,
  };
}

function resetPlayerForMatch(player) {
  player.ready = false;
  player.ships = [];
  player.shotsReceived = new Map();
  player.stats = { shots: 0, hits: 0 };
}

function opponentIndex(index) {
  return index === 0 ? 1 : 0;
}

function seatOf(room, socketId) {
  return room.players.findIndex((p) => p && p.socketId === socketId);
}

function shipIsSunk(ship) {
  return ship.hits.size >= ship.cells.length;
}

function remainingShips(player) {
  return player.ships.filter((ship) => !shipIsSunk(ship)).length;
}

function touch(room) {
  room.lastActivity = Date.now();
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function pushChat(room, entry) {
  const full = { ...entry, id: crypto.randomUUID(), timestamp: Date.now() };
  room.chat.push(full);
  if (room.chat.length > MAX_CHAT_MESSAGES) {
    room.chat.splice(0, room.chat.length - MAX_CHAT_MESSAGES);
  }
  room.players.forEach((player, index) => {
    if (player?.connected) {
      io.to(player.socketId).emit('chat', serializeChatEntry(full, index));
    }
  });
}

function systemChat(room, message) {
  pushChat(room, { kind: 'system', seat: null, name: 'System', message });
}

function serializeChatEntry(entry, viewerSeat) {
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    message: entry.message,
    timestamp: entry.timestamp,
    mine: entry.seat !== null && entry.seat === viewerSeat,
  };
}

// ---------------------------------------------------------------------------
// State snapshots (each player only ever sees what they are allowed to see)
// ---------------------------------------------------------------------------

function serializeShots(player) {
  return [...player.shotsReceived.entries()].map(([key, result]) => {
    const [x, y] = key.split(',').map(Number);
    return { x, y, result };
  });
}

function serializeShip(ship) {
  return {
    name: ship.name,
    x: ship.x,
    y: ship.y,
    dir: ship.dir,
    length: ship.cells.length,
    hits: ship.hits.size,
    sunk: shipIsSunk(ship),
  };
}

function snapshotFor(room, seat) {
  const me = room.players[seat];
  const enemy = room.players[opponentIndex(seat)];
  const revealAll = room.phase === 'over';

  return {
    code: room.code,
    phase: room.phase,
    boardSize: BOARD_SIZE,
    fleet: SHIPS,
    rules: room.rules,
    isHost: seat === 0,
    turn: room.turn === null ? null : room.turn === seat ? 'you' : 'enemy',
    winner: room.winner === null ? null : room.winner === seat ? 'you' : 'enemy',
    endReason: room.endReason,
    round: room.round,
    rematch: {
      you: room.rematch.has(seat),
      enemy: room.rematch.has(opponentIndex(seat)),
    },
    me: {
      name: me.name,
      ready: me.ready,
      ships: me.ships.map(serializeShip),
      shotsReceived: serializeShots(me),
      stats: me.stats,
      shipsRemaining: remainingShips(me),
    },
    enemy: enemy
      ? {
          name: enemy.name,
          connected: enemy.connected,
          ready: enemy.ready,
          shotsReceived: serializeShots(enemy),
          stats: enemy.stats,
          shipsRemaining: enemy.ships.length ? remainingShips(enemy) : SHIPS.length,
          ships: enemy.ships
            .filter((ship) => revealAll || shipIsSunk(ship))
            .map(serializeShip),
        }
      : null,
  };
}

function broadcastState(room) {
  room.players.forEach((player, seat) => {
    if (player?.connected) {
      io.to(player.socketId).emit('state', snapshotFor(room, seat));
    }
  });
}

// ---------------------------------------------------------------------------
// Room lifecycle
// ---------------------------------------------------------------------------

function createRoom(hostPlayer) {
  const code = generateRoomCode();
  const room = {
    code,
    phase: 'lobby',
    players: [hostPlayer],
    turn: null,
    winner: null,
    endReason: null,
    round: 1,
    lastLoser: null,
    rules: { bonusShot: true },
    rematch: new Set(),
    chat: [],
    lastActivity: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function startPlacement(room) {
  room.phase = 'placement';
  room.turn = null;
  room.winner = null;
  room.endReason = null;
  room.rematch.clear();
  room.players.forEach((player) => player && resetPlayerForMatch(player));
}

function startBattle(room) {
  room.phase = 'battle';
  if (room.lastLoser !== null && room.players[room.lastLoser]) {
    room.turn = room.lastLoser;
  } else {
    room.turn = crypto.randomInt(2);
  }
  systemChat(room, `Battle stations! ${room.players[room.turn].name} fires first.`);
}

function endMatch(room, winnerSeat, reason) {
  room.phase = 'over';
  room.winner = winnerSeat;
  room.endReason = reason;
  room.turn = null;
  room.lastLoser = opponentIndex(winnerSeat);
  room.rematch.clear();
}

function removeSeat(room, seat, { reason }) {
  const leaving = room.players[seat];
  if (!leaving) return;
  if (leaving.disconnectTimer) clearTimeout(leaving.disconnectTimer);

  const remainingSeat = opponentIndex(seat);
  const remaining = room.players[remainingSeat];

  if (!remaining) {
    rooms.delete(room.code);
    return;
  }

  const wasBattle = room.phase === 'battle';
  // The remaining player always becomes seat 0 (the host).
  room.players = [remaining];
  room.lastLoser = null;
  room.rematch.clear();

  if (wasBattle) {
    room.phase = 'over';
    room.winner = 0;
    room.endReason = 'forfeit';
    room.turn = null;
  } else {
    room.phase = 'lobby';
    room.turn = null;
    room.winner = null;
    room.endReason = null;
    resetPlayerForMatch(remaining);
  }

  systemChat(
    room,
    reason === 'timeout'
      ? `${leaving.name} lost connection and left the room.`
      : `${leaving.name} left the room.`
  );
  touch(room);
  broadcastState(room);
}

function leaveCurrentRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  socket.data.roomCode = null;
  socket.leave(code);
  const room = rooms.get(code);
  if (!room) return;
  const seat = seatOf(room, socket.id);
  if (seat === -1) return;
  removeSeat(room, seat, { reason: 'left' });
}

function attachSocket(socket, room, player) {
  if (socket.data.roomCode && socket.data.roomCode !== room.code) {
    leaveCurrentRoom(socket);
  }
  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }
  player.socketId = socket.id;
  player.connected = true;
  socket.data.roomCode = room.code;
  socket.join(room.code);
}

// ---------------------------------------------------------------------------
// Fleet validation
// ---------------------------------------------------------------------------

function buildFleet(rawShips) {
  if (!Array.isArray(rawShips) || rawShips.length !== SHIPS.length) {
    throw new Error('Place every ship before readying up.');
  }
  const spec = new Map(SHIPS.map((ship) => [ship.name, ship.length]));
  const seen = new Set();
  const occupied = new Set();

  return rawShips.map((raw) => {
    const name = raw?.name;
    const length = spec.get(name);
    if (!length) throw new Error('Unknown ship in fleet.');
    if (seen.has(name)) throw new Error(`${name} was placed twice.`);
    seen.add(name);

    const x = Number(raw.x);
    const y = Number(raw.y);
    const dir = raw.dir === 'v' ? 'v' : raw.dir === 'h' ? 'h' : null;
    if (!Number.isInteger(x) || !Number.isInteger(y) || !dir) {
      throw new Error('Invalid ship coordinates.');
    }

    const cells = [];
    for (let i = 0; i < length; i += 1) {
      const cx = dir === 'h' ? x + i : x;
      const cy = dir === 'v' ? y + i : y;
      if (cx < 0 || cy < 0 || cx >= BOARD_SIZE || cy >= BOARD_SIZE) {
        throw new Error(`${name} is outside the grid.`);
      }
      const key = cellKey(cx, cy);
      if (occupied.has(key)) throw new Error('Ships cannot overlap.');
      occupied.add(key);
      cells.push(key);
    }

    return { name, x, y, dir, cells, hits: new Set() };
  });
}

// ---------------------------------------------------------------------------
// Socket handlers
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  function currentRoom() {
    const code = socket.data.roomCode;
    if (!code) return {};
    const room = rooms.get(code);
    if (!room) return {};
    const seat = seatOf(room, socket.id);
    if (seat === -1) return {};
    return { room, seat, player: room.players[seat] };
  }

  socket.on('room:create', (payload = {}, callback) => {
    const token = sanitizeToken(payload.token);
    if (!token) {
      reply(callback, { error: 'Missing session token. Refresh the page.' });
      return;
    }
    leaveCurrentRoom(socket);
    const player = createPlayer({
      token,
      socketId: socket.id,
      name: sanitizeName(payload.name, 'Captain'),
    });
    const room = createRoom(player);
    attachSocket(socket, room, player);
    reply(callback, { ok: true, code: room.code });
    systemChat(room, `Room ${room.code} is open. Share the code to invite an opponent.`);
    broadcastState(room);
  });

  socket.on('room:join', (payload = {}, callback) => {
    const code = normalizeCode(payload.code);
    const token = sanitizeToken(payload.token);
    const room = rooms.get(code);
    if (!token) {
      reply(callback, { error: 'Missing session token. Refresh the page.' });
      return;
    }
    if (!room) {
      reply(callback, { error: `No room found with code ${code || '…'}.` });
      return;
    }

    // Reconnecting to an existing seat (e.g. after a refresh).
    const existingSeat = room.players.findIndex((p) => p && p.token === token);
    if (existingSeat !== -1) {
      const player = room.players[existingSeat];
      const wasDisconnected = !player.connected;
      attachSocket(socket, room, player);
      reply(callback, { ok: true, code, rejoined: true });
      socket.emit(
        'chatHistory',
        room.chat.map((entry) => serializeChatEntry(entry, existingSeat))
      );
      if (wasDisconnected) systemChat(room, `${player.name} reconnected.`);
      touch(room);
      broadcastState(room);
      return;
    }

    if (room.players.length >= 2) {
      reply(callback, { error: 'That room is already full.' });
      return;
    }

    leaveCurrentRoom(socket);
    const hostName = room.players[0]?.name;
    let name = sanitizeName(payload.name, 'Challenger');
    if (name === hostName) name = `${name} II`.slice(0, MAX_NAME_LENGTH + 3);
    const player = createPlayer({ token, socketId: socket.id, name });
    room.players.push(player);
    attachSocket(socket, room, player);

    reply(callback, { ok: true, code });
    socket.emit(
      'chatHistory',
      room.chat.map((entry) => serializeChatEntry(entry, 1))
    );
    startPlacement(room);
    systemChat(room, `${player.name} joined. Deploy your fleets!`);
    touch(room);
    broadcastState(room);
  });

  socket.on('room:resume', (payload = {}, callback) => {
    // Silent reconnect attempt on page load; never creates a seat.
    const code = normalizeCode(payload.code);
    const token = sanitizeToken(payload.token);
    const room = rooms.get(code);
    if (!room || !token) {
      reply(callback, { error: 'gone' });
      return;
    }
    const seat = room.players.findIndex((p) => p && p.token === token);
    if (seat === -1) {
      reply(callback, { error: 'gone' });
      return;
    }
    const player = room.players[seat];
    const wasDisconnected = !player.connected;
    attachSocket(socket, room, player);
    reply(callback, { ok: true, code });
    socket.emit(
      'chatHistory',
      room.chat.map((entry) => serializeChatEntry(entry, seat))
    );
    if (wasDisconnected) systemChat(room, `${player.name} reconnected.`);
    touch(room);
    broadcastState(room);
  });

  socket.on('room:leave', (_payload, callback) => {
    leaveCurrentRoom(socket);
    reply(callback, { ok: true });
  });

  socket.on('room:rules', (payload = {}, callback) => {
    const { room, seat } = currentRoom();
    if (!room) return reply(callback, { error: 'Not in a room.' });
    if (seat !== 0) return reply(callback, { error: 'Only the host can change rules.' });
    if (room.phase === 'battle') {
      return reply(callback, { error: 'Rules are locked once the battle begins.' });
    }
    const bonusShot = Boolean(payload.bonusShot);
    if (room.rules.bonusShot !== bonusShot) {
      room.rules.bonusShot = bonusShot;
      systemChat(
        room,
        bonusShot
          ? 'Rule change: a hit earns another shot.'
          : 'Rule change: turns alternate after every shot.'
      );
    }
    touch(room);
    broadcastState(room);
    reply(callback, { ok: true });
  });

  socket.on('player:name', (payload = {}, callback) => {
    const { room, player } = currentRoom();
    if (!room) return reply(callback, { error: 'Not in a room.' });
    const next = sanitizeName(payload.name, player.name);
    if (next !== player.name) {
      systemChat(room, `${player.name} is now known as ${next}.`);
      player.name = next;
      broadcastState(room);
    }
    reply(callback, { ok: true });
  });

  socket.on('fleet:submit', (payload = {}, callback) => {
    const { room, player, seat } = currentRoom();
    if (!room) return reply(callback, { error: 'Not in a room.' });
    if (room.phase !== 'placement') {
      return reply(callback, { error: 'Fleets can only be deployed before the battle.' });
    }
    try {
      player.ships = buildFleet(payload.ships);
    } catch (error) {
      return reply(callback, { error: error.message });
    }
    player.ready = true;
    reply(callback, { ok: true });
    touch(room);

    const enemy = room.players[opponentIndex(seat)];
    if (enemy && enemy.ready) {
      startBattle(room);
    }
    broadcastState(room);
  });

  socket.on('fleet:unready', (_payload, callback) => {
    const { room, player } = currentRoom();
    if (!room) return reply(callback, { error: 'Not in a room.' });
    if (room.phase !== 'placement') {
      return reply(callback, { error: 'Too late to reposition — the battle has begun.' });
    }
    player.ready = false;
    touch(room);
    broadcastState(room);
    reply(callback, { ok: true });
  });

  socket.on('fire', (payload = {}, callback) => {
    const { room, player, seat } = currentRoom();
    if (!room) return reply(callback, { error: 'Not in a room.' });
    if (room.phase !== 'battle') return reply(callback, { error: 'The battle is not active.' });
    if (room.turn !== seat) return reply(callback, { error: 'Hold fire — it is not your turn.' });

    const enemySeat = opponentIndex(seat);
    const enemy = room.players[enemySeat];
    if (!enemy) return reply(callback, { error: 'No opponent to fire at.' });

    const x = Number(payload.x);
    const y = Number(payload.y);
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= BOARD_SIZE ||
      y >= BOARD_SIZE
    ) {
      return reply(callback, { error: 'Target is off the grid.' });
    }

    const key = cellKey(x, y);
    if (enemy.shotsReceived.has(key)) {
      return reply(callback, { error: 'You already fired at that square.' });
    }

    const ship = enemy.ships.find((s) => s.cells.includes(key));
    let result = 'miss';
    let sunkShip = null;
    player.stats.shots += 1;

    if (ship) {
      ship.hits.add(key);
      player.stats.hits += 1;
      result = 'hit';
      if (shipIsSunk(ship)) {
        result = 'sunk';
        sunkShip = serializeShip(ship);
      }
    }
    enemy.shotsReceived.set(key, result === 'miss' ? 'miss' : 'hit');

    const fleetDestroyed = remainingShips(enemy) === 0;
    if (fleetDestroyed) {
      endMatch(room, seat, 'fleet');
    } else if (result === 'miss' || !room.rules.bonusShot) {
      room.turn = enemySeat;
    }

    reply(callback, { ok: true, result });

    room.players.forEach((p, viewer) => {
      if (!p?.connected) return;
      io.to(p.socketId).emit('shot', {
        by: viewer === seat ? 'you' : 'enemy',
        x,
        y,
        result,
        sunkShip,
        gameOver: fleetDestroyed,
      });
    });

    if (sunkShip) systemChat(room, `${player.name} sank ${enemy.name}'s ${sunkShip.name}!`);
    if (fleetDestroyed) systemChat(room, `${player.name} wins the battle!`);
    touch(room);
    broadcastState(room);
  });

  socket.on('rematch', (_payload, callback) => {
    const { room, seat, player } = currentRoom();
    if (!room) return reply(callback, { error: 'Not in a room.' });
    if (room.phase !== 'over') return reply(callback, { error: 'The match is still running.' });

    const enemy = room.players[opponentIndex(seat)];
    if (!enemy) {
      // Opponent is gone: reopen the room so someone new can join.
      room.phase = 'lobby';
      room.winner = null;
      room.endReason = null;
      room.round += 1;
      resetPlayerForMatch(player);
      systemChat(room, `Room ${room.code} is open again. Share the code to find a new opponent.`);
    } else {
      room.rematch.add(seat);
      if (room.rematch.size === 2) {
        room.round += 1;
        startPlacement(room);
        systemChat(room, `Round ${room.round}! Redeploy your fleets.`);
      } else {
        systemChat(room, `${player.name} wants a rematch.`);
      }
    }
    touch(room);
    broadcastState(room);
    reply(callback, { ok: true });
  });

  socket.on('chat', (payload = {}, callback) => {
    const { room, player, seat } = currentRoom();
    if (!room) return reply(callback, { error: 'Not in a room.' });
    const text = typeof payload.message === 'string'
      ? payload.message.replace(/\s+/g, ' ').trim()
      : '';
    if (!text) return reply(callback, { error: 'Message is empty.' });
    if (text.length > MAX_CHAT_LENGTH) {
      return reply(callback, { error: `Messages are limited to ${MAX_CHAT_LENGTH} characters.` });
    }
    pushChat(room, { kind: 'user', seat, name: player.name, message: text });
    touch(room);
    reply(callback, { ok: true });
  });

  socket.on('disconnect', () => {
    const { room, player } = currentRoom();
    if (!room) return;
    player.connected = false;
    touch(room);
    player.disconnectTimer = setTimeout(() => {
      player.disconnectTimer = null;
      const liveRoom = rooms.get(room.code);
      // Seats can shift (the remaining player becomes host), so look it up again.
      const liveSeat = liveRoom ? liveRoom.players.indexOf(player) : -1;
      if (liveSeat === -1 || player.connected) return;
      removeSeat(liveRoom, liveSeat, { reason: 'timeout' });
    }, RECONNECT_GRACE_MS);
    broadcastState(room);
  });
});

// Sweep rooms nobody is connected to anymore.
setInterval(() => {
  const now = Date.now();
  rooms.forEach((room, code) => {
    const anyoneHere = room.players.some((p) => p?.connected);
    if (!anyoneHere && now - room.lastActivity > EMPTY_ROOM_TTL_MS) {
      room.players.forEach((p) => p?.disconnectTimer && clearTimeout(p.disconnectTimer));
      rooms.delete(code);
    }
  });
}, 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Battleship server running on http://localhost:${PORT}`);
});
