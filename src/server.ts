import type { Server } from "node:http";
import { AdkAgent } from "./adapters/agent/adk-agent.js";
import { ElevenLabsClient } from "./adapters/elevenlabs/client.js";
import { EvolutionClient } from "./adapters/evolution/client.js";
import { EvolutionConnection } from "./adapters/evolution/connection.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase, postgresReady } from "./db/client.js";
import { migrateWithRetry } from "./db/migrate.js";
import { logger } from "./logger.js";
import { PostgresConversationRepository } from "./modules/conversations/postgres-repository.js";
import { PostgresMessageRepository } from "./modules/messages/postgres-repository.js";
import { runInbound, runOutbound } from "./modules/pipeline/inbound.js";
import { PostgresToolExecutionRepository } from "./modules/tool-executions/postgres-repository.js";
import { createRedis, redisReady } from "./queues/connection.js";
import { createInboundQueue, startInboundWorker } from "./queues/inbound.js";
import { createOutboundQueue, startOutboundWorker } from "./queues/outbound.js";

const config = loadConfig();
const { db, pool } = createDatabase(config.databaseUrl);
await migrateWithRetry(db);

const queueRedis = createRedis(config.redisUrl);
const inboundRedis = createRedis(config.redisUrl);
const outboundRedis = createRedis(config.redisUrl);

const conversations = new PostgresConversationRepository(db);
const messages = new PostgresMessageRepository(db);
const toolExecutions = new PostgresToolExecutionRepository(db);
const messaging = new EvolutionClient({
  baseUrl: config.evolutionBaseUrl,
  apiKey: config.evolutionApiKey,
});
const whatsapp = new EvolutionConnection({
  baseUrl: config.evolutionBaseUrl,
  instanceToken: config.evolutionApiKey,
  globalApiKey: config.evolutionGlobalApiKey || undefined,
  instanceName: config.evolutionInstanceName,
  webhookUrl: config.evolutionWebhookUrl,
});
const transcription = new ElevenLabsClient({
  apiKey: config.elevenLabsApiKey,
  model: config.elevenLabsSttModel,
  languageCode: config.elevenLabsLanguageCode,
});
const agent = new AdkAgent({
  apiKey: config.openAiApiKey,
  model: config.openAiModel,
  maxToolRounds: config.agentMaxToolRounds,
  reasoningEffort: config.openAiReasoningEffort,
});

const inboundQueue = createInboundQueue(queueRedis);
const outboundQueue = createOutboundQueue(queueRedis);

const pipelineDeps = {
  webhookToken: config.evolutionWebhookToken,
  historyLimit: config.agentHistoryLimit,
  conversations,
  messages,
  toolExecutions,
  agent,
  transcription,
  enqueueOutbound: async (messageId: string) => {
    await outboundQueue.add("outbound", { messageId });
  },
  logger,
};

const inboundWorker = startInboundWorker(inboundRedis, (envelope, attempt) => runInbound(pipelineDeps, envelope, attempt));
const outboundWorker = startOutboundWorker(outboundRedis, (messageId, attempt) =>
  runOutbound(
    {
      conversations,
      messages,
      messaging,
      logger,
    },
    messageId,
    attempt,
  ),
);

const app = createApp({
  config,
  operator: {
    conversations,
    messages,
    toolExecutions,
    enqueueOutbound: pipelineDeps.enqueueOutbound,
  },
  whatsapp,
  enqueueInbound: async (envelope) => {
    await inboundQueue.add("inbound", { envelope });
  },
  checkReady: async () => (await postgresReady(pool)) && (await redisReady(queueRedis)),
});

const server: Server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "http up");
});

async function shutdown(): Promise<void> {
  server.close();
  await inboundWorker.close();
  await outboundWorker.close();
  await inboundQueue.close();
  await outboundQueue.close();
  queueRedis.disconnect();
  inboundRedis.disconnect();
  outboundRedis.disconnect();
  await pool.end();
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
