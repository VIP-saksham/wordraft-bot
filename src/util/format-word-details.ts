import commonWordsJson from "../data/commonWords.json";
import { escapeHtmlEntities } from "./escape-html-entities";

type WordDetails = {
  meaning: string;
  pronunciation: string;
  example: string;
};

const commonWords = commonWordsJson as Record<string, WordDetails>;

export function formatWordDetails(word: string) {
  const wordDetails = commonWords[word] ?? {
    meaning: "",
    pronunciation: "",
    example: "",
  };

  return `<blockquote><strong>Correct Word: ${word}</strong>
<strong>${escapeHtmlEntities(capitalizeFirstLetter(word))}</strong> <code>${
    escapeHtmlEntities(wordDetails.pronunciation) || ""
  }</code>
${
  wordDetails.meaning
    ? `<strong>Meaning</strong>: ${escapeHtmlEntities(wordDetails.meaning)}`
    : ""
}
${
  wordDetails.example
    ? `<strong>Example</strong>: ${escapeHtmlEntities(wordDetails.example)}`
    : ""
}</blockquote>`;
}

function capitalizeFirstLetter(string: string) {
  if (!string) return string;
  return string.charAt(0).toUpperCase() + string.slice(1);
}
