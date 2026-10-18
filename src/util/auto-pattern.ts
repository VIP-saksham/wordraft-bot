// © 2026 VIP-saksham · Wordraft Game Bot · All Rights Reserved.
import { Composer } from "grammy";

import { bot } from "../config/bot";
import { db } from "../config/db";
import { redis } from "../config/redis";
import {
  GAME_TTL_MS,
  PATTERN_GAME_TYPE,
  buildMaskDisplay,
  schedulePatternGameTimeout,
} from "../commands/pattern-game";
import { SCRAMBLE_GAME_TYPE } from "../commands/scramble-game";
import { WordSelector } from "./word-selector";

export const REGISTERED_GROUPS_KEY = "registeredGroups";

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;

const isGroupChat = (
  chat: { id: number; type: string } | undefined,
): chat is { id: number; type: string } =>
  !!chat && (chat.type === "group" || chat.type === "supergroup");

const registerGroup = async (chatId: number) => {
  try {
    await redis.sadd(REGISTERED_GROUPS_KEY, chatId.toString());
  } catch (error) {
    console.error("Group registry error:", error);
  }
};

const getRegisteredGroups = async (): Promise<string[]> => {
  try {
    return await redis.smembers(REGISTERED_GROUPS_KEY);
  } catch (error) {
    console.error("Group registry read error:", error);
    return [];
  }
};

/** Starts a pattern game in a chat, skipping/dealing with stale games. */
const startPatternGameInChat = async (chatId: string) => {
  const existing = await db
    .selectFrom("games")
    .selectAll()
    .where("activeChat", "=", chatId)
    .executeTakeFirst();

  if (existing) {
    // Sirf pattern game ko replace karte hain jo 3hr+ purana ho aur koi guess na ho.
    if (existing.type !== PATTERN_GAME_TYPE) return;

    const ageMs = Date.now() - new Date(existing.createdAt).getTime();
    if (ageMs < THREE_HOURS_MS) return;

    const guesses = await db
      .selectFrom("guesses")
      .selectAll()
      .where("gameId", "=", existing.id)
      .execute();

    if (guesses.length > 0) return;

    await db.deleteFrom("games").where("id", "=", existing.id).execute();
  }

  const word = await new WordSelector().getRandomWord(chatId);
  const masked = buildMaskDisplay(word, `${chatId}:${word}`);

  const insertedGame = await db
    .insertInto("games")
    .values({
      word,
      activeChat: chatId,
      type: PATTERN_GAME_TYPE,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  schedulePatternGameTimeout(insertedGame.id, chatId);

  await bot.api.sendMessage(
    Number(chatId),
    `🧩 <b>Auto Pattern Game Started!</b>\n\n` +
      `<code>${masked}</code>\n` +
      `(${word.length} letters)\n\n` +
      `First one to form a <b>real word</b> that fits the pattern wins! 🏆\n` +
      `<i>Example:</i> for <code>G _ _ P _</code>, <b>GRAPE</b> is valid!\n\n` +
      `⏰ You have <b>10 minutes</b>.`,
    { parse_mode: "HTML" },
  );
};

/** Purane stuck pattern/scramble games (10min+) ko reveal karke khatam karta hai. */
const sweepStalePatternGames = async () => {
  try {
    const patternGames = await db
      .selectFrom("games")
      .selectAll()
      .where("type", "in", [PATTERN_GAME_TYPE, SCRAMBLE_GAME_TYPE])
      .execute();

    for (const game of patternGames) {
      const ageMs = Date.now() - new Date(game.createdAt).getTime();
      if (ageMs < GAME_TTL_MS) continue;

      await db.deleteFrom("games").where("id", "=", game.id).execute();

      try {
        await bot.api.sendMessage(
          Number(game.activeChat),
          `⏰ <b>Time's up!</b> Nobody found a word in time.\nThe word was <b>${game.word.toUpperCase()}</b>\nStart again with /new or /pattern`,
          { parse_mode: "HTML" },
        );
      } catch (error) {
        console.error(`Stale game sweep notify failed for ${game.activeChat}:`, error);
      }
    }
  } catch (error) {
    console.error("Stale pattern game sweep failed:", error);
  }
};

const runOnce = async () => {
  await sweepStalePatternGames();

  const groups = await getRegisteredGroups();
  for (const chatId of groups) {
    try {
      await startPatternGameInChat(chatId);
    } catch (error) {
      console.error(`Auto pattern game failed for group ${chatId}:`, error);
    }
  }
};

export const startAutoPatternLoop = () => {
  setTimeout(() => {
    void runOnce();
  }, FIRST_RUN_DELAY_MS);

  setInterval(() => {
    void runOnce();
  }, THREE_HOURS_MS);
};

/** Har group message/membership change pe group ko registry mein add karta hai. */
const registry = new Composer();

registry.on("message", async (ctx, next) => {
  if (isGroupChat(ctx.chat)) await registerGroup(ctx.chat.id);
  await next();
});

registry.on("my_chat_member", async (ctx, next) => {
  if (isGroupChat(ctx.chat)) await registerGroup(ctx.chat.id);
  await next();
});

registry.on("channel_post", async (ctx, next) => {
  if (isGroupChat(ctx.chat)) await registerGroup(ctx.chat.id);
  await next();
});

registry.on("edited_message", async (ctx, next) => {
  if (isGroupChat(ctx.chat)) await registerGroup(ctx.chat.id);
  await next();
});

export const autoPattern = registry;
