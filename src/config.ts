export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface AppConfig {
  databaseUrl: string;
  redisUrl: string;
  apiToken: string;
  evolutionBaseUrl: string;
  evolutionApiKey: string;
  evolutionWebhookToken: string;
  elevenLabsApiKey: string;
  openAiApiKey: string;
  port: number;
  openAiModel: string;
  elevenLabsSttModel: string;
  elevenLabsLanguageCode: string;
  agentHistoryLimit: number;
  agentMaxToolRounds: number;
  corsOrigin: string;
}

type Env = Record<string, string | undefined>;

const REQUIRED = [
  "DATABASE_URL",
  "REDIS_URL",
  "API_TOKEN",
  "EVOLUTION_BASE_URL",
  "EVOLUTION_API_KEY",
  "EVOLUTION_WEBHOOK_TOKEN",
  "ELEVENLABS_API_KEY",
  "OPENAI_API_KEY",
] as const;

export function parseConfig(env: Env): AppConfig {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new ConfigError(`faltam variáveis: ${missing.join(", ")}`);
  }

  return {
    databaseUrl: env.DATABASE_URL!.trim(),
    redisUrl: env.REDIS_URL!.trim(),
    apiToken: env.API_TOKEN!.trim(),
    evolutionBaseUrl: stripTrailingSlash(env.EVOLUTION_BASE_URL!.trim()),
    evolutionApiKey: env.EVOLUTION_API_KEY!.trim(),
    evolutionWebhookToken: env.EVOLUTION_WEBHOOK_TOKEN!.trim(),
    elevenLabsApiKey: env.ELEVENLABS_API_KEY!.trim(),
    openAiApiKey: env.OPENAI_API_KEY!.trim(),
    port: positiveInt(env.PORT, "PORT", 3000),
    openAiModel: env.OPENAI_MODEL?.trim() || "gpt-6-luna",
    elevenLabsSttModel: env.ELEVENLABS_STT_MODEL?.trim() || "scribe_v4_turbo",
    elevenLabsLanguageCode: env.ELEVENLABS_LANGUAGE_CODE?.trim() || "por",
    agentHistoryLimit: positiveInt(env.AGENT_HISTORY_LIMIT, "AGENT_HISTORY_LIMIT", 40),
    agentMaxToolRounds: positiveInt(env.AGENT_MAX_TOOL_ROUNDS, "AGENT_MAX_TOOL_ROUNDS", 5),
    corsOrigin: env.CORS_ORIGIN?.trim() ?? "",
  };
}

export function loadConfig(): AppConfig {
  try {
    return parseConfig(process.env);
  } catch (error) {
    const message = error instanceof Error ? error.message : "configuração inválida";
    console.error(message);
    process.exit(1);
  }
}

function positiveInt(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${name} inválida`);
  }
  return value;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
