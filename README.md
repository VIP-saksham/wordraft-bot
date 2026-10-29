# Wordraft Game Bot

<div align="center">

**A multi-game word bot for Telegram — Classic Wordle, Pattern, Scramble and Word Chain**

</div>

## 🎮 Games

### Classic Wordle — `/new`
Guess a random 5-letter word. After every guess you get 🟩🟨🟥 hints. The first correct guess wins (+30 points, leaderboard).

### Pattern — `/pattern`
The bot shows a masked word like `P L _ _ _`. The first player to form a **real dictionary word** that fits the pattern wins within **10 minutes**. Fake words are rejected.

### Word Scramble — `/scramble`
The bot sends scrambled letters like `L A P P E`. Unscramble them and guess the exact word within **10 minutes**. Only same-length answers are checked; fake words are rejected.

### Word Chain — `/chain`
Multiplayer elimination game (ported from on9wordchainbot rules):
- `/chain` / `/startgame` — start, 60s joining phase
- `/join`, `/flee`, `/forcestart`, `/killgame`
- Every word must start with the **last letter** of the previous word and be a real dictionary word (370k+ word dictionary)
- 40s per turn; every 5 accepted words the timer drops (min 20s) and the minimum word length grows (up to 10 letters)
- Time out and you're eliminated — last player standing wins **+30 points**

## 🛠 Commands

| Command | Description |
|---|---|
| `/new` | Start a classic game |
| `/pattern` | Start a pattern game |
| `/scramble` | Start a word scramble game |
| `/chain` | Start a word chain game |
| `/end` | End the current game (admins in groups) |
| `/leaderboard`, `/score` | Scores with time filters |
| `/help`, `/start` | Rules and command list |

**Owner-only:** `/log` (set log GC), `/broadcast`, `/track`, `/stats`, `/ban`, `/unban`

## ⚙️ Setup

1. `bun install`
2. Create `.env`:
   ```env
   BOT_TOKEN=your-telegram-bot-token
   MONGO_URI=mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
   NODE_ENV=production
   ADMIN_USERS=your-telegram-user-id
   ```
3. `bun run start` (or run under PM2: `pm2 start bun --name wordseek-bot -- src/index.ts`)

**Requirements:** Bun (or Node 18+), MongoDB Atlas. TypeScript strict-checked.

> All persistent data — users, scores, games, word history, tracking, broadcast groups — is stored in MongoDB. It survives VPS restarts/migrations, since the database lives outside the server.

## 🏗 Tech

- [grammY](https://grammy.dev) bot framework on Bun/TypeScript
- MongoDB Atlas (games, guesses, users, leaderboard, word history, tracking, broadcasts)
- PM2 process management

---

© 2026 **VIP-saksham** — this project and all its code are provided under the terms in [LICENSE](LICENSE). All rights reserved.

🛠 Developed by [@truenakshu](https://t.me/truenakshu)
