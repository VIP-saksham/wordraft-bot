// © 2026 VIP-saksham · Wordraft Game Bot · All Rights Reserved.
import { db } from "../config/db";

import { timeWindowFor } from "./get-user-scores";

export async function getLeaderboardScores({
  chatId,
  searchKey,
  timeKey,
}: {
  chatId: string;
  searchKey: "group" | "global";
  timeKey: "today" | "week" | "month" | "year" | "all";
}) {
  let query = db.selectFrom("leaderboard").selectAll();

  if (searchKey === "group") query = query.where("chatId", "=", chatId);

  const windowStart = timeWindowFor(timeKey);
  if (windowStart) query = query.where("createdAt", ">", windowStart);

  const rows = (await query.execute()) as unknown as {
    userId: string;
    score: number;
  }[];

  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.userId, (totals.get(row.userId) ?? 0) + Number(row.score));
  }

  const top = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  if (top.length === 0) return [];

  const userDocs = (await db
    .selectFrom("users")
    .selectAll()
    .where(
      "id",
      "in",
      top.map(([id]) => id),
    )
    .execute()) as unknown as {
    id: string;
    name: string;
    username: string | null;
  }[];

  const userMap = new Map(userDocs.map((user) => [user.id, user]));

  return top.map(([userId, totalScore]) => ({
    userId,
    name: userMap.get(userId)?.name || userId,
    username: userMap.get(userId)?.username || null,
    totalScore,
  }));
}
