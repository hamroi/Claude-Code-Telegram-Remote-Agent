/**
 * Claude signals "send this file to the user" by emitting a marker line:
 *   [[file: C:\path\to\file.docx]]
 * We parse those out of the final answer, deliver each as a Telegram document,
 * and strip the markers from the text the user sees.
 */

const FILE_MARKER = /\[\[file:\s*([^\]]+?)\s*\]\]/gi;

export interface ExtractedFiles {
  /** The answer text with all file markers removed and trimmed. */
  text: string;
  /** Absolute paths Claude asked to send, in order, de-duplicated. */
  files: string[];
}

/** Pull `[[file: ...]]` markers out of Claude's reply. */
export function extractFileMarkers(raw: string): ExtractedFiles {
  const files: string[] = [];
  for (const match of raw.matchAll(FILE_MARKER)) {
    const p = match[1].trim().replace(/^["']|["']$/g, "");
    if (p && !files.includes(p)) files.push(p);
  }
  const text = raw.replace(FILE_MARKER, "").replace(/\n{3,}/g, "\n\n").trim();
  return { text, files };
}
