// Monopoly board, shared by the server and the browser: 40 spaces round a square,
// starting at GO in the bottom-right corner and running clockwise.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TycoonBoard = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const GROUPS = {
    brown: { color: '#8a5a3c', house: 50 },
    sky: { color: '#8fd3f4', house: 50 },
    pink: { color: '#e05aa8', house: 100 },
    orange: { color: '#f08a2e', house: 100 },
    red: { color: '#e0413b', house: 150 },
    yellow: { color: '#f5d02e', house: 150 },
    green: { color: '#2fb35a', house: 200 },
    navy: { color: '#2f4fb0', house: 200 },
  };

  const street = (name, group, price, rent) => ({ type: 'street', name, group, price, rent });
  const station = (name) => ({ type: 'station', name, price: 200 });
  const utility = (name, icon) => ({ type: 'utility', name, price: 150, icon });

  const SPACES = [
    { type: 'start', name: 'GO' },
    street('Mediterranean Avenue', 'brown', 60, [2, 10, 30, 90, 160, 250]),
    { type: 'card', deck: 'town', name: 'Community Chest' },
    street('Baltic Avenue', 'brown', 60, [4, 20, 60, 180, 320, 450]),
    { type: 'tax', name: 'Income Tax', amount: 200 },
    station('Reading Railroad'),
    street('Oriental Avenue', 'sky', 100, [6, 30, 90, 270, 400, 550]),
    { type: 'card', deck: 'lucky', name: 'Chance' },
    street('Vermont Avenue', 'sky', 100, [6, 30, 90, 270, 400, 550]),
    street('Connecticut Avenue', 'sky', 120, [8, 40, 100, 300, 450, 600]),
    { type: 'jail', name: 'Jail' },
    street('St. Charles Place', 'pink', 140, [10, 50, 150, 450, 625, 750]),
    utility('Electric Company', '⚡'),
    street('States Avenue', 'pink', 140, [10, 50, 150, 450, 625, 750]),
    street('Virginia Avenue', 'pink', 160, [12, 60, 180, 500, 700, 900]),
    station('Pennsylvania Railroad'),
    street('St. James Place', 'orange', 180, [14, 70, 200, 550, 750, 950]),
    { type: 'card', deck: 'town', name: 'Community Chest' },
    street('Tennessee Avenue', 'orange', 180, [14, 70, 200, 550, 750, 950]),
    street('New York Avenue', 'orange', 200, [16, 80, 220, 600, 800, 1000]),
    { type: 'rest', name: 'Free Parking' },
    street('Kentucky Avenue', 'red', 220, [18, 90, 250, 700, 875, 1050]),
    { type: 'card', deck: 'lucky', name: 'Chance' },
    street('Indiana Avenue', 'red', 220, [18, 90, 250, 700, 875, 1050]),
    street('Illinois Avenue', 'red', 240, [20, 100, 300, 750, 925, 1100]),
    station('B&O Railroad'),
    street('Atlantic Avenue', 'yellow', 260, [22, 110, 330, 800, 975, 1150]),
    street('Ventnor Avenue', 'yellow', 260, [22, 110, 330, 800, 975, 1150]),
    utility('Water Works', '💧'),
    street('Marvin Gardens', 'yellow', 280, [24, 120, 360, 850, 1025, 1200]),
    { type: 'gotojail', name: 'Go to Jail' },
    street('Pacific Avenue', 'green', 300, [26, 130, 390, 900, 1100, 1275]),
    street('North Carolina Avenue', 'green', 300, [26, 130, 390, 900, 1100, 1275]),
    { type: 'card', deck: 'town', name: 'Community Chest' },
    street('Pennsylvania Avenue', 'green', 320, [28, 150, 450, 1000, 1200, 1400]),
    station('Short Line'),
    { type: 'card', deck: 'lucky', name: 'Chance' },
    street('Park Place', 'navy', 350, [35, 175, 500, 1100, 1300, 1500]),
    { type: 'tax', name: 'Luxury Tax', amount: 100 },
    street('Boardwalk', 'navy', 400, [50, 200, 600, 1400, 1700, 2000]),
  ].map((s, id) => ({ id, ...s }));

  const JAIL = 10;
  const BUYABLE = new Set(['street', 'station', 'utility']);
  const STATION_RENT = [0, 25, 50, 100, 200];
  const groupSpaces = (group) => SPACES.filter((s) => s.group === group).map((s) => s.id);

  // Cards: `do` describes the effect for the server; `text` is shown to players.
  const CARDS = {
    lucky: [
      { text: 'Advance to GO. Collect $200.', do: { moveTo: 0 } },
      { text: 'Advance to Illinois Avenue. If you pass GO, collect $200.', do: { moveTo: 24 } },
      { text: 'Advance to the nearest railroad. If it is owned, pay the owner double rent.', do: { nearest: 'station', rentTimes: 2 } },
      { text: 'Take a walk on the Boardwalk. Advance to Boardwalk.', do: { moveTo: 39 } },
      { text: 'Advance to St. Charles Place. If you pass GO, collect $200.', do: { moveTo: 11 } },
      { text: 'Advance to the nearest utility. If it is owned, pay 10× your dice roll.', do: { nearest: 'utility', diceTimes: 10 } },
      { text: 'Your startup got funded! Collect $150.', do: { money: 150 } },
      { text: 'Tax refund. Collect $50.', do: { money: 50 } },
      { text: 'Speeding ticket. Pay $15.', do: { money: -15 } },
      { text: 'Oops, wrong turn. Go back 3 spaces.', do: { back: 3 } },
      { text: 'Go directly to Jail. Do not pass GO, do not collect $200.', do: { jail: true } },
      { text: 'Get Out of Jail Free. Keep this card until you need it.', do: { jailCard: true } },
      { text: 'You were elected club captain. Pay each player $50.', do: { eachPlayer: -50 } },
      { text: 'Street repairs: pay $25 per house and $100 per hotel.', do: { repairs: [25, 100] } },
      { text: 'Take a trip on the Reading Railroad. If you pass GO, collect $200.', do: { moveTo: 5 } },
      { text: 'You won the lottery! Collect $100.', do: { money: 100 } },
    ],
    town: [
      { text: 'Advance to GO. Collect $200.', do: { moveTo: 0 } },
      { text: 'The bank rounds up your savings. Collect $200.', do: { money: 200 } },
      { text: 'Dentist appointment. Pay $50.', do: { money: -50 } },
      { text: 'You sold your old comic books. Collect $50.', do: { money: 50 } },
      { text: 'Get Out of Jail Free. Keep this card until you need it.', do: { jailCard: true } },
      { text: 'Parking fines caught up with you. Go directly to Jail.', do: { jail: true } },
      { text: "It's your birthday! Collect $10 from every player.", do: { eachPlayer: 10 } },
      { text: 'Holiday bonus. Collect $100.', do: { money: 100 } },
      { text: 'You overpaid your taxes. Collect $20.', do: { money: 20 } },
      { text: 'Vet bill for your pet. Pay $100.', do: { money: -100 } },
      { text: 'Art class fees. Pay $50.', do: { money: -50 } },
      { text: 'Freelance design gig. Collect $25.', do: { money: 25 } },
      { text: 'Home repairs: pay $40 per house and $115 per hotel.', do: { repairs: [40, 115] } },
      { text: 'Second prize in the baking contest. Collect $10.', do: { money: 10 } },
      { text: 'A long-lost aunt leaves you $100.', do: { money: 100 } },
      { text: 'Your garden wins first prize. Collect $100.', do: { money: 100 } },
    ],
  };

  const TOKENS = ['car', 'rocket', 'hat', 'boat', 'gem', 'ufo'];
  const TOKEN_NAMES = { car: 'Race car', rocket: 'Rocket', hat: 'Top hat', boat: 'Sailboat', gem: 'Diamond', ufo: 'UFO' };
  const PLAYER_COLORS = ['#e0413b', '#2f7fe0', '#2fb35a', '#f5b920', '#9b59d0', '#2fb7a8'];

  return { GROUPS, SPACES, JAIL, BUYABLE, STATION_RENT, CARDS, TOKENS, TOKEN_NAMES, PLAYER_COLORS, groupSpaces };
});
