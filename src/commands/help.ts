// © 2026 VIP-saksham · Wordraft Game Bot · All Rights Reserved.
import { Composer } from "grammy";

import { FOOTER_MESSAGE } from "../config/constants";
import { CommandsHelper } from "../util/commands-helper";

const composer = new Composer();

composer.command("help", (ctx) =>
  ctx.reply(
    `<blockquote>🎮 Classic Wordle (/new)</blockquote>
1. You have to guess a random 5-letter word.
2. After each guess, you'll get hints:
   - 🟩 - Correct letter in the right spot.
   - 🟨 - Correct letter in the wrong spot.
   - 🟥 - Letter not in the word.
3. The game runs until the word is found or 30 guesses are reached.
4. The first person to guess the word correctly wins.

<blockquote>🧩 Pattern (/pattern)</blockquote>
1. The bot shows a word with hidden letters, e.g. <code>P L _ _ _</code>.
2. The first player to form a REAL word that fits the pattern wins!
   Example: for <code>G _ _ P _</code>, <b>GRAPE</b> is a valid answer.
3. Fake words are rejected. You have 10 minutes.

<blockquote>🔀 Word Scramble (/scramble)</blockquote>
1. The bot sends scrambled letters, e.g. <code>L A P P E</code>.
2. Unscramble them and guess the word — the first correct guess wins!
3. You have 10 minutes.

<blockquote>🔗 Classic Word Chain (/startclassic)</blockquote>
1. Use /startclassic in a group — players join with /join.
2. Starts after 1 minute or with /forcestart (starter only); /extend adds 30s.
3. The first word starts with a random letter; each word must start with the last letter of the previous word, be a real dictionary word, and not repeat.
4. 45s per turn — the minimum word length grows by 1 every 2 words and the timer drops by 10s every 4 words.
5. Time out = eliminated; invalid words skip your turn. Last player standing wins!

<blockquote>🎩 Host Game (/host)</blockquote>
1. Use /host to start hosting a word guessing game.
2. Use the inline buttons to view or change the secret word (host only).
3. Players guess by typing words in the chat — first correct guess wins the round.
4. The host cannot participate in guessing. Stop anytime with /stopgame.

<blockquote>Commands:</blockquote>
- /new - Start a new classic game.
- /pattern - Start a pattern game.
- /scramble - Start a word scramble game.
- /chain, /startclassic - Start a classic word chain game.
- /join, /flee, /extend, /forcestart, /killgame - Word chain game commands.
- /host, /stopgame - Host word guessing game.
- /end - End the current game. Available for only admins in groups.
- /help - Get help on how to play and commands list.
- /leaderboard - Get leaderboard from current group.
- /score - Get your score of the game.
- /score [@username/user_id] - Get score of anyone in the game.
- Leaderboard, and Score parameters: /[leaderboard/score] [global/group] [today/week/month/year/all]
- Example: <code>/leaderboard global month</code> <code>/score group all</code>

  ${FOOTER_MESSAGE}`,
    { parse_mode: "HTML" },
  ),
);

CommandsHelper.addNewCommand(
  "help",
  "Get help on how to play and commands list.",
);

export const helpCommand = composer;
