import { Composer } from "grammy";

import { env } from "../config/env";
import { redis } from "../config/redis";
import { REGISTERED_GROUPS_KEY } from "../util/auto-pattern";

const composer = new Composer();

const SEND_GAP_MS = 150;

composer.command("broadcast", async (ctx) => {
  if (!ctx.from) return;
  if (!env.ADMIN_USERS.includes(ctx.from.id)) return;
  if (ctx.chat.type !== "private") return;

  const replyTarget = ctx.message?.reply_to_message;
  const args = ctx.match.trim();

  if (!replyTarget && !args) {
    return ctx.reply(
      "📡 Usage: /broadcast <message>\nYa kisi message ko reply karke /broadcast bhejo.",
    );
  }

  const targets = await redis
    .smembers(REGISTERED_GROUPS_KEY)
    .catch(() => []);

  if (targets.length === 0) {
    return ctx.reply("Abhi koi group registered nahi hai.");
  }

  await ctx.reply(`📡 Broadcasting to ${targets.length} groups...`);

  let sent = 0;
  let failed = 0;

  for (const chatId of targets) {
    try {
      if (replyTarget) {
        await ctx.api.copyMessage(
          Number(chatId),
          ctx.chat.id,
          replyTarget.message_id,
        );
      } else {
        await ctx.api.sendMessage(Number(chatId), args);
      }
      sent++;
    } catch (error) {
      failed++;
      console.error(`Broadcast failed for ${chatId}:`, error);
    }

    await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
  }

  return ctx.reply(`✅ Broadcast complete: ${sent} sent, ${failed} failed.`);
});

export const broadcastCommand = composer;
