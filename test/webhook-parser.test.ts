import { describe, expect, it } from "vitest";
import { parseEvolutionEnvelope, UNSUPPORTED_BODY } from "../src/modules/webhook/parser.js";

const TOKEN = "hook-token";

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    event: "Message",
    instanceToken: TOKEN,
    data: {
      Info: {
        ID: "MSG1",
        IsFromMe: false,
        IsGroup: false,
        PushName: "Ana",
        Timestamp: "2026-11-17T12:00:00.000Z",
        Chat: "5511999999999@s.whatsapp.net",
        MediaType: "",
      },
      Message: { conversation: "oi" },
    },
    ...overrides,
  };
}

describe("parser do webhook", () => {
  it("lê texto simples", () => {
    const parsed = parseEvolutionEnvelope(envelope(), TOKEN);
    expect(parsed).toMatchObject({
      action: "accept",
      inbound: { type: "text", body: "oi", providerMessageId: "MSG1", pushName: "Ana" },
    });
  });

  it("lê texto estendido nos dois formatos", () => {
    const lower = parseEvolutionEnvelope(
      envelope({ data: { Info: envelope().data.Info, Message: { extendedTextMessage: { text: "olá" } } } }),
      TOKEN,
    );
    const upper = parseEvolutionEnvelope(
      envelope({ data: { Info: envelope().data.Info, Message: { ExtendedTextMessage: { Text: "olá" } } } }),
      TOKEN,
    );
    expect(lower).toMatchObject({ action: "accept", inbound: { type: "text", body: "olá" } });
    expect(upper).toMatchObject({ action: "accept", inbound: { type: "text", body: "olá" } });
  });

  it("lê áudio com base64 e trata opus como audio/ogg", () => {
    const parsed = parseEvolutionEnvelope(
      envelope({
        data: {
          Info: { ...envelope().data.Info, MediaType: "audio" },
          Message: { base64: "AAAA", audioMessage: { mimetype: "audio/ogg; codecs=opus" } },
        },
      }),
      TOKEN,
    );
    expect(parsed).toMatchObject({
      action: "accept",
      inbound: { type: "audio", body: "", audio: { base64: "AAAA", mimeType: "audio/ogg" } },
    });
  });

  it("aceita o chat como objeto de JID", () => {
    const parsed = parseEvolutionEnvelope(
      envelope({
        data: {
          Info: { ...envelope().data.Info, Chat: { User: "5511999999999", Server: "s.whatsapp.net" } },
          Message: { conversation: "oi" },
        },
      }),
      TOKEN,
    );
    expect(parsed).toMatchObject({ action: "accept", inbound: { rawPhone: "5511999999999@s.whatsapp.net" } });
  });

  it("descarta grupo, fromMe e broadcast", () => {
    expect(parseEvolutionEnvelope(envelope({ data: { Info: { ...envelope().data.Info, IsGroup: true }, Message: { conversation: "oi" } } }), TOKEN)).toMatchObject({ action: "discard" });
    expect(
      parseEvolutionEnvelope(
        envelope({
          data: {
            Info: { ...envelope().data.Info, Chat: "123@g.us" },
            Message: { conversation: "oi" },
          },
        }),
        TOKEN,
      ),
    ).toMatchObject({ action: "discard" });
    expect(parseEvolutionEnvelope(envelope({ data: { Info: { ...envelope().data.Info, IsFromMe: true }, Message: { conversation: "oi" } } }), TOKEN)).toMatchObject({ action: "discard" });
    expect(
      parseEvolutionEnvelope(
        envelope({
          data: { Info: { ...envelope().data.Info, Chat: "status@broadcast" }, Message: { conversation: "oi" } },
        }),
        TOKEN,
      ),
    ).toMatchObject({ action: "discard" });
  });

  it("descarta evento que não é Message", () => {
    expect(parseEvolutionEnvelope(envelope({ event: "Receipt" }), TOKEN)).toMatchObject({ action: "discard" });
  });

  it("rejeita token inválido", () => {
    expect(parseEvolutionEnvelope(envelope({ instanceToken: "outro" }), TOKEN)).toEqual({ action: "unauthorized" });
    expect(parseEvolutionEnvelope(envelope({ instanceToken: undefined }), TOKEN)).toEqual({ action: "unauthorized" });
  });

  it("marca mídia não suportada", () => {
    const parsed = parseEvolutionEnvelope(
      envelope({
        data: { Info: { ...envelope().data.Info, MediaType: "image" }, Message: { imageMessage: {} } },
      }),
      TOKEN,
    );
    expect(parsed).toMatchObject({ action: "accept", inbound: { type: "unsupported", body: UNSUPPORTED_BODY } });
  });
});
