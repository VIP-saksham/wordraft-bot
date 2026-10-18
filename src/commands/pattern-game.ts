import { Composer } from "grammy";

import { bot } from "../config/bot";
import { db } from "../config/db";
import allWords from "../data/allWords.json";
import commonWords from "../data/commonWords.json";
import { CommandsHelper } from "../util/commands-helper";
import { formatWordDetails } from "../util/format-word-details";
import { WordSelector } from "../util/word-selector";

const composer = new Composer();

export const PATTERN_GAME_TYPE = "pattern";

const GAME_TTL_MS = 10 * 60 * 1000; // 10 minutes

export { GAME_TTL_MS };

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
};

/**
 * Easy mask: first letter is ALWAYS revealed, plus 1-2 random extra letters.
 * Deterministic, so the mask never changes mid-game.
 */
export const getRevealedIndices = (
  word: string,
  seed: string,
): number[] => {
  const extraCount = 1 + (hashString(`${seed}:count`) % 2); // 1 ya 2 extra letters
  const revealed = new Set<number>([0]); // first letter hamesha dikhega
  let salt = 0;

  while (revealed.size < 1 + Math.min(extraCount, word.length - 1)) {
    const hash = hashString(`${seed}:pos:${salt}`);
    revealed.add(hash % word.length);
    salt++;
  }

  return [...revealed];
};

export const buildMaskDisplay = (word: string, seed: string): string => {
  const revealed = getRevealedIndices(word, seed);
  return word
    .split("")
    .map((c, i) => (revealed.includes(i) ? c.toUpperCase() : "_"))
    .join(" ");
};

/** 10 min baad game khatam — agar tab tak koi word guess na ho paya ho. */
export const schedulePatternGameTimeout = (gameId: number, chatId: string) => {
  setTimeout(async () => {
    try {
      const game = await db
        .selectFrom("games")
        .selectAll()
        .where("id", "=", gameId)
        .executeTakeFirst();

      if (!game) return; // jeet gaya ya pehle hi khatam ho gaya

      await db.deleteFrom("games").where("id", "=", gameId).execute();

      await bot.api.sendMessage(
        Number(chatId),
        `⏰ <b>Time's up!</b> Nobody found a word in time.\nThe word was <b>${game.word.toUpperCase()}</b>\nStart again with /new or /pattern`,
        { parse_mode: "HTML" },
      );
    } catch (error) {
      console.error(`Pattern game timeout failed for ${chatId}:`, error);
    }
  }, GAME_TTL_MS);
};

/** Stuck pattern/scramble game ko reveal karke khatam karta hai (e.g. jab /new chalu ho). */
export const forceEndPatternGame = async (chatId: string) => {
  const game = await db
    .selectFrom("games")
    .selectAll()
    .where("activeChat", "=", chatId)
    .where("type", "!=", "classic")
    .executeTakeFirst();

  if (!game) return;

  await db.deleteFrom("games").where("id", "=", game.id).execute();

  try {
    await bot.api.sendMessage(
      Number(chatId),
      `⏰ ${game.type === "scramble" ? "Word Scramble" : "Pattern"} game ended — a new game is starting.
The word was <b>${game.word.toUpperCase()}</b>`,
      { parse_mode: "HTML" },
    );
  } catch (error) {
    console.error(`forceEndPatternGame notify failed for ${chatId}:`, error);
  }
};

const buildPatternRegex = (word: string, seed: string): RegExp => {
  const revealed = getRevealedIndices(word, seed);
  const source = word
    .split("")
    .map((c, i) => (revealed.includes(i) ? c : "."))
    .join("");
  return new RegExp(`^${source}$`);
};

const patternCommand = new Composer();

patternCommand.command("pattern", async (ctx) => {
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

    // Insert se pehle hi check — duplicate key error se pehle friendly reply.
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
        type: PATTERN_GAME_TYPE,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    schedulePatternGameTimeout(insertedGame.id, chatId.toString());

    const masked = buildMaskDisplay(randomWord, `${chatId}:${randomWord}`);

    await ctx.reply(
      `🧩 <b>Pattern Game Started!</b>\n\n` +
        `<code>${masked}</code>\n` +
        `(${randomWord.length} letters)\n\n` +
        `First one to form a <b>real word</b> that fits the pattern wins! 🏆\n` +
        `<i>Example:</i> for <code>G _ _ P _</code>, <b>GRAPE</b> is valid!\n\n` +
        `⏰ You have <b>10 minutes</b>.`,
      { parse_mode: "HTML" },
    );
  } catch (error) {
    // pg DatabaseError ka instanceof bun ESM/CJS interop ka fail karta hai,
    // isvahan code property check karte hein.
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
  "pattern",
  "Start a new pattern (fill the blanks) word game.",
);

const patternGuessHandler = new Composer();

patternGuessHandler.on("message:text", async (ctx, next) => {
  const guess = ctx.message.text.trim().toLowerCase();

  // Commands aur non-letter messages — classic handler ke liye chhod do.
  if (guess.startsWith("/") || !/^[a-z]+$/.test(guess)) return next();

  const game = await db
    .selectFrom("games")
    .selectAll()
    .where("activeChat", "=", ctx.chat.id.toString())
    .where("type", "=", PATTERN_GAME_TYPE)
    .executeTakeFirst();

  if (!game) return next();

  // Length ya pattern mismatch — ignore karo, classic handler ko aage bhejo
  // (wahan classic game na hone par silent rehta hai — purane repo jaisa).
  if (guess.length !== game.word.length) return next();

  const seed = `${ctx.chat.id}:${game.word}`;
  if (!buildPatternRegex(game.word, seed).test(guess)) return next();

  const chatId = ctx.chat.id.toString();
  const userId = ctx.from.id.toString();

  // Pattern se match karta hai — ab real meaningful word hona chahiye.
  const isRealWord =
    allWords.includes(guess) || Object.keys(commonWords).includes(guess);

  if (!isRealWord)
    return ctx.reply(
      `❌ <code>${guess.toUpperCase()}</code> is not a valid word. It fits the pattern, but it isn't a real word!`,
      { parse_mode: "HTML", protect_content: true },
    );

  // Pattern se match karta hua real word — WIN! (secret word se match na bhi kare)
  let score = 30;
  let additionalMessage = `+30 points to the leaderboard! 🎉\nStart with /new or /pattern`;

  if (ctx.from.is_bot) {
    score = 0;
    additionalMessage = `Anonymous admins or bot accounts don't get points.\nStart with /new or /pattern`;
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
    `🎉 Congrats! <a href="tg://user?id=${userId}">${ctx.from.first_name}</a> found a word — <b>${guess.toUpperCase()}</b> fits the pattern!\n${additionalMessage}\nHidden word was <b>${game.word.toUpperCase()}</b>\n${formatWordDetails(guess)}`,
    { parse_mode: "HTML", reply_parameters: { message_id: ctx.msgId } },
  );
});

const combined = new Composer();

combined.use(patternCommand, patternGuessHandler);

export const patternGame = combined;
