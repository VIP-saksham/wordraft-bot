// © 2026 VIP-saksham · Wordraft Game Bot · All Rights Reserved.
import { Bot } from "grammy";

import { env } from "./env";

export const bot = new Bot(env.BOT_TOKEN, {
  client: { apiRoot: env.CUSTOM_API_ROOT },
});
