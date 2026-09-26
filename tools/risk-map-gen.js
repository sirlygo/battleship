// Generates public/shared/risk-map.js: territory shapes traced from a raster Voronoi over hand-drawn land.
const fs = require('fs');
const W = 1000;
const H = 600;
const R = 2.5; // raster cell size in map units

const CONTINENTS = [
  { id: 'na', name: 'North America', bonus: 5, color: '#c9a23a' },
  { id: 'sa', name: 'South America', bonus: 2, color: '#c0553a' },
  { id: 'eu', name: 'Europe', bonus: 5, color: '#3f73b8' },
  { id: 'af', name: 'Africa', bonus: 3, color: '#b87a3a' },
  { id: 'as', name: 'Asia', bonus: 7, color: '#4f9a52' },
  { id: 'au', name: 'Australia', bonus: 2, color: '#8a55b0' },
];

// [id, name, continent, seeds...]
const T = [
  ['alaska', 'Alaska', 'na', [65, 88]],
  ['nwt', 'Northwest Territory', 'na', [165, 80], [215, 75]],
  ['greenland', 'Greenland', 'na', [338, 55]],
  ['alberta', 'Alberta', 'na', [148, 135]],
  ['ontario', 'Ontario', 'na', [218, 140], [250, 108]],
  ['quebec', 'Quebec', 'na', [292, 140]],
  ['western_us', 'Western United States', 'na', [158, 200]],
  ['eastern_us', 'Eastern United States', 'na', [238, 212]],
  ['central_america', 'Central America', 'na', [190, 268]],
  ['venezuela', 'Venezuela', 'sa', [268, 325]],
  ['peru', 'Peru', 'sa', [262, 405]],
  ['brazil', 'Brazil', 'sa', [330, 380]],
  ['argentina', 'Argentina', 'sa', [285, 485]],
  ['iceland', 'Iceland', 'eu', [430, 93]],
  ['great_britain', 'Great Britain', 'eu', [433, 162]],
  ['scandinavia', 'Scandinavia', 'eu', [525, 88]],
  ['ukraine', 'Ukraine', 'eu', [600, 150]],
  ['northern_europe', 'Northern Europe', 'eu', [505, 180]],
  ['western_europe', 'Western Europe', 'eu', [450, 237]],
  ['southern_europe', 'Southern Europe', 'eu', [535, 225]],
  ['north_africa', 'North Africa', 'af', [468, 322], [512, 345]],
  ['egypt', 'Egypt', 'af', [553, 293]],
  ['east_africa', 'East Africa', 'af', [598, 360], [588, 425]],
  ['congo', 'Congo', 'af', [535, 418]],
  ['south_africa', 'South Africa', 'af', [555, 485]],
  ['madagascar', 'Madagascar', 'af', [641, 465]],
  ['ural', 'Ural', 'as', [690, 112], [712, 160], [738, 180]],
  ['siberia', 'Siberia', 'as', [752, 82], [768, 138], [782, 178]],
  ['yakutsk', 'Yakutsk', 'as', [838, 62]],
  ['kamchatka', 'Kamchatka', 'as', [930, 85]],
  ['irkutsk', 'Irkutsk', 'as', [828, 118]],
  ['mongolia', 'Mongolia', 'as', [845, 172], [882, 185]],
  ['japan', 'Japan', 'as', [938, 192]],
  ['afghanistan', 'Afghanistan', 'as', [675, 222], [712, 238]],
  ['china', 'China', 'as', [790, 240], [830, 255]],
  ['middle_east', 'Middle East', 'as', [630, 262]],
  ['india', 'India', 'as', [728, 300]],
  ['siam', 'Siam', 'as', [806, 318]],
  ['indonesia', 'Indonesia', 'au', [820, 392]],
  ['new_guinea', 'New Guinea', 'au', [913, 388]],
  ['western_australia', 'Western Australia', 'au', [858, 487]],
  ['eastern_australia', 'Eastern Australia', 'au', [922, 482]],
];

const ADJ = {
  alaska: ['nwt', 'alberta', 'kamchatka'],
  nwt: ['alaska', 'alberta', 'ontario', 'greenland'],
  greenland: ['nwt', 'ontario', 'quebec', 'iceland'],
  alberta: ['alaska', 'nwt', 'ontario', 'western_us'],
  ontario: ['nwt', 'alberta', 'western_us', 'eastern_us', 'quebec', 'greenland'],
  quebec: ['ontario', 'eastern_us', 'greenland'],
  western_us: ['alberta', 'ontario', 'eastern_us', 'central_america'],
  eastern_us: ['western_us', 'ontario', 'quebec', 'central_america'],
  central_america: ['western_us', 'eastern_us', 'venezuela'],
  venezuela: ['central_america', 'peru', 'brazil'],
  peru: ['venezuela', 'brazil', 'argentina'],
  brazil: ['venezuela', 'peru', 'argentina', 'north_africa'],
  argentina: ['peru', 'brazil'],
  iceland: ['greenland', 'great_britain', 'scandinavia'],
  great_britain: ['iceland', 'scandinavia', 'northern_europe', 'western_europe'],
  scandinavia: ['iceland', 'great_britain', 'northern_europe', 'ukraine'],
  ukraine: ['scandinavia', 'northern_europe', 'southern_europe', 'ural', 'afghanistan', 'middle_east'],
  northern_europe: ['great_britain', 'scandinavia', 'ukraine', 'southern_europe', 'western_europe'],
  western_europe: ['great_britain', 'northern_europe', 'southern_europe', 'north_africa'],
  southern_europe: ['western_europe', 'northern_europe', 'ukraine', 'middle_east', 'egypt', 'north_africa'],
  north_africa: ['brazil', 'western_europe', 'southern_europe', 'egypt', 'east_africa', 'congo'],
  egypt: ['southern_europe', 'middle_east', 'east_africa', 'north_africa'],
  east_africa: ['egypt', 'middle_east', 'north_africa', 'congo', 'south_africa', 'madagascar'],
  congo: ['north_africa', 'east_africa', 'south_africa'],
  south_africa: ['congo', 'east_africa', 'madagascar'],
  madagascar: ['south_africa', 'east_africa'],
  ural: ['ukraine', 'siberia', 'china', 'afghanistan'],
  siberia: ['ural', 'yakutsk', 'irkutsk', 'mongolia', 'china'],
  yakutsk: ['siberia', 'kamchatka', 'irkutsk'],
  kamchatka: ['yakutsk', 'irkutsk', 'mongolia', 'japan', 'alaska'],
  irkutsk: ['siberia', 'yakutsk', 'kamchatka', 'mongolia'],
  mongolia: ['siberia', 'irkutsk', 'kamchatka', 'japan', 'china'],
  japan: ['kamchatka', 'mongolia'],
  afghanistan: ['ukraine', 'ural', 'china', 'india', 'middle_east'],
  china: ['mongolia', 'siberia', 'ural', 'afghanistan', 'india', 'siam'],
  middle_east: ['ukraine', 'afghanistan', 'india', 'egypt', 'east_africa', 'southern_europe'],
  india: ['middle_east', 'afghanistan', 'china', 'siam'],
  siam: ['india', 'china', 'indonesia'],
  indonesia: ['siam', 'new_guinea', 'western_australia'],
  new_guinea: ['indonesia', 'eastern_australia', 'western_australia'],
  western_australia: ['indonesia', 'new_guinea', 'eastern_australia'],
  eastern_australia: ['new_guinea', 'western_australia'],
};

// Land masses: [continent, polygon]. Each territory may only take cells of its own continent's land.
const LAND_RAW = [
  ['na', [[18, 72], [60, 55], [120, 48], [180, 40], [250, 48], [272, 70], [262, 92], [300, 105], [335, 118], [352, 132], [330, 170], [300, 188], [280, 215], [262, 240], [238, 250], [224, 258], [212, 280], [232, 292], [226, 305], [200, 300], [168, 283], [150, 250], [128, 222], [115, 175], [100, 140], [72, 118], [40, 115], [22, 100]]],
  ['na', [[288, 32], [330, 20], [372, 22], [392, 40], [372, 72], [348, 92], [322, 96], [304, 78]]],
  ['sa', [[236, 306], [270, 298], [300, 305], [335, 328], [375, 352], [370, 392], [345, 425], [318, 452], [305, 490], [292, 530], [278, 552], [266, 540], [262, 492], [252, 440], [242, 392], [232, 350], [228, 322]]],
  ['eu', [[410, 84], [438, 76], [452, 90], [444, 106], [418, 108]]],
  ['eu', [[418, 140], [436, 130], [448, 148], [452, 172], [444, 190], [426, 190], [420, 172], [426, 156]]],
  ['eu', [[482, 62], [520, 48], [560, 55], [585, 72], [575, 100], [555, 118], [540, 140], [520, 145], [505, 128], [500, 105], [488, 88]]],
  ['eu', [[470, 172], [492, 152], [520, 150], [545, 140], [570, 110], [600, 100], [640, 104], [668, 120], [672, 160], [662, 205], [630, 225], [585, 236], [562, 250], [545, 242], [530, 258], [508, 246], [490, 262], [458, 268], [428, 262], [424, 240], [444, 214], [462, 200]]],
  ['af', [[420, 290], [448, 276], [480, 272], [520, 272], [548, 276], [575, 280], [592, 305], [604, 332], [632, 346], [628, 372], [612, 400], [600, 436], [585, 480], [566, 512], [545, 522], [527, 500], [515, 455], [505, 418], [480, 390], [446, 378], [424, 352], [414, 318]]],
  ['af', [[632, 440], [650, 432], [657, 460], [648, 492], [634, 498], [626, 470]]],
  ['as', [[650, 100], [700, 62], [770, 42], [850, 34], [920, 40], [970, 52], [990, 80], [975, 108], [948, 122], [950, 140], [920, 146], [898, 168], [885, 200], [868, 238], [858, 270], [840, 300], [835, 335], [818, 348], [796, 330], [785, 300], [760, 320], [740, 348], [722, 345], [705, 312], [678, 292], [660, 300], [640, 292], [610, 284], [596, 262], [604, 238], [628, 225], [652, 206], [658, 160]]],
  ['as', [[920, 168], [938, 158], [952, 176], [956, 200], [944, 226], [926, 222], [928, 196]]],
  ['au', [[778, 385], [806, 372], [835, 374], [858, 388], [842, 406], [812, 410], [788, 404]]],
  ['au', [[878, 378], [915, 368], [944, 378], [958, 398], [930, 406], [896, 402]]],
  ['au', [[818, 468], [846, 446], [880, 436], [908, 438], [932, 446], [955, 468], [962, 505], [940, 535], [905, 548], [872, 540], [846, 530], [826, 508]]],
];

// Continental Europe and Asia share one land mass so their border is drawn by the territories themselves.
const LAND = LAND_RAW.map(([cont, poly], i) => ({ conts: cont === 'eu' && i === 6 ? ['eu', 'as'] : cont === 'as' && i === 9 ? ['eu', 'as'] : [cont], poly, group: i === 6 || i === 9 ? 'eurasia' : `g${i}` }));

function inPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Smooth value noise for organic borders.
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => noise(x, y) * 0.6 + noise(x * 2.1, y * 2.1) * 0.3 + noise(x * 4.3, y * 4.3) * 0.1;

const GW = Math.ceil(W / R);
const GH = Math.ceil(H / R);
const grid = new Int16Array(GW * GH).fill(-1);
const groupOf = new Int16Array(GW * GH).fill(-1);
const terr = T.map(([id, name, cont, ...seeds]) => ({ id, name, cont, seeds }));
const idx = Object.fromEntries(terr.map((t, i) => [t.id, i]));

for (let gy = 0; gy < GH; gy += 1) {
  for (let gx = 0; gx < GW; gx += 1) {
    const x = (gx + 0.5) * R;
    const y = (gy + 0.5) * R;
    const land = LAND.find((l) => inPoly(l.poly, x, y));
    if (!land) continue;
    groupOf[gy * GW + gx] = LAND.indexOf(land);
    let best = -1;
    let bestD = Infinity;
    const jx = (fbm(x / 22, y / 22) - 0.5) * 34;
    const jy = (fbm(x / 22 + 40, y / 22 + 17) - 0.5) * 34;
    terr.forEach((t, i) => {
      if (!land.conts.includes(t.cont)) return;
      t.seeds.forEach(([sx, sy]) => {
        const d = Math.hypot(x + jx - sx, y + jy - sy);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
    });
    grid[gy * GW + gx] = best;
  }
}

// Fold small stray patches (from the noisy borders) into their surroundings.
for (let pass = 0; pass < 3; pass += 1) {
  const seen = new Uint8Array(GW * GH);
  for (let start = 0; start < GW * GH; start += 1) {
    if (seen[start] || grid[start] < 0) continue;
    const label = grid[start];
    const comp = [start];
    seen[start] = 1;
    const border = new Map();
    for (let k = 0; k < comp.length; k += 1) {
      const c = comp[k];
      const cx = c % GW;
      const cy = (c - cx) / GW;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) return;
        const n = ny * GW + nx;
        if (grid[n] === label) {
          if (!seen[n]) {
            seen[n] = 1;
            comp.push(n);
          }
        } else if (grid[n] >= 0) border.set(grid[n], (border.get(grid[n]) || 0) + 1);
      });
    }
    if (comp.length < 400 && border.size) {
      const own = terr[label].seeds.some(([sx, sy]) => comp.includes(Math.floor(sy / R) * GW + Math.floor(sx / R)));
      if (own) continue;
      const [to] = [...border.entries()].sort((a, b) => b[1] - a[1])[0];
      comp.forEach((c) => (grid[c] = to));
    }
  }
}

const at = (gx, gy) => (gx < 0 || gy < 0 || gx >= GW || gy >= GH ? -1 : grid[gy * GW + gx]);

// Trace boundary loops of cells matching `test`.
function trace(test) {
  const edges = new Map(); // "x,y" -> list of [x2,y2]
  const addEdge = (x1, y1, x2, y2) => {
    const k = `${x1},${y1}`;
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push([x2, y2]);
  };
  for (let gy = 0; gy < GH; gy += 1) {
    for (let gx = 0; gx < GW; gx += 1) {
      if (!test(at(gx, gy))) continue;
      // clockwise edges with inside on the right
      if (!test(at(gx, gy - 1))) addEdge(gx, gy, gx + 1, gy);
      if (!test(at(gx + 1, gy))) addEdge(gx + 1, gy, gx + 1, gy + 1);
      if (!test(at(gx, gy + 1))) addEdge(gx + 1, gy + 1, gx, gy + 1);
      if (!test(at(gx - 1, gy))) addEdge(gx, gy + 1, gx, gy);
    }
  }
  const loops = [];
  while (edges.size) {
    const [startKey] = edges.keys();
    let [x, y] = startKey.split(',').map(Number);
    const loop = [[x, y]];
    for (;;) {
      const k = `${x},${y}`;
      const list = edges.get(k);
      if (!list) break;
      const [nx, ny] = list.pop();
      if (!list.length) edges.delete(k);
      x = nx;
      y = ny;
      if (`${x},${y}` === startKey) break;
      loop.push([x, y]);
    }
    if (loop.length > 3) loops.push(loop);
  }
  return loops;
}

function simplify(loop) {
  // drop collinear points
  const out = [];
  for (let i = 0; i < loop.length; i += 1) {
    const p = loop[(i - 1 + loop.length) % loop.length];
    const c = loop[i];
    const n = loop[(i + 1) % loop.length];
    if ((c[0] - p[0]) * (n[1] - c[1]) - (c[1] - p[1]) * (n[0] - c[0]) !== 0) out.push(c);
  }
  return out;
}

function chaikin(pts, iterations = 3) {
  let p = pts;
  for (let it = 0; it < iterations; it += 1) {
    const q = [];
    for (let i = 0; i < p.length; i += 1) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = q;
  }
  return p;
}

// Remove points closer than tol along the loop to keep paths small.
function thin(pts, tol) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i += 1) {
    const l = out[out.length - 1];
    if (Math.hypot(pts[i][0] - l[0], pts[i][1] - l[1]) >= tol) out.push(pts[i]);
  }
  return out;
}

function toPath(loops) {
  return loops
    .map((loop) => {
      const pts = thin(chaikin(simplify(loop)), 1.6 / R).map(([x, y]) => [+(x * R).toFixed(1), +(y * R).toFixed(1)]);
      return `M${pts.map((p) => p.join(',')).join('L')}Z`;
    })
    .join('');
}

// Label point: land cell farthest from the territory's edge (simple distance transform).
function labelPoint(i) {
  let best = null;
  let bestD = -1;
  for (let gy = 0; gy < GH; gy += 1) {
    for (let gx = 0; gx < GW; gx += 1) {
      if (at(gx, gy) !== i) continue;
      let d = 0;
      for (let r = 1; r < 30; r += 1) {
        if (at(gx + r, gy) !== i || at(gx - r, gy) !== i || at(gx, gy + r) !== i || at(gx, gy - r) !== i ||
          at(gx + r * 0.7 | 0, gy + r * 0.7 | 0) !== i || at(gx - r * 0.7 | 0, gy - r * 0.7 | 0) !== i) break;
        d = r;
      }
      // prefer near the seed
      const [sx, sy] = terr[i].seeds[0];
      const score = d - Math.hypot((gx + 0.5) * R - sx, (gy + 0.5) * R - sy) / 40;
      if (score > bestD) {
        bestD = score;
        best = [+((gx + 0.5) * R).toFixed(1), +((gy + 0.5) * R).toFixed(1)];
      }
    }
  }
  return best;
}

// Which territory pairs share a land border?
const touching = new Set();
for (let gy = 0; gy < GH; gy += 1) {
  for (let gx = 0; gx < GW; gx += 1) {
    const a = at(gx, gy);
    if (a < 0) continue;
    [[1, 0], [0, 1]].forEach(([dx, dy]) => {
      const b = at(gx + dx, gy + dy);
      const sameMass = LAND[groupOf[gy * GW + gx]]?.group === LAND[groupOf[(gy + dy) * GW + gx + dx]]?.group;
      if (b >= 0 && b !== a && sameMass) touching.add([a, b].sort((m, n) => m - n).join('-'));
    });
  }
}

const out = {
  width: W,
  height: H,
  continents: CONTINENTS.map((c) => ({
    ...c,
    territories: terr.filter((t) => t.cont === c.id).map((t) => t.id),
    path: toPath(trace((v) => v >= 0 && terr[v].cont === c.id)),
  })),
  territories: terr.map((t, i) => ({
    id: t.id,
    name: t.name,
    continent: t.cont,
    path: toPath(trace((v) => v === i)),
    label: labelPoint(i),
    adj: ADJ[t.id],
  })),
};
// Sea routes: adjacent pairs without a shared land border.
const links = [];
const problems = [];
Object.entries(ADJ).forEach(([a, list]) => {
  list.forEach((b) => {
    if (!ADJ[b]?.includes(a)) problems.push(`asymmetric ${a}-${b}`);
    if (a < b && !touching.has([idx[a], idx[b]].sort((m, n) => m - n).join('-'))) links.push([a, b]);
  });
});
touching.forEach((k) => {
  const [a, b] = k.split('-').map(Number);
  if (!ADJ[terr[a].id].includes(terr[b].id)) problems.push(`touching but not adjacent: ${terr[a].id}-${terr[b].id}`);
});
terr.forEach((t, i) => {
  const n = grid.filter((v) => v === i).length;
  if (n < 20) problems.push(`tiny ${t.id} ${n}`);
});
out.links = links;
console.log('links', links.map((l) => l.join('-')).join(' '));
console.log('problems', problems);

const js = `// Risk world map: territory shapes, continents and adjacency. Generated; shared by server and browser.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RiskMap = api;
})(typeof self !== 'undefined' ? self : this, function () {
  return ${JSON.stringify(out)};
});
`;
fs.writeFileSync(process.argv[2] || 'risk-map.js', js);
console.log('bytes', js.length);

// Preview
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 1.5}" height="${H * 1.5}">
<rect width="${W}" height="${H}" fill="#1c3a55"/>
${out.continents.map((c) => `<path d="${c.path}" fill="${c.color}"/>`).join('\n')}
${out.territories.map((t) => `<path d="${t.path}" fill="${CONTINENTS.find((c) => c.id === t.continent).color}" stroke="#222" stroke-width="0.8" fill-opacity="0.9"/>`).join('\n')}
${links.map(([a, b]) => { const A = out.territories[idx[a]].label; const B = out.territories[idx[b]].label; return `<line x1="${A[0]}" y1="${A[1]}" x2="${B[0]}" y2="${B[1]}" stroke="#fff" stroke-dasharray="3 3" stroke-width="0.8"/>`; }).join('\n')}
${out.territories.map((t) => `<circle cx="${t.label[0]}" cy="${t.label[1]}" r="7" fill="#fff"/><text x="${t.label[0]}" y="${t.label[1] + 16}" font-size="7" text-anchor="middle" fill="#fff">${t.name}</text>`).join('\n')}
</svg>`;
fs.writeFileSync('preview.svg', svg);
