// © 2026 VIP-saksham · Wordraft Game Bot · All Rights Reserved.
import { Composer } from "grammy";

import { db } from "../config/db";

const composer = new Composer();

composer.use(async (ctx, next) => {
  try {
    const user = ctx.from;
    if (!user || user.is_bot) {
      return next();
    }

    const userId = user.id.toString();
    const userName =
      user.first_name + (user.last_name ? " " + user.last_name : "");
    const userUsername = user.username || null;

    (async () => {
      try {
        const result = await db.upsertUser({
          id: userId,
          name: userName,
          username: userUsername,
        });

        if (result.modifiedCount === 0 && result.upsertedCount === 0) {
          await db.upsertUser({ id: userId, name: userName, username: userUsername });
        }
      } catch (error) {
        console.error("Error in user sync:", error);
      }
    })();
  } catch (error) {
    console.error("Error in user sync middleware:", error);
  }

  return next();
});

export const userSyncHandler = composer;
