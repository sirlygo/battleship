// Page plumbing shared by the 2D board games: lobby, chat, settings, share box,
// room buttons, rematch panel and big callouts. Expects the standard element ids
// used in public/checkers/index.html and public/chess/index.html.

import { RoomClient, toast, copyText, shareTarget, shareWarning, onShareInfo } from './room-client.js';
import { sound } from './audio.js';

const $ = (id) => document.getElementById(id);

export { toast, sound };

export function bigText(title, sub = '', kind = 'info') {
  const box = $('bigText');
  if (!box) return;
  box.innerHTML = '';
  const node = document.createElement('div');
  node.className = `big big-${kind}`;
  const t = document.createElement('div');
  t.className = 'big-title';
  t.textContent = title;
  node.appendChild(t);
  if (sub) {
    const s = document.createElement('div');
    s.className = 'big-sub';
    s.textContent = sub;
    node.appendChild(s);
  }
  box.appendChild(node);
  setTimeout(() => node.remove(), 1700);
}

/**
 * Wires the shared page chrome and returns helpers.
 * @param {object} opts
 * @param {string} opts.game       room game id, e.g. 'chess'
 * @param {string} opts.title      human title for share sheets
 * @param {(snap, prev) => void} opts.onState
 * @param {() => void} [opts.onExit]
 * @param {(snap) => boolean} [opts.isPlaying]  true when leaving would forfeit
 * @param {string} [opts.leaveWarning]  confirm text shown when leaving mid-game
 * @param {() => void} [opts.onRematch]  replaces the default rematch vote
 */
export function setupTable({
  game,
  title,
  onState,
  onExit,
  isPlaying = () => false,
  leaveWarning = 'Leave the game? Your opponent wins by forfeit.',
  onRematch,
}) {
  const el = {
    lobby: $('lobby'),
    room: $('room'),
    nameInput: $('nameInput'),
    hostBtn: $('hostBtn'),
    joinForm: $('joinForm'),
    codeInput: $('codeInput'),
    lobbyError: $('lobbyError'),
    roomChip: $('roomChip'),
    roomCodeLabel: $('roomCodeLabel'),
    watchers: $('watchers'),
    watchersCount: $('watchersCount'),
    waitingCode: $('waitingCode'),
    shareUrl: $('shareUrl'),
    shareWarning: $('shareWarning'),
    copyCodeBtn: $('copyCodeBtn'),
    copyLinkBtn: $('copyLinkBtn'),
    leaveBtn: $('leaveBtn'),
    gameOver: $('gameOver'),
    rematchBtn: $('rematchBtn'),
    rematchNote: $('rematchNote'),
    goViewBtn: $('goViewBtn'),
    goLeaveBtn: $('goLeaveBtn'),
    chatBtn: $('chatBtn'),
    chatBadge: $('chatBadge'),
    chat: $('chat'),
    chatClose: $('chatClose'),
    chatLog: $('chatLog'),
    chatForm: $('chatForm'),
    chatInput: $('chatInput'),
    settingsBtn: $('settingsBtn'),
    settings: $('settings'),
    settingsClose: $('settingsClose'),
    volEffects: $('volEffects'),
    volMusic: $('volMusic'),
    net: $('netStatus'),
  };
  const chat = { open: false, unread: 0 };
  let lastSnap = null;

  // ---- chat ---------------------------------------------------------------
  function setChatOpen(open) {
    chat.open = open;
    el.chat.hidden = !open;
    el.chatBtn.classList.toggle('active', open);
    if (open) {
      chat.unread = 0;
      el.chatLog.scrollTop = el.chatLog.scrollHeight;
    }
    el.chatBadge.hidden = chat.unread === 0;
    el.chatBadge.textContent = chat.unread > 9 ? '9+' : String(chat.unread);
  }

  function addChat(entry, { quiet = false } = {}) {
    const row = document.createElement('div');
    row.className = `msg msg-${entry.kind}${entry.mine ? ' mine' : ''}`;
    if (entry.kind !== 'system') {
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = `${entry.mine ? 'You' : entry.name}${entry.spectator ? ' · watching' : ''}`;
      row.appendChild(who);
    }
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = entry.message;
    row.appendChild(text);
    el.chatLog.appendChild(row);
    while (el.chatLog.children.length > 120) el.chatLog.firstElementChild.remove();
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
    if (!quiet && entry.kind === 'user' && !entry.mine) {
      if (!chat.open) {
        chat.unread += 1;
        setChatOpen(false);
        toast(`${entry.name}: ${entry.message}`, 'chat');
      }
      sound.message();
    }
  }

  // ---- settings -----------------------------------------------------------
  function syncSettings() {
    el.volEffects.value = Math.round(sound.volumes.effects * 100);
    el.volMusic.value = Math.round(sound.volumes.music * 100);
    [el.volEffects, el.volMusic].forEach((input) => {
      input.style.setProperty('--fill', `${input.value}%`);
      input.nextElementSibling.textContent = `${input.value}%`;
    });
  }

  // ---- room chrome --------------------------------------------------------
  function renderChrome(snap) {
    el.roomCodeLabel.textContent = snap.code;
    if (el.waitingCode) el.waitingCode.textContent = snap.code;
    el.watchers.hidden = snap.spectators.length === 0;
    el.watchersCount.textContent = snap.spectators.length;
    el.watchers.title = `Watching: ${snap.spectators.join(', ')}`;
    const { url, scope } = shareTarget();
    if (el.shareUrl) el.shareUrl.textContent = url.replace(/^https?:\/\//, '');
    if (el.shareWarning) {
      el.shareWarning.hidden = scope === 'public';
      el.shareWarning.textContent = shareWarning(scope);
    }
  }

  function renderRematch(snap) {
    const opponent = snap.players.find((p, i) => p && i !== snap.perspective);
    el.rematchBtn.hidden = snap.spectator;
    el.rematchBtn.classList.toggle('pulse', Boolean(snap.rematch?.enemy && !snap.rematch?.you));
    if (snap.spectator) {
      el.rematchNote.textContent = 'Stick around — the players may start a rematch.';
    } else if (!opponent) {
      el.rematchBtn.textContent = 'Find a new opponent';
      el.rematchBtn.disabled = false;
      el.rematchNote.textContent = 'Reopen the room and share the code again.';
    } else if (snap.rematch?.you) {
      el.rematchBtn.textContent = 'Rematch requested';
      el.rematchBtn.disabled = true;
      el.rematchNote.textContent = `Waiting for ${opponent.name}…`;
    } else {
      el.rematchBtn.textContent = snap.rematch?.enemy ? 'Accept rematch' : 'Rematch (swap colours)';
      el.rematchBtn.disabled = false;
      el.rematchNote.textContent = snap.rematch?.enemy ? `${opponent.name} wants a rematch!` : '';
    }
  }

  // ---- client -------------------------------------------------------------
  const client = new RoomClient(game, {
    onEnter() {
      el.lobby.hidden = true;
      el.room.hidden = false;
      el.lobbyError.textContent = '';
      el.chatLog.innerHTML = '';
    },
    onExit(message) {
      lastSnap = null;
      el.room.hidden = true;
      el.lobby.hidden = false;
      el.gameOver.hidden = true;
      setChatOpen(false);
      el.lobbyError.textContent = message;
      sound.setMood('calm');
      onExit?.();
    },
    onState(snap, prev) {
      lastSnap = snap;
      renderChrome(snap);
      onState(snap, prev);
    },
    onChat: (entry) => addChat(entry),
    onChatHistory(entries) {
      el.chatLog.innerHTML = '';
      entries.forEach((entry) => addChat(entry, { quiet: true }));
    },
    onConnection(connected) {
      el.net.hidden = connected || !client.code;
    },
    onError(message) {
      el.lobbyError.textContent = message;
    },
  });
  onShareInfo(() => lastSnap && renderChrome(lastSnap));

  // ---- lobby --------------------------------------------------------------
  el.nameInput.value = client.name;
  el.nameInput.addEventListener('input', () => {
    client.name = el.nameInput.value;
  });
  el.codeInput.addEventListener('input', () => {
    el.codeInput.value = el.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  });
  const invited = new URLSearchParams(location.search).get('room');
  if (invited) {
    el.codeInput.value = invited.toUpperCase().slice(0, 5);
    el.joinForm.classList.add('invited');
  }
  el.hostBtn.addEventListener('click', async () => {
    sound.click();
    el.hostBtn.disabled = true;
    const res = await client.host();
    el.hostBtn.disabled = false;
    if (res.error) el.lobbyError.textContent = res.error;
  });
  el.joinForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    sound.click();
    const res = await client.join(el.codeInput.value);
    if (res.error && !res.game) el.lobbyError.textContent = res.error;
  });

  // ---- room buttons -------------------------------------------------------
  el.roomChip.addEventListener('click', async () => {
    const ok = await copyText(client.code);
    toast(ok ? `Room code ${client.code} copied.` : `Room code: ${client.code}`);
  });
  el.copyCodeBtn?.addEventListener('click', async () => {
    const ok = await copyText(client.code);
    toast(ok ? `Code copied. Friends open ${shareTarget().url.replace(/^https?:\/\//, '')}` : `Room code: ${client.code}`);
  });
  el.copyLinkBtn?.addEventListener('click', async () => {
    const link = client.inviteLink();
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title, text: `Play ${title} with me — room ${client.code}`, url: link });
        return;
      } catch {
        /* fall back to copying */
      }
    }
    const ok = await copyText(link);
    toast(ok ? 'Invite link copied.' : link);
  });
  el.leaveBtn.addEventListener('click', () => {
    if (!lastSnap || !isPlaying(lastSnap) || window.confirm(leaveWarning)) client.leave();
  });
  el.goLeaveBtn.addEventListener('click', () => client.leave());
  el.goViewBtn.addEventListener('click', () => {
    el.gameOver.hidden = true;
  });
  el.rematchBtn.addEventListener('click', async () => {
    sound.click();
    if (onRematch) return onRematch();
    const res = await client.send('rematch');
    if (res.error) toast(res.error, 'error');
  });

  // ---- chat & settings wiring --------------------------------------------
  el.chatBtn.addEventListener('click', () => setChatOpen(!chat.open));
  el.chatClose.addEventListener('click', () => setChatOpen(false));
  el.chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = el.chatInput.value.trim();
    if (!message) return;
    el.chatInput.value = '';
    const res = await client.send('chat', { message });
    if (res.error) toast(res.error, 'error');
  });
  el.settingsBtn.addEventListener('click', () => {
    syncSettings();
    el.settings.hidden = false;
  });
  el.settingsClose.addEventListener('click', () => {
    el.settings.hidden = true;
  });
  el.settings.addEventListener('click', (event) => {
    if (event.target === el.settings) el.settings.hidden = true;
  });
  [
    [el.volEffects, 'effects'],
    [el.volMusic, 'music'],
  ].forEach(([input, bus]) => {
    input.addEventListener('input', () => {
      sound.setVolume(bus, Number(input.value) / 100);
      if (sound.muted && Number(input.value) > 0) sound.setMuted(false);
      syncSettings();
    });
  });
  el.volEffects.addEventListener('change', () => sound.clack());

  // Escape closes overlays first; games get it when nothing else is open.
  function handleEscape() {
    if (!el.settings.hidden) {
      el.settings.hidden = true;
      return true;
    }
    if (chat.open) {
      setChatOpen(false);
      return true;
    }
    return false;
  }

  return { client, el, renderRematch, handleEscape, bigText, toast };
}
