import request from "supertest";
import { describe, expect, it } from "vitest";
import { WhatsappConnectionError } from "../src/ports.js";
import { createTestApp } from "./helpers.js";

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("rotas /whatsapp", () => {
  it("exigem o token do operador", async () => {
    const { app } = createTestApp();
    for (const [method, path] of [
      ["get", "/whatsapp"],
      ["post", "/whatsapp/connect"],
      ["get", "/whatsapp/qr"],
      ["post", "/whatsapp/disconnect"],
      ["get", "/whatsapp/license?redirectUri=http://x"],
      ["post", "/whatsapp/license"],
    ] as const) {
      expect((await request(app)[method](path)).status, `${method} ${path}`).toBe(401);
    }
  });

  it("GET /whatsapp devolve o estado", async () => {
    const { app, token, whatsapp } = createTestApp();
    whatsapp.state = { status: "connected", name: "Ana", phone: "5511999998888" };
    const res = await request(app).get("/whatsapp").set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "connected", name: "Ana", phone: "5511999998888" });
  });

  it("POST /whatsapp/connect conecta e devolve o novo estado", async () => {
    const { app, token, whatsapp } = createTestApp();
    const res = await request(app).post("/whatsapp/connect").set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("connecting");
    expect(whatsapp.calls).toEqual(["connect"]);
  });

  it("GET /whatsapp/qr devolve o QR ou null", async () => {
    const { app, token, whatsapp } = createTestApp();
    expect((await request(app).get("/whatsapp/qr").set(bearer(token))).body).toEqual({ qrcode: null });
    whatsapp.qr = "data:image/png;base64,AAAA";
    expect((await request(app).get("/whatsapp/qr").set(bearer(token))).body).toEqual({ qrcode: "data:image/png;base64,AAAA" });
  });

  it("POST /whatsapp/disconnect desconecta", async () => {
    const { app, token, whatsapp } = createTestApp();
    whatsapp.state = { status: "connected", name: "Ana", phone: null };
    const res = await request(app).post("/whatsapp/disconnect").set(bearer(token));
    expect(res.body.status).toBe("disconnected");
  });

  it("licença: devolve o link de cadastro e ativa com o code", async () => {
    const { app, token, whatsapp } = createTestApp();
    const link = await request(app).get("/whatsapp/license").query({ redirectUri: "http://localhost:3100/whatsapp" }).set(bearer(token));
    expect(link.body.registerUrl).toContain("redirect_uri=");

    const activated = await request(app).post("/whatsapp/license").set(bearer(token)).send({ code: " abc " });
    expect(activated.status).toBe(200);
    expect(whatsapp.calls).toContain("activate:abc");
  });

  it("valida a entrada com 400", async () => {
    const { app, token } = createTestApp();
    expect((await request(app).get("/whatsapp/license").set(bearer(token))).status).toBe(400);
    expect((await request(app).get("/whatsapp/license").query({ redirectUri: "javascript:alert(1)" }).set(bearer(token))).status).toBe(400);
    expect((await request(app).post("/whatsapp/license").set(bearer(token)).send({})).status).toBe(400);
  });

  it("traduz erros do EvolutionGo em status HTTP com { error }", async () => {
    const { app, token, whatsapp } = createTestApp();
    for (const [kind, status] of [["license", 409], ["invalid", 400], ["config", 500], ["upstream", 502]] as const) {
      whatsapp.failWith = new WhatsappConnectionError(kind, `erro ${kind}`);
      const res = await request(app).post("/whatsapp/connect").set(bearer(token));
      expect(res.status).toBe(status);
      expect(res.body).toEqual({ error: `erro ${kind}` });
    }
  });
});
