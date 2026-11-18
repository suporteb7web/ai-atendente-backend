import { describe, expect, it, vi } from "vitest";
import { EvolutionClient } from "../src/adapters/evolution/client.js";

describe("EvolutionClient", () => {
  it("envia number e text com o header apikey e lê messageId", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ messageId: "EVO1" }), { status: 200 }));
    const client = new EvolutionClient({
      baseUrl: "http://evolution.test",
      apiKey: "segredo",
      fetchImpl,
    });

    await expect(client.sendText("5511999999999", "olá")).resolves.toBe("EVO1");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const [url, init] = calls[0]!;
    expect(url).toBe("http://evolution.test/send/text");
    expect(init?.headers).toMatchObject({ apikey: "segredo" });
    expect(JSON.parse(String(init?.body))).toEqual({ number: "5511999999999", text: "olá" });
  });

  it("falha sem gravar o corpo quando a API recusa", async () => {
    const fetchImpl = vi.fn(async () => new Response("segredo do provedor", { status: 500 }));
    const client = new EvolutionClient({ baseUrl: "http://evolution.test", apiKey: "k", fetchImpl });
    await expect(client.sendText("5511999999999", "olá")).rejects.toThrow("envio falhou");
  });
});
