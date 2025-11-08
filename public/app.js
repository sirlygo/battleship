const socket = io();

const state = {
  phase: 'menu',
  boardSize: 5,
  shipsConfig: [],
  orientation: 'y',
  placementIndex: 0,
  placements: [],
  selfOccupied: new Set(),
  roomCode: null,
  myTurn: false,
  username: '',
  playerId: null,
  playerNames: new Map(),
  players: [],
  turn: null,
};

const elements = {
  createGameBtn: document.getElementById('createGameBtn'),
  copyCodeBtn: document.getElementById('copyCodeBtn'),
  joinForm: document.getElementById('joinForm'),
  joinCodeInput: document.getElementById('joinCodeInput'),
  roomCodeDisplay: document.getElementById('roomCodeDisplay'),
  statusText: document.getElementById('statusText'),
  placementInfo: document.getElementById('placementInfo'),
  orientationControls: document.getElementById('orientationControls'),
  orientationButtons: Array.from(
    document.querySelectorAll('#orientationControls button')
  ),
  autoPlacementBtn: document.getElementById('autoPlacementBtn'),
  resetPlacementBtn: document.getElementById('resetPlacementBtn'),
  turnText: document.getElementById('turnText'),
  gameCanvas: document.getElementById('gameCanvas'),
  chatForm: document.getElementById('chatForm'),
  chatInput: document.getElementById('chatInput'),
  chatLog: document.getElementById('chatLog'),
  chatMessageTemplate: document.getElementById('chatMessageTemplate'),
  usernameBlock: document.getElementById('usernameBlock'),
  usernameForm: document.getElementById('usernameForm'),
  usernameInput: document.getElementById('usernameInput'),
  playersList: document.getElementById('playersList'),
  playersHint: document.getElementById('playersHint'),
};

const boards = {
  self: {
    group: null,
    cells: new Map(),
    states: new Map(),
  },
  opponent: {
    group: null,
    cells: new Map(),
    states: new Map(),
  },
};

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoveredCells = [];

const colorPalettes = {
  self: {
    empty: 0x152042,
    ship: 0x2fcfa1,
    hit: 0xff6b6b,
    miss: 0x8a95b5,
  },
  opponent: {
    unknown: 0x152042,
    hit: 0xff6b6b,
    miss: 0x8a95b5,
  },
};

let scene;
let camera;
let renderer;
let animationId;
let copyButtonResetTimeout;

function setStatus(message) {
  elements.statusText.textContent = message;
}

function setTurnInfo(message) {
  elements.turnText.textContent = message || '';
}

function toKey({ x, y, z }) {
  return `${x}:${y}:${z}`;
}

function fromKey(key) {
  const [x, y, z] = key.split(':').map(Number);
  return { x, y, z };
}

function updateRoomCodeDisplay() {
  const code = state.roomCode || '';
  elements.roomCodeDisplay.textContent = code;
  const copyButton = elements.copyCodeBtn;
  if (!copyButton) return;
  const showCopyButton = Boolean(code);
  copyButton.hidden = !showCopyButton;
  copyButton.disabled = !showCopyButton;
  if (!showCopyButton) {
    copyButton.textContent = 'Copy Code';
    if (copyButtonResetTimeout) {
      clearTimeout(copyButtonResetTimeout);
      copyButtonResetTimeout = null;
    }
  }
}

function createBoardStates() {
  boards.self.states.clear();
  boards.self.cells.forEach((_, key) => boards.self.states.set(key, 'empty'));
  boards.opponent.states.clear();
  boards.opponent.cells.forEach((_, key) => boards.opponent.states.set(key, 'unknown'));
}

function createBoardGeometry(boardKey, offsetX) {
  const size = state.boardSize;
  const spacing = 1.15;
  const center = (size - 1) / 2;
  const baseGeometry = new THREE.BoxGeometry(0.95, 0.95, 0.95);

  const group = new THREE.Group();
  const cells = new Map();

  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let z = 0; z < size; z += 1) {
        const material = new THREE.MeshStandardMaterial({
          color: 0x152042,
          transparent: true,
          opacity: 0.88,
          roughness: 0.6,
          metalness: 0.15,
          emissiveIntensity: 0,
        });
        const cube = new THREE.Mesh(baseGeometry, material);
        cube.position.set(
          (x - center) * spacing + offsetX,
          (y - center) * spacing,
          (z - center) * spacing
        );
        cube.userData = { boardKey, x, y, z };
        group.add(cube);
        cells.set(toKey({ x, y, z }), cube);
      }
    }
  }

  return { group, cells };
}

function refreshCellAppearance(boardKey, key) {
  const board = boards[boardKey];
  const mesh = board.cells.get(key);
  if (!mesh) return;
  const stateKey = board.states.get(key);
  const palette = colorPalettes[boardKey];
  const color = palette[stateKey] || palette.unknown;
  mesh.material.color.setHex(color);
  mesh.material.emissive.setHex(0x000000);
  if (stateKey === 'hit') {
    mesh.material.opacity = 1;
  } else if (stateKey === 'ship') {
    mesh.material.opacity = 0.95;
  } else {
    mesh.material.opacity = 0.85;
  }
}

function setCellState(boardKey, key, stateValue) {
  const board = boards[boardKey];
  if (!board) return;
  board.states.set(key, stateValue);
  refreshCellAppearance(boardKey, key);
}

function syncOrientationButtons() {
  elements.orientationButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.axis === state.orientation);
  });
}

function setOrientation(axis, { updateInfo = true } = {}) {
  if (!['x', 'y', 'z'].includes(axis)) return;
  if (state.orientation === axis) {
    if (updateInfo) updatePlacementInfo();
    return;
  }
  state.orientation = axis;
  syncOrientationButtons();
  if (updateInfo) updatePlacementInfo();
}

function highlightCells(boardKey, keys, { valid }) {
  hoveredCells = keys.map((key) => ({ boardKey, key }));
  hoveredCells.forEach(({ boardKey: bk, key }) => {
    const mesh = boards[bk].cells.get(key);
    if (!mesh) return;
    mesh.material.emissive.setHex(valid ? 0x5ca3ff : 0xff6b6b);
    mesh.material.emissiveIntensity = valid ? 0.9 : 0.7;
  });
}

function clearHover() {
  if (!hoveredCells.length) return;
  hoveredCells.forEach(({ boardKey, key }) => {
    const mesh = boards[boardKey].cells.get(key);
    if (!mesh) return;
    mesh.material.emissive.setHex(0x000000);
    mesh.material.emissiveIntensity = 0;
    refreshCellAppearance(boardKey, key);
  });
  hoveredCells = [];
}

function getShipCells(start, axis, length) {
  const cells = [];
  for (let i = 0; i < length; i += 1) {
    const cell = { x: start.x, y: start.y, z: start.z };
    if (axis === 'x') cell.x += i;
    if (axis === 'y') cell.y += i;
    if (axis === 'z') cell.z += i;
    cells.push(cell);
  }
  return cells;
}

function cellsAreValid(cells, occupiedSet = state.selfOccupied) {
  return cells.every((cell) => {
    const { x, y, z } = cell;
    if (![x, y, z].every((coord) => Number.isInteger(coord))) return false;
    if (x < 0 || y < 0 || z < 0) return false;
    if (x >= state.boardSize || y >= state.boardSize || z >= state.boardSize) return false;
    return occupiedSet ? !occupiedSet.has(toKey(cell)) : true;
  });
}

function canPlaceShip(cells) {
  return cellsAreValid(cells);
}

function generateAutomaticPlacements() {
  if (!Array.isArray(state.shipsConfig) || !state.shipsConfig.length) {
    return null;
  }

  const placements = [];
  const occupied = new Set();
  const axes = ['x', 'y', 'z'];
  const size = state.boardSize;

  for (const ship of state.shipsConfig) {
    let placed = false;
    let attempts = 0;
    while (!placed && attempts < 400) {
      attempts += 1;
      const axis = axes[Math.floor(Math.random() * axes.length)];
      const axisSpan = Math.max(size - ship.length + 1, 1);
      const start = {
        x: Math.floor(Math.random() * (axis === 'x' ? axisSpan : size)),
        y: Math.floor(Math.random() * (axis === 'y' ? axisSpan : size)),
        z: Math.floor(Math.random() * (axis === 'z' ? axisSpan : size)),
      };
      const cells = getShipCells(start, axis, ship.length);
      if (!cellsAreValid(cells, occupied)) {
        continue;
      }
      cells.forEach((cell) => occupied.add(toKey(cell)));
      placements.push({ name: ship.name, cells });
      placed = true;
    }
    if (!placed) {
      return null;
    }
  }

  return placements;
}

function applyShipPlacement(ship, cells) {
  cells.forEach((cell) => {
    const key = toKey(cell);
    state.selfOccupied.add(key);
    setCellState('self', key, 'ship');
  });
  state.placements.push({ name: ship.name, cells });
  state.placementIndex += 1;
}

function resetPlacement() {
  state.placements = [];
  state.placementIndex = 0;
  state.selfOccupied.clear();
  setOrientation('y', { updateInfo: false });
  syncOrientationButtons();
  boards.self.states.forEach((_, key) => {
    setCellState('self', key, 'empty');
  });
  state.phase = 'placement';
  if (elements.orientationControls) {
    elements.orientationControls.hidden = false;
  }
  if (elements.autoPlacementBtn) {
    elements.autoPlacementBtn.hidden = !state.roomCode;
    elements.autoPlacementBtn.disabled = !state.roomCode;
  }
  if (elements.resetPlacementBtn) {
    elements.resetPlacementBtn.hidden = !state.roomCode;
  }
  updatePlacementInfo();
  renderPlayers();
}

function lockPlacement() {
  state.phase = 'waiting';
  elements.orientationControls.hidden = true;
  elements.resetPlacementBtn.hidden = false;
  if (elements.autoPlacementBtn) {
    elements.autoPlacementBtn.hidden = true;
  }
  updatePlacementInfo();
  renderPlayers();
  socket.emit(
    'placeShips',
    { code: state.roomCode, ships: state.placements },
    (response) => {
      if (response?.error) {
        setStatus(response.error);
        state.phase = 'placement';
        elements.orientationControls.hidden = false;
        return;
      }
      setStatus('Ships locked. Waiting for opponent to get ready.');
    }
  );
}

function updatePlacementInfo() {
  if (!state.roomCode) {
    elements.placementInfo.textContent = 'Create or join a game to start.';
    return;
  }

  if (state.phase === 'placement') {
    const ship = state.shipsConfig[state.placementIndex];
    if (ship) {
      const autoPlacementAvailable =
        Boolean(elements.autoPlacementBtn) && !elements.autoPlacementBtn.hidden;
      const autoHint = autoPlacementAvailable ? ' You can also use Auto Place Fleet for a quick layout.' : '';
      elements.placementInfo.textContent = `Place your ${ship.name} (${ship.length} cells). Orientation: ${state.orientation
        .toUpperCase()} (press X/Y/Z to change).${autoHint}`;
    } else {
      elements.placementInfo.textContent = 'All ships placed. Confirming with server...';
    }
    return;
  }

  if (state.phase === 'waiting') {
    elements.placementInfo.textContent = 'Waiting for the other player to finish placing their fleet.';
    return;
  }

  if (state.phase === 'playing') {
    elements.placementInfo.textContent = state.myTurn
      ? 'Aim at the opponent board (right) and click to fire a shot.'
      : "Hold tight! Your opponent is choosing a target.";
    return;
  }

  if (state.phase === 'finished') {
    elements.placementInfo.textContent = 'Match finished. Create a new game to play again.';
  }
}

function enterPlacementPhase() {
  state.phase = 'placement';
  resetPlacement();
  elements.orientationControls.hidden = false;
  elements.resetPlacementBtn.hidden = false;
  if (elements.autoPlacementBtn) {
    elements.autoPlacementBtn.hidden = false;
    elements.autoPlacementBtn.disabled = false;
  }
  updatePlacementInfo();
  renderPlayers();
}

function ensureScene() {
  if (scene) return;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x040610);

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(0, 12, 18);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ canvas: elements.gameCanvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  resizeRenderer();

  const ambient = new THREE.AmbientLight(0xa6b4ff, 0.55);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight.position.set(8, 12, 10);
  scene.add(dirLight);

  const gap = state.boardSize * 0.7;
  const selfBoard = createBoardGeometry('self', -gap);
  const opponentBoard = createBoardGeometry('opponent', gap);
  boards.self.group = selfBoard.group;
  boards.self.cells = selfBoard.cells;
  boards.opponent.group = opponentBoard.group;
  boards.opponent.cells = opponentBoard.cells;
  scene.add(selfBoard.group);
  scene.add(opponentBoard.group);

  createBoardStates();
  boards.self.states.forEach((_, key) => refreshCellAppearance('self', key));
  boards.opponent.states.forEach((_, key) => refreshCellAppearance('opponent', key));

  animate();
  window.addEventListener('resize', resizeRenderer);
  elements.gameCanvas.addEventListener('pointermove', handlePointerMove);
  elements.gameCanvas.addEventListener('click', handleCanvasClick);
}

function animate() {
  animationId = requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

function resizeRenderer() {
  if (!renderer) return;
  const { clientWidth, clientHeight } = elements.gameCanvas.parentElement;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}

function handlePointerMove(event) {
  if (!scene) return;
  clearHover();
  if (state.phase === 'menu') return;
  if (state.phase === 'waiting' || state.phase === 'finished') return;

  const rect = elements.gameCanvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const intersects = raycaster.intersectObjects(
    [...boards.self.cells.values(), ...boards.opponent.cells.values()],
    false
  );
  if (!intersects.length) return;
  const [hit] = intersects;
  const { boardKey, x, y, z } = hit.object.userData;

  if (state.phase === 'placement') {
    if (boardKey !== 'self') return;
    const ship = state.shipsConfig[state.placementIndex];
    if (!ship) return;
    const cells = getShipCells({ x, y, z }, state.orientation, ship.length);
    const valid = canPlaceShip(cells);
    const keys = cells.map((cell) => toKey(cell));
    highlightCells('self', keys, { valid });
  } else if (state.phase === 'playing' && state.myTurn) {
    if (boardKey !== 'opponent') return;
    const key = toKey({ x, y, z });
    const cellState = boards.opponent.states.get(key);
    if (cellState === 'hit' || cellState === 'miss') return;
    highlightCells('opponent', [key], { valid: true });
  }
}

function handleCanvasClick(event) {
  if (!scene) return;
  const rect = elements.gameCanvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(
    [...boards.self.cells.values(), ...boards.opponent.cells.values()],
    false
  );
  if (!intersects.length) return;
  const [hit] = intersects;
  const { boardKey, x, y, z } = hit.object.userData;

  if (state.phase === 'placement' && boardKey === 'self') {
    const ship = state.shipsConfig[state.placementIndex];
    if (!ship) return;
    const cells = getShipCells({ x, y, z }, state.orientation, ship.length);
    if (!canPlaceShip(cells)) {
      setStatus('Invalid placement. Ensure ships stay within bounds and do not overlap.');
      return;
    }
    applyShipPlacement(ship, cells);
    updatePlacementInfo();
    clearHover();

    if (state.placementIndex === state.shipsConfig.length) {
      lockPlacement();
    }
  }

  if (state.phase === 'playing' && state.myTurn && boardKey === 'opponent') {
    const key = toKey({ x, y, z });
    const cellState = boards.opponent.states.get(key);
    if (cellState === 'hit' || cellState === 'miss') {
      setStatus('You already fired at that coordinate.');
      return;
    }
    socket.emit(
      'attack',
      { code: state.roomCode, target: { x, y, z } },
      (response) => {
        if (response?.error) {
          setStatus(response.error);
        }
      }
    );
  }
}

function addChatEntry({ username, message, id, timestamp }) {
  const template = elements.chatMessageTemplate.content.firstElementChild.cloneNode(true);
  const senderLabel = username || (id === state.playerId ? 'You' : 'Player');
  template.querySelector('.sender').textContent = senderLabel;
  template.querySelector('.content').textContent = message;
  const stamp = template.querySelector('.timestamp');
  if (stamp) {
    stamp.textContent = formatTimestamp(timestamp);
  }
  elements.chatLog.appendChild(template);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function renderPlayers() {
  const list = elements.playersList;
  if (!list) return;
  list.innerHTML = '';

  if (!state.players.length) {
    if (elements.playersHint) {
      elements.playersHint.hidden = false;
    }
    return;
  }

  if (elements.playersHint) {
    elements.playersHint.hidden = true;
  }

  state.players.forEach((player, index) => {
    const item = document.createElement('li');
    item.classList.add('player-item');
    if (player.id === state.playerId) item.classList.add('player-self');
    if (player.ready) item.classList.add('player-ready');
    if (state.phase === 'playing' && state.turn && player.id === state.turn) {
      item.classList.add('player-turn');
    }

    const displayName = player.username?.trim() || `Player ${index + 1}`;
    const name = document.createElement('span');
    name.classList.add('name');
    name.textContent = player.id === state.playerId ? `${displayName} (You)` : displayName;

    const status = document.createElement('span');
    status.classList.add('status');
    let statusText = 'Waiting';
    if (state.phase === 'finished') {
      statusText = 'Finished';
    } else if (state.phase === 'playing') {
      statusText = player.id === state.turn ? 'Taking turn' : 'Standing by';
    } else if (player.ready) {
      statusText = 'Ready';
    } else {
      statusText = 'Placing fleet';
    }
    status.textContent = statusText;

    item.appendChild(name);
    item.appendChild(status);
    list.appendChild(item);
  });
}

function formatTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function setupUiEvents() {
  elements.createGameBtn.addEventListener('click', () => {
    socket.emit('createGame', null, (response) => {
      if (response?.code) {
        state.roomCode = response.code;
        state.boardSize = response.boardSize;
        state.shipsConfig = response.ships;
        state.players = [];
        state.playerNames = new Map();
        setStatus(`Room created! Share the code ${response.code} with your opponent.`);
        elements.usernameBlock.hidden = false;
        ensureScene();
        enterPlacementPhase();
        elements.chatForm.hidden = false;
        updatePlacementInfo();
        updateRoomCodeDisplay();
      }
    });
  });

  elements.joinForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = elements.joinCodeInput.value.trim();
    if (code.length !== 6) {
      setStatus('Room codes are 6 digits.');
      return;
    }
    socket.emit('joinGame', { code }, (response) => {
      if (response?.error) {
        setStatus(response.error);
        return;
      }
      state.roomCode = code;
      state.boardSize = response.boardSize;
      state.shipsConfig = response.ships;
      state.players = [];
      state.playerNames = new Map();
      setStatus(`Joined room ${code}. Place your fleet!`);
      elements.usernameBlock.hidden = false;
      ensureScene();
      enterPlacementPhase();
      elements.chatForm.hidden = false;
      updatePlacementInfo();
      updateRoomCodeDisplay();
    });
  });

  elements.orientationButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setOrientation(button.dataset.axis);
    });
  });

  elements.resetPlacementBtn.addEventListener('click', () => {
    if (!state.roomCode) return;
    resetPlacement();
    setStatus('Placement reset. Arrange your fleet again.');
  });

  if (elements.autoPlacementBtn) {
    elements.autoPlacementBtn.addEventListener('click', () => {
      if (!state.roomCode) return;
      const placements = generateAutomaticPlacements();
      if (!placements) {
        setStatus('Unable to auto-arrange a valid fleet. Try again.');
        return;
      }
      resetPlacement();
      placements.forEach(({ name, cells }) => {
        applyShipPlacement({ name }, cells);
      });
      clearHover();
      setStatus('Fleet automatically arranged. Locking in...');
      lockPlacement();
    });
  }

  elements.chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state.roomCode) return;
    const message = elements.chatInput.value.trim();
    if (!message) return;
    socket.emit('chatMessage', { code: state.roomCode, message });
    elements.chatInput.value = '';
  });

  elements.usernameForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state.roomCode) return;
    const username = elements.usernameInput.value.trim().slice(0, 12);
    state.username = username;
    socket.emit('setUsername', { code: state.roomCode, username });
  });

  if (elements.copyCodeBtn) {
    elements.copyCodeBtn.addEventListener('click', async () => {
      if (!state.roomCode) return;
      if (copyButtonResetTimeout) {
        clearTimeout(copyButtonResetTimeout);
        copyButtonResetTimeout = null;
      }
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(state.roomCode);
        } else {
          const textArea = document.createElement('textarea');
          textArea.value = state.roomCode;
          textArea.setAttribute('readonly', '');
          textArea.style.position = 'absolute';
          textArea.style.left = '-9999px';
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
        }
        elements.copyCodeBtn.textContent = 'Copied!';
        copyButtonResetTimeout = setTimeout(() => {
          elements.copyCodeBtn.textContent = 'Copy Code';
          copyButtonResetTimeout = null;
        }, 2000);
        setStatus('Room code copied to clipboard.');
      } catch (error) {
        setStatus(`Unable to copy automatically. Room code: ${state.roomCode}`);
      }
    });
  }
}

function handleAttackResult({ attacker, target, result, shipName, nextTurn, winner }) {
  const key = toKey(target);
  if (attacker === state.playerId) {
    if (result === 'miss') setCellState('opponent', key, 'miss');
    if (result === 'hit' || result === 'sunk') setCellState('opponent', key, 'hit');
    const message =
      result === 'sunk'
        ? `You sunk the opponent's ${shipName}!`
        : result === 'hit'
        ? 'Direct hit!'
        : 'Splash! That shot missed.';
    setStatus(message);
  } else {
    const wasShip = state.selfOccupied.has(key);
    if (result === 'miss') setCellState('self', key, 'miss');
    if (wasShip && (result === 'hit' || result === 'sunk')) setCellState('self', key, 'hit');
    const attackerName = state.playerNames.get(attacker) || 'Opponent';
    const message =
      result === 'miss'
        ? `${attackerName} missed your fleet.`
        : result === 'sunk'
        ? `${attackerName} sunk your ${shipName}!`
        : `${attackerName} scored a hit!`;
    setStatus(message);
  }

  if (winner) {
    state.phase = 'finished';
    state.myTurn = false;
    state.turn = null;
    const youWon = winner === state.playerId;
    setTurnInfo(youWon ? 'Victory!' : 'Defeat.');
    setStatus(youWon ? 'All enemy ships destroyed!' : 'Your fleet was sunk.');
    updatePlacementInfo();
    renderPlayers();
    return;
  }

  state.myTurn = nextTurn === state.playerId;
  state.turn = nextTurn;
  setTurnInfo(state.myTurn ? "Your turn" : "Opponent's turn");
  updatePlacementInfo();
  renderPlayers();
}

function setupSocketEvents() {
  socket.on('connect', () => {
    state.playerId = socket.id;
    renderPlayers();
  });

  socket.on('playerJoined', () => {
    setStatus('An opponent joined the room. Place your fleet!');
  });

  socket.on('playerReady', () => {
    setStatus('Opponent is ready. Finish your placement!');
  });

  socket.on('gameStarted', ({ turn }) => {
    state.phase = 'playing';
    state.myTurn = turn === state.playerId;
    state.turn = turn;
    setStatus('Battle commences!');
    setTurnInfo(state.myTurn ? 'Your turn' : "Opponent's turn");
    elements.orientationControls.hidden = true;
    updatePlacementInfo();
    renderPlayers();
  });

  socket.on('attackResult', (payload) => {
    handleAttackResult(payload);
  });

  socket.on('chatUpdate', (entry) => {
    addChatEntry(entry);
  });

  socket.on('playerLeft', () => {
    setStatus('Your opponent left the room. Create a new game to continue.');
    state.phase = 'finished';
    state.myTurn = false;
    state.turn = null;
    setTurnInfo('Opponent disconnected');
    updatePlacementInfo();
    renderPlayers();
  });

  socket.on('usernameUpdate', ({ players }) => {
    players.forEach(({ id, username }) => {
      state.playerNames.set(id, username);
    });
    renderPlayers();
  });

  socket.on('roomState', ({ players, turn }) => {
    state.players = players;
    state.turn = turn;
    state.playerNames = new Map(players.map((player) => [player.id, player.username]));
    if (state.phase === 'playing' && typeof turn === 'string') {
      state.myTurn = turn === state.playerId;
      setTurnInfo(state.myTurn ? 'Your turn' : "Opponent's turn");
    }
    renderPlayers();
  });
}

function init() {
  setupUiEvents();
  setupSocketEvents();
  ensureScene();
  setStatus('Waiting to create or join a game.');
  updatePlacementInfo();
  updateRoomCodeDisplay();
  syncOrientationButtons();
  renderPlayers();
  window.addEventListener('keydown', handleKeydown);
}

function handleKeydown(event) {
  const activeTag = document.activeElement?.tagName?.toLowerCase();
  if (activeTag === 'input' || activeTag === 'textarea') return;
  if (state.phase !== 'placement') return;

  const key = event.key.toLowerCase();
  if (['x', 'y', 'z'].includes(key)) {
    setOrientation(key);
  }
  if (key === 'r') {
    resetPlacement();
    setStatus('Placement reset. Arrange your fleet again.');
  }
}

init();
