import { describe, expect, it, vi } from "vitest";
import { EvolutionConnection } from "../src/adapters/evolution/connection.js";
import { WhatsappConnectionError } from "../src/ports.js";

type Route = { status?: number; body?: unknown } | (() => never);

/** fetch falso: responde por "MÉTODO /caminho" e registra as chamadas. */
function fakeEvolution(routes: Record<string, Route>) {
  const calls: Array<{ key: string; headers: Record<string, string>; body: unknown }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("http://evo.test", "");
    const key = `${init?.method ?? "GET"} ${path}`;
    calls.push({
      key,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const route = routes[key] ?? routes[key.split("?")[0]!];
    if (!route) return new Response("{}", { status: 404 });
    if (typeof route === "function") route();
    const r = route as { status?: number; body?: unknown };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  });
  return { calls, fetchImpl };
}

const make = (routes: Record<string, Route>, extra: { globalApiKey?: string } = { globalApiKey: "global" }) => {
  const evo = fakeEvolution(routes);
  const connection = new EvolutionConnection({
    baseUrl: "http://evo.test",
    instanceToken: "inst-token",
    instanceName: "atendente",
    webhookUrl: "http://api:3000/webhooks/evolution",
    fetchImpl: evo.fetchImpl,
    ...extra,
  });
  return { connection, ...evo };
};

const status = (data: unknown, httpStatus = 200) => ({ "GET /instance/status": { status: httpStatus, body: { message: "success", data } } });

describe("EvolutionConnection.getState", () => {
  it("license_required quando o EvolutionGo devolve LICENSE_REQUIRED", async () => {
    const { connection } = make({ "GET /instance/status": { status: 503, body: { code: "LICENSE_REQUIRED" } } });
    await expect(connection.getState()).resolves.toMatchObject({ status: "license_required" });
  });

  it("not_created quando o token da instância não existe (401)", async () => {
    const { connection } = make({ "GET /instance/status": { status: 401, body: { error: "not authorized" } } });
    await expect(connection.getState()).resolves.toMatchObject({ status: "not_created" });
  });

  it("disconnected, connecting e connected seguem Connected/LoggedIn", async () => {
    expect((await make(status({ Connected: false, LoggedIn: false, Name: "" })).connection.getState()).status).toBe("disconnected");
    expect((await make(status({ Connected: true, LoggedIn: false, Name: "" })).connection.getState()).status).toBe("connecting");
    const connected = make({
      ...status({ Connected: true, LoggedIn: true, Name: "Loja da Ana" }),
      "GET /instance/all": { body: { data: [{ name: "atendente", token: "inst-token", jid: "5511999998888:12@s.whatsapp.net" }] } },
    });
    await expect(connected.connection.getState()).resolves.toEqual({
      status: "connected",
      name: "Loja da Ana",
      phone: "5511999998888",
    });
  });

  it("connected sem GLOBAL_API_KEY ainda funciona, só sem telefone", async () => {
    const { connection } = make(status({ Connected: true, LoggedIn: true, Name: "Ana" }), {});
    await expect(connection.getState()).resolves.toEqual({ status: "connected", name: "Ana", phone: null });
  });

  it("unavailable quando a rede falha", async () => {
    const { connection } = make({
      "GET /instance/status": () => {
        throw new Error("ECONNREFUSED");
      },
    });
    await expect(connection.getState()).resolves.toMatchObject({ status: "unavailable" });
  });
});

describe("EvolutionConnection.connect", () => {
  it("cria a instância com a chave global e conecta com o webhook quando ela não existe", async () => {
    const { connection, calls } = make({
      "GET /instance/status": { status: 401 },
      "POST /instance/create": { body: { message: "success" } },
      "POST /instance/connect": { body: { message: "success" } },
    });
    await connection.connect();
    const create = calls.find((c) => c.key === "POST /instance/create")!;
    expect(create.headers).toMatchObject({ apikey: "global" });
    expect(create.body).toEqual({ name: "atendente", token: "inst-token" });
    const connect = calls.find((c) => c.key === "POST /instance/connect")!;
    expect(connect.headers).toMatchObject({ apikey: "inst-token" });
    expect(connect.body).toEqual({ webhookUrl: "http://api:3000/webhooks/evolution", subscribe: ["MESSAGE"], immediate: true });
  });

  it("não recria a instância que já existe", async () => {
    const { connection, calls } = make({
      ...status({ Connected: false, LoggedIn: false }),
      "POST /instance/connect": {},
    });
    await connection.connect();
    expect(calls.some((c) => c.key === "POST /instance/create")).toBe(false);
  });

  it("recusa conectar sem licença e sem chave global para criar", async () => {
    const noLicense = make({ "GET /instance/status": { status: 503, body: { code: "LICENSE_REQUIRED" } } });
    await expect(noLicense.connection.connect()).rejects.toMatchObject({ kind: "license" });

    const noKey = make({ "GET /instance/status": { status: 401 } }, {});
    await expect(noKey.connection.connect()).rejects.toMatchObject({ kind: "config" });
  });

  it("falha com erro de upstream quando o EvolutionGo recusa", async () => {
    const { connection } = make({ ...status({ Connected: false, LoggedIn: false }), "POST /instance/connect": { status: 500 } });
    await expect(connection.connect()).rejects.toBeInstanceOf(WhatsappConnectionError);
  });
});

describe("EvolutionConnection.getQr", () => {
  it("devolve o data URL do QR", async () => {
    const { connection } = make({ "GET /instance/qr": { body: { data: { qrcode: "data:image/png;base64,AAAA", code: "2@x" } } } });
    await expect(connection.getQr()).resolves.toBe("data:image/png;base64,AAAA");
  });

  it("devolve null quando ainda não há QR ou a sessão já está conectada (400)", async () => {
    const { connection } = make({ "GET /instance/qr": { status: 400, body: { error: "no QR code available" } } });
    await expect(connection.getQr()).resolves.toBeNull();
  });
});

describe("EvolutionConnection.disconnect", () => {
  it("faz logout quando há sessão", async () => {
    const { connection, calls } = make({ "DELETE /instance/logout": {} });
    await connection.disconnect();
    expect(calls.map((c) => c.key)).toEqual(["DELETE /instance/logout"]);
  });

  it("derruba a conexão quando só havia QR pendente (logout recusa)", async () => {
    const { connection, calls } = make({ "DELETE /instance/logout": { status: 400 }, "POST /instance/disconnect": {} });
    await connection.disconnect();
    expect(calls.map((c) => c.key)).toEqual(["DELETE /instance/logout", "POST /instance/disconnect"]);
  });
});

describe("EvolutionConnection.licença", () => {
  it("pede o link de cadastro com o redirect_uri", async () => {
    const { connection, calls } = make({ "GET /license/register": { body: { register_url: "https://license.test/r?token=1" } } });
    await expect(connection.getLicenseRegisterUrl("http://localhost:3100/whatsapp")).resolves.toBe("https://license.test/r?token=1");
    expect(calls[0]!.key).toBe("GET /license/register?redirect_uri=http%3A%2F%2Flocalhost%3A3100%2Fwhatsapp");
  });

  it("ativa com o code e trata código inválido como erro de entrada", async () => {
    const ok = make({ "GET /license/activate": { body: { status: "active" } } });
    await expect(ok.connection.activateLicense("abc")).resolves.toBeUndefined();
    expect(ok.calls[0]!.key).toBe("GET /license/activate?code=abc");

    const bad = make({ "GET /license/activate": { status: 400, body: { error: "invalid" } } });
    await expect(bad.connection.activateLicense("zzz")).rejects.toMatchObject({ kind: "invalid" });
  });
});
