const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.get('/healthz', (_req, res) => res.send('ok'));
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
const MODES = ['classic', 'salvo'];

const ROOM_CODE_LENGTH = 5;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECONNECT_GRACE_MS = 45 * 1000;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const MAX_CHAT_MESSAGES = 100;
const MAX_CHAT_LENGTH = 200;
const MAX_NAME_LENGTH = 16;
const MAX_SPECTATORS = 20;

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

function shipIsSunk(ship) {
  return ship.hits.size >= ship.cells.length;
}

function remainingShips(player) {
  return player.ships.filter((ship) => !shipIsSunk(ship)).length;
}

function touch(room) {
  room.lastActivity = Date.now();
}

// How many shots the given seat must fire this turn.
function shotsPerTurn(room, seat) {
  if (room.rules.mode !== 'salvo') return 1;
  const shooter = room.players[seat];
  const target = room.players[opponentIndex(seat)];
  if (!shooter || !target) return 1;
  const openCells = BOARD_SIZE * BOARD_SIZE - target.shotsReceived.size;
  return Math.max(1, Math.min(remainingShips(shooter), openCells));
}

// Calls fn(socketId, viewer) for every connected player and spectator.
function forEachViewer(room, fn) {
  room.players.forEach((player, seat) => {
    if (player?.connected) fn(player.socketId, { seat, token: player.token });
  });
  room.spectators.forEach((spectator) => {
    if (spectator.connected) fn(spectator.socketId, { seat: null, token: spectator.token });
  });
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function serializeChatEntry(entry, viewerToken) {
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    message: entry.message,
    timestamp: entry.timestamp,
    spectator: Boolean(entry.spectator),
    mine: entry.token !== null && entry.token === viewerToken,
  };
}

function pushChat(room, entry) {
  const full = { token: null, ...entry, id: crypto.randomUUID(), timestamp: Date.now() };
  room.chat.push(full);
  if (room.chat.length > MAX_CHAT_MESSAGES) {
    room.chat.splice(0, room.chat.length - MAX_CHAT_MESSAGES);
  }
  forEachViewer(room, (socketId, viewer) => {
    io.to(socketId).emit('chat', serializeChatEntry(full, viewer.token));
  });
}

function systemChat(room, message) {
  pushChat(room, { kind: 'system', name: 'System', message });
}

function sendChatHistory(socket, room, token) {
  socket.emit('chatHistory', room.chat.map((entry) => serializeChatEntry(entry, token)));
}

// ---------------------------------------------------------------------------
// State snapshots (each viewer only ever sees what they are allowed to see)
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

function serializeSide(player, { revealShips }) {
  return {
    name: player.name,
    connected: player.connected,
    ready: player.ready,
    shotsReceived: serializeShots(player),
    stats: player.stats,
    shipsRemaining: player.ships.length ? remainingShips(player) : SHIPS.length,
    ships: player.ships.filter((ship) => revealShips || shipIsSunk(ship)).map(serializeShip),
  };
}

// `seat` is the viewer's seat, or null for a spectator (who sees seat 0 as
// "me" and seat 1 as "enemy", but never unsunk ship positions of either).
function snapshotFor(room, seat) {
  const spectator = seat === null;
  const perspective = spectator ? 0 : seat;
  const me = room.players[perspective];
  const enemy = room.players[opponentIndex(perspective)];
  const over = room.phase === 'over';
  const relative = (value) => (value === null ? null : value === perspective ? 'you' : 'enemy');

  return {
    code: room.code,
    phase: room.phase,
    boardSize: BOARD_SIZE,
    fleet: SHIPS,
    rules: room.rules,
    spectator,
    isHost: seat === 0,
    turn: relative(room.turn),
    shotsPerTurn: room.turn === null ? 1 : shotsPerTurn(room, room.turn),
    winner: relative(room.winner),
    endReason: room.endReason,
    round: room.round,
    spectators: [...room.spectators.values()].filter((s) => s.connected).map((s) => s.name),
    rematch: {
      you: room.rematch.has(perspective),
      enemy: room.rematch.has(opponentIndex(perspective)),
    },
    me: me
      ? {
          ...serializeSide(me, { revealShips: !spectator || over }),
          shipsRemaining: remainingShips(me),
        }
      : null,
    enemy: enemy ? serializeSide(enemy, { revealShips: over }) : null,
  };
}

function broadcastState(room) {
  forEachViewer(room, (socketId, viewer) => {
    io.to(socketId).emit('state', snapshotFor(room, viewer.seat));
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
    spectators: new Map(),
    turn: null,
    winner: null,
    endReason: null,
    round: 1,
    lastLoser: null,
    rules: { mode: 'classic', bonusShot: true },
    rematch: new Set(),
    chat: [],
    lastActivity: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function closeRoom(room) {
  room.players.forEach((p) => p?.disconnectTimer && clearTimeout(p.disconnectTimer));
  room.spectators.forEach((s) => {
    if (s.disconnectTimer) clearTimeout(s.disconnectTimer);
    if (s.connected) io.to(s.socketId).emit('room:closed');
  });
  rooms.delete(room.code);
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

  const remaining = room.players[opponentIndex(seat)];
  if (!remaining) {
    closeRoom(room);
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

function removeSpectator(room, token) {
  const spectator = room.spectators.get(token);
  if (!spectator) return;
  if (spectator.disconnectTimer) clearTimeout(spectator.disconnectTimer);
  room.spectators.delete(token);
  broadcastState(room);
}

function leaveCurrentRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  socket.data.roomCode = null;
  socket.leave(code);
  const room = rooms.get(code);
  if (!room) return;
  const seat = room.players.findIndex((p) => p && p.socketId === socket.id);
  if (seat !== -1) {
    removeSeat(room, seat, { reason: 'left' });
    return;
  }
  const spectator = [...room.spectators.values()].find((s) => s.socketId === socket.id);
  if (spectator) removeSpectator(room, spectator.token);
}

function attachSocket(socket, room, member) {
  if (socket.data.roomCode && socket.data.roomCode !== room.code) {
    leaveCurrentRoom(socket);
  }
  if (member.disconnectTimer) {
    clearTimeout(member.disconnectTimer);
    member.disconnectTimer = null;
  }
  member.socketId = socket.id;
  member.connected = true;
  socket.data.roomCode = room.code;
  socket.join(room.code);
}

// Re-attaches a returning player or spectator by token. Returns the role or null.
function resumeMember(socket, room, token) {
  const seat = room.players.findIndex((p) => p && p.token === token);
  if (seat !== -1) {
    const player = room.players[seat];
    const wasDisconnected = !player.connected;
    attachSocket(socket, room, player);
    sendChatHistory(socket, room, token);
    if (wasDisconnected) systemChat(room, `${player.name} reconnected.`);
    return 'player';
  }
  const spectator = room.spectators.get(token);
  if (spectator) {
    attachSocket(socket, room, spectator);
    sendChatHistory(socket, room, token);
    return 'spectator';
  }
  return null;
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

// Validates a list of targets; returns normalized cells or throws.
function parseTargets(raw, enemy, expected) {
  if (!Array.isArray(raw) || raw.length !== expected) {
    throw new Error(
      expected === 1 ? 'Pick one target.' : `Pick exactly ${expected} targets for your salvo.`
    );
  }
  const seen = new Set();
  return raw.map((target) => {
    const x = Number(target?.x);
    const y = Number(target?.y);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) {
      throw new Error('Target is off the grid.');
    }
    const key = cellKey(x, y);
    if (enemy.shotsReceived.has(key)) throw new Error('You already fired at that square.');
    if (seen.has(key)) throw new Error('Each salvo target must be different.');
    seen.add(key);
    return { x, y, key };
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
    const seat = room.players.findIndex((p) => p && p.socketId === socket.id);
    if (seat !== -1) return { room, seat, player: room.players[seat] };
    const spectator = [...room.spectators.values()].find((s) => s.socketId === socket.id);
    if (spectator) return { room, spectator };
    return {};
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

    // Returning player or spectator (e.g. after a refresh).
    const resumed = resumeMember(socket, room, token);
    if (resumed) {
      reply(callback, { ok: true, code, spectator: resumed === 'spectator' });
      touch(room);
      broadcastState(room);
      return;
    }

    const name = sanitizeName(payload.name, 'Challenger');

    if (room.players.length >= 2) {
      if (room.spectators.size >= MAX_SPECTATORS) {
        reply(callback, { error: 'That room is full, including spectator seats.' });
        return;
      }
      leaveCurrentRoom(socket);
      const spectator = { token, socketId: socket.id, name, connected: true, disconnectTimer: null };
      room.spectators.set(token, spectator);
      attachSocket(socket, room, spectator);
      reply(callback, { ok: true, code, spectator: true });
      sendChatHistory(socket, room, token);
      systemChat(room, `${name} is watching.`);
      touch(room);
      broadcastState(room);
      return;
    }

    leaveCurrentRoom(socket);
    const hostName = room.players[0]?.name;
    const player = createPlayer({
      token,
      socketId: socket.id,
      name: name === hostName ? `${name} II`.slice(0, MAX_NAME_LENGTH + 3) : name,
    });
    room.players.push(player);
    attachSocket(socket, room, player);

    reply(callback, { ok: true, code, spectator: false });
    sendChatHistory(socket, room, token);
    startPlacement(room);
    systemChat(room, `${player.name} joined. Deploy your fleets!`);
    touch(room);
    broadcastState(room);
  });

  socket.on('room:resume', (payload = {}, callback) => {
    // Silent reconnect attempt on page load; never creates a new membership.
    const code = normalizeCode(payload.code);
    const token = sanitizeToken(payload.token);
    const room = rooms.get(code);
    const resumed = room && token ? resumeMember(socket, room, token) : null;
    if (!resumed) {
      reply(callback, { error: 'gone' });
      return;
    }
    reply(callback, { ok: true, code, spectator: resumed === 'spectator' });
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
    if (typeof payload.bonusShot === 'boolean' && room.rules.bonusShot !== payload.bonusShot) {
      room.rules.bonusShot = payload.bonusShot;
      systemChat(
        room,
        payload.bonusShot
          ? 'Rule change: a hit earns another shot.'
          : 'Rule change: turns alternate after every shot.'
      );
    }
    if (MODES.includes(payload.mode) && room.rules.mode !== payload.mode) {
      room.rules.mode = payload.mode;
      systemChat(
        room,
        payload.mode === 'salvo'
          ? 'Mode: Salvo — fire one shot per surviving ship each turn.'
          : 'Mode: Classic — one shot per turn.'
      );
    }
    touch(room);
    broadcastState(room);
    reply(callback, { ok: true });
  });

  socket.on('player:name', (payload = {}, callback) => {
    const { room, player } = currentRoom();
    if (!player) return reply(callback, { error: 'Not in a room.' });
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
    if (!player) return reply(callback, { error: 'Only players can deploy a fleet.' });
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
    if (!player) return reply(callback, { error: 'Only players can reposition.' });
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
    if (!player) return reply(callback, { error: 'Spectators cannot fire.' });
    if (room.phase !== 'battle') return reply(callback, { error: 'The battle is not active.' });
    if (room.turn !== seat) return reply(callback, { error: 'Hold fire — it is not your turn.' });

    const enemySeat = opponentIndex(seat);
    const enemy = room.players[enemySeat];
    if (!enemy) return reply(callback, { error: 'No opponent to fire at.' });

    const rawTargets = Array.isArray(payload.targets) ? payload.targets : [payload];
    let targets;
    try {
      targets = parseTargets(rawTargets, enemy, shotsPerTurn(room, seat));
    } catch (error) {
      return reply(callback, { error: error.message });
    }

    const shots = [];
    let fleetDestroyed = false;
    for (const { x, y, key } of targets) {
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
      shots.push({ x, y, result, sunkShip });
      if (remainingShips(enemy) === 0) {
        fleetDestroyed = true;
        break;
      }
    }

    const anyHit = shots.some((s) => s.result !== 'miss');
    if (fleetDestroyed) {
      endMatch(room, seat, 'fleet');
    } else if (room.rules.mode === 'salvo' || !anyHit || !room.rules.bonusShot) {
      room.turn = enemySeat;
    }

    reply(callback, { ok: true, results: shots.map((s) => s.result) });

    forEachViewer(room, (socketId, viewer) => {
      const perspective = viewer.seat === null ? 0 : viewer.seat;
      io.to(socketId).emit('volley', {
        by: perspective === seat ? 'you' : 'enemy',
        shots,
        gameOver: fleetDestroyed,
      });
    });

    shots
      .filter((s) => s.sunkShip)
      .forEach((s) => systemChat(room, `${player.name} sank ${enemy.name}'s ${s.sunkShip.name}!`));
    if (fleetDestroyed) systemChat(room, `${player.name} wins the battle!`);
    touch(room);
    broadcastState(room);
  });

  socket.on('rematch', (_payload, callback) => {
    const { room, seat, player } = currentRoom();
    if (!player) return reply(callback, { error: 'Only players can start a rematch.' });
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
    const { room, player, spectator } = currentRoom();
    const member = player || spectator;
    if (!member) return reply(callback, { error: 'Not in a room.' });
    const text = typeof payload.message === 'string'
      ? payload.message.replace(/\s+/g, ' ').trim()
      : '';
    if (!text) return reply(callback, { error: 'Message is empty.' });
    if (text.length > MAX_CHAT_LENGTH) {
      return reply(callback, { error: `Messages are limited to ${MAX_CHAT_LENGTH} characters.` });
    }
    pushChat(room, {
      kind: 'user',
      token: member.token,
      name: member.name,
      spectator: Boolean(spectator),
      message: text,
    });
    touch(room);
    reply(callback, { ok: true });
  });

  socket.on('disconnect', () => {
    const { room, player, spectator } = currentRoom();
    const member = player || spectator;
    if (!member) return;
    member.connected = false;
    touch(room);
    member.disconnectTimer = setTimeout(() => {
      member.disconnectTimer = null;
      const liveRoom = rooms.get(room.code);
      if (!liveRoom || member.connected) return;
      if (spectator) {
        removeSpectator(liveRoom, member.token);
        return;
      }
      // Seats can shift (the remaining player becomes host), so look it up again.
      const liveSeat = liveRoom.players.indexOf(member);
      if (liveSeat !== -1) removeSeat(liveRoom, liveSeat, { reason: 'timeout' });
    }, RECONNECT_GRACE_MS);
    broadcastState(room);
  });
});

// Sweep rooms no player is connected to anymore.
setInterval(() => {
  const now = Date.now();
  rooms.forEach((room) => {
    const anyoneHere = room.players.some((p) => p?.connected);
    if (!anyoneHere && now - room.lastActivity > EMPTY_ROOM_TTL_MS) closeRoom(room);
  });
}, 60 * 1000).unref();

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((net) => net && net.family === 'IPv4' && !net.internal)
    .map((net) => net.address);
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Battleship server running on http://localhost:${PORT}`);
  const addresses = lanAddresses();
  if (addresses.length) {
    console.log('Other devices on the same Wi-Fi can open:');
    addresses.forEach((address) => console.log(`  http://${address}:${PORT}`));
    console.log('If a phone cannot connect, allow Node.js through your firewall on private networks.');
  }
});
