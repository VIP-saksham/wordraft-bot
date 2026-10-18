import { Composer, Context } from "grammy";

import { readFileSync } from "fs";
import { join } from "path";

import { bot } from "../config/bot";
import { db } from "../config/db";
import { env } from "../config/env";
import { CommandsHelper } from "../util/commands-helper";

const composer = new Composer();

// Timings copied from on9wordchainbot's classic mode.
const JOIN_MS = 60_000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 50;
const INITIAL_TURN_MS = 40_000;
const MIN_TURN_MS = 20_000;
const INITIAL_MIN_LEN = 3;
const MAX_MIN_LEN = 10;
const RAMP_EVERY = 5;
const WIN_SCORE = 30;

type ChainPlayer = { id: string; name: string };

interface ChainGame {
  chatId: number;
  status: "joining" | "playing";
  players: ChainPlayer[];
  idx: number;
  used: Set<string>;
  currentWord: string;
  accepted: number;
  minLen: number;
  turnMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  starterId: string;
}

const games = new Map<string, ChainGame>();

let wordsCache: { dict: Set<string>; startPool: string[] } | null = null;

const words = () => {
  if (!wordsCache) {
    const txt = readFileSync(
      join(process.cwd(), "src", "data", "words_alpha.txt"),
      "utf8",
    );
    const dict = new Set<string>();
    const startPool: string[] = [];
    for (const raw of txt.split(/\r?\n/)) {
      const w = raw.trim().toLowerCase();
      if (!/^[a-z]{3,15}$/.test(w)) continue;
      dict.add(w);
      if (w.length <= 7) startPool.push(w);
    }
    wordsCache = { dict, startPool };
  }
  return wordsCache;
};

const esc = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const link = (p: ChainPlayer) =>
  `<a href="tg://user?id=${p.id}">${esc(p.name)}</a>`;

const clearTimer = (game: ChainGame) => {
  if (game.timer) {
    clearTimeout(game.timer);
    game.timer = null;
  }
};

const nextTurnText = (game: ChainGame) => {
  const tail = game.currentWord[game.currentWord.length - 1];
  return (
    `Current word: <code>${esc(game.currentWord.toUpperCase())}</code> ` +
    `(start with <b>${tail.toUpperCase()}</b> · min ${game.minLen} letters · ⏱ ${Math.round(
      game.turnMs / 1000,
    )}s)`
  );
};

const eliminateCurrent = async (game: ChainGame) => {
  const eliminated = game.players[game.idx];
  game.players.splice(game.idx, 1);

  if (game.players.length === 1) {
    const winner = game.players[0];
    clearTimer(game);
    games.delete(game.chatId.toString());

    try {
      await db
        .insertInto("leaderboard")
        .values({
          score: WIN_SCORE,
          chatId: game.chatId.toString(),
          userId: winner.id,
        })
        .execute();
    } catch (error) {
      console.error("Chain leaderboard error:", error);
    }

    await bot.api
      .sendMessage(
        game.chatId,
        `🏆 ${link(winner)} wins the Word Chain game! (+${WIN_SCORE} points)\nTotal words played: ${game.accepted}\nLast word was <code>${esc(
          game.currentWord.toUpperCase(),
        )}</code>`,
        { parse_mode: "HTML" },
      )
      .catch(() => undefined);
    return;
  }

  if (game.idx >= game.players.length) game.idx = 0;

  await bot.api
    .sendMessage(
      game.chatId,
      `⏰ ${link(eliminated)} ran out of time and is OUT!\n${nextTurnText(game)}`,
      { parse_mode: "HTML" },
    )
    .catch(() => undefined);
  scheduleTurn(game);
};

const scheduleTurn = (game: ChainGame) => {
  if (game.timer) clearTimeout(game.timer);
  game.timer = setTimeout(() => {
    void eliminateCurrent(game).catch((error) =>
      console.error("Chain turn error:", error),
    );
  }, game.turnMs);
};

const handleAnswer = async (
  ctx: Context,
  game: ChainGame,
  guess: string,
) => {
  const player = game.players[game.idx];
  if (!ctx.from || ctx.from.id.toString() !== player.id) return;

  const { dict } = words();
  const tail = game.currentWord[game.currentWord.length - 1];

  if (!guess.startsWith(tail)) {
    return ctx.reply(
      `❌ <code>${esc(guess.toUpperCase())}</code> must start with <b>${tail.toUpperCase()}</b>!`,
      { parse_mode: "HTML" },
    );
  }
  if (guess.length < game.minLen) {
    return ctx.reply(
      `❌ Too short! Words need at least <b>${game.minLen}</b> letters now.`,
      { parse_mode: "HTML" },
    );
  }
  if (game.used.has(guess)) {
    return ctx.reply(
      `❌ <code>${esc(guess.toUpperCase())}</code> was already used in this game!`,
      { parse_mode: "HTML" },
    );
  }
  if (!dict.has(guess)) {
    return ctx.reply(
      `❌ <code>${esc(guess.toUpperCase())}</code> is not in my dictionary!`,
      { parse_mode: "HTML" },
    );
  }

  game.used.add(guess);
  game.currentWord = guess;
  game.accepted += 1;

  if (game.accepted % RAMP_EVERY === 0) {
    game.turnMs = Math.max(MIN_TURN_MS, game.turnMs - 5_000);
    game.minLen = Math.min(MAX_MIN_LEN, game.minLen + 1);
  }

  game.idx = (game.idx + 1) % game.players.length;
  scheduleTurn(game);

  const next = game.players[game.idx];
  return ctx.reply(
    `✅ ${link(player)} played <code>${esc(guess.toUpperCase())}</code>!\n➡️ ${link(next)} — words starting with <b>${esc(
      guess[guess.length - 1].toUpperCase(),
    )}</b>\n${nextTurnText(game)}`,
    { parse_mode: "HTML" },
  );
};

const beginPlay = async (game: ChainGame) => {
  if (game.status !== "joining") return;
  clearTimer(game);

  if (game.players.length < MIN_PLAYERS) {
    games.delete(game.chatId.toString());
    return bot.api
      .sendMessage(
        game.chatId,
        `❌ Not enough players joined (need at least ${MIN_PLAYERS}). Word Chain cancelled.`,
      )
      .catch(() => undefined);
  }

  const { dict, startPool } = words();
  game.players.sort(() => Math.random() - 0.5);
  const startWord = startPool[Math.floor(Math.random() * startPool.length)];
  game.status = "playing";
  game.currentWord = startWord;
  game.used.add(startWord);
  game.accepted = 0;
  game.minLen = INITIAL_MIN_LEN;
  game.turnMs = INITIAL_TURN_MS;
  game.idx = 0;

  const first = game.players[0];
  await bot.api
    .sendMessage(
      game.chatId,
      `🔗 <b>Word Chain begins!</b>\nStarting word: <code>${esc(
        startWord.toUpperCase(),
      )}</code>\n${link(first)} — send a word starting with <b>${esc(
        startWord[startWord.length - 1].toUpperCase(),
      )}</b>!\n${nextTurnText(game)}`,
      { parse_mode: "HTML" },
    )
    .catch(() => undefined);
  scheduleTurn(game);
};

const startChain = async (ctx: Context) => {
  const key = ctx.chat!.id.toString();
  if (games.has(key)) {
    return ctx.reply(
      "A Word Chain game is already running in this chat! Use /join to play.",
    );
  }

  const dbGame = await db
    .selectFrom("games")
    .selectAll()
    .where("activeChat", "=", key)
    .executeTakeFirst();
  if (dbGame) {
    return ctx.reply(
      "There is already a game in progress in this chat. Use /end to end the current game.",
    );
  }

  const name =
    `${ctx.from!.first_name || ""}${ctx.from!.last_name ? " " + ctx.from!.last_name : ""}`.trim() ||
    "Player";

  const game: ChainGame = {
    chatId: ctx.chat!.id,
    status: "joining",
    players: [],
    idx: 0,
    used: new Set(),
    currentWord: "",
    accepted: 0,
    minLen: INITIAL_MIN_LEN,
    turnMs: INITIAL_TURN_MS,
    timer: null,
    starterId: ctx.from!.id.toString(),
  };
  games.set(key, game);
  game.timer = setTimeout(() => {
    void beginPlay(game).catch((error) =>
      console.error("Chain begin error:", error),
    );
  }, JOIN_MS);

  return ctx.reply(
    `🔗 <b>Word Chain started!</b>\nType /join to play — need at least ${MIN_PLAYERS} players.\n⏳ Joining ends in <b>60 seconds</b>.\nHost: ${link({
      id: ctx.from!.id.toString(),
      name,
    })}`,
    { parse_mode: "HTML" },
  );
};

const canManage = async (ctx: Context, game: ChainGame) => {
  const uid = ctx.from!.id.toString();
  if (uid === game.starterId) return true;
  if (env.ADMIN_USERS.includes(ctx.from!.id)) return true;
  try {
    const member = await ctx.getChatMember(ctx.from!.id);
    return ["administrator", "creator"].includes(member.status);
  } catch {
    return false;
  }
};

composer.command("chain", startChain);
composer.command("startgame", startChain);

composer.command("join", async (ctx) => {
  const key = ctx.chat.id.toString();
  const game = games.get(key);
  if (!game) {
    return ctx.reply("No Word Chain game is running. Start one with /chain!");
  }
  if (game.status !== "joining") {
    return ctx.reply("The game already started — catch the next one!");
  }
  const id = ctx.from!.id.toString();
  if (game.players.some((p) => p.id === id)) {
    return ctx.reply("You already joined!");
  }
  if (game.players.length >= MAX_PLAYERS) {
    return ctx.reply("Player limit reached!");
  }
  const name =
    `${ctx.from!.first_name || ""}${ctx.from!.last_name ? " " + ctx.from!.last_name : ""}`.trim() ||
    "Player";
  game.players.push({ id, name });
  return ctx.reply(`🙋 ${esc(name)} joined! (${game.players.length} players)`);
});

composer.command("flee", async (ctx) => {
  const game = games.get(ctx.chat!.id.toString());
  if (!game) {
    return ctx.reply("No Word Chain game is running.");
  }
  if (game.status !== "joining") {
    return ctx.reply("You can only /flee during the joining phase.");
  }
  const id = ctx.from!.id.toString();
  const idx = game.players.findIndex((p) => p.id === id);
  if (idx === -1) return ctx.reply("You haven't joined!");
  game.players.splice(idx, 1);
  return ctx.reply(`🚪 ${esc(ctx.from!.first_name || "Player")} left the chain.`);
});

composer.command("forcestart", async (ctx) => {
  const game = games.get(ctx.chat.id.toString());
  if (!game || game.status !== "joining") {
    return ctx.reply("No joining phase is active.");
  }
  if (!(await canManage(ctx, game))) return;
  return beginPlay(game);
});

composer.command("killgame", async (ctx) => {
  const key = ctx.chat!.id.toString();
  const game = games.get(key);
  if (!game) return ctx.reply("No Word Chain game is running.");
  if (!(await canManage(ctx, game))) return;
  clearTimer(game);
  const suffix =
    game.status === "playing"
      ? ` Last word was <code>${esc(game.currentWord.toUpperCase())}</code>.`
      : "";
  games.delete(key);
  return ctx.reply(
    `🗑 Word Chain game ended by ${esc(ctx.from!.first_name || "admin")}.${suffix}`,
    { parse_mode: "HTML" },
  );
});

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  if (!/^[a-zA-Z]{1,100}$/.test(text)) return next();

  const game = games.get(ctx.chat.id.toString());
  if (!game || game.status !== "playing") return next();

  await handleAnswer(ctx, game, text.toLowerCase());
});

CommandsHelper.addNewCommand("chain", "Start a word chain game.");
CommandsHelper.addNewCommand("join", "Join a running word chain game.");

export const chainGame = composer;
