# Battleship

Real-time, two-player Battleship in the browser. It has a 3D ocean scene built with Three.js and uses Socket.IO for multiplayer. One player hosts a room and gets a 5-character room code. The other player types in that code, or opens the invite link, to join.

## Features

- **Room codes and invite links.** Host a game and share a code like `K7QX2`, or share a link that fills the code in for your friend.
- **Classic rules.** Each player has a 10×10 grid and five ships (Carrier 5, Battleship 4, Cruiser 3, Submarine 3, Destroyer 2).
- **Bonus shot on hit.** On by default. The host can switch it off so turns strictly alternate.
- **3D scene.** Animated ocean with sky and sun glare. Each ship type has its own model, and ships bob on the swell. Shells fly in an arc, then you get a splash, or an explosion with fire and smoke. Sunk ships go down charred. The camera follows the action.
- **Fleet placement.** Hover to see a ghost of the ship, click to drop it, and press `R` or right-click to rotate. Click a placed ship to pick it back up, or hit Randomize. After you're ready, you can still reposition until the battle starts.
- **Feedback.** HIT / MISS / SUNK callouts, synthesized sound effects (with a mute button), a fleet status bar for both sides, and accuracy stats.
- **Rematch.** Both players accept to start a new round in the same room. The loser of the last round fires first.
- **Reconnects.** Refreshing the page or a short network drop puts you back in your seat. If your opponent leaves, the room reopens so someone new can join with the same code.
- **Chat.** Built-in comms panel with unread badges.
- **Server-side game state.** The server validates fleets, turns, and shots. It never sends the enemy's ship positions until a ship is sunk or the game ends, so you can't cheat by reading network traffic.
- **Works on phones.** On touch screens, tap once to aim and tap again (or press Fire) to shoot.

## Getting started

Requires Node.js 18+.

```bash
npm run setup      # installs dependencies if needed, then starts the server
# or
npm install
npm start
```

Open <http://localhost:3000>. Set `PORT` to use a different port.

### Playing from a phone on the same Wi-Fi

When the server starts, it prints the address other devices can use, for example `http://192.168.1.23:3000`. Open that address on the phone; `localhost` won't work there. If the phone can't connect:

- **Windows:** open "Allow an app through Windows Firewall" and tick **Private** for Node.js JavaScript Runtime. Also set your Wi-Fi's network profile to **Private**.
- **macOS:** allow incoming connections for `node` when asked, or under System Settings → Network → Firewall.
- Make sure the phone is on the same network, not a guest network or mobile data. Some routers block devices from reaching each other ("AP/client isolation").

## Deploy online (free)

The repo includes a `render.yaml`, so it can be hosted on [Render](https://render.com) and played from any phone or network:

1. Sign in to Render with GitHub.
2. Click **New → Blueprint**, choose this repository, and click **Apply**.
3. When the deploy finishes, share the `https://battleship-….onrender.com` link.

On Render's free plan the server sleeps after 15 minutes without visitors. The first visit after that takes about 30–60 seconds to wake it. Rooms live in memory, so they reset when the server sleeps or redeploys.

## How to play

1. **Host** a game and share the room code or invite link.
2. Your friend enters the code and presses **Join**.
3. Both players deploy their fleets and press **Ready**.
4. Take turns firing into enemy waters. Press `V` to switch between boards.
5. Sink all five enemy ships to win, then hit **Rematch**.

## Project structure

```
.
├── public
│   ├── index.html      # UI: lobby, HUD, panels, chat, game-over modal
│   ├── style.css       # Styling
│   └── js
│       ├── main.js     # Client: networking, placement, turn flow, UI
│       ├── scene.js    # Three.js scene: ocean, boards, ships, effects, camera
│       └── audio.js    # Synthesized Web Audio sound effects
├── server.js           # Express + Socket.IO game server (rooms, rules, validation)
└── package.json
```
