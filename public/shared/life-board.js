// The Game of Life: board layout, space contents, careers and houses.
// Shared by the server (rules) and the browser (drawing).
//
// The road is laid along a serpentine centre line. Forks run as two lanes side by
// side and join again. Money amounts are in thousands of dollars.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LifeBoard = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const ROWS = [-5.4, -2.7, 0, 2.7, 5.4];
  const X_END = 8.2;
  const TURN_R = 1.35;
  const LANE = 0.62;

  // ---- centre line ---------------------------------------------------------
  const line = [];
  ROWS.forEach((z, r) => {
    const dir = r % 2 === 0 ? 1 : -1;
    const x0 = -X_END * dir;
    const x1 = X_END * dir;
    for (let i = 0; i <= 40; i += 1) line.push([x0 + ((x1 - x0) * i) / 40, z]);
    if (r < ROWS.length - 1) {
      const cz = z + TURN_R;
      for (let i = 1; i < 24; i += 1) {
        const a = -Math.PI / 2 + (Math.PI * i) / 24;
        line.push([x1 + dir * Math.cos(a) * TURN_R, cz + Math.sin(a) * TURN_R]);
      }
    }
  });
  const cum = [0];
  for (let i = 1; i < line.length; i += 1) {
    cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  }
  const LENGTH = cum[cum.length - 1];

  function at(d) {
    d = Math.max(0, Math.min(LENGTH - 0.001, d));
    let i = 1;
    while (cum[i] < d) i += 1;
    const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1]);
    const [ax, az] = line[i - 1];
    const [bx, bz] = line[i];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const tx = (bx - ax) / len;
    const tz = (bz - az) / len;
    return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, tx, tz, nx: -tz, nz: tx };
  }

  // ---- contents --------------------------------------------------------------
  // [type, amount or kind, text]
  const P = ['payday'];
  const L = (text) => ['life', 0, text];
  const M = (amount, text) => ['money', amount, text];
  const SUE = ['sue', 100, 'Lawsuit! Sue another player for $100K'];
  const BABY = ['baby', 1, "It's a baby!"];
  const TWINS = ['twins', 2, 'Twins!'];

  const SEGMENTS = [
    {
      length: 9,
      lanes: [
        {
          name: 'college',
          label: 'College',
          spaces: [
            M(-10, 'Buy textbooks'),
            L('Make lifelong friends'),
            M(5, 'Part-time job at the campus café'),
            M(-5, 'Spring break road trip'),
            L('Study group — ace your exams'),
            M(10, 'Win a scholarship'),
            M(-10, 'All-nighter: a mountain of coffee'),
            ['stop', 'graduation', 'Graduation! Choose your career'],
          ],
        },
        {
          name: 'career',
          label: 'Start a career',
          spaces: [
            ['stop', 'career', 'Start your career'],
            P,
            M(10, 'Employee of the month'),
            L('Volunteer at the animal shelter'),
            M(-10, 'Buy a work wardrobe'),
          ],
        },
      ],
    },
    {
      length: 13,
      spaces: [
        P,
        M(-20, 'Car breaks down'),
        L('Learn to surf'),
        M(20, 'Win a talent show'),
        SUE,
        P,
        L('Run a marathon'),
        M(-10, 'Adopt a cat — vet bills'),
        M(50, 'Invent a new snack'),
        P,
        L('Fall in love'),
        ['stop', 'marry', 'Get married! Everyone gives a gift'],
      ],
    },
    {
      length: 12,
      spaces: [
        M(-20, 'Honeymoon in Paris'),
        L('Plant a garden'),
        P,
        M(-30, 'The roof leaks'),
        M(30, 'Sell your old car'),
        L('Take up painting'),
        P,
        SUE,
        M(-15, 'Host the family reunion'),
        L('Learn a new language'),
        ['stop', 'house', 'Buy a house'],
      ],
    },
    {
      length: 13,
      lanes: [
        {
          name: 'family',
          label: 'Family path',
          spaces: [
            BABY,
            P,
            L('Family camping trip'),
            TWINS,
            M(-20, 'Braces for the kids'),
            BABY,
            P,
            L('Coach a youth team'),
            M(-30, "Kids' summer camp"),
            BABY,
            L('Standing ovation at the school play'),
          ],
        },
        {
          name: 'adventure',
          label: 'Adventure path',
          spaces: [
            M(40, 'Start a hit podcast'),
            P,
            L('Climb a mountain'),
            M(-40, 'Luxury cruise'),
            SUE,
            P,
            M(60, 'Your startup gets funding'),
            L('Write a novel'),
            M(-25, 'Buy a sports car'),
            P,
            L('Travel the world'),
          ],
        },
      ],
    },
    {
      length: 8,
      spaces: [P, M(-30, 'Home renovation'), L('Help a neighbour move'), BABY, M(25, 'Win a bake-off'), P, L('Throw a block party')],
    },
    {
      length: 7,
      lanes: [
        {
          name: 'nightschool',
          label: 'Night school',
          spaces: [
            ['stop', 'nightschool', 'Night school: pay $100K for a new career'],
            L('Graduate with honours'),
            M(20, 'Tutor on weekends'),
            P,
            M(-10, 'Buy a new laptop'),
          ],
        },
        {
          name: 'keepgoing',
          label: 'Keep your career',
          spaces: [M(15, 'Yard sale'), L('Adopt a rescue dog'), P, M(-20, 'Plumbing disaster'), L('Learn to dance')],
        },
      ],
    },
    {
      length: 10,
      spaces: [
        P,
        M(50, 'Win a radio contest'),
        L('The grandkids visit'),
        M(-40, 'Tax audit'),
        SUE,
        P,
        L('Record an album'),
        M(-30, "Pay for a child's wedding"),
        P,
      ],
    },
    {
      length: 11,
      lanes: [
        {
          name: 'risky',
          label: 'Risky road',
          spaces: [
            M(100, 'Hit it big on the stock market'),
            M(-100, 'Stock market crash'),
            L('Sail around the world'),
            M(150, 'Strike gold!'),
            M(-80, 'A bad investment'),
            P,
            L('Become famous'),
          ],
        },
        {
          name: 'safe',
          label: 'Safe road',
          spaces: [
            M(10, 'Garage sale'),
            P,
            L('Read 100 books'),
            M(-10, 'Book club dues'),
            M(20, 'Sell your quilts at the fair'),
            P,
            L('Take up golf'),
            M(-15, 'Dentist bill'),
            L('Plant a tree'),
          ],
        },
      ],
    },
    {
      length: 12,
      spaces: [
        P,
        L('Write your memoirs'),
        M(-50, 'Buy a vacation cabin'),
        L('Big anniversary party'),
        M(40, 'Sell your collectibles'),
        P,
        L('Start a charity'),
        M(-20, 'Retirement party'),
        L('Watch the sunset'),
        ['stop', 'retire', 'Retire!'],
      ],
    },
  ];

  // ---- build the space graph -------------------------------------------------
  const spaces = [];
  const add = (spec, pos, lane) => {
    const [type, value, text] = spec;
    const s = {
      id: spaces.length,
      type,
      amount: type === 'money' || type === 'sue' ? value : 0,
      kind: type === 'stop' ? value : type === 'baby' || type === 'twins' ? value : null,
      text: text || (type === 'payday' ? 'Payday!' : ''),
      x: +pos.x.toFixed(3),
      z: +pos.z.toFixed(3),
      angle: +Math.atan2(pos.tz, pos.tx).toFixed(3),
      lane: lane || null,
      next: [],
    };
    spaces.push(s);
    return s;
  };

  let d = 0.45;
  const start = add(['start', 0, 'Start'], at(d));
  d += 0.55;
  let tails = [start];
  const forks = {}; // space id -> [{ to, name, label }]
  SEGMENTS.forEach((seg) => {
    const lanes = seg.lanes || [{ spaces: seg.spaces }];
    const newTails = [];
    lanes.forEach((lane, li) => {
      const offset = seg.lanes ? (li === 0 ? -LANE : LANE) : 0;
      const n = lane.spaces.length;
      let prev = null;
      lane.spaces.forEach((spec, i) => {
        const c = at(d + ((i + 0.5) * seg.length) / n);
        const pos = { ...c, x: c.x + c.nx * offset, z: c.z + c.nz * offset };
        const s = add(spec, pos, lane.name);
        if (prev) prev.next.push(s.id);
        else {
          tails.forEach((t) => t.next.push(s.id));
          if (seg.lanes) {
            tails.forEach((t) => {
              (forks[t.id] ||= []).push({ to: s.id, name: lane.name, label: lane.label || lane.name });
            });
          }
        }
        prev = s;
      });
      newTails.push(prev);
    });
    tails = newTails;
    d += seg.length;
  });

  // ---- decks ---------------------------------------------------------------------
  const CAREERS = [
    { id: 'stylist', name: 'Hair Stylist', salary: 40, degree: false },
    { id: 'mechanic', name: 'Mechanic', salary: 50, degree: false },
    { id: 'sales', name: 'Salesperson', salary: 60, degree: false },
    { id: 'police', name: 'Police Officer', salary: 70, degree: false },
    { id: 'entertainer', name: 'Entertainer', salary: 80, degree: false },
    { id: 'athlete', name: 'Pro Athlete', salary: 90, degree: false },
    { id: 'teacher', name: 'Teacher', salary: 70, degree: true },
    { id: 'accountant', name: 'Accountant', salary: 90, degree: true },
    { id: 'vet', name: 'Veterinarian', salary: 100, degree: true },
    { id: 'designer', name: 'Game Designer', salary: 110, degree: true },
    { id: 'lawyer', name: 'Lawyer', salary: 120, degree: true },
    { id: 'doctor', name: 'Doctor', salary: 130, degree: true },
  ];

  const HOUSES = [
    { id: 'mobile', name: 'Mobile Home', price: 60, high: 90, low: 40 },
    { id: 'condo', name: 'City Condo', price: 100, high: 150, low: 70 },
    { id: 'cabin', name: 'Log Cabin', price: 120, high: 180, low: 90 },
    { id: 'beach', name: 'Beach Hut', price: 150, high: 240, low: 100 },
    { id: 'farm', name: 'Farmhouse', price: 200, high: 300, low: 140 },
    { id: 'tudor', name: 'Tudor House', price: 250, high: 380, low: 170 },
    { id: 'victorian', name: 'Victorian', price: 300, high: 460, low: 200 },
    { id: 'mansion', name: 'Mansion', price: 500, high: 800, low: 350 },
  ];

  const LIFE_TILES = [
    ...Array(8).fill(50),
    ...Array(8).fill(100),
    ...Array(6).fill(150),
    ...Array(5).fill(200),
    ...Array(3).fill(250),
  ];

  return {
    spaces,
    forks,
    startId: start.id,
    retireId: spaces.find((s) => s.kind === 'retire').id,
    CAREERS,
    HOUSES,
    LIFE_TILES,
    LOAN: 50,
    LOAN_REPAY: 60,
    COLLEGE_COST: 100,
    NIGHT_SCHOOL_COST: 100,
    KID_GIFT: 50,
    RETIRE_BONUS: [100, 50, 20],
    size: { width: 20, depth: 14 },
  };
});
