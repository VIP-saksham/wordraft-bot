// © 2026 VIP-saksham · Wordraft Game Bot · All Rights Reserved.
import {
  Collection,
  MongoClient,
  MongoServerError,
  type UpdateResult,
  type WithId,
} from "mongodb";

import { env } from "./env";

const DB_NAME = "wordseek";

let client: MongoClient | null = null;
let dbInstance: ReturnType<MongoClient["db"]> | null = null;
let indexesPromise: Promise<void> | null = null;

/** Kysely (Postgres) se MongoDB pe shift hone ke baad table-collections ka naam same rakha gaya hai. */
export interface TableDocs {
  games: {
    id: number;
    word: string;
    activeChat: string;
    startedBy: string | null;
    type: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  guesses: {
    id: number;
    gameId: number;
    guess: string;
    chatId: string;
    createdAt: Date;
    updatedAt: Date;
  };
  leaderboard: {
    id: number;
    userId: string;
    chatId: string;
    score: number;
    createdAt: Date;
    updatedAt: Date;
  };
  users: {
    id: string;
    name: string;
    username: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  bannedUsers: {
    userId: string;
    createdAt: Date;
    updatedAt: Date;
  };
  authorizedUsers: {
    chatId: string;
    userId: string;
    authorizedBy: string;
    createdAt: Date;
    updatedAt: Date;
  };
  chatGameTopics: {
    chatId: string;
    topicId: string;
    createdAt: Date;
    updatedAt: Date;
  };
}

export type TableKey = keyof TableDocs;

interface TableMeta {
  counters: boolean; // numeric id auto-increment
  hasIdField: boolean; // doc ke andar bhi id field store karo (users ka id telegram id hota hai)
  uniqueKeys?: string[][]; // unique compound keys (duplicate -> "23505" style error)
}

const TABLE_META: Record<TableKey, TableMeta> = {
  games: {
    counters: true,
    hasIdField: true,
    uniqueKeys: [["activeChat"]],
  },
  guesses: { counters: true, hasIdField: true },
  leaderboard: { counters: true, hasIdField: true },
  users: { counters: false, hasIdField: true },
  bannedUsers: { counters: false, hasIdField: false, uniqueKeys: [["userId"]] },
  authorizedUsers: {
    counters: false,
    hasIdField: false,
    uniqueKeys: [["chatId", "userId"]],
  },
  chatGameTopics: {
    counters: false,
    hasIdField: false,
    uniqueKeys: [["chatId", "topicId"]],
  },
};

export const safeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ts-prune-style: any needed here — mongo _id can be ObjectId | string | number
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyRecord = Record<string, any>;

/** Mongo typing `_id` ko ObjectId samajhta hai — string `_id` ke filters ko yahin cast karte hain. */
const idFilter = (id: unknown): any => ({ _id: id });

const collection = (name: TableKey | string): Collection<AnyRecord> | null => {
  if (!env.MONGO_URI) return null;
  if (!client) {
    client = new MongoClient(env.MONGO_URI, {
      serverSelectionTimeoutMS: 10_000,
    });
    dbInstance = client.db(DB_NAME);
    if (!indexesPromise) {
      indexesPromise = ensureIndexes();
    }
  }
  return dbInstance!.collection<AnyRecord>(name);
};

const getCollection = (name: string): Collection<AnyRecord> => {
  const col = collection(name);
  if (!col) throw new Error("MONGO_URI is not configured");
  return col;
};

export const getMongoCollection = (
  name: string,
): Collection<AnyRecord> => {
  if (!env.MONGO_URI) throw new Error("MONGO_URI is not configured");
  if (!client) {
    client = new MongoClient(env.MONGO_URI, {
      serverSelectionTimeoutMS: 10_000,
    });
    dbInstance = client.db(DB_NAME);
    if (!indexesPromise) {
      indexesPromise = ensureIndexes();
    }
  }
  return dbInstance!.collection<AnyRecord>(name);
};

async function ensureIndexes(): Promise<void> {
  try {
    const db = dbInstance!;
    await db
      .collection("games")
      .createIndex({ activeChat: 1 }, { unique: true });
    await db
      .collection("guesses")
      .createIndex({ gameId: 1 }, { background: true });
    await db
      .collection("leaderboard")
      .createIndex({ userId: 1, chatId: 1, createdAt: 1 }, { background: true });
    await db
      .collection("users")
      .createIndex({ username: 1 }, { background: true });
    await db
      .collection("votes")
      .createIndex({ createdAt: 1 }, { expireAfterSeconds: 300 });
  } catch (error) {
    console.error("MongoDB index create error:", error);
  }
}

const stripId = <T>(doc: WithId<AnyRecord>) => {
  const copy: Record<string, unknown> = { ...doc };
  delete copy._id;
  return copy as unknown as T;
};

type WhereOperator = "=" | "!=" | "<" | ">" | "<=" | ">=" | "in" | "like";

const buildCondition = (
  key: string,
  op: WhereOperator,
  value: unknown,
): Record<string, unknown> => {
  switch (op) {
    case "=":
      return { [key]: value };
    case "!=":
      return { [key]: { $ne: value } };
    case "<":
      return { [key]: { $lt: value } };
    case ">":
      return { [key]: { $gt: value } };
    case "<=":
      return { [key]: { $lte: value } };
    case ">=":
      return { [key]: { $gte: value } };
    case "in":
      return { [key]: { $in: value } };
    case "like": {
      const pattern = String(value);
      const regexSource = `^${safeRegex(pattern).replace(/%/g, ".*")}$`;
      return { [key]: { $regex: regexSource, $options: "i" } };
    }
    default:
      return { [key]: value };
  }
};

class Whereable<T> {
  protected filters: Record<string, unknown>[] = [];

  constructor(protected colName: string) {}

  where(key: string, opOrValue: WhereOperator | unknown, maybeValue?: unknown) {
    if (maybeValue === undefined && opOrValue !== undefined) {
      // where("field", value) shorthand — equality
      this.filters.push(buildCondition(key, "=", opOrValue));
    } else {
      this.filters.push(
        buildCondition(key, opOrValue as WhereOperator, maybeValue),
      );
    }
    return this as unknown as T;
  }

  protected get filter() {
    return { $and: this.filters };
  }

  protected get col() {
    return getCollection(this.colName);
  }
}

export class SelectBuilder<Row> extends Whereable<SelectBuilder<Row>> {
  private projection: string[] | null = null;
  private sortSpec: Record<string, 1 | -1> = {};
  private limitCount: number | undefined;

  select(columns: string | string[]) {
    const cols = Array.isArray(columns) ? columns : [columns];
    this.projection = [...(this.projection ?? []), ...cols];
    return this;
  }

  selectAll() {
    this.projection = null;
    return this;
  }

  orderBy(key: string, direction: "asc" | "desc" = "asc") {
    this.sortSpec[key] = direction === "desc" ? -1 : 1;
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  private async run(): Promise<Row[]> {
    const projection: Record<string, 1> = {};
    for (const field of this.projection ?? []) projection[field] = 1;

    let cursor = this.col.find(this.filter, projection);
    if (Object.keys(this.sortSpec).length > 0) cursor = cursor.sort(this.sortSpec);
    if (this.limitCount !== undefined) cursor = cursor.limit(this.limitCount);

    const docs = await cursor.toArray();
    return docs.map((doc) => stripId<Row>(doc));
  }

  async execute(): Promise<Row[]> {
    return this.run();
  }

  async executeTakeFirst(): Promise<Row | undefined> {
    const rows = await this.run();
    return rows[0];
  }

  async executeTakeFirstOrThrow(): Promise<Row> {
    const rows = await this.run();
    if (rows.length === 0) throw new Error("No results found");
    return rows[0];
  }
}

export class InsertBuilder<Row> {
  private insertValues: Record<string, unknown> = {};

  constructor(private colName: TableKey) {}

  values(values: Record<string, unknown>) {
    this.insertValues = values;
    return this;
  }

  /** Compat ke liye rakha — Mongo me upsert helpers use hote hain. */
  returningAll() {
    return this;
  }

  async execute(): Promise<unknown> {
    await this.persist();
    return { numInsertedOrUpdatedRows: BigInt(1) };
  }

  async executeTakeFirst(): Promise<Row | undefined> {
    return this.persist() as Promise<Row>;
  }

  async executeTakeFirstOrThrow(): Promise<Row> {
    return (await this.persist()) as Row;
  }

  private async persist(): Promise<unknown> {
    const col = getCollection(this.colName);
    const meta = TABLE_META[this.colName];

    const doc: Record<string, unknown> = { ...this.insertValues };

    if (meta.hasIdField && doc.id === undefined) {
      const counters = getCollection("counters");
      const counter = await counters.findOneAndUpdate(
        { _id: this.colName as unknown as any },
        { $inc: { seq: 1 } },
        { upsert: true, returnDocument: "after" },
      );
      doc.id = Number(counter?.seq ?? Date.now());
    }

    const now = new Date();
    doc.createdAt = this.insertValues.createdAt ?? now;
    doc.updatedAt = now;

    try {
      await col.insertOne(doc);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        // Postgres unique-violation ke message pe bot ka code depend karta hai.
        throw { code: "23505" };
      }
      throw error;
    }

    return doc;
  }
}

export class DeleteBuilder<T> extends Whereable<DeleteBuilder<T>> {
  async execute(): Promise<{ numDeletedRows: bigint }> {
    const result = await this.col.deleteMany(this.filter);
    return { numDeletedRows: BigInt(result.deletedCount) };
  }

  async executeTakeFirst(): Promise<{ numDeletedRows: bigint }> {
    return this.execute();
  }
}

interface NextQuery {
  selectFrom: <K extends TableKey>(table: K) => SelectBuilder<TableDocs[K]>;
  insertInto: <K extends TableKey>(table: K) => InsertBuilder<TableDocs[K]>;
  deleteFrom: (table: string) => DeleteBuilder<unknown>;
  countUsers(): Promise<number>;
  countGroupChats(): Promise<number>;
  upsertUser(user: {
    id: string;
    name: string;
    username: string | null | undefined;
  }): Promise<UpdateResult>;
  findUserByUsername(
    identifier: string,
  ): Promise<{ id: string; name: string; username: string } | undefined>;
  getRegisteredGroups(): Promise<string[]>;
  addRegisteredGroup(chatId: string): Promise<void>;
  getTracking(chatId: string): Promise<{ adminChatId: string } | undefined>;
  setTracking(chatId: string, adminChatId: string): Promise<void>;
  deleteTracking(chatId: string): Promise<boolean>;
  listTracking(): Promise<{ chatId: string; adminChatId: string }[]>;
  getVote(chatId: string): Promise<{ voters: string[]; initiatedAt: Date } | undefined>;
  createVote(
    chatId: string,
    voter: string,
  ): Promise<{ voters: string[]; initiatedAt: Date }>;
  addVoter(chatId: string, voter: string): Promise<{ voters: string[] } | undefined>;
  deleteVote(chatId: string): Promise<void>;
}

/** Kysely-style db object — query sites unchanged rahen isliye same shape expose kiya gaya hai. */
export const db: NextQuery = {
  selectFrom: ((table: TableKey) =>
    new SelectBuilder<unknown>(table)) as never,
  insertInto: ((table: TableKey) => new InsertBuilder(table)) as never,
  deleteFrom: (table: string) => new DeleteBuilder(table) as never,

  async countUsers() {
    return getCollection("users").countDocuments();
  },

  async countGroupChats() {
    // % like: "-1%" — Telegram group chat ids negative hote hain.
    const chatIds = await getCollection("leaderboard").distinct("chatId", {
      chatId: { $regex: "^-1" },
    });
    return chatIds.length;
  },

  async upsertUser(user: {
    id: string;
    name: string;
    username: string | null | undefined;
  }) {
    const col = getCollection("users");
    if (user.username) {
      // Username kisi doosre user ka na rahe — Postgres code jaisa hi behavior.
      await col.updateMany(
        { username: user.username, id: { $ne: user.id } },
        { $set: { username: null } },
      );
    }
    return col.updateOne(
      { id: user.id },
      {
        $set: {
          id: user.id,
          name: user.name,
          username: user.username ?? null,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true },
    );
  },

  async findUserByUsername(identifier) {
    const col = getCollection("users");
    const doc = await col.findOne({
      username: { $regex: `^${safeRegex(identifier)}$`, $options: "i" },
    });
    if (!doc) return undefined;
    const clean = stripId<Record<string, unknown>>(doc);
    return {
      id: String(clean.id),
      name: String(clean.name),
      username: String(clean.username ?? ""),
    };
  },

  async getRegisteredGroups() {
    try {
      const docs = await getCollection("registeredGroups").find({}).toArray();
      return docs.map((doc) => String(doc._id));
    } catch (error) {
      console.error("Registered groups read error:", error);
      return [];
    }
  },

  async addRegisteredGroup(chatId) {
    try {
      await getCollection("registeredGroups").updateOne(
        idFilter(chatId),
        { $set: { registeredAt: new Date() } },
        { upsert: true },
      );
    } catch (error) {
      console.error("Group registry error:", error);
    }
  },

  async getTracking(chatId) {
    const doc = await getCollection("tracking").findOne(idFilter(chatId));
    return doc ? { adminChatId: String(doc.adminChatId) } : undefined;
  },

  async setTracking(chatId, adminChatId) {
    await getCollection("tracking").updateOne(
      idFilter(chatId),
      { $set: { adminChatId, createdAt: new Date() } },
      { upsert: true },
    );
  },

  async deleteTracking(chatId) {
    const result = await getCollection("tracking").deleteOne(idFilter(chatId));
    return result.deletedCount > 0;
  },

  async listTracking() {
    const docs = await getCollection("tracking").find({}).toArray();
    return docs.map((doc) => ({
      chatId: String(doc._id),
      adminChatId: String(doc.adminChatId),
    }));
  },

  async getVote(chatId) {
    const doc = await getCollection("votes").findOne(idFilter(chatId));
    if (!doc) return undefined;
    return {
      voters: (doc.voters as string[]) ?? [],
      initiatedAt: (doc.initiatedAt as Date) ?? new Date(),
    };
  },

  async createVote(chatId, voter) {
    const doc = {
      _id: chatId,
      voters: [voter],
      initiatedAt: new Date(),
      createdAt: new Date(),
    };
    const col = getCollection("votes");
    try {
      await col.insertOne(doc as any);
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        return { voters: [voter], initiatedAt: new Date() };
      }
      throw error;
    }
    return { voters: [voter], initiatedAt: doc.initiatedAt };
  },

  async addVoter(chatId, voter) {
    // Har vote pe createdAt refresh — TTL 300s wapas start (redis setex jaisa).
    const result = await getCollection("votes").findOneAndUpdate(
      ({ _id: chatId, voters: { $ne: voter } } as unknown) as any,
      ({
        $push: { voters: voter },
        $set: { createdAt: new Date() },
      } as unknown) as any,
      { returnDocument: "after" },
    );
    return result ? { voters: (result.voters as string[]) ?? [] } : undefined;
  },

  async deleteVote(chatId) {
    await getCollection("votes").deleteOne(idFilter(chatId));
  },
};
