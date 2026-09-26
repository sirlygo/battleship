# Game Room

Real-time board games to play with friends in the browser: no accounts, just share a room code. Pick a game on the home page, host a room, and send the 5-character code or invite link. Anyone who joins a full room watches as a spectator.

| Game | Players | Status |
|---|---|---|
| **Battleship**: 3D ocean, Classic and Salvo modes | 2 | Playable |
| **Checkers**: 3D or 2D board, forced captures, multi-jumps, kings, draw offers | 2 | Playable |
| **Chess**: 3D or 2D board, full rules, drag-and-drop, optional clocks | 2 | Playable |
| **Clue**: 3D or 2D mansion board, secret passages, private card showing, auto-filling notes | 2–6 | Playable |
| **Risk**: 3D or 2D world map, dice battles with blitz, cards, continent bonuses | 2–6 | Playable |
| **The Game of Life**: 3D board, Life Points (wealth, knowledge, happiness), decision cards, pets | 2–6 | Playable |

## Checkers

- **3D board** (default): glossy ridged checkers on a wooden board with a brass inlay. Pieces hop, and jumps arc over the piece being captured, which flies off in a burst of sparks. A crowned king gets a second checker with a gold crown dropped on top. Movable pieces get a gold ring, the selected piece lifts, and jump targets glow red. The camera turns to your side. Switch to the flat **2D** board in Settings.
- Standard American rules: black moves first, men move diagonally forward, and kings move both ways. A man that reaches the far row is crowned, and that ends its move.
- Captures are mandatory by default; the host can make them optional. Multi-jumps must be completed.
- Tap a piece, then a highlighted square. Red rings mark jumps, and you can tap the final square of a multi-jump directly.
- Pieces glide and capture with animation. The move list uses standard square numbers (1–32).
- You win by capturing every enemy piece or leaving them with no legal move. You can offer a draw or resign. After 40 moves each without a capture or a new king, the game is a draw.
- Colours swap every rematch. The server checks every move with the same rules file the browser uses.

## Clue

- The host starts the game once 2–6 players have joined. Everyone gets a suspect (Miss Scarlet goes first), and the remaining cards are dealt after one suspect, weapon and room go into the case file.
- **3D board** (default): a walled mansion with glossy pawns, little brass and steel weapon models, a sealed case file in the cellar and a staircase for each secret passage. Pawns hop square by square, and weapons fly into the room when they're named in a suggestion. Switch to the flat **2D** board in Settings.
- On your turn, roll and move. Glowing squares and rooms show where you can go, and the corner rooms have secret passages. Other pawns block hallway squares.
- In a room you can make a suggestion. The suspect and weapon move into that room, and the first player to your left holding one of those cards must show you one in secret. If they only hold one match it's shown automatically.
- Your detective notes cross off your own cards, cards shown to you, and cards of players who left. The host can turn this auto-fill off in the lobby for classic, fully manual notes. Tap any line to mark it ✕, ? or ✓ yourself. The case log records every suggestion and who passed.
- Accuse at any time on your turn. Right and you win; wrong and you're out, but you still show cards. The server holds the hidden cards and sends each player only what they're allowed to see.

## The Game of Life

- The host starts the game with 2–6 players. Everyone starts with $10K.
- **Life Points win.** Build all three sides of a good life: 💰 **Wealth** (every $10K of net worth is 1 point), 📘 **Knowledge** and ❤ **Happiness**.
- **3D board** (default):
  - A winding road over green hills, with trees, drifting clouds, hot-air balloons, and landmarks such as a university, chapel, house, night school and retirement villa.
  - Each player drives a car with peg people. A spouse and kids join as your family grows, and pets ride along too.
  - Confetti and a happy car spin mark weddings, babies, new homes, pets, careers, jackpots and retirement.
  - Scroll or pinch to zoom, and drag to look around. The camera follows the moving car (you can turn this off). Switch to the flat **2D** board in Settings.
- **Moving:** spin the wheel (1–10) and drive. At the first fork, choose **college** ($100K in loans, +Knowledge, and any career) or **start a career** right away. Later forks offer the family or adventure path, night school, and the risky or safe road.
- **Decision cards (?):** pick option A or B, such as concert tickets or studying, investing in a friend's startup (spin to see if it pays off), adopting a puppy, or taking a promotion with overtime. Each card shows its effect on cash, Knowledge, Happiness and salary.
- **Other spaces:**
  - **Payday** pays your salary whenever you pass it, and your pets cheer you up there too.
  - **❤ Happiness** and **📘 Knowledge** spaces, pets, babies and twins, and lawsuits (sue someone for $100K).
  - Red **STOP** spaces end your move: graduation, starting a career, marriage (everyone gives a gift), buying a house, night school and retirement.
- **Loans:** if you run out of cash the bank lends $50K at a time. Repay $60K each whenever you like, or it comes out at the end.
- **Retirement:** the first three to arrive get $100K, $50K and $20K. Houses are sold (spin: even for the high price, odd for the low price) and loans are repaid. The results screen breaks each player's Life Points into Wealth, Knowledge and Happiness.

## Risk

- **3D board** (default): raised territories on a wooden tabletop ocean, with small armies of infantry, cavalry (5) and cannons (10) in each owner's colour, plus a count badge. Territories lift when selected, targets glow, an arc marks the attack, and conquered land flashes into its new colour. Scroll or pinch to zoom, drag to pan, and double-click to reset. Switch to the flat **2D** map in Settings.
- The host picks the rules in the lobby: place starting armies yourself or automatically, rising (4, 6, 8, 10, 12, 15, +5) or fixed card values, and fortifying along any chain of your territories or only next door. Then they start the game with 2–6 players.
- The 42 territories are dealt out. Everyone places their starting armies at the same time, then turns begin.
- **Reinforce:** you get 1 army per 3 territories (at least 3), plus continent bonuses. Tap territories to stage armies (right-click or long-press takes one back), or use Auto-place, then confirm. Trade three cards (three of a kind, one of each, or any with a wild) for more; with 5 or more cards you must trade. A traded card showing a territory you hold adds 2 armies there.
- **Attack:** tap your territory, then a neighbouring enemy (dashed lines are sea routes, and Alaska wraps round to Kamchatka). Roll 1–3 dice against the defender's 1–2. The highest dice are compared and ties go to the defender. **Blitz** keeps rolling until one side runs out. The dice are shown to everyone. After a conquest, choose how many armies move in.
- **Fortify:** move armies once, then end your turn. Conquer at least one territory to earn a card. Knock a player out and you take their cards.
- A player who leaves turns into neutral armies that never attack. The last commander standing wins.
- The map is generated from `tools/risk-map-gen.js`, and the server checks every move against the same map file the browser draws.

## Chess

- All the rules, enforced by [chess.js](https://github.com/jhlywa/chess.js): castling, en passant, promotion (with a piece picker), check, checkmate, stalemate, insufficient material, threefold repetition and the 50-move rule.
- **3D board** (default): a wooden board with turned pieces, soft shadows and reflections, built with Three.js. Pieces glide into place, knights hop, captured pieces pop off the board, and the camera turns to your side. Quality adapts to the device: phones use lighter shadows. Switch to the flat **2D** board in Settings.
- Tap a piece and then a square, or drag and drop. It works the same on both boards. Legal moves, the last move and check are highlighted, and moves animate, including the rook when you castle.
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
