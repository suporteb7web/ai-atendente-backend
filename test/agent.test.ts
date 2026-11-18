import { describe, expect, it, vi } from "vitest";
import { AdkAgent } from "../src/adapters/agent/adk-agent.js";

function jsonResponse(message: unknown) {
  return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
}

describe("AdkAgent", () => {
  it("executa a tool, devolve o resultado ao modelo no mesmo turno e usa esse texto", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (bodies.length === 1) {
        return jsonResponse({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_time",
              type: "function",
              function: { name: "current_time", arguments: "{}" },
            },
          ],
        });
      }
      return jsonResponse({ role: "assistant", content: "agora são 12h" });
    });
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const agent = new AdkAgent({ apiKey: "sk-test", model: "gpt-6-luna", maxToolRounds: 5 });
      const result = await agent.run({
        conversationId: "11111111-1111-4111-8111-111111111111",
        phone: "5511999999999",
        history: [
          { author: "operator", body: "o cliente perguntou a hora" },
          { author: "customer", body: "que horas são?" },
        ],
      });
      expect(result.toolCalls.map((call) => call.name)).toEqual(["current_time"]);
      expect(result.toolCalls[0]?.status).toBe("success");
      expect(result.toolCalls[0]?.result).toMatchObject({ iso: expect.stringMatching(/-03:00$/) });
      expect(result.text).toBe("agora são 12h");
      expect(result.handoffRequested).toBe(false);
      const second = bodies[1] as { model: string; messages: Array<{ role: string; content?: string }> };
      expect(second.model).toBe("gpt-6-luna");
      const toolMessage = second.messages.find((message) => message.role === "tool");
      expect(toolMessage?.content).toContain("iso");
      expect(second.messages.some((message) => message.content?.includes("o cliente perguntou a hora"))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("request_handoff volta como pedido de handoff", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: unknown[] };
      if (body.messages.some((message) => (message as { role?: string }).role === "tool")) {
        return jsonResponse({ role: "assistant", content: "já chamei" });
      }
      return jsonResponse({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_handoff",
            type: "function",
            function: { name: "request_handoff", arguments: JSON.stringify({ reason: "cliente pediu humano" }) },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const agent = new AdkAgent({ apiKey: "sk-test", model: "gpt-6-luna", maxToolRounds: 5 });
      const result = await agent.run({
        conversationId: "11111111-1111-4111-8111-111111111111",
        phone: "5511999999999",
        history: [{ author: "customer", body: "quero um humano" }],
      });
      expect(result.handoffRequested).toBe(true);
      expect(result.toolCalls[0]).toMatchObject({
        name: "request_handoff",
        status: "success",
        arguments: { reason: "cliente pediu humano" },
        result: { accepted: true, reason: "cliente pediu humano" },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("estourar as rodadas de tool não devolve texto", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        role: "assistant",
        content: "não deveria sair",
        tool_calls: [
          {
            id: `call_${Math.random()}`,
            type: "function",
            function: { name: "current_time", arguments: "{}" },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const agent = new AdkAgent({ apiKey: "sk-test", model: "gpt-6-luna", maxToolRounds: 1 });
      const result = await agent.run({
        conversationId: "11111111-1111-4111-8111-111111111111",
        phone: "5511999999999",
        history: [{ author: "customer", body: "de novo" }],
      });
      expect(result.toolRoundsExceeded).toBe(true);
      expect(result.text).toBe("");
      expect(result.toolCalls).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
