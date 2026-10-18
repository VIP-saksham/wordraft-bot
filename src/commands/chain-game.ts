// © 2026 VIP-saksham · Wordraft Game Bot · All Rights Reserved.
import { Composer, Context } from "grammy";

import { readFileSync } from "fs";
import { join } from "path";

import { bot } from "../config/bot";
import { db } from "../config/db";
import { env } from "../config/env";
import { CommandsHelper } from "../util/commands-helper";

const composer = new Composer();

// Timings per spec: 45s turns, +1 length every 2 words, -10s every 4 words.
const JOIN_MS = 60_000;
const EXTEND_MS = 30_000;
const MAX_JOIN_MS = 180_000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 50;
const INITIAL_TURN_MS = 45_000;
const MIN_TURN_MS = 15_000;
const INITIAL_MIN_LEN = 3;
const MAX_MIN_LEN = 10;
const WIN_SCORE = 30;

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

type ChainPlayer = { id: string; name: string };

interface ChainGame {
  chatId: number;
  status: "joining" | "playing";
  players: ChainPlayer[];
  idx: number;
  used: Set<string>;
  currentWord: string; // "" => bag start-letter phase
  requiredLetter: string;
  accepted: number;
  minLen: number;
  turnMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  joinDeadlineMs: number;
  joinTimer: ReturnType<typeof setTimeout> | null;
  starterId: string;
}

const games = new Map<string, ChainGame>();

let wordsCache: { dict: Set<string>; pool: string[] } | null = null;

const words = () => {
  if (!wordsCache) {
    const txt = readFileSync(
      join(process.cwd(), "src", "data", "words_alpha.txt"),
      "utf8",
    );
    const dict = new Set<string>();
    const pool: string[] = [];
    for (const raw of txt.split(/\r?\n/)) {
      const w = raw.trim().toLowerCase();
      if (!/^[a-z]{3,15}$/.test(w)) continue;
      dict.add(w);
      if (w.length <= 7) pool.push(w);
    }
    wordsCache = { dict, pool };
  }
  return wordsCache;
};

const esc = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const link = (p: ChainPlayer) =>
  `<a href="tg://user?id=${p.id}">${esc(p.name)}</a>`;

const clearTimers = (game: ChainGame) => {
  if (game.timer) {
    clearTimeout(game.timer);
    game.timer = null;
  }
  if (game.joinTimer) {
    clearTimeout(game.joinTimer);
    game.joinTimer = null;
  }
};

const turnRuleText = (game: ChainGame) =>
  `(start with <b>${game.requiredLetter.toUpperCase()}</b> · min ${game.minLen} letters · ⏱ ${Math.round(
    game.turnMs / 1000,
  )}s)`;

const eliminateCurrent = async (game: ChainGame) => {
  const eliminated = game.players[game.idx];
  game.players.splice(game.idx, 1);

  if (game.players.length === 1) {
    const winner = game.players[0];
    clearTimers(game);
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
        `🏆 ${link(winner)} wins the Word Chain game! (+${WIN_SCORE} points)\nTotal words played: ${game.accepted}${
          game.currentWord
            ? `\nLast word was <code>${esc(game.currentWord.toUpperCase())}</code>`
            : ""
        }`,
        { parse_mode: "HTML" },
      )
      .catch(() => undefined);
    return;
  }

  if (game.idx >= game.players.length) game.idx = 0;

  await bot.api
    .sendMessage(
      game.chatId,
      `⏰ ${link(eliminated)} ran out of time and is OUT!\n➡️ ${link(
        game.players[game.idx],
      )} — ${turnRuleText(game)}`,
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

/** Invalid word => the turn is skipped to the next player (per game rules). */
const skipTurn = async (game: ChainGame) => {
  game.idx = (game.idx + 1) % game.players.length;
  scheduleTurn(game);
  const next = game.players[game.idx];
  return bot.api
    .sendMessage(
      game.chatId,
      `↪️ Turn skipped — ${link(next)}, you're up! ${turnRuleText(game)}`,
      { parse_mode: "HTML" },
    )
    .catch(() => undefined);
};

const handleAnswer = async (ctx: Context, game: ChainGame, guess: string) => {
  const player = game.players[game.idx];
  if (!ctx.from || ctx.from.id.toString() !== player.id) return;

  const { dict } = words();

  if (!guess.startsWith(game.requiredLetter)) {
    await ctx.reply(
      `❌ <code>${esc(guess.toUpperCase())}</code> must start with <b>${game.requiredLetter.toUpperCase()}</b>!`,
      { parse_mode: "HTML" },
    );
    return void (await skipTurn(game));
  }
  if (guess.length < game.minLen) {
    await ctx.reply(
      `❌ Too short! Words need at least <b>${game.minLen}</b> letters now.`,
      { parse_mode: "HTML" },
    );
    return void (await skipTurn(game));
  }
  if (game.used.has(guess)) {
    await ctx.reply(
      `❌ <code>${esc(guess.toUpperCase())}</code> was already used in this game!`,
      { parse_mode: "HTML" },
    );
    return void (await skipTurn(game));
  }
  if (!dict.has(guess)) {
    await ctx.reply(
      `❌ <code>${esc(guess.toUpperCase())}</code> is not in my dictionary!`,
      { parse_mode: "HTML" },
    );
    return void (await skipTurn(game));
  }

  game.used.add(guess);
  game.currentWord = guess;
  game.accepted += 1;
  game.requiredLetter = guess[guess.length - 1];

  // Length +1 per 2 words; time -10s per 4 words.
  game.minLen = Math.min(MAX_MIN_LEN, INITIAL_MIN_LEN + Math.floor(game.accepted / 2));
  game.turnMs = Math.max(MIN_TURN_MS, INITIAL_TURN_MS - 10_000 * Math.floor(game.accepted / 4));

  game.idx = (game.idx + 1) % game.players.length;
  scheduleTurn(game);

  const next = game.players[game.idx];
  return ctx.reply(
    `✅ ${link(player)} played <code>${esc(guess.toUpperCase())}</code>!\n➡️ ${link(next)} — ${turnRuleText(game)}`,
    { parse_mode: "HTML" },
  );
};

const beginPlay = async (game: ChainGame) => {
  if (game.status !== "joining") return;
  if (game.joinTimer) {
    clearTimeout(game.joinTimer);
    game.joinTimer = null;
  }

  if (game.players.length < MIN_PLAYERS) {
    games.delete(game.chatId.toString());
    return bot.api
      .sendMessage(
        game.chatId,
        `❌ Not enough players joined (need at least ${MIN_PLAYERS}). Word Chain cancelled.`,
      )
      .catch(() => undefined);
  }

  const { dict } = words();
  game.players.sort(() => Math.random() - 0.5);
  game.status = "playing";
  game.currentWord = "";
  game.accepted = 0;
  game.minLen = INITIAL_MIN_LEN;
  game.turnMs = INITIAL_TURN_MS;
  game.idx = 0;
  game.requiredLetter =
    LETTERS[Math.floor(Math.random() * LETTERS.length)]!;

  // Seed the used-set minimally so the opening letter always has options.
  void dict;

  const first = game.players[0];
  await bot.api
    .sendMessage(
      game.chatId,
      `🔗 <b>Word Chain begins!</b>\nThe first word must start with <b>${game.requiredLetter.toUpperCase()}</b> (min ${game.minLen} letters).\n${link(
        first,
      )} — send a word now!\n⏱ You have ${Math.round(game.turnMs / 1000)}s per turn.`,
      { parse_mode: "HTML" },
    )
    .catch(() => undefined);
  scheduleTurn(game);
};

const scheduleJoin = (game: ChainGame) => {
  if (game.joinTimer) clearTimeout(game.joinTimer);
  const remaining = Math.max(1000, game.joinDeadlineMs - Date.now());
  game.joinTimer = setTimeout(() => {
    void beginPlay(game).catch((error) =>
      console.error("Chain begin error:", error),
    );
  }, remaining);
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
    requiredLetter: "",
    accepted: 0,
    minLen: INITIAL_MIN_LEN,
    turnMs: INITIAL_TURN_MS,
    timer: null,
    joinDeadlineMs: Date.now() + JOIN_MS,
    joinTimer: null,
    starterId: ctx.from!.id.toString(),
  };
  games.set(key, game);
  scheduleJoin(game);

  return ctx.reply(
    `🔗 <b>Classic Word Chain started!</b>\nType /join to play — need at least ${MIN_PLAYERS} players.\n⏳ Game starts in <b>60 seconds</b> (use /extend to add 30s).\nHost: ${link({
      id: ctx.from!.id.toString(),
      name,
    })}`,
    { parse_mode: "HTML" },
  );
};

const canManage = async (ctx: Context, starterId: string) => {
  const isStarter = ctx.from!.id.toString() === starterId;
  const isSystemAdmin = env.ADMIN_USERS.includes(ctx.from!.id);
  if (isStarter || isSystemAdmin) return isStarter || isSystemAdmin;
  try {
    const member = await ctx.getChatMember(ctx.from!.id);
    return ["administrator", "creator"].includes(member.status);
  } catch {
    return false;
  }
};

composer.command("chain", startChain);
composer.command("startclassic", startChain);
composer.command("startgame", startChain);

composer.command("join", async (ctx) => {
  const game = games.get(ctx.chat!.id.toString());
  if (!game) {
    return ctx.reply("No Word Chain game is running. Start one with /startclassic!");
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

composer.command("extend", async (ctx) => {
  const game = games.get(ctx.chat!.id.toString());
  if (!game || game.status !== "joining") {
    return ctx.reply("No joining phase is active right now.");
  }

  const remainingMs = game.joinDeadlineMs - Date.now();
  if (remainingMs >= MAX_JOIN_MS) {
    return ctx.reply("⌛ The countdown can't be extended any further.");
  }

  game.joinDeadlineMs = Date.now() + remainingMs + EXTEND_MS;
  scheduleJoin(game);
  return ctx.reply(
    `⏳ Countdown extended by 30s — now ${Math.round(
      (game.joinDeadlineMs - Date.now()) / 1000,
    )}s remaining.`,
  );
});

composer.command("forcestart", async (ctx) => {
  const game = games.get(ctx.chat!.id.toString());
  if (!game || game.status !== "joining") {
    return ctx.reply("No joining phase is active.");
  }
  // Starter only, per game rules.
  if (ctx.from!.id.toString() !== game.starterId) return;
  return beginPlay(game);
});

composer.command("killgame", async (ctx) => {
  const key = ctx.chat!.id.toString();
  const game = games.get(key);
  if (!game) return ctx.reply("No Word Chain game is running.");
  if (!(await canManage(ctx, game.starterId))) return;
  clearTimers(game);
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

  const game = games.get(ctx.chat!.id.toString());
  if (!game || game.status !== "playing") return next();

  await handleAnswer(ctx, game, text.toLowerCase());
});

CommandsHelper.addNewCommand("chain", "Start a word chain game.");
CommandsHelper.addNewCommand("join", "Join a running word chain game.");

export const chainGame = composer;
