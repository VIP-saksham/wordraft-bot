import { MongoClient } from "mongodb";

import { env } from "./env";
import { redis } from "./redis";

const DB_NAME = "wordseek";
const COLLECTION_NAME = "settings";

let client: MongoClient | null = null;

const getCollection = async () => {
  if (!env.MONGO_URI) return null;

  if (!client) {
    client = new MongoClient(env.MONGO_URI, {
      serverSelectionTimeoutMS: 10_000,
    });
    await client.connect();
  }
  return client.db(DB_NAME).collection(COLLECTION_NAME);
};

export const getSetting = async <T = string>(
  key: string,
): Promise<T | undefined> => {
  const collection = await getCollection().catch((error) => {
    console.error("MongoDB settings connection failed:", error);
    return null;
  });

  if (!collection) {
    const value = await redis.get(`settings:${key}`);
    return value === null ? undefined : (value as T);
  }

  const doc = await collection.findOne<{ key: string; value: T }>({ key });
  return doc?.value;
};

export const setSetting = async (key: string, value: string) => {
  const collection = await getCollection().catch((error) => {
    console.error("MongoDB settings connection failed:", error);
    return null;
  });

  if (!collection) {
    await redis.set(`settings:${key}`, value);
    return;
  }

  await collection.updateOne(
    { key },
    { $set: { value } },
    { upsert: true },
  );
};

export const deleteSetting = async (key: string) => {
  const collection = await getCollection().catch((error) => {
    console.error("MongoDB settings connection failed:", error);
    return null;
  });

  if (!collection) {
    await redis.del(`settings:${key}`);
    return;
  }

  await collection.deleteOne({ key });
};
