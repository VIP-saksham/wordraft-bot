// © 2026 VIP-saksham · Wordraft Game Bot · All Rights Reserved.
/**
 * One-time migration: legacy Postgres (VPS-local) + Redis data  =>  MongoDB Atlas.
 *
 * Usage (on the VPS):
 *   cd /root/WordSeek
 *   MONGO_URI="mongodb+srv://..." bun scripts/migrate-to-mongo.cjs
 *
 * Reads DATABASE_URL from the existing .env of the project (before switchover).
 */

const fs = require("fs");
const path = require("path");

const { MongoClient } = require("mongodb");
const { Pool } = require("pg");
const IORedis = require("ioredis");

const PROJECT_ROOT = path.join(__dirname, "..");

// ---------- env loading ----------
function readEnvFile() {
  const raw = fs.readFileSync(path.join(PROJECT_ROOT, ".env"), "utf8");
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const envFile = readEnvFile();
const MONGO_URI = process.env.MONGO_URI || envFile.MONGO_URI;
const DATABASE_URL = process.env.DATABASE_URL || envFile.DATABASE_URL;
const REDIS_URI = process.env.REDIS_URI || envFile.REDIS_URI || "redis://127.0.0.1:6379";

if (!MONGO_URI) {
  console.error("MONGO_URI missing — pass as env or set in .env");
  process.exit(1);
}

// ---------- helpers ----------
const camelize = (key) =>
  key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

const convertRow = (row) => {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "id") out.id = value;
    else out[camelize(key)] = value;
  }
  return out;
};

function fixTimestamps(doc) {
  for (const key of ["createdAt", "updatedAt"]) {
    if (doc[key]) doc[key] = new Date(doc[key]);
  }
  return doc;
}

/** collection upsert by business key (Postgres id / natural keys preserve ho rahe hain) */
const upsertBy = async (collection, rows, keyFn) => {
  let count = 0;
  for (const row of rows) {
    const doc = fixTimestamps(convertRow(row));
    const filter = keyFn(doc);
    try {
      await collection.updateOne(filter, { $set: doc }, { upsert: true });
      count++;
    } catch (error) {
      console.error(`  insert fail (${filter}):`, error.message);
    }
  }
  return count;
};

async function tryTable(pool, name, query) {
  try {
    const { rows } = await pool.query(query);
    return rows;
  } catch (error) {
    console.log(`  (!) Postgres table "${name}" skip: ${error.message.split("\n")[0]}`);
    return null;
  }
}

async function main() {
  let sharedMongo;
  try {
    sharedMongo = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    await sharedMongo.connect();
    await sharedMongo.db().command({ ping: 1 });
    console.log("Atlas connected ✓");
  } catch (error) {
    console.error("Atlas connect FAILED:", error.message);
    process.exit(1);
  }

  const mongo = sharedMongo.db("wordseek");
  const gamesCol = mongo.collection("games");
  const guessesCol = mongo.collection("guesses");
  const leaderboardCol = mongo.collection("leaderboard");
  const usersCol = mongo.collection("users");
  const bannedCol = mongo.collection("bannedUsers");
  const authorizedCol = mongo.collection("authorizedUsers");
  const topicsCol = mongo.collection("chatGameTopics");
  const counters = mongo.collection("counters");

  // ---------- Postgres ----------
  if (DATABASE_URL) {
    const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
    try {
      console.log("Reading Postgres tables...");

      const users = await tryTable(pool, "users", "SELECT * FROM users");
      if (users) {
        console.log(`users: ${users.length} rows`);
        await upsertBy(usersCol, users, (doc) => ({ id: doc.id }));
      }

      const leaderboard = await tryTable(pool, "leaderboard", "SELECT * FROM leaderboard");
      if (leaderboard) {
        console.log(`leaderboard: ${leaderboard.length} rows`);
        await upsertBy(leaderboardCol, leaderboard, (doc) => ({ id: doc.id }));
      }

      const games = await tryTable(pool, "games", "SELECT * FROM games");
      if (games) {
        console.log(`games: ${games.length} rows`);
        await upsertBy(gamesCol, games, (doc) => ({ id: doc.id }));
      }

      const guesses = await tryTable(pool, "guesses", "SELECT * FROM guesses");
      if (guesses) {
        console.log(`guesses: ${guesses.length} rows`);
        await upsertBy(guessesCol, guesses, (doc) => ({ id: doc.id }));
      }

      const bannedUsers = await tryTable(pool, "banned_users", "SELECT * FROM banned_users");
      if (bannedUsers) {
        console.log(`bannedUsers: ${bannedUsers.length} rows`);
        await upsertBy(bannedCol, bannedUsers, (doc) => ({ userId: doc.userId }));
      }

      const authorizedUsers = await tryTable(
        pool,
        "authorized_users",
        "SELECT * FROM authorized_users",
      );
      if (authorizedUsers && authorizedUsers.length > 0) {
        console.log(`authorizedUsers: ${authorizedUsers.length} rows`);
        await upsertBy(authorizedCol, authorizedUsers, (doc) => ({
          chatId: doc.chatId,
          userId: doc.userId,
        }));
      }

      const topics = await tryTable(
        pool,
        "chat_game_topics",
        "SELECT * FROM chat_game_topics",
      );
      if (topics && topics.length > 0) {
        console.log(`chatGameTopics: ${topics.length} rows`);
        await upsertBy(topicsCol, topics, (doc) => ({
          chatId: doc.chatId,
          topicId: doc.topicId,
        }));
      }

      // ---------- counters seed ----------
      for (const [colName, collection] of [
        ["games", gamesCol],
        ["guesses", guessesCol],
        ["leaderboard", leaderboardCol],
      ]) {
        const maxId = await collection
          .find({ id: { $exists: true } })
          .sort({ id: -1 })
          .limit(1)
          .toArray();
        const seq = maxId.length ? Number(maxId[0].id) : 0;
        await counters.updateOne(
          { _id: colName },
          { $set: { seq } },
          { upsert: true },
        );
        console.log(`counters/${colName} seeded at ${seq}`);
      }
    } finally {
      await pool.end().catch(() => undefined);
    }
  } else {
    console.log("No DATABASE_URL in .env — Postgres skip.");
  }

  // ---------- Redis ----------
  try {
    const redis = new IORedis(REDIS_URI, { maxRetriesPerRequest: 1, retryStrategy: () => null });
    await new Promise((resolve) => {
      if (redis.status === "connecting" || redis.status === "connect") {
        redis.once("ready", resolve);
        redis.once("error", resolve);
        setTimeout(resolve, 5000);
      } else {
        setTimeout(resolve, 1000);
      }
    });

    // registeredGroups set -> collection
    try {
      const groups = await redis.smembers("registeredGroups");
      for (const chatId of groups) {
        await mongo
          .collection("registeredGroups")
          .updateOne(
            { _id: chatId },
            { $set: { registeredAt: new Date() } },
            { upsert: true },
          );
      }
      console.log(`registeredGroups: ${groups.length}`);
    } catch (error) {
      console.log("registeredGroups skip:", error.message);
    }

    // word history h:* -> wordHistory docs
    try {
      const hKeys = await redis.keys("h:*");
      for (const key of hKeys) {
        const words = await redis.smembers(key);
        await mongo
          .collection("wordHistory")
          .updateOne(
            { _id: key },
            { $set: { words, updatedAt: new Date() } },
            { upsert: true },
          );
      }
      console.log(`wordHistory chats: ${hKeys.length}`);
    } catch (error) {
      console.log("wordHistory skip:", error.message);
    }

    // tracking:* -> tracking docs
    try {
      const tKeys = await redis.keys("tracking:*");
      let n = 0;
      for (const key of tKeys) {
        const adminChatId = await redis.get(key);
        if (adminChatId) {
          await mongo
            .collection("tracking")
            .updateOne(
              { _id: key.replace("tracking:", "") },
              { $set: { adminChatId, createdAt: new Date() } },
              { upsert: true },
            );
          n++;
        }
      }
      console.log(`tracking keys: ${n}`);
    } catch (error) {
      console.log("tracking skip:", error.message);
    }

    // settings:* -> settings docs (logs GC, etc.)
    try {
      const sKeys = await redis.keys("settings:*");
      let n = 0;
      for (const key of sKeys) {
        const value = await redis.get(key);
        if (value !== null) {
          await mongo
            .collection("settings")
            .updateOne(
              { key: key.replace("settings:", "") },
              { $set: { value } },
              { upsert: true },
            );
          n++;
        }
      }
      console.log(`settings keys: ${n}`);
    } catch (error) {
      console.log("settings skip:", error.message);
    }

    redis.disconnect();
  } catch (error) {
    console.log("Redis migration skipped:", error.message);
  }

  // ---------- summary ----------
  console.log("Collection counts:");
  for (const name of [
    "users",
    "leaderboard",
    "games",
    "guesses",
    "bannedUsers",
    "authorizedUsers",
    "chatGameTopics",
    "registeredGroups",
    "wordHistory",
    "tracking",
    "settings",
  ]) {
    const count = await mongo
      .collection(name)
      .countDocuments()
      .catch(() => 0);
    console.log(`  ${name}: ${count}`);
  }
  console.log("Migration complete ✓");
  await sharedMongo.close();
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
