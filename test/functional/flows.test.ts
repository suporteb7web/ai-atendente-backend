import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { runInbound, runOutbound } from "../../src/modules/pipeline/inbound.js";
import type { InboundDeps } from "../../src/modules/pipeline/inbound.js";
import type { MessagingPort } from "../../src/ports.js";
import { FakeAgent, FakeWhatsapp, testConfig, TOKEN, WEBHOOK_TOKEN, textEnvelope } from "../helpers.js";
import { createMemoryStore } from "../memory-store.js";

function createFlow() {
  const store = createMemoryStore();
  const agent = new FakeAgent();
  const sent: Array<{ phone: string; text: string }> = [];
  const messaging: MessagingPort = {
    sendText: vi.fn(async (phone: string, text: string) => {
      sent.push({ phone, text });
      return `evo-${sent.length}`;
    }),
  };
  const transcription = vi.fn(async () => "quero falar com uma pessoa");
  const deps: InboundDeps = {
    webhookToken: WEBHOOK_TOKEN,
    historyLimit: 40,
    ...store,
    agent,
    transcription: { transcribe: transcription },
    enqueueOutbound: async (messageId) => {
      await runOutbound({ ...store, messaging }, messageId, { attempt: 1, maxAttempts: 3 });
    },
  };
  const app = createApp({
    config: testConfig(),
    operator: { ...store, enqueueOutbound: deps.enqueueOutbound },
    whatsapp: new FakeWhatsapp(),
    enqueueInbound: async (envelope) => {
      await runInbound(deps, envelope, { attempt: 1, maxAttempts: 3 });
    },
    checkReady: async () => true,
  });
  return { app, store, agent, sent, transcription };
}

async function authGet(app: ReturnType<typeof createFlow>["app"], url: string) {
  return request(app).get(url).set("Authorization", `Bearer ${TOKEN}`);
}

describe("fluxos funcionais", () => {
  it("health não consulta dependência e ready reflete a checagem", async () => {
    const { app } = createFlow();
    expect((await request(app).get("/health")).body).toEqual({ ok: true });
    const down = createApp({
      config: testConfig(),
      operator: { ...createMemoryStore(), enqueueOutbound: async () => undefined },
      whatsapp: new FakeWhatsapp(),
      enqueueInbound: async () => undefined,
      checkReady: async () => false,
    });
    expect((await request(down).get("/ready")).status).toBe(503);
  });

  it("texto no webhook gera a resposta do agente e as duas mensagens aparecem na API", async () => {
    const { app, agent, sent } = createFlow();
    agent.result = { text: "olá, posso ajudar", toolCalls: [], handoffRequested: false, toolRoundsExceeded: false };

    const posted = await request(app).post("/webhooks/evolution").send(textEnvelope("bom dia"));
    expect(posted.status).toBe(200);
    expect(posted.text).toBe("");

    const list = await authGet(app, "/conversations");
    const conversationId = list.body.items[0].id as string;
    const messages = await authGet(app, `/conversations/${conversationId}/messages`);
    expect(messages.body.items.map((item: { author: string; body: string }) => [item.author, item.body])).toEqual([
      ["customer", "bom dia"],
      ["agent", "olá, posso ajudar"],
    ]);
    expect(sent).toEqual([{ phone: "5511999999999", text: "olá, posso ajudar" }]);
  });

  it("áudio chega transcrito e é esse texto que o agente lê", async () => {
    const { app, agent, transcription } = createFlow();
    agent.result = { text: "entendi", toolCalls: [], handoffRequested: false, toolRoundsExceeded: false };
    await request(app)
      .post("/webhooks/evolution")
      .send({
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
          Message: { base64: Buffer.from("ogg").toString("base64"), audioMessage: { mimetype: "audio/ogg; codecs=opus" } },
        },
      });

    expect(transcription).toHaveBeenCalledOnce();
    expect(agent.calls[0]?.history.map((item) => item.body)).toEqual(["quero falar com uma pessoa"]);
    const list = await authGet(app, "/conversations");
    const messages = await authGet(app, `/conversations/${list.body.items[0].id}/messages`);
    expect(messages.body.items[0]).toMatchObject({ type: "audio", body: "quero falar com uma pessoa" });
  });

  it("com handoff ligado grava o cliente, não chama o agente, e a mensagem do operador sai", async () => {
    const { app, store, agent, sent } = createFlow();
    const conversation = await store.conversations.upsertByPhone({ phone: "5511999999999", pushName: "Ana" });
    await store.conversations.setHandoff(conversation.id, true);

    await request(app).post("/webhooks/evolution").send(textEnvelope("ainda estou aqui", "M2"));
    expect(agent.calls).toHaveLength(0);

    const sentByOperator = await request(app)
      .post(`/conversations/${conversation.id}/messages`)
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ text: "sou eu, o operador" });
    expect(sentByOperator.status).toBe(202);
    expect(sent).toEqual([{ phone: "5511999999999", text: "sou eu, o operador" }]);
    expect((await store.conversations.findById(conversation.id))?.handoff).toBe(true);
  });

  it("request_handoff liga o flag, registra a tool e não envia a fala do modelo", async () => {
    const { app, agent, sent } = createFlow();
    agent.result = {
      text: "vou te transferir",
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
    await request(app).post("/webhooks/evolution").send(textEnvelope("quero um humano"));
    const list = await authGet(app, "/conversations");
    expect(list.body.items[0].handoff).toBe(true);
    const tools = await authGet(app, `/conversations/${list.body.items[0].id}/tool-executions`);
    expect(tools.body.items[0]).toMatchObject({
      name: "request_handoff",
      arguments: { reason: "cliente pediu humano" },
      status: "success",
    });
    const messages = await authGet(app, `/conversations/${list.body.items[0].id}/messages`);
    expect(messages.body.items.map((item: { author: string }) => item.author)).toEqual(["customer"]);
    expect(sent).toEqual([]);
  });

  it("ao desligar o handoff a próxima mensagem volta ao agente com a fala do operador no histórico", async () => {
    const { app, store, agent, sent } = createFlow();
    const conversation = await store.conversations.upsertByPhone({ phone: "5511999999999", pushName: "Ana" });
    await store.conversations.setHandoff(conversation.id, true);
    await request(app).post("/webhooks/evolution").send(textEnvelope("preciso de ajuda", "C1"));
    await request(app)
      .post(`/conversations/${conversation.id}/messages`)
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ text: "já resolvi por aqui" });
    await request(app)
      .post(`/conversations/${conversation.id}/handoff`)
      .set("Authorization", `Bearer ${TOKEN}`)
      .send({ enabled: false });

    agent.result = { text: "continuando", toolCalls: [], handoffRequested: false, toolRoundsExceeded: false };
    await request(app).post("/webhooks/evolution").send(textEnvelope("obrigado", "C2"));

    expect(agent.calls).toHaveLength(1);
    expect(agent.calls[0]?.history.map((item) => [item.author, item.body])).toEqual([
      ["customer", "preciso de ajuda"],
      ["operator", "já resolvi por aqui"],
      ["customer", "obrigado"],
    ]);
    expect(sent.map((item) => item.text)).toEqual(["já resolvi por aqui", "continuando"]);
  });

  it("webhook repetido não duplica mensagem nem resposta", async () => {
    const { app, agent, sent } = createFlow();
    const envelope = textEnvelope("oi", "DUP");
    await request(app).post("/webhooks/evolution").send(envelope);
    await request(app).post("/webhooks/evolution").send(envelope);
    expect(agent.calls).toHaveLength(1);
    expect(sent).toHaveLength(1);
    const list = await authGet(app, "/conversations");
    const messages = await authGet(app, `/conversations/${list.body.items[0].id}/messages`);
    expect(messages.body.items).toHaveLength(2);
  });

  it("rota do operador sem bearer recebe 401 e o webhook com token errado não entra na fila", async () => {
    const { app, agent } = createFlow();
    const denied = await request(app).get("/conversations");
    expect(denied.status).toBe(401);
    const webhook = await request(app)
      .post("/webhooks/evolution")
      .send({ ...textEnvelope("oi", "X"), instanceToken: "errado" });
    expect(webhook.status).toBe(401);
    expect(agent.calls).toHaveLength(0);
  });

  it("lista a página mais recente e o cursor pede a mais antiga", async () => {
    const { app, store } = createFlow();
    const conversation = await store.conversations.upsertByPhone({ phone: "5511999999999", pushName: "Ana" });
    for (const body of ["um", "dois", "três"]) {
      await store.messages.insertInbound({
        conversationId: conversation.id,
        type: "text",
        body,
        status: "stored",
        providerMessageId: body,
        providerTimestamp: null,
        failureReason: null,
      });
    }
    const first = await authGet(app, `/conversations/${conversation.id}/messages?limit=2`);
    expect(first.body.items.map((item: { body: string }) => item.body)).toEqual(["dois", "três"]);
    const second = await authGet(app, `/conversations/${conversation.id}/messages?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.items.map((item: { body: string }) => item.body)).toEqual(["um"]);
    expect(second.body.nextCursor).toBeNull();
  });
});
