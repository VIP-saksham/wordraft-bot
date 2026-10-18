import { Composer } from "grammy";

import { FOOTER_MESSAGE } from "../config/constants";

const composer = new Composer();

composer.on("my_chat_member", async (ctx) => {
  const botStatusInGroup = ctx.myChatMember.new_chat_member.status;

  if (botStatusInGroup === "left" || botStatusInGroup === "kicked") return;

  await ctx.reply(
    `<blockquote>Hey! Thanks for adding me to the group. 😊</blockquote>

To function properly, I need to be able to read messages. Please make me an <strong>administrator</strong> with the least privileges possible—just enough to read messages.

If I (<strong>@Wordriftbot</strong>) stop working for a while, feel free to remove me and add me back instead.

${FOOTER_MESSAGE}`,
    { parse_mode: "HTML" },
  );
});

export const onBotAddedInChat = composer;
