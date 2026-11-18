import { describe, expect, it, vi } from "vitest";
import { OpenAiLlm } from "../src/adapters/agent/openai-llm.js";

describe("OpenAiLlm", () => {
  it("manda gpt-6-luna no body e não faz streaming", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "olá" } }] }), { status: 200 }),
    );
    const llm = new OpenAiLlm({ model: "gpt-6-luna", apiKey: "sk-test", fetchImpl });
    const response = await llm
      .generateContentAsync({
        model: "gpt-6-luna",
        contents: [{ role: "user", parts: [{ text: "oi" }] }],
        liveConnectConfig: {},
        toolsDict: {},
        config: {
          systemInstruction: "seja breve",
          tools: [
            {
              functionDeclarations: [
                {
                  name: "current_time",
                  description: "hora",
                  parameters: { type: "OBJECT", properties: {} } as never,
                },
              ],
            },
          ],
        },
      })
      .next();

    const calls = fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>;
    const [url, init] = calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("gpt-6-luna");
    expect(body.stream).toBeUndefined();
    expect(body.messages[0]).toEqual({ role: "system", content: "seja breve" });
    expect(body.tools[0].function.name).toBe("current_time");
    expect(body.tools[0].function.parameters.type).toBe("object");
    if (!response.value) throw new Error("sem resposta");
    expect(response.value.content?.parts?.[0]?.text).toBe("olá");
  });

  it("connect rejeita o modo live", async () => {
    const llm = new OpenAiLlm({ model: "gpt-6-luna", apiKey: "sk-test" });
    await expect(llm.connect({ contents: [], liveConnectConfig: {}, toolsDict: {} })).rejects.toThrow(/live/i);
  });
});
