// The Game of Life: spin, drive, pick a career, marry, buy a house and retire.
// Players build up Wealth, Knowledge and Happiness; together they make Life Points.
// The board and decks live in public/shared/life-board.js. Money is in $1,000s.

const crypto = require('crypto');
const B = require('../../public/shared/life-board.js');

const SPACES = B.spaces;
const CAREER = Object.fromEntries(B.CAREERS.map((c) => [c.id, c]));
const HOUSE = Object.fromEntries(B.HOUSES.map((h) => [h.id, h]));
const COLORS = ['#e0413b', '#3b82e0', '#3fb35a', '#e8c53a', '#9b59d0', '#f08a2e'];
const START_MONEY = 10;
const MAX_LOG = 120;

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const spin = () => crypto.randomInt(10) + 1;
const money = (k) => `${k < 0 ? '−' : ''}$${Math.abs(k)}K`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function active(state) {
  return state.order.filter((s) => !state.left.includes(s));
}

function log(state, entry) {
  state.log.push({ id: state.logId++, ...entry });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

// Pay or collect; debts are covered with $50K bank loans.
function adjust(state, seat, amount) {
  const p = state.players[seat];
  p.money += amount;
  let loans = 0;
  while (p.money < 0) {
    p.money += B.LOAN;
    p.loans += 1;
    loans += 1;
  }
  return loans;
}

const PET_NAMES = { dog: 'dog', cat: 'cat', bunny: 'bunny', parrot: 'parrot' };

function gain(state, seat, { happy = 0, know = 0 } = {}) {
  const p = state.players[seat];
  p.happiness = Math.max(0, p.happiness + happy);
  p.knowledge = Math.max(0, p.knowledge + know);
}

function wealthPoints(p, houseValue) {
  return Math.floor((p.money + houseValue - p.loans * B.LOAN_REPAY) / B.MONEY_PER_POINT);
}

// Life Points so far, valuing a house at its purchase price.
function lifePoints(p) {
  const house = p.house ? HOUSE[p.house].price : 0;
  return wealthPoints(p, house) + p.knowledge + p.happiness;
}

function careerOptions(state, degreeOnly, allowDegree) {
  const pool = B.CAREERS.filter((c) => (degreeOnly ? c.degree : allowDegree || !c.degree));
  return shuffle(pool)
    .slice(0, 3)
    .map((c) => c.id);
}

function nextTurn(ctx) {
  const { state } = ctx.room;
  const alive = active(state).filter((s) => !state.players[s].retired);
  if (!alive.length) {
    finalScore(ctx);
    return;
  }
  const idx = state.order.indexOf(state.turn);
  for (let i = 1; i <= state.order.length; i += 1) {
    const next = state.order[(idx + i) % state.order.length];
    if (alive.includes(next)) {
      state.turn = next;
      state.phase = 'spin';
      state.pending = null;
      state.turnNumber += 1;
      return;
    }
  }
}

function finalScore(ctx) {
  const { state } = ctx.room;
  const results = active(state).map((seat) => {
    const p = state.players[seat];
    const lines = [{ label: 'Cash', amount: p.money, unit: '$' }];
    let house = 0;
    if (p.house) {
      const roll = spin();
      const h = HOUSE[p.house];
      house = roll % 2 === 0 ? h.high : h.low;
      lines.push({ label: `Sold the ${h.name} (spun ${roll})`, amount: house, unit: '$' });
    }
    if (p.loans) lines.push({ label: `Repay ${p.loans} loan${p.loans === 1 ? '' : 's'}`, amount: -p.loans * B.LOAN_REPAY, unit: '$' });
    const wealth = wealthPoints(p, house);
    const total = wealth + p.knowledge + p.happiness;
    return { seat, total, wealth, knowledge: p.knowledge, happiness: p.happiness, net: p.money + house - p.loans * B.LOAN_REPAY, lines };
  });
  results.sort((a, b) => b.total - a.total);
  state.results = results;
  state.phase = 'over';
  const winner = results[0]?.seat ?? null;
  ctx.finish(winner, 'retired');
  if (winner !== null) ctx.system(`${state.names[winner]} wins with ${results[0].total} Life Points!`);
}

// ---------------------------------------------------------------------------
// Movement and spaces
// ---------------------------------------------------------------------------

// Moves the current player up to `steps` spaces, stopping at forks (to ask)
// and at stop spaces. Returns events for the animation.
function drive(ctx, seat, steps, move) {
  const { state } = ctx.room;
  const p = state.players[seat];
  let remaining = steps;
  while (remaining > 0) {
    const here = SPACES[p.pos];
    if (!here.next.length) break;
    if (here.next.length > 1) {
      state.phase = 'choice';
      state.pending = {
        kind: 'fork',
        seat,
        remaining,
        options: B.forks[here.id].map((f) => ({ value: f.to, label: f.label, name: f.name })),
        prompt: 'Which way?',
      };
      return;
    }
    p.pos = here.next[0];
    remaining -= 1;
    move.path.push(p.pos);
    const s = SPACES[p.pos];
    if (s.type === 'payday' && remaining > 0) collectPay(state, seat, move, true);
    if (s.type === 'stop') break;
  }
  land(ctx, seat, move);
}

function collectPay(state, seat, move, passing) {
  const p = state.players[seat];
  if (p.salary) {
    adjust(state, seat, p.salary);
    move.events.push({ at: p.pos, text: `${passing ? 'Passed' : 'Landed on'} payday: +${money(p.salary)}`, amount: p.salary });
  }
  if (p.pets.length) {
    const h = p.pets.length * B.HAPPY.payPet;
    gain(state, seat, { happy: h });
    move.events.push({ at: p.pos, text: `Your pet${p.pets.length > 1 ? 's' : ''} made your day: +${h} happiness`, happy: h });
  }
}

function land(ctx, seat, move) {
  const { state } = ctx.room;
  const p = state.players[seat];
  const s = SPACES[p.pos];
  const ev = (text, amount = 0, extra = {}) => move.events.push({ at: p.pos, text, amount, ...extra });
  state.phase = 'done';
  switch (s.type) {
    case 'payday':
      collectPay(state, seat, move, false);
      break;
    case 'money': {
      const loans = adjust(state, seat, s.amount);
      ev(`${s.text}: ${s.amount > 0 ? '+' : ''}${money(s.amount)}${loans ? ` (took ${loans} loan${loans > 1 ? 's' : ''})` : ''}`, s.amount);
      break;
    }
    case 'life':
      gain(state, seat, { happy: s.amount });
      ev(`${s.text}: +${s.amount} happiness`, 0, { happy: s.amount });
      break;
    case 'learn':
      gain(state, seat, { know: s.amount });
      ev(`${s.text}: +${s.amount} knowledge`, 0, { know: s.amount });
      break;
    case 'pet': {
      const pet = B.PETS[crypto.randomInt(B.PETS.length)];
      p.pets.push(pet);
      gain(state, seat, { happy: B.HAPPY.pet });
      ev(`Adopts a ${PET_NAMES[pet]}! +${B.HAPPY.pet} happiness`, 0, { pet, happy: B.HAPPY.pet });
      break;
    }
    case 'choice': {
      const card = state.dilemmas.pop() || B.DILEMMAS[crypto.randomInt(B.DILEMMAS.length)];
      if (!state.dilemmas.length) state.dilemmas = shuffle(B.DILEMMAS);
      state.phase = 'choice';
      state.pending = {
        kind: 'dilemma',
        seat,
        remaining: 0,
        prompt: card.text,
        options: [
          { value: 'a', label: card.a.label, fx: card.a },
          { value: 'b', label: card.b.label, fx: card.b },
        ],
      };
      ev(`Decision: ${card.text}`);
      break;
    }
    case 'baby':
    case 'twins': {
      p.kids += s.kind;
      const h = B.HAPPY.baby * s.kind;
      gain(state, seat, { happy: h });
      ev(`${s.text} Now ${p.kids} ${p.kids === 1 ? 'child' : 'children'}. +${h} happiness`, 0, { baby: s.kind, happy: h });
      break;
    }
    case 'sue': {
      const targets = active(state).filter((t) => t !== seat);
      if (targets.length) {
        state.phase = 'choice';
        state.pending = {
          kind: 'sue',
          seat,
          remaining: 0,
          prompt: 'Who do you sue for $100K?',
          options: targets.map((t) => ({ value: t, label: state.names[t] })),
        };
      }
      break;
    }
    case 'stop':
      stopSpace(ctx, seat, s, move);
      break;
    default:
      break;
  }
}

function stopSpace(ctx, seat, s, move) {
  const { state } = ctx.room;
  const p = state.players[seat];
  const ev = (text, amount = 0, extra = {}) => move.events.push({ at: p.pos, text, amount, ...extra });
  switch (s.kind) {
    case 'career':
    case 'graduation':
      if (s.kind === 'graduation') {
        gain(state, seat, { know: B.KNOW.graduation });
        ev(`Graduated: +${B.KNOW.graduation} knowledge`, 0, { know: B.KNOW.graduation });
      }
      state.phase = 'choice';
      state.pending = {
        kind: 'career',
        seat,
        remaining: 0,
        prompt: s.kind === 'graduation' ? 'Congratulations, graduate! Pick a career.' : 'Pick your first job.',
        options: careerOptions(state, false, p.degree).map((id) => ({ value: id, label: CAREER[id].name, salary: CAREER[id].salary })),
      };
      ev(s.text);
      break;
    case 'nightschool':
      adjust(state, seat, -B.NIGHT_SCHOOL_COST);
      p.degree = true;
      gain(state, seat, { know: B.KNOW.nightschool });
      state.phase = 'choice';
      state.pending = {
        kind: 'career',
        seat,
        remaining: 0,
        prompt: 'Night school done! Pick a new career (or keep yours).',
        options: [
          ...(p.career ? [{ value: 'keep', label: `Keep ${CAREER[p.career].name}`, salary: p.salary }] : []),
          ...careerOptions(state, true).map((id) => ({ value: id, label: CAREER[id].name, salary: CAREER[id].salary })),
        ],
      };
      ev(`Night school: −${money(B.NIGHT_SCHOOL_COST)}`, -B.NIGHT_SCHOOL_COST);
      break;
    case 'marry': {
      p.married = true;
      gain(state, seat, { happy: B.HAPPY.marry });
      const roll = spin();
      const gift = roll >= 6 ? 20 : 10;
      let total = 0;
      active(state)
        .filter((t) => t !== seat)
        .forEach((t) => {
          adjust(state, t, -gift);
          total += gift;
        });
      adjust(state, seat, total);
      ev(`Gets married! +${B.HAPPY.marry} happiness. Gift spin ${roll}: everyone gives ${money(gift)}`, total, { marry: true, happy: B.HAPPY.marry });
      break;
    }
    case 'house': {
      const options = shuffle(B.HOUSES)
        .slice(0, 2)
        .map((h) => ({ value: h.id, label: h.name, price: h.price, high: h.high, low: h.low }));
      state.phase = 'choice';
      state.pending = {
        kind: 'house',
        seat,
        remaining: 0,
        prompt: 'Buy a house? You can take loans to pay for it.',
        options: [...options, { value: 'skip', label: 'Keep renting' }],
      };
      ev(s.text);
      break;
    }
    case 'retire': {
      p.retired = true;
      state.retireCount += 1;
      p.retireRank = state.retireCount;
      const bonus = B.RETIRE_BONUS[state.retireCount - 1] || 0;
      if (bonus) adjust(state, seat, bonus);
      gain(state, seat, { happy: B.HAPPY.retire });
      ev(`Retires${bonus ? ` — #${state.retireCount} to retire earns ${money(bonus)}` : ''}!`, bonus, { retire: true });
      break;
    }
    default:
      break;
  }
}

// Finish the turn after landing (and any choice).
function afterMove(ctx, seat) {
  const { state } = ctx.room;
  if (state.phase === 'choice') return;
  nextTurn(ctx);
}

function recordMove(state, seat, move) {
  state.lastMove = { id: state.moveId++, seat, ...move };
  move.events.forEach((e) => log(state, { seat, text: e.text, amount: e.amount }));
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function view(ctx, seat) {
  const { room } = ctx;
  const state = room.state;
  const base = {
    phase: room.status === 'waiting' ? 'lobby' : room.status === 'active' ? 'playing' : 'over',
    minPlayers: 2,
    maxPlayers: 6,
  };
  if (!state) {
    return {
      ...base,
      seats: room.players.map((p, i) => (p ? { seat: i, name: p.name, color: null } : null)).filter(Boolean),
    };
  }
  const over = room.status === 'over';
  return {
    ...base,
    seats: state.order.map((s) => {
      const p = state.players[s];
      return {
        seat: s,
        name: state.names[s],
        color: state.colors[s],
        pos: p.pos,
        money: p.money,
        loans: p.loans,
        career: p.career,
        salary: p.salary,
        degree: p.degree,
        married: p.married,
        kids: p.kids,
        house: p.house,
        knowledge: p.knowledge,
        happiness: p.happiness,
        pets: p.pets,
        points: lifePoints(p),
        retired: p.retired,
        retireRank: p.retireRank,
        left: state.left.includes(s),
        connected: Boolean(room.players[s]?.connected),
      };
    }),
    turn: state.turn,
    turnPhase: state.phase,
    turnNumber: state.turnNumber,
    pending: state.pending,
    lastMove: state.lastMove,
    log: state.log,
    results: over ? state.results : null,
    winner: over && room.result ? room.result.winner : null,
  };
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

function requireTurn(ctx, seat) {
  const { room } = ctx;
  if (room.status !== 'active') return 'The game is not running.';
  if (room.state.turn !== seat) return 'It is not your turn.';
  return null;
}

module.exports = {
  id: 'life',
  title: 'The Game of Life',
  minPlayers: 2,
  maxPlayers: 6,
  manualStart: true,

  defaultOptions() {
    return {};
  },

  canChangeOptions() {
    return false;
  },

  applyOptions() {},

  start(ctx) {
    const { room } = ctx;
    const seats = shuffle(room.players.map((p, i) => (p ? i : null)).filter((s) => s !== null));
    const names = {};
    const colors = {};
    const players = {};
    seats.forEach((s, i) => {
      names[s] = room.players[s].name;
      colors[s] = COLORS[i];
      players[s] = {
        pos: B.startId,
        money: START_MONEY,
        loans: 0,
        career: null,
        salary: 0,
        degree: false,
        married: false,
        kids: 0,
        house: null,
        knowledge: 0,
        happiness: 0,
        pets: [],
        retired: false,
        retireRank: null,
      };
    });
    const state = {
      order: seats,
      names,
      colors,
      players,
      turn: seats[0],
      phase: 'spin',
      pending: null,
      turnNumber: 1,
      dilemmas: shuffle(B.DILEMMAS),
      retireCount: 0,
      left: [],
      lastMove: null,
      moveId: 1,
      results: null,
      log: [],
      logId: 1,
    };
    room.state = state;
    ctx.system(
      `Buckle up! ${seats.map((s) => names[s]).join(', ')} hit the road. Collect Wealth, Knowledge and Happiness — the most Life Points wins.`
    );
    return state;
  },

  onLeave(ctx, seat) {
    const { state } = ctx.room;
    if (!state.order.includes(seat) || state.left.includes(seat)) return;
    state.left.push(seat);
    ctx.system(`${state.names[seat]} left the game.`);
    const alive = active(state);
    if (alive.length <= 1) {
      finalScore(ctx);
      return;
    }
    if (state.turn === seat || (state.pending && state.pending.seat === seat)) {
      state.pending = null;
      nextTurn(ctx);
    } else if (state.pending?.kind === 'sue') {
      state.pending.options = state.pending.options.filter((o) => o.value !== seat);
    }
  },

  view,

  actions: {
    'life:spin'(ctx, seat) {
      const err = requireTurn(ctx, seat);
      if (err) return { error: err };
      const { state } = ctx.room;
      if (state.phase !== 'spin') return { error: 'Finish your current choice first.' };
      const n = spin();
      const move = { spin: n, path: [], events: [] };
      drive(ctx, seat, n, move);
      recordMove(state, seat, move);
      afterMove(ctx, seat);
      return { ok: true, spin: n };
    },

    'life:choose'(ctx, seat, payload) {
      const err = requireTurn(ctx, seat);
      if (err) return { error: err };
      const { state } = ctx.room;
      const pending = state.pending;
      if (state.phase !== 'choice' || !pending) return { error: 'Nothing to choose right now.' };
      const option = pending.options.find((o) => o.value === payload?.value);
      if (!option) return { error: 'Pick one of the options.' };
      const p = state.players[seat];
      const move = { spin: null, path: [], events: [] };
      state.pending = null;
      state.phase = 'done';
      if (pending.kind === 'fork') {
        const lane = B.spaces[option.value].lane;
        if (lane === 'college') {
          p.degree = true;
          adjust(state, seat, -B.COLLEGE_COST);
          gain(state, seat, { know: B.KNOW.college });
          move.events.push({ at: p.pos, text: `Off to college: −${money(B.COLLEGE_COST)} in student loans`, amount: -B.COLLEGE_COST });
        } else {
          move.events.push({ at: p.pos, text: `Takes the ${option.label.toLowerCase()}`, amount: 0 });
        }
        // Step onto the chosen lane, then keep driving.
        p.pos = option.value;
        move.path.push(p.pos);
        move.spin = null;
        const left = pending.remaining - 1;
        const s = B.spaces[p.pos];
        if (s.type === 'stop' || left <= 0) land(ctx, seat, move);
        else {
          if (s.type === 'payday') collectPay(state, seat, move, true);
          drive(ctx, seat, left, move);
        }
      } else if (pending.kind === 'career') {
        if (option.value !== 'keep') {
          p.career = option.value;
          p.salary = CAREER[option.value].salary;
        }
        move.events.push({ at: p.pos, text: `Becomes a ${CAREER[p.career].name} earning ${money(p.salary)}`, amount: 0, career: true });
      } else if (pending.kind === 'house') {
        if (option.value !== 'skip') {
          const h = HOUSE[option.value];
          const loans = adjust(state, seat, -h.price);
          p.house = h.id;
          gain(state, seat, { happy: B.HAPPY.house });
          move.events.push({
            at: p.pos,
            text: `Buys a ${h.name} for ${money(h.price)}${loans ? ` (${loans} loan${loans > 1 ? 's' : ''})` : ''}`,
            amount: -h.price,
            house: h.id,
          });
        } else {
          move.events.push({ at: p.pos, text: 'Keeps renting', amount: 0 });
        }
      } else if (pending.kind === 'dilemma') {
        const fx = option.fx;
        const parts = [];
        let amount = 0;
        if (fx.risk) {
          adjust(state, seat, -fx.risk.cost);
          const roll = spin();
          const won = roll >= fx.risk.need;
          if (won) adjust(state, seat, fx.risk.win);
          amount = won ? fx.risk.win - fx.risk.cost : -fx.risk.cost;
          parts.push(`spun ${roll} — ${won ? `it pays off: +${money(fx.risk.win)}` : 'it flops'}`);
        }
        if (fx.money) {
          adjust(state, seat, fx.money);
          amount += fx.money;
          parts.push(`${fx.money > 0 ? '+' : ''}${money(fx.money)}`);
        }
        if (fx.happy || fx.know) gain(state, seat, { happy: fx.happy || 0, know: fx.know || 0 });
        if (fx.happy) parts.push(`${fx.happy > 0 ? '+' : ''}${fx.happy} happiness`);
        if (fx.know) parts.push(`+${fx.know} knowledge`);
        if (fx.pet) {
          p.pets.push(fx.pet);
          parts.push(`new ${fx.pet}!`);
        }
        if (fx.raise && p.salary) {
          p.salary += fx.raise;
          parts.push(`salary +${money(fx.raise)}`);
        }
        move.events.push({
          at: p.pos,
          text: `${option.label}${parts.length ? `: ${parts.join(', ')}` : ''}`,
          amount,
          happy: fx.happy || 0,
          know: fx.know || 0,
          pet: fx.pet,
        });
      } else if (pending.kind === 'sue') {
        const target = option.value;
        adjust(state, target, -100);
        adjust(state, seat, 100);
        move.events.push({ at: p.pos, text: `Sues ${state.names[target]} and wins ${money(100)}!`, amount: 100, sue: target });
      }
      recordMove(state, seat, move);
      afterMove(ctx, seat);
      return { ok: true };
    },

    'life:repay'(ctx, seat) {
      const { room } = ctx;
      if (room.status !== 'active') return { error: 'The game is not running.' };
      const p = room.state.players[seat];
      if (!p) return { error: 'You are not playing.' };
      if (!p.loans) return { error: 'You have no loans.' };
      if (p.money < B.LOAN_REPAY) return { error: `You need ${money(B.LOAN_REPAY)} to repay a loan.` };
      p.money -= B.LOAN_REPAY;
      p.loans -= 1;
      log(room.state, { seat, text: `Repays a loan: −${money(B.LOAN_REPAY)}`, amount: -B.LOAN_REPAY });
      return { ok: true };
    },
  },
};
