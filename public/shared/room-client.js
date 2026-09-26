// Shared browser-side plumbing for a game page: connection, rooms, invites, toasts.
// Usage: const client = new RoomClient('checkers', { onState, onEnter, onExit, onChat, onChatHistory });

/* global io */

export function store(kind, key, value) {
  try {
    const s = kind === 'session' ? sessionStorage : localStorage;
    if (value === undefined) return s.getItem(key);
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
  return null;
}

function getToken() {
  let token = store('session', 'battleship:token');
  if (!token) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    store('session', 'battleship:token', token);
  }
  return token;
}

export function toast(message, kind = 'info') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.className = 'toasts';
    document.body.appendChild(box);
  }
  const node = document.createElement('div');
  node.className = `toast toast-${kind}`;
  node.textContent = message;
  box.appendChild(node);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => node.classList.add('out'), 2600);
  setTimeout(() => node.remove(), 3000);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

// Works out the address other players should open (see /api/share on the server).
const share = { publicUrl: null, lanUrl: null, listeners: [] };
fetch('/api/share')
  .then((res) => res.json())
  .then((info) => {
    share.publicUrl = info.publicUrl || null;
    share.lanUrl = info.lanUrls?.[0] || null;
    share.listeners.forEach((fn) => fn());
  })
  .catch(() => {});

export function onShareInfo(fn) {
  share.listeners.push(fn);
}

export function shareTarget() {
  const host = location.hostname;
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
  const privateNet = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.endsWith('.local');
  if (!local && !privateNet) return { url: location.origin, scope: 'public' };
  if (share.publicUrl) return { url: share.publicUrl, scope: 'public' };
  if (local) return share.lanUrl ? { url: share.lanUrl, scope: 'lan' } : { url: location.origin, scope: 'local' };
  return { url: location.origin, scope: 'lan' };
}

export function shareWarning(scope) {
  if (scope === 'lan') {
    return 'This address only works for devices on your Wi-Fi. For friends elsewhere, host online (e.g. GitHub Codespaces or a Cloudflare tunnel) — see the README.';
  }
  if (scope === 'local') return 'This address only works on this computer. Host online so friends can join.';
  return '';
}

export class RoomClient {
  constructor(game, handlers = {}) {
    this.game = game;
    this.handlers = handlers;
    this.token = getToken();
    this.code = null;
    this.snap = null;
    this.socket = io();
    this.bind();
  }

  get savedRoomKey() {
    return `${this.game}:room`;
  }

  get name() {
    return store('local', 'battleship:name') || '';
  }

  set name(value) {
    store('local', 'battleship:name', value ? value.trim().slice(0, 16) : null);
  }

  inviteLink() {
    return `${shareTarget().url}/${this.game}/?room=${this.code}`;
  }

  send(event, payload = null) {
    return new Promise((resolve) => this.socket.emit(event, payload, (res) => resolve(res || {})));
  }

  enter(code, spectator) {
    this.code = code;
    store('session', this.savedRoomKey, code);
    const url = new URL(location.href);
    url.searchParams.set('room', code);
    ['create', 'join'].forEach((p) => url.searchParams.delete(p));
    history.replaceState(null, '', url);
    this.handlers.onEnter?.(code, spectator);
  }

  exit(message = '') {
    this.code = null;
    this.snap = null;
    store('session', this.savedRoomKey, null);
    const url = new URL(location.href);
    url.searchParams.delete('room');
    history.replaceState(null, '', url);
    this.handlers.onExit?.(message);
  }

  async host() {
    const res = await this.send('room:create', { game: this.game, name: this.name, token: this.token });
    if (res.ok) this.enter(res.code, false);
    return res;
  }

  async join(rawCode) {
    const code = (rawCode || '').trim().toUpperCase();
    if (code.length !== 5) return { error: 'Room codes are 5 characters.' };
    const res = await this.send('room:join', { game: this.game, code, name: this.name, token: this.token });
    if (res.game && res.game !== this.game) {
      location.href = `/${res.game}/?room=${code}&join=1`;
      return res;
    }
    if (res.ok) {
      this.enter(res.code, res.spectator);
      if (res.spectator) toast("That room is full — you're watching as a spectator.");
    }
    return res;
  }

  leave() {
    this.socket.emit('room:leave');
    this.exit('');
  }

  // Handles ?create=1 and ?join=1 links from the home page.
  autoStart() {
    const params = new URLSearchParams(location.search);
    const create = params.get('create') === '1';
    const join = params.get('join') === '1';
    if (!create && !join) return false;
    store('session', this.savedRoomKey, null);
    const run = async () => {
      if (this.code) return;
      const res = create ? await this.host() : await this.join(params.get('room'));
      if (res.error) this.handlers.onError?.(res.error);
    };
    if (this.socket.connected) run();
    else this.socket.once('connect', run);
    return true;
  }

  bind() {
    const { socket } = this;
    socket.on('connect', () => {
      this.handlers.onConnection?.(true);
      const saved = store('session', this.savedRoomKey);
      if (!saved) return;
      socket.emit('room:resume', { code: saved, token: this.token }, (res) => {
        if (res?.ok) {
          if (this.code !== res.code) this.enter(res.code, res.spectator);
        } else if (this.code) {
          this.exit('That game has ended. Host or join a new one.');
        } else {
          store('session', this.savedRoomKey, null);
        }
      });
    });
    socket.on('disconnect', () => this.handlers.onConnection?.(false));
    socket.on('state', (snap) => {
      if (!this.code) return;
      const prev = this.snap;
      this.snap = snap;
      this.handlers.onState?.(snap, prev);
    });
    socket.on('chatHistory', (entries) => this.handlers.onChatHistory?.(entries));
    socket.on('chat', (entry) => {
      if (this.code) this.handlers.onChat?.(entry);
    });
    socket.on('room:closed', () => {
      if (this.code) this.exit('Everyone left, so the room closed.');
    });
  }
}
