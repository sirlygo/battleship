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
  if (!room) return;
  room.players = room.players.filter((player) => player.id !== socketId);
  if (room.players.length === 0) {
    rooms.delete(roomCode);
  } else {
    rooms.set(roomCode, room);
  }
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
    callback({ code, ships: SHIPS, boardSize: BOARD_SIZE });
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

    callback({ success: true, ships: SHIPS, boardSize: BOARD_SIZE });
    io.to(code).emit('playerJoined');
  });

  socket.on('setUsername', ({ code, username }) => {
    const room = rooms.get(code);
    if (!room) return;
    const player = getPlayer(room, socket.id);
    if (!player) return;
    player.username = username;
    io.to(code).emit('usernameUpdate', {
      players: room.players.map((p) => ({ id: p.id, username: p.username })),
    });
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

    const board = createEmptyBoard();
    const occupied = new Set();

    try {
      ships.forEach((ship) => {
        if (!SHIPS.some((config) => config.name === ship.name && config.length === ship.cells.length)) {
          throw new Error('Invalid ship configuration');
        }
        ship.cells.forEach(({ x, y, z }) => {
          if (x < 0 || y < 0 || z < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE || z >= BOARD_SIZE) {
            throw new Error('Ship out of bounds');
          }
          const key = `${x}:${y}:${z}`;
          if (occupied.has(key)) {
            throw new Error('Ships cannot overlap');
          }
          occupied.add(key);
          board[x][y][z] = ship.name;
        });
      });
    } catch (error) {
      callback({ error: error.message });
      return;
    }

    player.board = board;
    player.ships = ships;
    player.ready = true;
    rooms.set(code, room);

    callback({ success: true });

    if (room.players.length === 2 && room.players.every((p) => p.ready)) {
      room.turn = room.players[0].id;
      io.to(code).emit('gameStarted', { turn: room.turn });
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
    callback(payload);
  });

  socket.on('chatMessage', ({ code, message }) => {
    const room = rooms.get(code);
    if (!room) return;
    const player = getPlayer(room, socket.id);
    if (!player) return;
    const entry = {
      id: socket.id,
      username: player.username || 'Player',
      message,
      timestamp: Date.now(),
    };
    room.chat.push(entry);
    io.to(code).emit('chatUpdate', entry);
  });

  socket.on('disconnecting', () => {
    const roomCodes = [...socket.rooms].filter((code) => rooms.has(code));
    roomCodes.forEach((code) => {
      const room = rooms.get(code);
      if (!room) return;
      const opponent = getOpponent(room, socket.id);
      removePlayerFromRoom(code, socket.id);
      io.to(code).emit('playerLeft', { leaver: socket.id });
      if (!opponent) {
        rooms.delete(code);
      } else {
        room.turn = opponent.id;
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
