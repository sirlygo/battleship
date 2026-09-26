// The Game of Life: board layout, space contents, careers, houses and decision cards.
// Players collect Wealth ($), Knowledge and Happiness; all three add up to Life Points.
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
  const L = (text, n = 10) => ['life', n, text]; // happiness
  const K = (text, n = 10) => ['learn', n, text]; // knowledge
  const M = (amount, text) => ['money', amount, text];
  const SUE = ['sue', 100, 'Lawsuit! Sue another player for $100K'];
  const BABY = ['baby', 1, "It's a baby!"];
  const TWINS = ['twins', 2, 'Twins!'];
  const PET = ['pet', 0, 'Adopt a pet'];
  const C = ['choice', 0, 'Decision time!'];

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
            K('Top of the class', 15),
            C,
            K('Study group — ace your exams'),
            M(10, 'Win a scholarship'),
            K('All-nighter before finals', 5),
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
            C,
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
        C,
        SUE,
        P,
        PET,
        K('Learn a new language'),
        M(50, 'Invent a new snack'),
        P,
        L('Fall in love', 15),
        ['stop', 'marry', 'Get married! Everyone gives a gift'],
      ],
    },
    {
      length: 12,
      spaces: [
        M(-20, 'Honeymoon in Paris'),
        C,
        P,
        M(-30, 'The roof leaks'),
        K('Take an evening class'),
        L('Take up painting'),
        P,
        SUE,
        C,
        M(20, 'Sell your old car'),
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
            L('Family camping trip', 15),
            TWINS,
            PET,
            BABY,
            P,
            C,
            M(-30, "Kids' summer camp"),
            BABY,
            L('Standing ovation at the school play', 15),
          ],
        },
        {
          name: 'adventure',
          label: 'Adventure path',
          spaces: [
            M(40, 'Start a hit podcast'),
            P,
            L('Climb a mountain', 15),
            C,
            SUE,
            P,
            M(60, 'Your startup gets funding'),
            K('Write a novel', 15),
            C,
            P,
            L('Travel the world', 20),
          ],
        },
      ],
    },
    {
      length: 8,
      spaces: [P, C, K('Help a neighbour fix their computer'), BABY, M(25, 'Win a bake-off'), P, PET],
    },
    {
      length: 7,
      lanes: [
        {
          name: 'nightschool',
          label: 'Night school',
          spaces: [
            ['stop', 'nightschool', 'Night school: pay $100K for a new career'],
            K('Graduate with honours', 20),
            M(20, 'Tutor on weekends'),
            P,
            K('Build a robot', 15),
          ],
        },
        {
          name: 'keepgoing',
          label: 'Keep your career',
          spaces: [M(15, 'Yard sale'), L('Adopt a rescue dog'), P, C, L('Learn to dance')],
        },
      ],
    },
    {
      length: 10,
      spaces: [
        P,
        C,
        L('The grandkids visit', 15),
        M(-40, 'Tax audit'),
        SUE,
        P,
        K('Record an album'),
        C,
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
            L('Sail around the world', 20),
            M(150, 'Strike gold!'),
            M(-80, 'A bad investment'),
            P,
            C,
          ],
        },
        {
          name: 'safe',
          label: 'Safe road',
          spaces: [
            M(10, 'Garage sale'),
            P,
            K('Read 100 books', 15),
            C,
            L('Knit sweaters for charity'),
            P,
            PET,
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
        K('Write your memoirs', 15),
        C,
        L('Big anniversary party', 15),
        M(40, 'Sell your collectibles'),
        P,
        L('Start a charity', 20),
        C,
        L('Watch the sunset'),
        ['stop', 'retire', 'Retire!'],
      ],
    },
  ];

  // Decision cards: pick A or B. Effects: money ($K), happy, know, pet, raise
  // (salary), risk { cost, win, need } resolved with a spin.
  const DILEMMAS = [
    { text: 'A free weekend!', a: { label: 'Cooking class', money: -5, know: 10 }, b: { label: 'Beach day', happy: 10 } },
    { text: 'You find a stray puppy.', a: { label: 'Adopt it', money: -10, happy: 5, pet: 'dog' }, b: { label: 'Take it to a shelter', happy: 5 } },
    { text: 'A job offer overseas.', a: { label: 'Take it', money: 40, happy: -5, know: 5 }, b: { label: 'Stay near family', happy: 12 } },
    { text: 'A friend pitches a startup.', a: { label: 'Invest $30K', risk: { cost: 30, win: 90, need: 6 } }, b: { label: 'Wish them luck', happy: 3 } },
    { text: 'The library is having a sale.', a: { label: 'Buy a stack of books', money: -5, know: 12 }, b: { label: 'Keep your cash' } },
    { text: 'Concert tickets on sale!', a: { label: 'Go with friends', money: -10, happy: 14 }, b: { label: 'Stay in and study', know: 8 } },
    { text: "Your neighbour's garden party.", a: { label: 'Bake a pie', happy: 8 }, b: { label: 'Network with guests', money: 15 } },
    { text: 'A charity marathon.', a: { label: 'Run it', happy: 8, know: 4 }, b: { label: 'Donate $10K', money: -10, happy: 14 } },
    { text: 'Online courses are half price.', a: { label: 'Learn to code', money: -10, know: 16 }, b: { label: 'Learn guitar', money: -5, happy: 10 } },
    { text: 'Your car is getting old.', a: { label: 'Buy a new one', money: -30, happy: 10 }, b: { label: 'Fix it yourself', know: 8 } },
    { text: 'A surprise inheritance!', a: { label: 'Invest it', money: 50 }, b: { label: 'Throw a party', money: 20, happy: 12 } },
    { text: 'A promotion — with overtime.', a: { label: 'Go for it', raise: 10, happy: -6 }, b: { label: 'Family first', happy: 10 } },
    { text: 'You could write a book.', a: { label: 'Write it', know: 14 }, b: { label: 'Travel instead', money: -15, happy: 14 } },
    { text: 'The garage is full of junk.', a: { label: 'Hold a yard sale', money: 15 }, b: { label: 'Donate it all', happy: 8 } },
    { text: 'Museum night downtown.', a: { label: 'Guided tour', know: 10 }, b: { label: 'Dance party', happy: 10 } },
    { text: "A friend's food truck needs cash.", a: { label: 'Invest $20K', risk: { cost: 20, win: 50, need: 5 } }, b: { label: 'Be their best customer', money: -5, happy: 8 } },
    { text: 'A kitten follows you home.', a: { label: 'Keep it', money: -5, happy: 5, pet: 'cat' }, b: { label: 'Find its owner', happy: 6 } },
    { text: 'Volunteer at the science fair?', a: { label: 'Judge the projects', know: 10 }, b: { label: 'Run the snack stand', money: 10 } },
  ];

  const PETS = ['dog', 'cat', 'bunny', 'parrot'];

  // ---- build the space graph -------------------------------------------------
  const spaces = [];
  const add = (spec, pos, lane) => {
    const [type, value, text] = spec;
    const s = {
      id: spaces.length,
      type,
      amount: ['money', 'sue', 'life', 'learn'].includes(type) ? value : 0,
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


  return {
    spaces,
    forks,
    startId: start.id,
    retireId: spaces.find((s) => s.kind === 'retire').id,
    CAREERS,
    HOUSES,
    DILEMMAS,
    PETS,
    LOAN: 50,
    LOAN_REPAY: 60,
    COLLEGE_COST: 100,
    NIGHT_SCHOOL_COST: 100,
    RETIRE_BONUS: [100, 50, 20],
    MONEY_PER_POINT: 10, // $10K of net worth = 1 Life Point
    HAPPY: { marry: 20, baby: 15, pet: 10, house: 10, payPet: 2, retire: 10 },
    KNOW: { college: 10, graduation: 20, nightschool: 20 },
    size: { width: 20, depth: 14 },
  };
});
