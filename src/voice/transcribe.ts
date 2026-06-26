import { CONFIG } from "../config/index.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("voice");

const SCRIBE_ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";

/**
 * Transcribe audio to text using ElevenLabs Scribe (`scribe_v2` by default).
 * Telegram voice notes are OGG/Opus, which Scribe accepts directly.
 *
 * @throws if the API key is missing or the request fails.
 */
export async function transcribeVoice(
  audio: Buffer,
  filename = "voice.ogg",
): Promise<string> {
  if (!CONFIG.elevenLabsKey) {
    throw new Error(
      "ELEVENLABS_API_KEY is not set — voice transcription is unavailable.",
    );
  }

  const form = new FormData();
  // Buffer is a Uint8Array; wrap it so the typed Blob constructor is satisfied.
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/ogg" }), filename);
  form.append("model_id", CONFIG.scribeModel);

  log.debug("transcribing", { bytes: audio.length, model: CONFIG.scribeModel });

  const res = await fetch(SCRIBE_ENDPOINT, {
    method: "POST",
    headers: { "xi-api-key": CONFIG.elevenLabsKey },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`ElevenLabs Scribe failed (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as { text?: string };
  const text = (data.text ?? "").trim();
  log.info("transcribed", { chars: text.length });
  return text;
}
