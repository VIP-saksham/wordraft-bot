import { promises as fs } from "fs";

type WordDetails = {
  meaning: string;
  pronunciation: string;
  example: string;
};

type DictionaryResponse = Array<{
  meanings?: Array<{
    definitions?: Array<{
      definition?: string;
      example?: string;
    }>;
  }>;
  phonetics?: Array<{
    text?: string;
  }>;
}>;

// Input JSON file
const inputFilePath = "words.json";
const outputFilePath = "words_with_details.json";

async function fetchWordDetails(word: string): Promise<WordDetails> {
  const apiUrl = `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`;
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Word not found: ${word}`);
    }

    const data = (await response.json()) as DictionaryResponse;
    const meanings =
      data[0]?.meanings
        ?.map((meaning) => meaning.definitions?.[0]?.definition)
        .filter((definition): definition is string => Boolean(definition))
        .join("; ") ?? "";
    const pronunciation = data[0]?.phonetics?.[0]?.text ?? "";
    const example = data[0]?.meanings?.[0]?.definitions?.[0]?.example ?? "";

    return {
      meaning: meanings,
      pronunciation,
      example,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error fetching details for ${word}:`, message);
    return {
      meaning: "",
      pronunciation: "",
      example: "",
    };
  }
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processWords() {
  try {
    const words = JSON.parse(await fs.readFile(inputFilePath, "utf-8")) as string[];
    let result: Record<string, WordDetails> = {};

    try {
      result = JSON.parse(await fs.readFile(outputFilePath, "utf-8")) as Record<
        string,
        WordDetails
      >;
    } catch {}

    for (const word of words) {
      if (!result[word]) {
        console.log(`Fetching details for: ${word}`);
        result[word] = await fetchWordDetails(word);
        await fs.writeFile(
          outputFilePath,
          JSON.stringify(result, null, 2),
          "utf-8",
        );
        await delay(1000); // Delay to avoid rate limiting
      } else {
        console.log(`Details already exist for: ${word}`);
      }
    }

    console.log("Processing complete.");
  } catch (error) {
    console.error("Error during processing:", error);
  }
}

processWords();
