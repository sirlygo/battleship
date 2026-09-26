// Game-agnostic rooms: codes, seats, spectators, reconnects, chat and rematches.
// Each game plugs in as a module (see server/games/*.js) that owns the rules.

const crypto = require('crypto');

const ROOM_CODE_LENGTH = 5;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECONNECT_GRACE_MS = 45 * 1000;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const MAX_CHAT_MESSAGES = 100;
const MAX_CHAT_LENGTH = 200;
const MAX_NAME_LENGTH = 16;
const MAX_SPECTATORS = 20;

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

function reply(callback, payload) {
  if (typeof callback === 'function') callback(payload);
}

class RoomManager {
  constructor(io, games) {
    this.io = io;
    this.games = games;
    this.rooms = new Map();
    setInterval(() => this.sweep(), 60 * 1000).unref();
    io.on('connection', (socket) => this.bindSocket(socket));
  }

  // ---- lookups ------------------------------------------------------------

  lookup(code) {
    const room = this.rooms.get(normalizeCode(code));
    return room ? { game: room.game } : null;
  }

  occupiedSeats(room) {
    return room.players.map((p, seat) => (p ? seat : null)).filter((seat) => seat !== null);
  }

  hostSeat(room) {
    const seats = this.occupiedSeats(room);
    return seats.length ? seats[0] : null;
  }

  memberOf(socket) {
    const room = this.rooms.get(socket.data.roomCode || '');
    if (!room) return {};
    const seat = room.players.findIndex((p) => p && p.socketId === socket.id);
    if (seat !== -1) return { room, seat, player: room.players[seat] };
    const spectator = [...room.spectators.values()].find((s) => s.socketId === socket.id);
    return spectator ? { room, spectator } : {};
  }

  forEachViewer(room, fn) {
    room.players.forEach((player, seat) => {
      if (player?.connected) fn(player.socketId, { seat, token: player.token });
    });
    room.spectators.forEach((spectator) => {
      if (spectator.connected) fn(spectator.socketId, { seat: null, token: spectator.token });
    });
  }

  // ---- context handed to game modules -------------------------------------

  ctx(room) {
    return {
      room,
      system: (message) => this.systemChat(room, message),
      name: (seat) => room.players[seat]?.name || 'A player',
      emit: (event, payloadFor) => {
        this.forEachViewer(room, (socketId, viewer) => {
          this.io.to(socketId).emit(event, payloadFor(viewer.seat));
        });
      },
      finish: (winnerSeat, reason) => this.finish(room, winnerSeat, reason),
      // For changes that happen outside a player action (e.g. a clock running out).
      broadcast: () => this.broadcast(room),
    };
  }

  // ---- room lifecycle -----------------------------------------------------

  generateCode() {
    let code;
    do {
      code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
        code += ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(gameId, host) {
    const game = this.games[gameId];
    const room = {
      code: this.generateCode(),
      game: gameId,
      module: game,
      players: new Array(game.maxPlayers).fill(null),
      spectators: new Map(),
      status: 'waiting',
      options: game.defaultOptions(),
      state: null,
      meta: {},
      round: 1,
      result: null,
      rematch: new Set(),
      chat: [],
      lastActivity: Date.now(),
    };
    room.players[0] = host;
    this.rooms.set(room.code, room);
    return room;
  }

  closeRoom(room) {
    if (room.status === 'active') room.module.onFinish?.(this.ctx(room));
    room.players.forEach((p) => p?.disconnectTimer && clearTimeout(p.disconnectTimer));
    room.spectators.forEach((s) => {
      if (s.disconnectTimer) clearTimeout(s.disconnectTimer);
      if (s.connected) this.io.to(s.socketId).emit('room:closed');
    });
    this.rooms.delete(room.code);
  }

  startGame(room) {
    room.status = 'active';
    room.result = null;
    room.rematch.clear();
    room.state = room.module.start(this.ctx(room));
  }

  finish(room, winnerSeat, reason) {
    room.module.onFinish?.(this.ctx(room));
    room.status = 'over';
    room.result = { winner: winnerSeat, reason };
    room.rematch.clear();
  }

  touch(room) {
    room.lastActivity = Date.now();
  }

  sweep() {
    const now = Date.now();
    this.rooms.forEach((room) => {
      const anyoneHere = room.players.some((p) => p?.connected);
      if (!anyoneHere && now - room.lastActivity > EMPTY_ROOM_TTL_MS) this.closeRoom(room);
    });
  }

  // ---- chat ---------------------------------------------------------------

  serializeChat(entry, viewerToken) {
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

  pushChat(room, entry) {
    const full = { token: null, ...entry, id: crypto.randomUUID(), timestamp: Date.now() };
    room.chat.push(full);
    if (room.chat.length > MAX_CHAT_MESSAGES) room.chat.splice(0, room.chat.length - MAX_CHAT_MESSAGES);
    this.forEachViewer(room, (socketId, viewer) => {
      this.io.to(socketId).emit('chat', this.serializeChat(full, viewer.token));
    });
  }

  systemChat(room, message) {
    this.pushChat(room, { kind: 'system', name: 'System', message });
  }

  sendChatHistory(socket, room, token) {
    socket.emit('chatHistory', room.chat.map((entry) => this.serializeChat(entry, token)));
  }

  // ---- snapshots ----------------------------------------------------------

  snapshot(room, seat) {
    const spectator = seat === null;
    const perspective = spectator ? this.hostSeat(room) ?? 0 : seat;
    const base = {
      code: room.code,
      game: room.game,
      status: room.status,
      spectator,
      seat: spectator ? null : seat,
      perspective,
      isHost: !spectator && seat === this.hostSeat(room),
      round: room.round,
      options: room.options,
      spectators: [...room.spectators.values()].filter((s) => s.connected).map((s) => s.name),
      players: room.players.map((p) => (p ? { name: p.name, connected: p.connected } : null)),
      rematchVotes: [...room.rematch],
      result: room.result,
    };
    return { ...base, ...room.module.view(this.ctx(room), seat, perspective) };
  }

  broadcast(room) {
    this.forEachViewer(room, (socketId, viewer) => {
      this.io.to(socketId).emit('state', this.snapshot(room, viewer.seat));
    });
  }

  // ---- membership ---------------------------------------------------------

  attach(socket, room, member) {
    if (socket.data.roomCode && socket.data.roomCode !== room.code) this.leave(socket);
    if (member.disconnectTimer) {
      clearTimeout(member.disconnectTimer);
      member.disconnectTimer = null;
    }
    member.socketId = socket.id;
    member.connected = true;
    socket.data.roomCode = room.code;
    socket.join(room.code);
  }

  resume(socket, room, token) {
    const seat = room.players.findIndex((p) => p && p.token === token);
    if (seat !== -1) {
      const player = room.players[seat];
      const wasDisconnected = !player.connected;
      this.attach(socket, room, player);
      this.sendChatHistory(socket, room, token);
      if (wasDisconnected) this.systemChat(room, `${player.name} reconnected.`);
      return 'player';
    }
    const spectator = room.spectators.get(token);
    if (spectator) {
      this.attach(socket, room, spectator);
      this.sendChatHistory(socket, room, token);
      return 'spectator';
    }
    return null;
  }

  removeSeat(room, seat, reason) {
    const leaving = room.players[seat];
    if (!leaving) return;
    if (leaving.disconnectTimer) clearTimeout(leaving.disconnectTimer);

    if (room.status === 'active') room.module.onLeave(this.ctx(room), seat);
    room.players[seat] = null;
    room.rematch.delete(seat);

    if (!room.players.some(Boolean)) {
      this.closeRoom(room);
      return;
    }
    if (room.status === 'active' && this.occupiedSeats(room).length < room.module.minPlayers) {
      // The module chose not to end the game (e.g. still setting up): go back to waiting.
      room.status = 'waiting';
      room.state = null;
    }
    this.systemChat(
      room,
      reason === 'timeout' ? `${leaving.name} lost connection and left the room.` : `${leaving.name} left the room.`
    );
    this.touch(room);
    this.broadcast(room);
  }

  removeSpectator(room, token) {
    const spectator = room.spectators.get(token);
    if (!spectator) return;
    if (spectator.disconnectTimer) clearTimeout(spectator.disconnectTimer);
    room.spectators.delete(token);
    this.broadcast(room);
  }

  leave(socket) {
    const code = socket.data.roomCode;
    if (!code) return;
    const { room, seat, spectator } = this.memberOf(socket);
    socket.data.roomCode = null;
    socket.leave(code);
    if (!room) return;
    if (spectator) this.removeSpectator(room, spectator.token);
    else if (seat !== undefined) this.removeSeat(room, seat, 'left');
  }

  // ---- socket wiring ------------------------------------------------------

  bindSocket(socket) {
    socket.on('room:create', (payload = {}, callback) => {
      const token = sanitizeToken(payload.token);
      const gameId = payload.game || 'battleship';
      if (!token) return reply(callback, { error: 'Missing session token. Refresh the page.' });
      if (!this.games[gameId]) return reply(callback, { error: 'Unknown game.' });
      this.leave(socket);
      const host = { token, socketId: socket.id, name: sanitizeName(payload.name, 'Captain'), connected: true };
      const room = this.createRoom(gameId, host);
      this.attach(socket, room, host);
      reply(callback, { ok: true, code: room.code, game: gameId });
      this.systemChat(room, `Room ${room.code} is open. Share the code to invite others.`);
      this.broadcast(room);
    });

    socket.on('room:join', (payload = {}, callback) => {
      const code = normalizeCode(payload.code);
      const token = sanitizeToken(payload.token);
      const room = this.rooms.get(code);
      if (!token) return reply(callback, { error: 'Missing session token. Refresh the page.' });
      if (!room) return reply(callback, { error: `No room found with code ${code || '…'}.` });
      if (payload.game && payload.game !== room.game) {
        return reply(callback, { error: `That code is for ${room.module.title}.`, game: room.game });
      }

      const resumed = this.resume(socket, room, token);
      if (resumed) {
        reply(callback, { ok: true, code, game: room.game, spectator: resumed === 'spectator' });
        this.touch(room);
        this.broadcast(room);
        return;
      }

      const name = sanitizeName(payload.name, 'Challenger');
      const openSeat = room.players.findIndex((p) => !p);

      if (openSeat === -1 || room.status === 'active') {
        if (room.spectators.size >= MAX_SPECTATORS) {
          return reply(callback, { error: 'That room is full, including spectator seats.' });
        }
        this.leave(socket);
        const spectator = { token, socketId: socket.id, name, connected: true };
        room.spectators.set(token, spectator);
        this.attach(socket, room, spectator);
        reply(callback, { ok: true, code, game: room.game, spectator: true });
        this.sendChatHistory(socket, room, token);
        this.systemChat(room, `${name} is watching.`);
        this.touch(room);
        this.broadcast(room);
        return;
      }

      this.leave(socket);
      const taken = new Set(room.players.filter(Boolean).map((p) => p.name));
      let unique = name;
      for (let n = 2; taken.has(unique); n += 1) unique = `${name} ${n}`;
      const player = { token, socketId: socket.id, name: unique, connected: true };
      room.players[openSeat] = player;
      this.attach(socket, room, player);
      reply(callback, { ok: true, code, game: room.game, spectator: false });
      this.sendChatHistory(socket, room, token);
      this.systemChat(room, `${player.name} joined.`);
      if (!room.module.manualStart && this.occupiedSeats(room).length >= room.module.maxPlayers) {
        if (room.status === 'over') room.round += 1;
        this.startGame(room);
      }
      this.touch(room);
      this.broadcast(room);
    });

    socket.on('room:resume', (payload = {}, callback) => {
      const room = this.rooms.get(normalizeCode(payload.code));
      const token = sanitizeToken(payload.token);
      const resumed = room && token ? this.resume(socket, room, token) : null;
      if (!resumed) return reply(callback, { error: 'gone' });
      reply(callback, { ok: true, code: room.code, game: room.game, spectator: resumed === 'spectator' });
      this.touch(room);
      this.broadcast(room);
    });

    socket.on('room:leave', (_payload, callback) => {
      this.leave(socket);
      reply(callback, { ok: true });
    });

    const setOptions = (payload = {}, callback) => {
      const { room, seat } = this.memberOf(socket);
      if (!room) return reply(callback, { error: 'Not in a room.' });
      if (seat !== this.hostSeat(room)) return reply(callback, { error: 'Only the host can change the rules.' });
      if (!room.module.canChangeOptions(this.ctx(room), payload || {})) {
        return reply(callback, { error: 'Rules are locked once the game is underway.' });
      }
      room.module.applyOptions(this.ctx(room), payload);
      this.touch(room);
      this.broadcast(room);
      reply(callback, { ok: true });
    };
    socket.on('room:options', setOptions);
    socket.on('room:rules', setOptions);

    // Games for 3+ players start when the host says so (once enough have joined).
    socket.on('room:start', (_payload, callback) => {
      const { room, seat } = this.memberOf(socket);
      if (!room) return reply(callback, { error: 'Not in a room.' });
      if (seat !== this.hostSeat(room)) return reply(callback, { error: 'Only the host can start the game.' });
      if (room.status === 'active') return reply(callback, { error: 'The game is already running.' });
      const count = this.occupiedSeats(room).length;
      if (count < room.module.minPlayers) {
        return reply(callback, { error: `Need at least ${room.module.minPlayers} players to start.` });
      }
      if (room.status === 'over') room.round += 1;
      this.startGame(room);
      this.systemChat(room, `The game begins with ${count} players!`);
      this.touch(room);
      this.broadcast(room);
      reply(callback, { ok: true });
    });

    socket.on('rematch', (_payload, callback) => {
      const { room, seat, player } = this.memberOf(socket);
      if (!player) return reply(callback, { error: 'Only players can start a rematch.' });
      if (room.status !== 'over') return reply(callback, { error: 'The game is still running.' });
      if (this.occupiedSeats(room).length < room.module.minPlayers) {
        room.status = 'waiting';
        room.state = null;
        room.result = null;
        room.round += 1;
        this.systemChat(room, `Room ${room.code} is open again. Share the code to find an opponent.`);
      } else {
        room.rematch.add(seat);
        if (this.occupiedSeats(room).every((s) => room.rematch.has(s))) {
          room.round += 1;
          this.startGame(room);
          this.systemChat(room, `Round ${room.round}! Good luck.`);
        } else {
          this.systemChat(room, `${player.name} wants a rematch.`);
        }
      }
      this.touch(room);
      this.broadcast(room);
      reply(callback, { ok: true });
    });

    socket.on('chat', (payload = {}, callback) => {
      const { room, player, spectator } = this.memberOf(socket);
      const member = player || spectator;
      if (!member) return reply(callback, { error: 'Not in a room.' });
      const text = typeof payload.message === 'string' ? payload.message.replace(/\s+/g, ' ').trim() : '';
      if (!text) return reply(callback, { error: 'Message is empty.' });
      if (text.length > MAX_CHAT_LENGTH) {
        return reply(callback, { error: `Messages are limited to ${MAX_CHAT_LENGTH} characters.` });
      }
      this.pushChat(room, { kind: 'user', token: member.token, name: member.name, spectator: Boolean(spectator), message: text });
      this.touch(room);
      reply(callback, { ok: true });
    });

    // Game-specific actions, routed to whichever game the socket's room is playing.
    const actionNames = new Set(Object.values(this.games).flatMap((g) => Object.keys(g.actions)));
    actionNames.forEach((name) => {
      socket.on(name, (payload = {}, callback) => {
        const { room, seat, player } = this.memberOf(socket);
        if (!room) return reply(callback, { error: 'Not in a room.' });
        const action = room.module.actions[name];
        if (!action) return reply(callback, { error: 'That action is not part of this game.' });
        if (!player) return reply(callback, { error: 'Spectators can only watch.' });
        const result = action(this.ctx(room), seat, payload || {}) || { ok: true };
        // Send the new state first so a client's reply handler already sees it.
        if (!result.error) {
          this.touch(room);
          this.broadcast(room);
        }
        reply(callback, result);
      });
    });

    socket.on('disconnect', () => {
      const { room, player, spectator } = this.memberOf(socket);
      const member = player || spectator;
      if (!member) return;
      member.connected = false;
      this.touch(room);
      member.disconnectTimer = setTimeout(() => {
        member.disconnectTimer = null;
        const liveRoom = this.rooms.get(room.code);
        if (!liveRoom || member.connected) return;
        if (spectator) {
          this.removeSpectator(liveRoom, member.token);
          return;
        }
        const liveSeat = liveRoom.players.indexOf(member);
        if (liveSeat !== -1) this.removeSeat(liveRoom, liveSeat, 'timeout');
      }, RECONNECT_GRACE_MS);
      this.broadcast(room);
    });
  }
}

module.exports = { RoomManager };
