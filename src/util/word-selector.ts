// © 2026 VIP-saksham · Wordraft Game Bot · All Rights Reserved.
import { randomInt } from "crypto";

import { getMongoCollection } from "../config/db";
import commonWords from "../data/commonWords.json";

export interface WordData {
  meaning: string;
  pronunciation: string;
  example: string;
}

interface CommonWords {
  [word: string]: WordData;
}

export interface WordSelectorConfig {
  historySize: number;
  resetThreshold: number;
  ttlSeconds: number;
}

const fetchUsedWords = async (historyKey: string): Promise<string[]> => {
  const doc = await getMongoCollection("wordHistory").findOne(
    { _id: historyKey } as never,
  );
  return (doc?.words as string[]) ?? [];
};

const saveUsedWords = async (historyKey: string, words: string[]) => {
  await getMongoCollection("wordHistory").updateOne(
    { _id: historyKey } as never,
    { $set: { words, updatedAt: new Date() } },
    { upsert: true },
  );
};

export class WordSelector {
  private config: WordSelectorConfig;

  constructor(config: Partial<WordSelectorConfig> = {}) {
    this.config = {
      historySize: config.historySize ?? 50,
      resetThreshold: config.resetThreshold ?? 10,
      ttlSeconds: config.ttlSeconds ?? 7 * 24 * 60 * 60, // 7 din
    };
  }

  async getRandomWord(chatId: string | number): Promise<string> {
    const allWords = Object.keys(commonWords);
    const historyKey = `h:${chatId}`;

    try {
      const usedWords = await fetchUsedWords(historyKey);

      const availableWords = allWords.filter(
        (word) => !usedWords.includes(word.toLowerCase()),
      );

      if (availableWords.length < this.config.resetThreshold) {
        const recentWords = usedWords.slice(
          -Math.floor(this.config.resetThreshold / 2),
        );
        await saveUsedWords(historyKey, recentWords);
        return this.getRandomWord(chatId);
      }

      const randomWord =
        availableWords[randomInt(0, availableWords.length)].toLowerCase();

      const trimmed =
        usedWords.length >= this.config.historySize
          ? [
              ...usedWords.slice(Math.floor(this.config.historySize * 0.2)),
              randomWord,
            ]
          : [...usedWords, randomWord];

      await saveUsedWords(historyKey, trimmed);

      return randomWord;
    } catch (error) {
      console.error("Word history error, using fallback:", error);
      return allWords[randomInt(0, allWords.length)].toLowerCase();
    }
  }

  getWordData(word: string) {
    const wordKey = Object.keys(commonWords).find(
      (key) => key.toLowerCase() === word.toLowerCase(),
    );
    return wordKey ? commonWords[wordKey as keyof typeof commonWords] : null;
  }

  async resetChat(chatId: string | number) {
    await getMongoCollection("wordHistory").deleteOne({ _id: `h:${chatId}` } as never);
  }

  async getChatStats(chatId: string | number) {
    const totalCount = Object.keys(commonWords).length;
    try {
      const usedCount = await fetchUsedWords(`h:${chatId}`);
      return {
        usedCount: usedCount.length,
        availableCount: totalCount - usedCount.length,
        totalCount,
      };
    } catch (error) {
      return { usedCount: 0, availableCount: totalCount, totalCount };
    }
  }

  async getRecentWords(chatId: string | number) {
    return fetchUsedWords(`h:${chatId}`);
  }

  getConfig() {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<WordSelectorConfig>) {
    this.config = { ...this.config, ...newConfig };
  }
}
