import { parseConfig, type AppConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import type { AgentPort, AgentRunInput, AgentRunResult } from "../src/ports.js";
import { createMemoryStore } from "./memory-store.js";

export const TOKEN = "operator-token";
export const WEBHOOK_TOKEN = "hook-token";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...parseConfig({
      DATABASE_URL: "postgres://localhost/atendente",
      REDIS_URL: "redis://localhost:6379",
      API_TOKEN: TOKEN,
      EVOLUTION_BASE_URL: "http://evolution.test/",
      EVOLUTION_API_KEY: "evo-key",
      EVOLUTION_WEBHOOK_TOKEN: WEBHOOK_TOKEN,
      ELEVENLABS_API_KEY: "eleven",
      OPENAI_API_KEY: "openai",
    }),
    ...overrides,
  };
}

export function createTestApp(options?: { ready?: boolean }) {
  const store = createMemoryStore();
  const outbound: string[] = [];
  const inbound: unknown[] = [];
  const config = testConfig();
  const app = createApp({
    config,
    operator: {
      ...store,
      enqueueOutbound: async (messageId) => {
        outbound.push(messageId);
      },
    },
    enqueueInbound: async (envelope) => {
      inbound.push(envelope);
    },
    checkReady: async () => options?.ready ?? true,
  });
  return { app, store, outbound, inbound, token: TOKEN, webhookToken: WEBHOOK_TOKEN };
}

export class FakeAgent implements AgentPort {
  readonly calls: AgentRunInput[] = [];
  result: AgentRunResult = {
    text: "olá",
    toolCalls: [],
    handoffRequested: false,
    toolRoundsExceeded: false,
  };

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    this.calls.push(input);
    return this.result;
  }
}

export function textEnvelope(body = "oi", id = "MSG1", chat = "5511999999999@s.whatsapp.net") {
  return {
    event: "Message",
    instanceToken: WEBHOOK_TOKEN,
    data: {
      Info: {
        ID: id,
        IsFromMe: false,
        IsGroup: false,
        PushName: "Ana",
        Timestamp: "2026-11-17T12:00:00.000Z",
        Chat: chat,
        MediaType: "",
      },
      Message: { conversation: body },
    },
  };
}
