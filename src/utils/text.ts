/** Telegram's hard limit for a single text message. */
export const TG_TEXT_LIMIT = 4096;

/**
 * Split text into chunks that each fit within `limit`, preferring to break on
 * line boundaries. Only hard-cuts a line that is itself longer than the limit.
 */
export function splitIntoChunks(text: string, limit = TG_TEXT_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    if (line.length > limit) {
      // Flush whatever we have, then hard-cut the oversized line.
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < line.length; i += limit) {
        chunks.push(line.slice(i, i + limit));
      }
      continue;
    }
    if (current.length + line.length + 1 > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
