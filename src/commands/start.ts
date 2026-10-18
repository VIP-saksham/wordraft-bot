// © 2026 VIP-saksham · Wordraft Game Bot · All Rights Reserved.
import { Composer } from "grammy";

import { FOOTER_MESSAGE } from "../config/constants";
import { CommandsHelper } from "../util/commands-helper";

const composer = new Composer();

composer.command("start", async (ctx) => {
  ctx.reply(
    `<blockquote><strong>𝐖ᴏʀᴅʀᴀꜰᴛ Game Bot</strong></blockquote>
A fun and competitive word-gaming bot that you can play directly on Telegram!

🎮 <b>Games:</b>
• <code>/new</code> — Classic Wordle: guess the 5-letter word with 🟩🟨🟥 hints.
• <code>/pattern</code> — Fill the blanks: e.g. <code>P L _ _ _</code> — first one to form a real word that fits wins!
• <code>/scramble</code> — Unscramble the letters: e.g. <code>L A P P E</code> — guess the word first to win!
• <code>/chain</code> — Classic Word Chain: players /join and build a last-letter chain against the clock!
• <code>/host</code> — Host Game: you hold the secret word, others guess in the chat!

1. Add me to a group with admin permission to play with your friends.
2. Use /help for full rules and the command list.

${FOOTER_MESSAGE}`,
    { parse_mode: "HTML" },
  );
});

CommandsHelper.addNewCommand("start", "Start the bot.");

export const startCommand = composer;
