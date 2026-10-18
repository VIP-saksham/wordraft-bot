// © 2026 VIP-saksham · Wordraft Game Bot · All Rights Reserved.
import { Composer, Context } from "grammy";

import { bot } from "../config/bot";
import { db } from "../config/db";
import commonWords from "../data/commonWords.json";
import { CommandsHelper } from "../util/commands-helper";

const composer = new Composer();

const WIN_SCORE = 30;

type HostGame = {
  chatId: number;
  hostId: string;
  hostName: string;
  word: string;
};

const games = new Map<string, HostGame>();

const POOL = Object.keys(commonWords);

const esc = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const link = (id: string, name: string) =>
  `<a href="tg://user?id=${id}">${esc(name)}</a>`;

const randomWord = (): string =>
  POOL[Math.floor(Math.random() * POOL.length)]!;

const endGame = async (
  chatId: number,
  reason: string,
  reveal = true,
) => {
  const game = games.get(chatId.toString());
  if (!game) return;
  games.delete(chatId.toString());
  await bot.api
    .sendMessage(
      chatId,
      `🛑 Host game stopped.\n${reason}${
        reveal ? `\nThe word was <code>${esc(game.word.toUpperCase())}</code>` : ""
      }`,
      { parse_mode: "HTML" },
    )
    .catch(() => undefined);
};

composer.command("host", async (ctx) => {
  const chatId = ctx.chat!.id.toString();

  if (games.has(chatId)) {
    return ctx.reply("A host game is already running here! Guess or use /stopgame.");
  }

  const dbGame = await db
    .selectFrom("games")
    .selectAll()
    .where("activeChat", "=", chatId)
    .executeTakeFirst();
  if (dbGame) {
    return ctx.reply(
      "There is already a game in progress in this chat. Use /end to end the current game.",
    );
  }

  const name =
    `${ctx.from!.first_name || ""}${ctx.from!.last_name ? " " + ctx.from!.last_name : ""}`.trim() ||
    "Player";

  const game: HostGame = {
    chatId: ctx.chat!.id,
    hostId: ctx.from!.id.toString(),
    hostName: name,
    word: randomWord(),
  };
  games.set(chatId, game);

  await ctx.reply(
    `🎩 <b>${esc(name)} is now hosting a Word Guessing Game!</b>\n\n` +
      `A secret word has been set (${game.word.length} letters).\n` +
      `Players: just type your guesses in the chat!\n` +
      `<i>The host cannot participate in guessing.</i>`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "👁 View word", callback_data: "host_view" },
            { text: "🔄 Change word", callback_data: "host_change" },
          ],
        ],
      },
    },
  );
});

composer.command("stopgame", async (ctx) => {
  const game = games.get(ctx.chat!.id.toString());
  if (!game) {
    return ctx.reply("No host game is running right now.");
  }
  if (ctx.from!.id.toString() !== game.hostId) {
    return ctx.reply("Only the host can stop this game.");
  }
  return endGame(ctx.chat!.id, `Stopped by host ${esc(game.hostName)}.`);
});

composer.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (data !== "host_view" && data !== "host_change") return;

  const chatKey = ctx.callbackQuery.message?.chat?.id?.toString() || "";
  const game = games.get(chatKey);
  if (!game) {
    return ctx.answerCallbackQuery({ text: "This host game has ended." });
  }

  // Buttons are for the host only.
  if (ctx.from.id.toString() !== game.hostId) {
    return ctx.answerCallbackQuery({
      text: "Only the host can use these buttons!",
      show_alert: true,
    });
  }

  if (data === "host_view") {
    return ctx.answerCallbackQuery({
      text: `Your word is: ${game.word.toUpperCase()}`,
      show_alert: true,
    });
  }

  game.word = randomWord();
  return ctx.answerCallbackQuery({
    text: `New word set! (${game.word.length} letters) — check again.`,
  });
});

composer.on("message:text", async (ctx, next) => {
  const guess = ctx.message.text.trim().toLowerCase();
  if (guess.startsWith("/") || !/^[a-z]+$/.test(guess)) return next();

  const game = games.get(ctx.chat!.id.toString());
  if (!game) return next();

  const userId = ctx.from?.id.toString();
  if (!userId) return next();

  // The host cannot participate in guessing.
  if (userId === game.hostId) {
    return ctx.reply("🎩 You are the host — you can't guess your own word!");
  }

  if (guess === game.word) {
    games.delete(ctx.chat!.id.toString());

    try {
      await db
        .insertInto("leaderboard")
        .values({ score: WIN_SCORE, chatId: ctx.chat!.id.toString(), userId })
        .execute();
    } catch (error) {
      console.error("Host leaderboard error:", error);
    }

    try {
      await ctx.react("🎉");
    } catch {
      // reaction not allowed — ignore
    }

    const name =
      `${ctx.from!.first_name || ""}${ctx.from!.last_name ? " " + ctx.from!.last_name : ""}`.trim() ||
      "Player";

    return ctx.reply(
      `🎉 ${link(userId, name)} guessed the word — <b>${esc(game.word.toUpperCase())}</b>!\n+${WIN_SCORE} points to the leaderboard!\nHost a new round with /host`,
      { parse_mode: "HTML", reply_parameters: { message_id: ctx.msgId } },
    );
  }

  return ctx.reply(
    `❌ <code>${esc(guess.toUpperCase())}</code> is not the answer. Try harder!`,
    { reply_parameters: { message_id: ctx.msgId } },
  );
});

CommandsHelper.addNewCommand(
  "host",
  "Host a word guessing game with inline buttons.",
);

export const hostGame = composer;
