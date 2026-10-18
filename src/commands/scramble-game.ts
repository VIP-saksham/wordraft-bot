// © 2026 VIP-saksham · Wordraft Game Bot · All Rights Reserved.
import { Composer } from "grammy";

import { db } from "../config/db";
import allWords from "../data/allWords.json";
import commonWords from "../data/commonWords.json";
import { CommandsHelper } from "../util/commands-helper";
import { WordSelector } from "../util/word-selector";
import { schedulePatternGameTimeout } from "./pattern-game";

const composer = new Composer();

export const SCRAMBLE_GAME_TYPE = "scramble";

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};

const deterministicShuffle = (word: string, seed: string): string[] => {
  const chars = word.split("");
  let state = hashString(seed) || 1;

  for (let i = chars.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars;
};

/** Deterministic scramble — same word + chat = same letters, always. */
export const buildScrambledDisplay = (word: string, seed: string): string => {
  let scrambled = deterministicShuffle(word, seed);
  let salt = 0;

  // Kabhi original word order mat dikhao.
  while (scrambled.join("") === word && salt < 10) {
    scrambled = deterministicShuffle(word, `${seed}:${salt}`);
    salt++;
  }

  return scrambled.join(" ").toUpperCase();
};

const scrambleCommand = new Composer();

scrambleCommand.command("scramble", async (ctx) => {
  const chatId = ctx.chat.id;

  try {
    if (ctx.chat.is_forum) {
      const topicData = await db
        .selectFrom("chatGameTopics")
        .where("chatId", "=", chatId.toString())
        .selectAll()
        .execute();
      const topicIds = topicData.map((t) => t.topicId);
      const currentTopicId = ctx.msg.message_thread_id?.toString() || "general";

      if (topicData.length > 0 && !topicIds.includes(currentTopicId))
        return await ctx.reply(
          "This topic is not set for the game. Please play the game in the designated topic.",
        );
    }

    const existingGame = await db
      .selectFrom("games")
      .selectAll()
      .where("activeChat", "=", chatId.toString())
      .executeTakeFirst();

    if (existingGame)
      return ctx.reply(
        "There is already a game in progress in this chat. Use /end to end the current game.",
      );

    const wordSelector = new WordSelector();
    const randomWord = await wordSelector.getRandomWord(chatId);

    const insertedGame = await db
      .insertInto("games")
      .values({
        word: randomWord,
        activeChat: chatId.toString(),
        startedBy: ctx.msg.from?.id.toString(),
        type: SCRAMBLE_GAME_TYPE,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    schedulePatternGameTimeout(insertedGame.id, chatId.toString());

    const scrambled = buildScrambledDisplay(randomWord, `${chatId}:${randomWord}`);

    await ctx.reply(
      `🔀 <b>Word Scramble Started!</b>\n\n` +
        `Letters: <code>${scrambled}</code>\n\n` +
        `Unscramble the letters and guess the word! First correct guess wins! 🏆\n\n` +
        `⏰ You have <b>10 minutes</b>.`,
      { parse_mode: "HTML" },
    );
  } catch (error) {
    if ((error as { code?: string })?.code === "23505") {
      return ctx.reply(
        "There is already a game in progress in this chat. Use /end to end the current game.",
      );
    }

    console.error(error);
    ctx.reply("Something went wrong. Please try again.");
  }
});

CommandsHelper.addNewCommand(
  "scramble",
  "Start a word scramble game — unscramble the letters!",
);

const scrambleGuessHandler = new Composer();

scrambleGuessHandler.on("message:text", async (ctx, next) => {
  const guess = ctx.message.text.trim().toLowerCase();

  if (guess.startsWith("/") || !/^[a-z]+$/.test(guess)) return next();

  const game = await db
    .selectFrom("games")
    .selectAll()
    .where("activeChat", "=", ctx.chat.id.toString())
    .where("type", "=", SCRAMBLE_GAME_TYPE)
    .executeTakeFirst();

  if (!game) return next();

  // Sirf same-length words pe hi check — baaki messages bilkul ignore.
  if (guess.length !== game.word.length) return next();

  const chatId = ctx.chat.id.toString();
  const userId = ctx.from.id.toString();

  if (guess === game.word) {
    let score = 30;
    let additionalMessage = `+30 points to the leaderboard! 🎉\nStart with /new, /pattern or /scramble`;

    if (ctx.from.is_bot) {
      score = 0;
      additionalMessage = `Anonymous admins or bot accounts don't get points.\nStart with /new, /pattern or /scramble`;
    }

    await db
      .insertInto("leaderboard")
      .values({ score, chatId, userId })
      .execute();

    try {
      await ctx.react("🎉");
    } catch {
      // reaction allowed nahi hai to ignore
    }

    await db.deleteFrom("games").where("id", "=", game.id).execute();

    return ctx.reply(
      `🎉 Congrats! <a href="tg://user?id=${userId}">${ctx.from.first_name}</a> unscrambled it — the word was <b>${game.word.toUpperCase()}</b>!\n${additionalMessage}`,
      { parse_mode: "HTML", reply_parameters: { message_id: ctx.msgId } },
    );
  }

  const isRealWord =
    allWords.includes(guess) || Object.keys(commonWords).includes(guess);

  if (!isRealWord)
    return ctx.reply(
      `❌ <code>${guess.toUpperCase()}</code> is not a valid word.`,
      { parse_mode: "HTML", protect_content: true },
    );

  // Word ko unscrambled letters se hi banana hona chahiye.
  const sorted = (s: string) => [...s].sort().join("");
  if (sorted(guess) !== sorted(game.word))
    return ctx.reply(
      `❌ <code>${guess.toUpperCase()}</code> doesn't use exactly the scrambled letters!`,
      { parse_mode: "HTML", protect_content: true },
    );

  return ctx.reply(
    `❌ <code>${guess.toUpperCase()}</code> is a real word, but it's not the answer! Keep trying!`,
    { parse_mode: "HTML", protect_content: true },
  );
});

const combined = new Composer();

combined.use(scrambleCommand, scrambleGuessHandler);

export const scrambleGame = combined;
