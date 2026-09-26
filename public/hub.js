// Home page: remembers your name, hosts a game, or routes a room code to its game.

const $ = (id) => document.getElementById(id);
const nameInput = $('nameInput');
const codeInput = $('codeInput');
const errorBox = $('hubError');

function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
  return null;
}

nameInput.value = store('battleship:name') || '';
nameInput.addEventListener('input', () => store('battleship:name', nameInput.value.trim().slice(0, 16)));

codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
});

async function goToRoom(code, { autoJoin }) {
  errorBox.textContent = '';
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
    const info = await res.json();
    if (!res.ok) throw new Error(info.error || 'Room not found.');
    location.href = `/${info.game}/?room=${code}${autoJoin ? '&join=1' : ''}`;
  } catch (error) {
    errorBox.textContent = error.message || 'Could not find that room.';
  }
}

$('joinForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const code = codeInput.value.trim();
  if (code.length !== 5) {
    errorBox.textContent = 'Room codes are 5 characters.';
    return;
  }
  goToRoom(code, { autoJoin: true });
});

// Old invite links pointed at /?room=CODE — send them to the right game.
const invited = new URLSearchParams(location.search).get('room');
if (invited) {
  codeInput.value = invited.toUpperCase().slice(0, 5);
  goToRoom(codeInput.value, { autoJoin: false });
}

// Cards tilt gently towards the pointer, with a sheen that follows it.
const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (canHover && !calm) {
  document.querySelectorAll('.game-card').forEach((card) => {
    card.addEventListener('pointermove', (event) => {
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      card.style.setProperty('--ry', `${(x - 0.5) * 8}deg`);
      card.style.setProperty('--rx', `${(0.5 - y) * 6}deg`);
      card.style.setProperty('--mx', `${x * 100}%`);
      card.style.setProperty('--my', `${y * 100}%`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    });
  });
}
