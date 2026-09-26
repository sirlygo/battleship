# Game Room

Real-time board games to play with friends in the browser: no accounts, just share a room code. Pick a game on the home page, host a room, and send the 5-character code or invite link. Anyone who joins a full room watches as a spectator.

| Game | Players | Status |
|---|---|---|
| **Battleship**: 3D ocean, Classic and Salvo modes | 2 | Playable |
| **Checkers**: forced captures, multi-jumps, kings, draw offers | 2 | Playable |
| **Chess**: full rules, drag-and-drop, optional clocks | 2 | Playable |
| Clue | 3–6 | Coming soon |
| Risk | 2–6 | Coming soon |
| The Game of Life | 2–6 | Coming soon |

## Checkers

- Standard American rules: black moves first, men move diagonally forward, and kings move both ways. A man that reaches the far row is crowned, and that ends its move.
- Captures are mandatory by default; the host can make them optional. Multi-jumps must be completed.
- Tap a piece, then a highlighted square. Red rings mark jumps, and you can tap the final square of a multi-jump directly.
- Pieces glide and capture with animation. The move list uses standard square numbers (1–32).
- You win by capturing every enemy piece or leaving them with no legal move. You can offer a draw or resign. After 40 moves each without a capture or a new king, the game is a draw.
- Colours swap every rematch. The server checks every move with the same rules file the browser uses.

## Chess

- All the rules, enforced by [chess.js](https://github.com/jhlywa/chess.js): castling, en passant, promotion (with a piece picker), check, checkmate, stalemate, insufficient material, threefold repetition and the 50-move rule.
- Tap a piece and then a square, or drag and drop. Legal moves, the last move and check are highlighted, and moves animate, including the rook when you castle.
- Before the game the host can add a clock: Off, 3+2, 5 min, 10 min or 15+10. The server keeps time, and running out loses (or draws if the opponent can't checkmate).
- Captured pieces and the point lead are shown next to each player, with a move list in standard notation.
- You can offer a draw or resign, and colours swap every rematch.

## Battleship

- **Room codes and invite links.** Host a game and share a code like `K7QX2`, or share a link that fills the code in for your friend.
- **Classic rules.** Each player has a 10×10 grid and five ships (Carrier 5, Battleship 4, Cruiser 3, Submarine 3, Destroyer 2).
- **Two game modes.** *Classic* is standard Battleship: one shot per turn. The host can optionally allow a bonus shot after a hit. In *Salvo*, you pick one target per surviving ship and fire them all at once, so losing ships costs you firepower.
- **Spectators.** Anyone who joins a full room watches the match live. Spectators never receive ship positions, so they can't tip off a player.
- **Settings.** Separate volume sliders for effects, music and ocean ambience (all generated in the browser; ocean starts muted); Low/Medium/High graphics quality for older phones; a 3D or top-down camera; and a toggle for whether the camera follows the action.
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

## Play online with GitHub Codespaces (free, no card)

1. Open <https://codespaces.new/sirlygo/battleship> and click **Create codespace**.
2. Wait for setup. The game installs and starts on its own.
3. Open the **Ports** tab, right-click port **3000**, and choose **Port Visibility → Public**.
4. Copy the forwarded address (`https://…app.github.dev`) and open it on any phone or computer.

The link only works while the codespace is running. Codespaces stop after about 30 minutes of inactivity; restart it from <https://github.com/codespaces>.

### If the `app.github.dev` link shows "404"

Codespaces sometimes fails to forward the port, especially when the codespace is open in desktop VS Code. A free Cloudflare tunnel works instead and needs no account. Leave `npm start` running, open a second terminal and run:

```bash
npx -y cloudflared tunnel --url http://localhost:3000
```

It prints a link like `https://some-random-words.trycloudflare.com`. Open it and host a room. Invite links automatically use that address. Keep both terminals running while you play, because each new tunnel gets a different link.

The same command works on your own computer if you want friends outside your Wi-Fi to join a game running on your machine.

## Deploy online (free)

The repo includes a `render.yaml`, so it can be hosted on [Render](https://render.com) and played from any phone or network:

1. Sign in to Render with GitHub.
2. Click **New → Blueprint**, choose this repository, and click **Apply**.
3. When the deploy finishes, share the `https://battleship-….onrender.com` link.

On Render's free plan the server sleeps after 15 minutes without visitors. The first visit after that takes about 30–60 seconds to wake it. Rooms live in memory, so they reset when the server sleeps or redeploys.

## How to play Battleship

1. **Host** a game and share the room code or invite link.
2. Your friend enters the code and presses **Join**.
3. Both players deploy their fleets and press **Ready**.
4. Take turns firing into enemy waters. Press `V` to switch between boards. In Salvo mode, mark your targets and press **Fire salvo** (or `F`).
5. Sink all five enemy ships to win, then hit **Rematch**.

## Project structure

```
.
├── server.js                 # Express + Socket.IO entry point, share/room-lookup APIs
├── server
│   ├── rooms.js              # Game-agnostic rooms: codes, seats, spectators, reconnects, chat, rematch
│   └── games
│       ├── battleship.js     # Battleship rules
│       └── checkers.js       # Checkers rules
└── public
    ├── index.html, hub.*     # Home page: pick a game, join by code
    ├── shared
    │   ├── ui.css            # Shared look: buttons, panels, chat, modals
    │   ├── audio.js          # Synthesized sound effects and music
    │   ├── room-client.js    # Browser-side rooms, invites, toasts
    │   └── checkers-rules.js # Checkers rules used by both server and browser
    ├── battleship/           # Battleship page (Three.js scene)
    └── checkers/             # Checkers page
```

### Adding a game

Create `server/games/<id>.js` exporting `id`, `title`, `minPlayers`, `maxPlayers`, `defaultOptions`, `canChangeOptions`, `applyOptions`, `start`, `view`, `onLeave` and an `actions` map. Register it in `server.js`, then add a page under `public/<id>/` that uses `shared/room-client.js`. Rooms, spectators, chat, reconnects and rematches work automatically.
