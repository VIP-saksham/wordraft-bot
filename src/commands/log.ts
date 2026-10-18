import { Composer } from "grammy";

import { env } from "../config/env";
import { deleteSetting, getSetting, setSetting } from "../config/settings";

const composer = new Composer();

export const LOG_SETTING_KEY = "logsGC";

/** Resolves the log chat: env.LOGS_CHANNEL first, then owner-set /log GC. */
export const resolveLogsChat = async (): Promise<number | undefined> => {
  if (env.LOGS_CHANNEL) return env.LOGS_CHANNEL;

  const setting = await getSetting(LOG_SETTING_KEY);
  return setting ? Number(setting) : undefined;
};

const getLogHint = () =>
  `• /log in the group — set it as log GC\n` +
  `• /log status — show current log GC\n` +
  `• /log off — remove the log GC`;

composer.command("log", async (ctx) => {
  if (!ctx.from) return;
  if (!env.ADMIN_USERS.includes(ctx.from.id)) return;

  const args = ctx.match.trim().toLowerCase();

  if (args === "off" || args === "unset") {
    const existing = await getSetting(LOG_SETTING_KEY);
    if (!existing) {
      return ctx.reply("⚠️ No log GC is currently set.");
    }
    await deleteSetting(LOG_SETTING_KEY);
    return ctx.reply("✅ Log GC removed.");
  }

  const isGroup = ctx.chat.type === "group" || ctx.chat.type === "supergroup";

  if (isGroup && args !== "status") {
    // Owner ran /log inside a group — set it as the log GC.
    await setSetting(LOG_SETTING_KEY, ctx.chat.id.toString());

    try {
      await ctx.api.sendMessage(
        ctx.chat.id,
        `🪵 <b>Log GC set by owner.</b>\nChat ID: <code>${ctx.chat.id}</code>`,
        {
          parse_mode: "HTML",
          reply_parameters: { message_id: ctx.message?.message_id },
        },
      );
    } catch (error) {
      await deleteSetting(LOG_SETTING_KEY);
      console.error("Failed to confirm log GC:", error);
      return ctx.reply(
        "⚠️ Could not post in this group. Check that I am a member.",
      );
    }
    return;
  }

  const existing = await getSetting(LOG_SETTING_KEY);

  if (!existing) {
    return ctx.reply(`🪵 No log GC is set yet.\n${getLogHint()}`);
  }

  return ctx.reply(
    `📋 Current log GC: <code>${existing}</code>\n${getLogHint()}`,
    { parse_mode: "HTML" },
  );
});

export const logCommand = composer;
