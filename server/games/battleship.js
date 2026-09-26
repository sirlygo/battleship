// Battleship rules. Room handling (seats, chat, rematch…) lives in server/rooms.js.

const crypto = require('crypto');

const BOARD_SIZE = 10;
const SHIPS = [
  { name: 'Carrier', length: 5 },
  { name: 'Battleship', length: 4 },
  { name: 'Cruiser', length: 3 },
  { name: 'Submarine', length: 3 },
  { name: 'Destroyer', length: 2 },
];
const MODES = ['classic', 'salvo'];

const other = (seat) => (seat === 0 ? 1 : 0);
const cellKey = (x, y) => `${x},${y}`;

function freshSeat() {
  return { ready: false, ships: [], shotsReceived: new Map(), stats: { shots: 0, hits: 0 } };
}

function shipIsSunk(ship) {
  return ship.hits.size >= ship.cells.length;
}

function remainingShips(side) {
  return side.ships.filter((ship) => !shipIsSunk(ship)).length;
}

function shotsPerTurn(ctx, seat) {
  const { room } = ctx;
  if (room.options.mode !== 'salvo') return 1;
  const shooter = room.state.seats[seat];
  const target = room.state.seats[other(seat)];
  const openCells = BOARD_SIZE * BOARD_SIZE - target.shotsReceived.size;
  return Math.max(1, Math.min(remainingShips(shooter), openCells));
}

// ---------------------------------------------------------------------------
// Validation
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
    if (!Number.isInteger(x) || !Number.isInteger(y) || !dir) throw new Error('Invalid ship coordinates.');

    const cells = [];
    for (let i = 0; i < length; i += 1) {
      const cx = dir === 'h' ? x + i : x;
      const cy = dir === 'v' ? y + i : y;
      if (cx < 0 || cy < 0 || cx >= BOARD_SIZE || cy >= BOARD_SIZE) throw new Error(`${name} is outside the grid.`);
      const key = cellKey(cx, cy);
      if (occupied.has(key)) throw new Error('Ships cannot overlap.');
      occupied.add(key);
      cells.push(key);
    }
    return { name, x, y, dir, cells, hits: new Set() };
  });
}

function parseTargets(raw, target, expected) {
  if (!Array.isArray(raw) || raw.length !== expected) {
    throw new Error(expected === 1 ? 'Pick one target.' : `Pick exactly ${expected} targets for your salvo.`);
  }
  const seen = new Set();
  return raw.map((t) => {
    const x = Number(t?.x);
    const y = Number(t?.y);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) {
      throw new Error('Target is off the grid.');
    }
    const key = cellKey(x, y);
    if (target.shotsReceived.has(key)) throw new Error('You already fired at that square.');
    if (seen.has(key)) throw new Error('Each salvo target must be different.');
    seen.add(key);
    return { x, y, key };
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function serializeShots(side) {
  return [...side.shotsReceived.entries()].map(([key, result]) => {
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

function serializeSide(player, side, { revealShips }) {
  const data = side || freshSeat();
  return {
    name: player.name,
    connected: player.connected,
    ready: data.ready,
    shotsReceived: serializeShots(data),
    stats: data.stats,
    shipsRemaining: data.ships.length ? remainingShips(data) : SHIPS.length,
    ships: data.ships.filter((ship) => revealShips || shipIsSunk(ship)).map(serializeShip),
  };
}

function view(ctx, seat, perspective) {
  const { room } = ctx;
  const spectator = seat === null;
  const state = room.state;
  const me = room.players[perspective];
  const enemySeat = other(perspective);
  const enemy = room.players[enemySeat];
  const over = room.status === 'over';
  const relative = (value) => (value === null || value === undefined ? null : value === perspective ? 'you' : 'enemy');

  let phase = 'lobby';
  if (room.status === 'active') phase = state.phase;
  if (over) phase = 'over';

  const turn = room.status === 'active' && state.phase === 'battle' ? state.turn : null;
  const mySide = state?.seats[perspective];

  return {
    phase,
    boardSize: BOARD_SIZE,
    fleet: SHIPS,
    rules: room.options,
    turn: relative(turn),
    shotsPerTurn: turn === null ? 1 : shotsPerTurn(ctx, turn),
    winner: relative(room.result?.winner),
    endReason: room.result?.reason || null,
    rematch: { you: room.rematch.has(perspective), enemy: room.rematch.has(enemySeat) },
    me: me
      ? {
          ...serializeSide(me, mySide, { revealShips: !spectator || over }),
          shipsRemaining: mySide ? remainingShips(mySide) : 0,
        }
      : null,
    enemy: enemy ? serializeSide(enemy, state?.seats[enemySeat], { revealShips: over }) : null,
  };
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

module.exports = {
  id: 'battleship',
  title: 'Battleship',
  minPlayers: 2,
  maxPlayers: 2,

  defaultOptions() {
    return { mode: 'classic', bonusShot: false };
  },

  canChangeOptions(ctx) {
    const { room } = ctx;
    return room.status !== 'active' || room.state.phase === 'placement';
  },

  applyOptions(ctx, payload) {
    const { options } = ctx.room;
    if (typeof payload.bonusShot === 'boolean' && options.bonusShot !== payload.bonusShot) {
      options.bonusShot = payload.bonusShot;
      ctx.system(payload.bonusShot ? 'Rule change: a hit earns another shot.' : 'Rule change: turns alternate after every shot.');
    }
    if (MODES.includes(payload.mode) && options.mode !== payload.mode) {
      options.mode = payload.mode;
      ctx.system(
        payload.mode === 'salvo'
          ? 'Mode: Salvo — fire one shot per surviving ship each turn.'
          : 'Mode: Classic — one shot per turn.'
      );
    }
  },

  start(ctx) {
    ctx.system('Deploy your fleets!');
    return { phase: 'placement', turn: null, seats: [freshSeat(), freshSeat()] };
  },

  onLeave(ctx, seat) {
    // Leaving mid-battle forfeits; leaving during placement just reopens the room.
    if (ctx.room.state.phase === 'battle') ctx.finish(other(seat), 'forfeit');
  },

  view,

  actions: {
    'fleet:submit'(ctx, seat, payload) {
      const { room } = ctx;
      if (room.status !== 'active' || room.state.phase !== 'placement') {
        return { error: 'Fleets can only be deployed before the battle.' };
      }
      const side = room.state.seats[seat];
      try {
        side.ships = buildFleet(payload.ships);
      } catch (error) {
        return { error: error.message };
      }
      side.ready = true;
      if (room.state.seats[other(seat)].ready) {
        room.state.phase = 'battle';
        const lastLoser = room.meta.lastLoser;
        room.state.turn = lastLoser !== undefined && room.players[lastLoser] ? lastLoser : crypto.randomInt(2);
        ctx.system(`Battle stations! ${ctx.name(room.state.turn)} fires first.`);
      }
      return { ok: true };
    },

    'fleet:unready'(ctx, seat) {
      const { room } = ctx;
      if (room.status !== 'active' || room.state.phase !== 'placement') {
        return { error: 'Too late to reposition — the battle has begun.' };
      }
      room.state.seats[seat].ready = false;
      return { ok: true };
    },

    fire(ctx, seat, payload) {
      const { room } = ctx;
      const state = room.state;
      if (room.status !== 'active' || state.phase !== 'battle') return { error: 'The battle is not active.' };
      if (state.turn !== seat) return { error: 'Hold fire — it is not your turn.' };

      const enemySeat = other(seat);
      const shooter = state.seats[seat];
      const target = state.seats[enemySeat];
      const rawTargets = Array.isArray(payload.targets) ? payload.targets : [payload];
      let targets;
      try {
        targets = parseTargets(rawTargets, target, shotsPerTurn(ctx, seat));
      } catch (error) {
        return { error: error.message };
      }

      const shots = [];
      let fleetDestroyed = false;
      for (const { x, y, key } of targets) {
        const ship = target.ships.find((s) => s.cells.includes(key));
        let result = 'miss';
        let sunkShip = null;
        shooter.stats.shots += 1;
        if (ship) {
          ship.hits.add(key);
          shooter.stats.hits += 1;
          result = 'hit';
          if (shipIsSunk(ship)) {
            result = 'sunk';
            sunkShip = serializeShip(ship);
          }
        }
        target.shotsReceived.set(key, result === 'miss' ? 'miss' : 'hit');
        shots.push({ x, y, result, sunkShip });
        if (remainingShips(target) === 0) {
          fleetDestroyed = true;
          break;
        }
      }

      const anyHit = shots.some((s) => s.result !== 'miss');
      if (fleetDestroyed) {
        room.meta.lastLoser = enemySeat;
        ctx.finish(seat, 'fleet');
      } else if (room.options.mode === 'salvo' || !anyHit || !room.options.bonusShot) {
        state.turn = enemySeat;
      }

      ctx.emit('volley', (viewerSeat) => {
        const perspective = viewerSeat === null ? 0 : viewerSeat;
        return { by: perspective === seat ? 'you' : 'enemy', shots, gameOver: fleetDestroyed };
      });

      shots
        .filter((s) => s.sunkShip)
        .forEach((s) => ctx.system(`${ctx.name(seat)} sank ${ctx.name(enemySeat)}'s ${s.sunkShip.name}!`));
      if (fleetDestroyed) ctx.system(`${ctx.name(seat)} wins the battle!`);
      return { ok: true, results: shots.map((s) => s.result) };
    },
  },
};
