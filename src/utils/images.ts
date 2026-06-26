/**
 * Claude signals "send this image to the user" by emitting a marker line:
 *   [[image: C:\path\to\file.png]]
 * We parse those out of the final answer, deliver each as a Telegram photo, and
 * strip the markers from the text the user sees. This gives Claude a simple,
 * reliable way to return screenshots, charts, or any generated image.
 */

const IMAGE_MARKER = /\[\[image:\s*([^\]]+?)\s*\]\]/gi;

export interface ExtractedImages {
  /** The answer text with all image markers removed and trimmed. */
  text: string;
  /** Absolute (or relative) paths Claude asked to send, in order, de-duplicated. */
  images: string[];
}

/** Pull `[[image: ...]]` markers out of Claude's reply. */
export function extractImageMarkers(raw: string): ExtractedImages {
  const images: string[] = [];
  for (const match of raw.matchAll(IMAGE_MARKER)) {
    const p = match[1].trim().replace(/^["']|["']$/g, "");
    if (p && !images.includes(p)) images.push(p);
  }
  const text = raw.replace(IMAGE_MARKER, "").replace(/\n{3,}/g, "\n\n").trim();
  return { text, images };
}
