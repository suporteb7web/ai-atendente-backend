import { describe, expect, it, vi } from "vitest";
import { ElevenLabsClient } from "../src/adapters/elevenlabs/client.js";

describe("ElevenLabsClient", () => {
  it("manda scribe_v3, idioma e o áudio, e usa o texto com trim", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(form.get("model_id")).toBe("scribe_v3");
      expect(form.get("language_code")).toBe("por");
      expect(form.get("tag_audio_events")).toBe("false");
      expect(form.get("file")).toBeInstanceOf(Blob);
      return new Response(JSON.stringify({ text: "  quero um humano  " }), { status: 200 });
    });
    const client = new ElevenLabsClient({
      apiKey: "xi-secret",
      model: "scribe_v3",
      languageCode: "por",
      fetchImpl,
    });

    await expect(client.transcribe(Buffer.from("abc"), "audio/ogg")).resolves.toBe("quero um humano");
    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const [, init] = calls[0]!;
    expect(init?.headers).toMatchObject({ "xi-api-key": "xi-secret" });
  });

  it("trata texto vazio como falha", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: "   " }), { status: 200 }));
    const client = new ElevenLabsClient({
      apiKey: "k",
      model: "scribe_v3",
      languageCode: "por",
      fetchImpl,
    });
    await expect(client.transcribe(Buffer.from("abc"), "audio/ogg")).rejects.toThrow("transcrição vazia");
  });
});
