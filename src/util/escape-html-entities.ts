export function escapeHtmlEntities(text: string) {
  const entityMap: Record<string, string> = {
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&#39;", // Single quotes
    "/": "&#x2F;", // Slash
  };

  return text.replace(/[<>&"'\/]/g, (char) => entityMap[char]);
}
