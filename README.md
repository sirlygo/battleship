# 3D Battleship

A room-based multiplayer Battleship experience with a fully interactive 3D grid built with Three.js and Socket.IO. Play classic Battleship rules on a 5×5×5 cube, invite a friend with a six-digit room code, and battle in real time.

## Features

- **Two Board 3D Scene** – Place and target ships on twin 3D grids rendered with Three.js.
- **Room Codes** – Instantly host a match and share a six-digit code so friends can join.
- **Real-Time Multiplayer** – Socket.IO keeps both players in sync for placement, turns, and attacks.
- **Turn-Based Combat** – Receive immediate hit, miss, and ship-sunk feedback with win detection.
- **In-Game Chat** – Chat with your opponent while you play.
- **Auto Fleet Placement** – Instantly arrange a legal fleet layout when you want a speedy start.
- **Server-Side Validation** – Hardened placement checks prevent cheating or malformed boards.

## Getting Started

### Requirements

- Node.js 18+

### Installation

```bash
npm install
```

### Running Locally

```bash
npm start
```

Then open your browser to <http://localhost:3000>. Create a game to generate a room code and share it with a friend, or join an existing room with its code.

## Gameplay Overview

1. **Create or Join** – One player hosts to receive a six-digit room code. The opponent joins with the same code.
2. **Set Usernames** – Pick names so the in-game chat identifies each player.
3. **Place Ships** – Each commander places the classic fleet (lengths 5, 4, 3, 3, and 2) along the X, Y, or Z axis of their cube.
4. **Battle** – Turns alternate. Click a cube in the opponent’s grid to fire. Results appear instantly on both boards.
5. **Victory** – Sink every enemy ship to win the match.

## Project Structure

```
.
├── public
│   ├── app.js        # Front-end logic and Three.js scene setup
│   ├── index.html    # UI layout and containers
│   └── style.css     # Styling for the dashboard and chat
├── server.js         # Express + Socket.IO real-time server
└── package.json      # Dependencies and scripts
```

Enjoy commanding your fleet!
