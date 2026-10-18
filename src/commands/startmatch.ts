// © 2026 VIP-saksham · Wordraft Game Bot · All Rights Reserved.
import { Composer } from "grammy";

import { CommandsHelper } from "../util/commands-helper";

const composer = new Composer();

composer.command("startmatch", async (ctx) => {});

// CommandsHelper.addNewCommand("startmatch", "Start a new game.");

export const startMatchCommand = composer;
