import { describe, expect, it, vi } from "vitest";
import { runInbound, runOutbound } from "../src/modules/pipeline/inbound.js";
import type { MessagingPort, TranscriptionPort } from "../src/ports.js";
import { FakeAgent, WEBHOOK_TOKEN, textEnvelope } from "./helpers.js";
import { createMemoryStore } from "./memory-store.js";

function setup() {
  const store = createMemoryStore();
  const agent = new FakeAgent();
  const outbound: string[] = [];
  const transcription = vi.fn<TranscriptionPort["transcribe"]>(async () => "texto do áudio");
  const messaging: MessagingPort = {
    sendText: vi.fn(async () => "EVO1"),
  };
  const deps = {
    webhookToken: WEBHOOK_TOKEN,
    historyLimit: 40,
    ...store,
    agent,
    transcription: { transcribe: transcription },
    enqueueOutbound: async (messageId: string) => {
      outbound.push(messageId);
    },
  };
  return { store, agent, outbound, transcription, messaging, deps };
}

describe("pipeline", () => {
  it("com handoff ligado grava a mensagem e não chama o agente", async () => {
    const { store, agent, outbound, deps } = setup();
    const conversation = await store.conversations.upsertByPhone({ phone: "5511999999999", pushName: null });
    await store.conversations.setHandoff(conversation.id, true);

    await runInbound(deps, textEnvelope("oi"), { attempt: 1, maxAttempts: 3 });

    expect(agent.calls).toHaveLength(0);
    expect(outbound).toHaveLength(0);
    const page = await store.messages.listPage({ conversationId: conversation.id, limit: 10 });
    expect(page.items.map((item) => item.body)).toEqual(["oi"]);
  });

  it("sem handoff chama o agente e enfileira uma outbound", async () => {
    const { store, agent, outbound, deps } = setup();
    agent.result = { text: "olá", toolCalls: [], handoffRequested: false, toolRoundsExceeded: false };

    await runInbound(deps, textEnvelope("oi"), { attempt: 1, maxAttempts: 3 });

    expect(agent.calls).toHaveLength(1);
    expect(agent.calls[0]?.history.map((item) => item.body)).toEqual(["oi"]);
    expect(outbound).toHaveLength(1);
    const reply = await store.messages.findById(outbound[0]!);
    expect(reply).toMatchObject({ author: "agent", status: "queued", body: "olá" });
  });

  it("request_handoff liga o flag e não enfileira", async () => {
    const { store, agent, outbound, deps } = setup();
    agent.result = {
      text: "vou chamar alguém",
      handoffRequested: true,
      toolRoundsExceeded: false,
      toolCalls: [
        {
          name: "request_handoff",
          arguments: { reason: "cliente pediu humano" },
          result: { accepted: true, reason: "cliente pediu humano" },
          status: "success",
        },
      ],
    };

    await runInbound(deps, textEnvelope("quero uma pessoa"), { attempt: 1, maxAttempts: 3 });

    expect(outbound).toHaveLength(0);
    const conversations = await store.conversations.list({ limit: 10 });
    expect(conversations.items[0]?.handoff).toBe(true);
    const tools = await store.toolExecutions.listRecent(conversations.items[0]!.id, 10);
    expect(tools[0]).toMatchObject({
      name: "request_handoff",
      arguments: { reason: "cliente pediu humano" },
      status: "success",
    });
  });

  it("grava tool comum e envia o texto final", async () => {
    const { store, agent, outbound, deps } = setup();
    agent.result = {
      text: "são 10h",
      handoffRequested: false,
      toolRoundsExceeded: false,
      toolCalls: [
        {
          name: "current_time",
          arguments: {},
          result: { iso: "2026-11-17T10:00:00.000-03:00" },
          status: "success",
        },
      ],
    };

    await runInbound(deps, textEnvelope("que horas são"), { attempt: 1, maxAttempts: 3 });

    const reply = await store.messages.findById(outbound[0]!);
    expect(reply?.body).toBe("são 10h");
    const conversations = await store.conversations.list({ limit: 10 });
    const tools = await store.toolExecutions.listRecent(conversations.items[0]!.id, 10);
    expect(tools[0]).toMatchObject({
      name: "current_time",
      result: { iso: "2026-11-17T10:00:00.000-03:00" },
    });
  });

  it("transcrição preenche o body do áudio e esse texto chega no agente", async () => {
    const { store, agent, deps, transcription } = setup();
    await runInbound(
      deps,
      {
        event: "Message",
        instanceToken: WEBHOOK_TOKEN,
        data: {
          Info: {
            ID: "AUD1",
            IsFromMe: false,
            IsGroup: false,
            PushName: "Ana",
            Chat: "5511999999999@s.whatsapp.net",
            MediaType: "audio",
          },
          Message: { base64: Buffer.from("audio").toString("base64"), audioMessage: { mimetype: "audio/ogg; codecs=opus" } },
        },
      },
      { attempt: 1, maxAttempts: 3 },
    );

    expect(transcription).toHaveBeenCalledOnce();
    const conversations = await store.conversations.list({ limit: 10 });
    const messages = await store.messages.listPage({ conversationId: conversations.items[0]!.id, limit: 10 });
    expect(messages.items[0]).toMatchObject({ type: "audio", body: "texto do áudio", status: "stored" });
    expect(agent.calls[0]?.history[0]?.body).toBe("texto do áudio");
  });

  it("falha de transcrição não chama o agente e, na última tentativa, marca failed", async () => {
    const { store, agent, deps } = setup();
    deps.transcription.transcribe = vi.fn(async () => {
      throw new Error("transcrição falhou");
    });
    const audio = {
      event: "Message",
      instanceToken: WEBHOOK_TOKEN,
      data: {
        Info: {
          ID: "AUD2",
          IsFromMe: false,
          IsGroup: false,
          Chat: "5511999999999@s.whatsapp.net",
          MediaType: "audio",
        },
        Message: { base64: Buffer.from("audio").toString("base64") },
      },
    };

    await expect(runInbound(deps, audio, { attempt: 1, maxAttempts: 3 })).rejects.toThrow("transcrição falhou");
    expect(agent.calls).toHaveLength(0);

    await expect(runInbound(deps, audio, { attempt: 3, maxAttempts: 3 })).rejects.toThrow("transcrição falhou");
    const conversations = await store.conversations.list({ limit: 10 });
    const messages = await store.messages.listPage({ conversationId: conversations.items[0]!.id, limit: 10 });
    expect(messages.items[0]).toMatchObject({ status: "failed", failureReason: "transcrição falhou" });
    expect(agent.calls).toHaveLength(0);
  });

  it("mídia não suportada não chama o agente", async () => {
    const { agent, deps, store } = setup();
    await runInbound(
      deps,
      {
        event: "Message",
        instanceToken: WEBHOOK_TOKEN,
        data: {
          Info: {
            ID: "IMG1",
            IsFromMe: false,
            IsGroup: false,
            Chat: "5511999999999@s.whatsapp.net",
            MediaType: "image",
          },
          Message: { imageMessage: {} },
        },
      },
      { attempt: 1, maxAttempts: 3 },
    );
    expect(agent.calls).toHaveLength(0);
    const conversations = await store.conversations.list({ limit: 10 });
    const messages = await store.messages.listPage({ conversationId: conversations.items[0]!.id, limit: 10 });
    expect(messages.items[0]).toMatchObject({ type: "unsupported", body: "[mensagem não suportada]", status: "stored" });
  });

  it("segundo job com o mesmo provider_message_id não duplica", async () => {
    const { store, agent, outbound, deps } = setup();
    const envelope = textEnvelope("oi", "SAME");
    await runInbound(deps, envelope, { attempt: 1, maxAttempts: 3 });
    await runInbound(deps, envelope, { attempt: 1, maxAttempts: 3 });

    expect(agent.calls).toHaveLength(1);
    const conversations = await store.conversations.list({ limit: 10 });
    const messages = await store.messages.listPage({ conversationId: conversations.items[0]!.id, limit: 10 });
    expect(messages.items.filter((item) => item.author === "agent")).toHaveLength(1);
    expect(messages.items).toHaveLength(2);
  });

  it("envio bem-sucedido marca sent e falha definitiva marca failed", async () => {
    const { store, messaging, deps } = setup();
    const conversation = await store.conversations.upsertByPhone({ phone: "5511999999999", pushName: null });
    const message = await store.messages.insertOutbound({
      conversationId: conversation.id,
      author: "operator",
      body: "oi",
      replyToMessageId: null,
    });

    await runOutbound({ ...store, messaging }, message.id, { attempt: 1, maxAttempts: 3 });
    expect(messaging.sendText).toHaveBeenCalledWith("5511999999999", "oi");
    expect(await store.messages.findById(message.id)).toMatchObject({ status: "sent", providerMessageId: "EVO1" });

    const again = await store.messages.insertOutbound({
      conversationId: conversation.id,
      author: "operator",
      body: "de novo",
      replyToMessageId: null,
    });
    messaging.sendText = vi.fn(async () => {
      throw new Error("rede");
    });
    await expect(runOutbound({ ...store, messaging }, again.id, { attempt: 1, maxAttempts: 3 })).rejects.toThrow("rede");
    expect((await store.messages.findById(again.id))?.status).toBe("queued");
    await expect(runOutbound({ ...store, messaging }, again.id, { attempt: 3, maxAttempts: 3 })).rejects.toThrow("rede");
    expect(await store.messages.findById(again.id)).toMatchObject({ status: "failed", failureReason: "falha ao enviar" });
  });

  it("não envia de novo uma mensagem que já está sent", async () => {
    const { store, messaging } = setup();
    const conversation = await store.conversations.upsertByPhone({ phone: "5511999999999", pushName: null });
    const message = await store.messages.insertOutbound({
      conversationId: conversation.id,
      author: "agent",
      body: "oi",
      replyToMessageId: null,
    });
    await store.messages.markSentIfQueued(message.id, "JA-FOI");
    await runOutbound({ ...store, messaging }, message.id, { attempt: 1, maxAttempts: 3 });
    expect(messaging.sendText).not.toHaveBeenCalled();
  });
});
