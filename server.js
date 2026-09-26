const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');
const { RoomManager } = require('./server/rooms');

const games = {
  battleship: require('./server/games/battleship'),
  checkers: require('./server/games/checkers'),
  chess: require('./server/games/chess'),
  clue: require('./server/games/clue'),
  risk: require('./server/games/risk'),
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((net) => net && net.family === 'IPv4' && !net.internal)
    .map((net) => net.address);
}

// The last public address someone actually reached this server through
// (e.g. a Cloudflare tunnel or the Codespaces link). It beats any guess.
let seenPublicUrl = null;

function isPrivateHost(hostname) {
  return (
    ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname) ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(hostname) ||
    hostname.endsWith('.local')
  );
}

app.use((req, _res, next) => {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const hostname = host.replace(/:\d+$/, '');
  if (host && !isPrivateHost(hostname)) {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    seenPublicUrl = `${proto}://${host}`;
  }
  next();
});

// The address other players should open. Browsers only know the address the
// host typed (often localhost), so the server works out a shareable one.
function publicBaseUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  if (seenPublicUrl) return seenPublicUrl;
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL.replace(/\/+$/, '');
  const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN } = process.env;
  if (CODESPACE_NAME && GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    return `https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`;
  }
  return null;
}

const rooms = new RoomManager(io, games);

app.get('/healthz', (_req, res) => res.send('ok'));

app.get('/api/share', (_req, res) => {
  res.json({
    publicUrl: publicBaseUrl(),
    lanUrls: lanAddresses().map((address) => `http://${address}:${PORT}`),
  });
});

// Which game a room code belongs to, so the home page can send players there.
app.get('/api/rooms/:code', (req, res) => {
  const room = rooms.lookup(req.params.code);
  if (!room) return res.status(404).json({ error: 'No room found with that code.' });
  return res.json(room);
});

app.get('/api/games', (_req, res) => {
  res.json(Object.values(games).map((g) => ({ id: g.id, title: g.title, minPlayers: g.minPlayers, maxPlayers: g.maxPlayers })));
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build')));
app.use('/vendor/three-addons', express.static(path.join(__dirname, 'node_modules', 'three', 'examples', 'jsm')));
app.use('/vendor/chess', express.static(path.join(__dirname, 'node_modules', 'chess.js', 'dist', 'esm')));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Game Room server running on http://localhost:${PORT}`);
  const publicUrl = publicBaseUrl();
  if (publicUrl) console.log(`Players anywhere can open: ${publicUrl}`);
  const addresses = lanAddresses();
  if (addresses.length && !publicUrl) {
    console.log('Other devices on the same Wi-Fi can open:');
    addresses.forEach((address) => console.log(`  http://${address}:${PORT}`));
    console.log('If a phone cannot connect, allow Node.js through your firewall on private networks.');
  }
});
