// © 2026 VIP-saksham · Wordraft Game Bot · All Rights Reserved.
import { db } from "../config/db";
import type { AllowedChatSearchKey, AllowedChatTimeKey } from "../types";

/** date_trunc jaisi time windows — project mein UTC server-based boundaries. */
export const timeWindowFor = (timeKey: AllowedChatTimeKey): Date | null => {
  if (timeKey === "all") return null;

  const now = new Date();

  if (timeKey === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (timeKey === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (timeKey === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return new Date(now.getFullYear(), 0, 1);
};

export async function getUserScores({
  chatId,
  searchKey,
  userId,
  timeKey,
}: {
  chatId: string;
  searchKey: AllowedChatSearchKey;
  userId: string;
  timeKey: AllowedChatTimeKey;
}) {
  let query = db.selectFrom("leaderboard").selectAll();

  if (searchKey === "group") query = query.where("chatId", "=", chatId);

  const windowStart = timeWindowFor(timeKey);
  if (windowStart) query = query.where("createdAt", ">", windowStart);

  const rows = (await query.execute()) as unknown as {
    userId: string;
    score: number;
  }[];

  // Mongo me aggregation ki jaga values ko code me hi sum + rank karte hain.
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.userId, (totals.get(row.userId) ?? 0) + Number(row.score));
  }

  if (!totals.has(userId)) return undefined;

  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  let rank = 1;
  let previousScore = Number.POSITIVE_INFINITY;
  for (const [index, [candidate, total]] of ranked.entries()) {
    if (total < previousScore) rank = index + 1;
    if (candidate === userId) break;
    previousScore = total;
  }

  const user = await db
    .selectFrom("users")
    .selectAll()
    .where("id", "=", userId)
    .executeTakeFirst();

  return {
    id: userId,
    name: user?.name || userId,
    username: user?.username || null,
    totalScore: totals.get(userId) ?? 0,
    rank,
  };
}
