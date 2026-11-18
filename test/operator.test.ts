import request from "supertest";
import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

describe("operador", () => {
  it("enviar mensagem enfileira outbound e não mexe no handoff", async () => {
    const { app, store, outbound, token } = createTestApp();
    const conversation = await store.conversations.upsertByPhone({ phone: "5511999999999", pushName: "Ana" });
    await store.conversations.setHandoff(conversation.id, true);

    const response = await request(app)
      .post(`/conversations/${conversation.id}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "  já te respondo  " });

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      direction: "outbound",
      author: "operator",
      type: "text",
      body: "já te respondo",
      status: "queued",
      failureReason: null,
    });
    expect(outbound).toEqual([response.body.id]);
    const stored = await store.conversations.findById(conversation.id);
    expect(stored?.handoff).toBe(true);
  });

  it("liga e desliga o handoff", async () => {
    const { app, store, token } = createTestApp();
    const conversation = await store.conversations.upsertByPhone({ phone: "5511999999999", pushName: null });

    const enabled = await request(app)
      .post(`/conversations/${conversation.id}/handoff`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body).toEqual({ id: conversation.id, handoff: true });

    const same = await request(app)
      .post(`/conversations/${conversation.id}/handoff`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: true });
    expect(same.status).toBe(200);
    expect(same.body).toEqual({ id: conversation.id, handoff: true });

    const disabled = await request(app)
      .post(`/conversations/${conversation.id}/handoff`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: false });
    expect(disabled.body).toEqual({ id: conversation.id, handoff: false });
  });

  it("responde 404 para conversa inexistente e uuid inválido", async () => {
    const { app, token } = createTestApp();
    const missing = await request(app)
      .get("/conversations/11111111-1111-4111-8111-111111111111")
      .set("Authorization", `Bearer ${token}`);
    expect(missing.status).toBe(404);
    const invalid = await request(app).get("/conversations/nao-e-uuid").set("Authorization", `Bearer ${token}`);
    expect(invalid.status).toBe(404);
  });

  it("rejeita body inválido", async () => {
    const { app, store, token } = createTestApp();
    const conversation = await store.conversations.upsertByPhone({ phone: "5511999999999", pushName: null });
    const response = await request(app)
      .post(`/conversations/${conversation.id}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ text: "   " });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "body inválido" });
  });
});
