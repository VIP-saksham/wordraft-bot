import { Composer } from "grammy";

import { banCommand } from "./ban-user";
import { broadcastCommand } from "./broadcast";
import { chainGame } from "./chain-game";
import { endGameCommand } from "./end-game";
import { helpCommand } from "./help";
import { leaderboardCommand } from "./leaderboard";
import { logCommand } from "./log";
import { myScoreCommand } from "./my-score";
import { newGameCommand } from "./new-game";
import { patternGame } from "./pattern-game";
import { scrambleGame } from "./scramble-game";
import { scoreCommand } from "./score";
import { seekAuthCommand } from "./seekauth";
import { setGameTopicCommand } from "./setgametopic";
import { startCommand } from "./start";
import { startMatchCommand } from "./startmatch";
import { statsCommand } from "./stats";
import { trackCommand } from "./track";
import { unbanCommand } from "./unban-user";
import { unsetGameTopicCommand } from "./unsetgametopic";

const composer = new Composer();

composer.use(
  startCommand,
  helpCommand,
  newGameCommand,
  endGameCommand,
  chainGame,
  patternGame,
  myScoreCommand,
  statsCommand,
  banCommand,
  unbanCommand,
  leaderboardCommand,
  scoreCommand,
  seekAuthCommand,
  startMatchCommand,
  setGameTopicCommand,
  unsetGameTopicCommand,
  trackCommand,
  logCommand,
  broadcastCommand,
  scrambleGame,
);

export const commands = composer;
