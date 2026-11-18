import type { TranscriptionPort } from "../../ports.js";

export class ElevenLabsClient implements TranscriptionPort {
  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      languageCode: string;
      fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
    },
  ) {}

  async transcribe(audio: Buffer, mimeType: string): Promise<string> {
    const fetchImpl = this.options.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init));
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audio) as BlobPart], { type: mimeType }), "audio");
    form.append("model_id", this.options.model);
    form.append("language_code", this.options.languageCode);
    form.append("tag_audio_events", "false");
    const response = await fetchImpl("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": this.options.apiKey },
      body: form,
    });
    if (!response.ok) throw new Error("transcrição falhou");
    const payload: unknown = await response.json();
    const text = payload && typeof payload === "object" ? (payload as { text?: unknown }).text : undefined;
    if (typeof text !== "string" || text.trim() === "") throw new Error("transcrição vazia");
    return text.trim();
  }
}
