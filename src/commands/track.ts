// © 2026 VIP-saksham · Wordraft Game Bot · All Rights Reserved.
// Track/untrack ab MongoDB me store hota hai — Redis ka chakkar nahi.
import { Composer } from "grammy";

import { db } from "../config/db";
import { env } from "../config/env";

const composer = new Composer();

composer.command("track", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  if (!env.ADMIN_USERS.includes(ctx.from.id)) return;

  const chatId = ctx.match.trim();
  if (!chatId) {
    return ctx.reply("Usage: /track <chat_id>");
  }

  const existingTracking = await db.getTracking(chatId);

  if (existingTracking) {
    return ctx.reply(`⚠️ Chat ${chatId} is already being tracked`);
  }

  await db.setTracking(chatId, ctx.chat.id.toString());

  await ctx.reply(
    `✅ Now tracking chat: ${chatId}\nAll messages will be forwarded here.`,
  );
});

composer.command("untrack", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  if (!env.ADMIN_USERS.includes(ctx.from.id)) return;

  const chatId = ctx.match.trim();
  if (!chatId) {
    return ctx.reply("Usage: /untrack <chat_id>");
  }

  const deleted = await db.deleteTracking(chatId);

  if (!deleted) {
    return ctx.reply(`⚠️ Chat ${chatId} is not being tracked`);
  }

  await ctx.reply(`✅ Stopped tracking chat: ${chatId}`);
});

composer.command("tracklist", async (ctx) => {
  if (!ctx.from || ctx.chat.type !== "private") return;
  if (!env.ADMIN_USERS.includes(ctx.from.id)) return;

  const tracked = await db.listTracking();

  if (tracked.length === 0) {
    return ctx.reply("No chats are currently being tracked");
  }

  const trackedChats = tracked
    .map((entry) => `${entry.chatId} → ${entry.adminChatId}`)
    .join("\n");
  await ctx.reply(`📋 Currently tracking:\n${trackedChats}`);
});

export const trackCommand = composer;
