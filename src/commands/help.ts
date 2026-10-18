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

<blockquote>🔗 Word Chain (/chain)</blockquote>
1. Players /join and take turns sending words.
2. Each word must start with the last letter of the previous word, be a real dictionary word, and not repeat.
3. 40s per turn — every 5 words the time drops (min 20s) and the minimum word length grows (up to 10).
4. Time out and you're eliminated — last player standing wins!

<blockquote>Commands:</blockquote>
- /new - Start a new classic game.
- /pattern - Start a pattern game.
- /scramble - Start a word scramble game.
- /chain - Start a word chain game.
- /join - Join a running word chain game.
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
