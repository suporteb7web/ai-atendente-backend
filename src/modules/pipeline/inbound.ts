import type { Logger } from "pino";
import { logger as rootLogger } from "../../logger.js";
import type { ConversationRepository } from "../conversations/repository.js";
import { normalizePhone } from "../conversations/phone.js";
import type { MessageRepository } from "../messages/repository.js";
import type { ToolExecutionRepository } from "../tool-executions/repository.js";
import type { AcceptedInbound } from "../webhook/parser.js";
import { parseEvolutionEnvelope } from "../webhook/parser.js";
import type { AgentPort, MessagingPort, TranscriptionPort } from "../../ports.js";
import type { Conversation, Message } from "../../domain.js";

export interface AttemptInfo {
  attempt: number;
  maxAttempts: number;
}

export interface InboundDeps {
  webhookToken: string;
  historyLimit: number;
  conversations: ConversationRepository;
  messages: MessageRepository;
  toolExecutions: ToolExecutionRepository;
  agent: AgentPort;
  transcription: TranscriptionPort;
  enqueueOutbound: (messageId: string) => Promise<void>;
  logger?: Logger;
}

export interface OutboundDeps {
  conversations: ConversationRepository;
  messages: MessageRepository;
  messaging: MessagingPort;
  logger?: Logger;
}

export async function runInbound(deps: InboundDeps, envelope: unknown, attempt: AttemptInfo): Promise<void> {
  const log = deps.logger ?? rootLogger;
  const parsed = parseEvolutionEnvelope(envelope, deps.webhookToken);
  if (parsed.action === "unauthorized" || parsed.action === "discard") {
    log.debug({ reason: parsed.action === "discard" ? parsed.reason : "token" }, "evento descartado");
    return;
  }

  const phone = normalizePhone(parsed.inbound.rawPhone);
  if (!phone) return;

  const conversation = await deps.conversations.upsertByPhone({
    phone,
    pushName: parsed.inbound.pushName,
  });

  if (parsed.inbound.type === "audio" && !parsed.inbound.audio?.base64 && !parsed.inbound.audio?.mediaUrl) {
    const missing = await deps.messages.insertInbound({
      conversationId: conversation.id,
      type: "audio",
      body: "",
      status: "failed",
      providerMessageId: parsed.inbound.providerMessageId,
      providerTimestamp: parsed.inbound.providerTimestamp,
      failureReason: "áudio sem conteúdo",
    });
    log.info({ conversationId: conversation.id, messageId: missing.message.id }, "áudio sem conteúdo");
    return;
  }

  const inserted = await deps.messages.insertInbound({
    conversationId: conversation.id,
    type: parsed.inbound.type,
    body: parsed.inbound.body,
    status: "stored",
    providerMessageId: parsed.inbound.providerMessageId,
    providerTimestamp: parsed.inbound.providerTimestamp,
    failureReason: null,
  });
  log.info({ conversationId: conversation.id, messageId: inserted.message.id }, "mensagem inbound gravada");

  if (!inserted.created) {
    const resume = await resumeExisting(deps, inserted.message, conversation);
    if (resume === "stop") return;
  }

  try {
    await processStored(deps, inserted.message, conversation, parsed.inbound);
  } catch (error) {
    const reply = await deps.messages.findAgentReply(inserted.message.id);
    if (reply?.status === "queued") {
      try {
        await deps.enqueueOutbound(reply.id);
        return;
      } catch {
        // a fila recusou de novo; a tentativa seguinte reenfileira
      }
    }
    if (attempt.attempt >= attempt.maxAttempts) {
      await deps.messages.markFailedIfStored(inserted.message.id, failureReason(error));
      log.error({ conversationId: conversation.id, messageId: inserted.message.id }, "inbound falhou");
    }
    throw error;
  }
}

async function resumeExisting(
  deps: InboundDeps,
  message: Message,
  conversation: Conversation,
): Promise<"stop" | "continue"> {
  if (message.status !== "stored" || message.type === "unsupported") return "stop";
  const reply = await deps.messages.findAgentReply(message.id);
  if (reply) {
    if (reply.status === "queued") await deps.enqueueOutbound(reply.id);
    return "stop";
  }
  const calls = await deps.toolExecutions.listForMessage(message.id);
  if (calls.length > 0) {
    if (calls.some((call) => call.name === "request_handoff" && call.status === "success")) {
      await deps.conversations.setHandoff(conversation.id, true);
      return "stop";
    }
    await deps.messages.markFailedIfStored(message.id, "falha no processamento");
    return "stop";
  }
  return "continue";
}

async function processStored(
  deps: InboundDeps,
  message: Message,
  conversation: Conversation,
  inbound: AcceptedInbound,
): Promise<void> {
  if (message.type === "unsupported" || message.status === "failed") return;

  let body = message.body;
  if (message.type === "audio" && body.trim() === "") {
    const audio = inbound.audio;
    if (!audio) throw new Error("áudio sem conteúdo");
    const bytes = await loadAudio(audio);
    body = await deps.transcription.transcribe(bytes, audio.mimeType);
    await deps.messages.updateBody(message.id, body);
  }

  const current = await deps.conversations.findById(conversation.id);
  if (current?.handoff) return;

  const history = await deps.messages.listHistory(conversation.id, deps.historyLimit);
  const result = await deps.agent.run({
    conversationId: conversation.id,
    phone: conversation.phone,
    history: history.map((item) => ({ author: item.author, body: item.body })),
  });

  for (const call of result.toolCalls) {
    await deps.toolExecutions.insert({
      conversationId: conversation.id,
      messageId: message.id,
      name: call.name,
      arguments: call.arguments,
      result: call.result,
      status: call.status,
    });
  }

  if (result.handoffRequested) {
    await deps.conversations.setHandoff(conversation.id, true);
  }
  if (result.toolRoundsExceeded) {
    await deps.messages.markFailedIfStored(message.id, "limite de rodadas de tool");
    return;
  }
  if (result.handoffRequested) return;

  const text = result.text.trim();
  if (!text) return;
  const outbound = await deps.messages.insertOutbound({
    conversationId: conversation.id,
    author: "agent",
    body: text,
    replyToMessageId: message.id,
  });
  await deps.enqueueOutbound(outbound.id);
}

const sendChains = new Map<string, Promise<void>>();

export async function runOutbound(deps: OutboundDeps, messageId: string, attempt: AttemptInfo): Promise<void> {
  const previous = sendChains.get(messageId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => deliverOutbound(deps, messageId, attempt));
  sendChains.set(messageId, current);
  try {
    await current;
  } finally {
    if (sendChains.get(messageId) === current) sendChains.delete(messageId);
  }
}

async function deliverOutbound(deps: OutboundDeps, messageId: string, attempt: AttemptInfo): Promise<void> {
  const log = deps.logger ?? rootLogger;
  const message = await deps.messages.findById(messageId);
  if (!message || message.status === "sent" || message.status === "failed" || message.status !== "queued") return;
  const conversation = await deps.conversations.findById(message.conversationId);
  if (!conversation) return;

  try {
    const providerMessageId = await deps.messaging.sendText(conversation.phone, message.body);
    const sent = await deps.messages.markSentIfQueued(message.id, providerMessageId);
    if (sent) {
      log.info({ conversationId: conversation.id, messageId: message.id }, "mensagem enviada");
    }
  } catch (error) {
    if (attempt.attempt >= attempt.maxAttempts) {
      await deps.messages.markFailedIfQueued(message.id, "falha ao enviar");
      log.error({ conversationId: conversation.id, messageId: message.id }, "envio falhou");
    }
    throw error;
  }
}

async function loadAudio(audio: NonNullable<AcceptedInbound["audio"]>): Promise<Buffer> {
  if (audio.base64) {
    const raw = audio.base64.includes(",") ? audio.base64.slice(audio.base64.indexOf(",") + 1) : audio.base64;
    const bytes = Buffer.from(raw, "base64");
    if (bytes.length === 0) throw new Error("áudio sem conteúdo");
    return bytes;
  }
  if (!audio.mediaUrl) throw new Error("áudio sem conteúdo");
  const response = await fetch(audio.mediaUrl);
  if (!response.ok) throw new Error("download de áudio falhou");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("áudio sem conteúdo");
  return bytes;
}

function failureReason(error: unknown): string {
  if (error instanceof Error && isSafeReason(error.message)) return error.message;
  return "falha no processamento";
}

function isSafeReason(message: string): boolean {
  return (
    message === "transcrição falhou" ||
    message === "transcrição vazia" ||
    message === "download de áudio falhou" ||
    message === "áudio sem conteúdo" ||
    message === "openai falhou" ||
    message === "histórico vazio"
  );
}
