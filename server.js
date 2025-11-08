const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const ROOM_CODE_LENGTH = 6;
const BOARD_SIZE = 5;
const SHIPS = [
  { name: 'Carrier', length: 5 },
  { name: 'Battleship', length: 4 },
  { name: 'Cruiser', length: 3 },
  { name: 'Submarine', length: 3 },
  { name: 'Destroyer', length: 2 },
];

const rooms = new Map();
const MAX_CHAT_MESSAGES = 200;
const MAX_CHAT_LENGTH = 200;

function createChatEntry({ id, username, message, kind = 'user' }) {
  return {
    id,
    username,
    message,
    kind,
    timestamp: Date.now(),
  };
}

function trimChatHistory(room) {
  if (room.chat.length <= MAX_CHAT_MESSAGES) return;
  const excess = room.chat.length - MAX_CHAT_MESSAGES;
  room.chat.splice(0, excess);
}

function recordAndBroadcastChat(room, code, entry) {
  room.chat.push(entry);
  trimChatHistory(room);
  rooms.set(code, room);
  io.to(code).emit('chatUpdate', entry);
}

function emitSystemChat(room, code, message) {
  if (!message) return;
  const entry = createChatEntry({
    id: 'system',
    username: 'System',
    message,
    kind: 'system',
  });
  recordAndBroadcastChat(room, code, entry);
}

function sanitizeChatMessage(raw) {
  if (typeof raw !== 'string') {
    return { error: 'Chat message must be text.' };
  }
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return { error: 'Chat messages must contain visible characters.' };
  }
  if (normalized.length > MAX_CHAT_LENGTH) {
    return {
      error: `Chat messages must be ${MAX_CHAT_LENGTH} characters or fewer.`,
    };
  }
  return { value: normalized };
}

function serializeChatHistory(room) {
  return room.chat.map(({ id, username, message, timestamp, kind }) => ({
    id,
    username,
    message,
    timestamp,
    kind: kind || 'user',
  }));
}

function emitRoomState(code) {
  const room = rooms.get(code);
  if (!room) return;

  const players = room.players.map((player) => ({
    id: player.id,
    username: player.username,
    ready: player.ready,
  }));

  io.to(code).emit('roomState', {
    players,
    turn: room.turn,
    started: Boolean(room.turn),
  });
}

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(Math.random() * Math.pow(10, ROOM_CODE_LENGTH))
      .toString()
      .padStart(ROOM_CODE_LENGTH, '0');
  } while (rooms.has(code));
  return code;
}

function createEmptyBoard() {
  const board = [];
  for (let x = 0; x < BOARD_SIZE; x += 1) {
    board[x] = [];
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      board[x][y] = [];
      for (let z = 0; z < BOARD_SIZE; z += 1) {
        board[x][y][z] = null;
      }
    }
  }
  return board;
}

function getOpponent(room, socketId) {
  const playerA = room.players[0];
  const playerB = room.players[1];
  if (!playerB) return null;
  return playerA.id === socketId ? playerB : playerA;
}

function getPlayer(room, socketId) {
  return room.players.find((player) => player.id === socketId) || null;
}

function removePlayerFromRoom(roomCode, socketId) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  const remainingPlayers = room.players.filter((player) => player.id !== socketId);

  if (remainingPlayers.length === 0) {
    rooms.delete(roomCode);
    return null;
  }

  room.players = remainingPlayers;
  rooms.set(roomCode, room);
  return room;
}

io.on('connection', (socket) => {
  socket.on('createGame', (_, callback) => {
    const code = generateRoomCode();
    const newRoom = {
      code,
      players: [
        {
          id: socket.id,
          ready: false,
          board: createEmptyBoard(),
          ships: [],
          hits: new Set(),
          misses: new Set(),
          username: null,
        },
      ],
      turn: null,
      chat: [],
    };
    rooms.set(code, newRoom);
    socket.join(code);
    callback({ code, ships: SHIPS, boardSize: BOARD_SIZE, chat: serializeChatHistory(newRoom) });
    emitRoomState(code);
    emitSystemChat(newRoom, code, 'Room created. Share the code to invite an opponent.');
  });

  socket.on('joinGame', ({ code }, callback) => {
    const room = rooms.get(code);
    if (!room) {
      callback({ error: 'Room not found.' });
      return;
    }

    if (room.players.length >= 2) {
      callback({ error: 'Room is full.' });
      return;
    }

    room.players.push({
      id: socket.id,
      ready: false,
      board: createEmptyBoard(),
      ships: [],
      hits: new Set(),
      misses: new Set(),
      username: null,
    });
    rooms.set(code, room);
    socket.join(code);

    const chatHistory = serializeChatHistory(room);
    callback({ success: true, ships: SHIPS, boardSize: BOARD_SIZE, chat: chatHistory });
    io.to(code).emit('playerJoined');
    emitSystemChat(room, code, 'A commander joined the battle.');
    emitRoomState(code);
  });

  socket.on('setUsername', ({ code, username }) => {
    const room = rooms.get(code);
    if (!room) return;
    const player = getPlayer(room, socket.id);
    if (!player) return;
    const previousName = player.username?.trim() || null;
    const trimmed = typeof username === 'string' ? username.trim() : '';
    const limited = trimmed.slice(0, 20);
    player.username = limited || null;
    emitRoomState(code);
    io.to(code).emit('usernameUpdate', {
      players: room.players.map((p) => ({ id: p.id, username: p.username })),
    });
    if (player.username && player.username !== previousName) {
      emitSystemChat(room, code, previousName
        ? `${previousName} is now known as ${player.username}.`
        : `${player.username} reported for duty.`);
    }
  });

  socket.on('placeShips', ({ code, ships }, callback) => {
    const room = rooms.get(code);
    if (!room) {
      callback({ error: 'Room not found.' });
      return;
    }

    const player = getPlayer(room, socket.id);
    if (!player) {
      callback({ error: 'Player not part of room.' });
      return;
    }

    if (!Array.isArray(ships)) {
      callback({ error: 'Invalid ship data submitted.' });
      return;
    }

    if (ships.length !== SHIPS.length) {
      callback({ error: 'All ships must be placed before locking in.' });
      return;
    }

    const board = createEmptyBoard();
    const occupied = new Set();
    const expectedShips = new Map(SHIPS.map((ship) => [ship.name, ship.length]));
    const seenNames = new Set();
    const sanitizedShips = [];

    try {
      ships.forEach((ship) => {
        if (!ship || typeof ship.name !== 'string' || !Array.isArray(ship.cells)) {
          throw new Error('Invalid ship configuration');
        }

        const requiredLength = expectedShips.get(ship.name);
        if (!requiredLength) {
          throw new Error('Unexpected ship provided.');
        }

        if (seenNames.has(ship.name)) {
          throw new Error('Duplicate ship entries are not allowed.');
        }

        if (ship.cells.length !== requiredLength) {
          throw new Error(`${ship.name} must occupy exactly ${requiredLength} cells.`);
        }

        const normalizedCells = ship.cells.map((cell) => {
          const x = Number(cell?.x);
          const y = Number(cell?.y);
          const z = Number(cell?.z);
          if (![x, y, z].every(Number.isInteger)) {
            throw new Error('Ship coordinates must be whole numbers.');
          }
          if (x < 0 || y < 0 || z < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE || z >= BOARD_SIZE) {
            throw new Error('Ship out of bounds');
          }
          return { x, y, z };
        });

        if (normalizedCells.length > 1) {
          const axes = ['x', 'y', 'z'];
          const varyingAxes = axes.filter((axis) => {
            const values = new Set(normalizedCells.map((cell) => cell[axis]));
            return values.size > 1;
          });

          if (varyingAxes.length !== 1) {
            throw new Error('Ships must be placed in a straight line.');
          }

          const axis = varyingAxes[0];
          const sortedValues = normalizedCells
            .map((cell) => cell[axis])
            .sort((a, b) => a - b);
          for (let index = 1; index < sortedValues.length; index += 1) {
            if (sortedValues[index] !== sortedValues[index - 1] + 1) {
              throw new Error('Ships must occupy consecutive cells.');
            }
          }

          axes
            .filter((axisKey) => axisKey !== axis)
            .forEach((axisKey) => {
              const values = new Set(normalizedCells.map((cell) => cell[axisKey]));
              if (values.size !== 1) {
                throw new Error('Ships must align to a single axis.');
              }
            });
        }

        normalizedCells.forEach(({ x, y, z }) => {
          const key = `${x}:${y}:${z}`;
          if (occupied.has(key)) {
            throw new Error('Ships cannot overlap');
          }
          occupied.add(key);
          board[x][y][z] = ship.name;
        });

        sanitizedShips.push({ name: ship.name, cells: normalizedCells });
        seenNames.add(ship.name);
      });
    } catch (error) {
      callback({ error: error.message });
      return;
    }

    player.board = board;
    player.ships = sanitizedShips;
    player.ready = true;
    rooms.set(code, room);

    callback({ success: true });
    emitRoomState(code);

    if (room.players.length === 2 && room.players.every((p) => p.ready)) {
      room.turn = room.players[0].id;
      io.to(code).emit('gameStarted', { turn: room.turn });
      emitRoomState(code);
    } else {
      io.to(code).emit('playerReady');
    }
  });

  socket.on('attack', ({ code, target }, callback) => {
    const room = rooms.get(code);
    if (!room) {
      callback({ error: 'Room not found.' });
      return;
    }

    if (room.turn !== socket.id) {
      callback({ error: 'Not your turn.' });
      return;
    }

    const opponent = getOpponent(room, socket.id);
    const player = getPlayer(room, socket.id);
    if (!opponent || !player) {
      callback({ error: 'Opponent not found.' });
      return;
    }

    const { x, y, z } = target;
    if (
      x < 0 ||
      y < 0 ||
      z < 0 ||
      x >= BOARD_SIZE ||
      y >= BOARD_SIZE ||
      z >= BOARD_SIZE
    ) {
      callback({ error: 'Invalid target.' });
      return;
    }

    const coordKey = `${x}:${y}:${z}`;
    if (player.hits.has(coordKey) || player.misses.has(coordKey)) {
      callback({ error: 'Coordinate already targeted.' });
      return;
    }

    const cell = opponent.board[x][y][z];
    let result = 'miss';
    let shipName = null;
    if (cell) {
      result = 'hit';
      shipName = cell;
      player.hits.add(coordKey);

      const ship = opponent.ships.find((s) => s.name === cell);
      const hitCount = ship.cells.filter((c) => player.hits.has(`${c.x}:${c.y}:${c.z}`)).length;
      if (hitCount === ship.cells.length) {
        result = 'sunk';
      }
    } else {
      player.misses.add(coordKey);
    }

    const allShipsSunk = opponent.ships.every((ship) =>
      ship.cells.every((c) => player.hits.has(`${c.x}:${c.y}:${c.z}`))
    );

    const payload = {
      attacker: socket.id,
      target,
      result,
      shipName,
      nextTurn: allShipsSunk ? null : opponent.id,
      winner: allShipsSunk ? socket.id : null,
    };

    if (!allShipsSunk) {
      room.turn = opponent.id;
    }

    rooms.set(code, room);

    io.to(code).emit('attackResult', payload);
    emitRoomState(code);
    callback(payload);
  });

  socket.on('chatMessage', ({ code, message }, callback = null) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    const room = rooms.get(code);
    if (!room) {
      respond({ error: 'Room not found.' });
      return;
    }
    const player = getPlayer(room, socket.id);
    if (!player) {
      respond({ error: 'Player not part of room.' });
      return;
    }
    const { value, error } = sanitizeChatMessage(message);
    if (error) {
      respond({ error });
      return;
    }
    const username = player.username?.trim() || 'Player';
    const entry = createChatEntry({
      id: socket.id,
      username,
      message: value,
    });
    recordAndBroadcastChat(room, code, entry);
    respond({ success: true });
  });

  socket.on('disconnecting', () => {
    const roomCodes = [...socket.rooms].filter((code) => rooms.has(code));
    roomCodes.forEach((code) => {
      const room = rooms.get(code);
      if (!room) return;
      const departingPlayer = getPlayer(room, socket.id);
      const opponent = getOpponent(room, socket.id);
      const wasTurn = room.turn === socket.id;
      const updatedRoom = removePlayerFromRoom(code, socket.id);
      io.to(code).emit('playerLeft', { leaver: socket.id });
      if (!updatedRoom) return;
      if (wasTurn) {
        updatedRoom.turn = opponent ? opponent.id : updatedRoom.players[0]?.id || null;
      }
      const name = departingPlayer?.username?.trim() || 'A commander';
      emitSystemChat(updatedRoom, code, `${name} left the battle.`);
      rooms.set(code, updatedRoom);
      emitRoomState(code);
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
