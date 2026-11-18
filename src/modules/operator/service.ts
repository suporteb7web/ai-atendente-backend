import { HttpError, encodeCursor, parseCursor, parseLimit, parseOperatorText, parseUuidParam } from "../../http/validate.js";
import type { ConversationRepository } from "../conversations/repository.js";
import type { MessageRepository } from "../messages/repository.js";
import type { ToolExecutionRepository } from "../tool-executions/repository.js";

export interface OperatorDeps {
  conversations: ConversationRepository;
  messages: MessageRepository;
  toolExecutions: ToolExecutionRepository;
  enqueueOutbound: (messageId: string) => Promise<void>;
}

export async function listConversations(deps: OperatorDeps, query: { limit?: unknown; cursor?: unknown }) {
  const limit = parseLimit(query.limit, 30, 100);
  const cursor = parseCursor(query.cursor);
  const page = await deps.conversations.list({ limit, cursor });
  const last = page.items[page.items.length - 1];
  return {
    items: page.items,
    nextCursor: page.hasMore && last ? encodeCursor(last.updatedAt, last.id) : null,
  };
}

export async function getConversation(deps: OperatorDeps, id: string) {
  const conversationId = parseUuidParam(id);
  const conversation = await deps.conversations.findById(conversationId);
  if (!conversation) throw new HttpError(404, "não encontrado");
  const [lastMessage, tools] = await Promise.all([
    deps.messages.latestWithBody(conversationId),
    deps.toolExecutions.listRecent(conversationId, 20),
  ]);
  return { conversation, lastMessage, tools };
}

export async function listMessages(deps: OperatorDeps, id: string, query: { limit?: unknown; cursor?: unknown }) {
  const conversationId = parseUuidParam(id);
  const conversation = await deps.conversations.findById(conversationId);
  if (!conversation) throw new HttpError(404, "não encontrado");
  const limit = parseLimit(query.limit, 50, 100);
  const cursor = parseCursor(query.cursor);
  const page = await deps.messages.listPage({ conversationId, limit, cursor });
  const oldest = page.items[0];
  return {
    items: page.items,
    nextCursor: page.hasMore && oldest ? encodeCursor(oldest.createdAt, oldest.id) : null,
  };
}

export async function listToolExecutions(
  deps: OperatorDeps,
  id: string,
  query: { limit?: unknown; cursor?: unknown },
) {
  const conversationId = parseUuidParam(id);
  const conversation = await deps.conversations.findById(conversationId);
  if (!conversation) throw new HttpError(404, "não encontrado");
  const limit = parseLimit(query.limit, 50, 100);
  const cursor = parseCursor(query.cursor);
  const page = await deps.toolExecutions.listPage({ conversationId, limit, cursor });
  const oldest = page.items[page.items.length - 1];
  return {
    items: page.items,
    nextCursor: page.hasMore && oldest ? encodeCursor(oldest.createdAt, oldest.id) : null,
  };
}

export async function sendOperatorMessage(deps: OperatorDeps, id: string, body: unknown) {
  const conversationId = parseUuidParam(id);
  const conversation = await deps.conversations.findById(conversationId);
  if (!conversation) throw new HttpError(404, "não encontrado");
  const text = parseOperatorText(body);
  const message = await deps.messages.insertOutbound({
    conversationId,
    author: "operator",
    body: text,
    replyToMessageId: null,
  });
  await deps.enqueueOutbound(message.id);
  return message;
}

export async function setConversationHandoff(deps: OperatorDeps, id: string, enabled: boolean) {
  const conversationId = parseUuidParam(id);
  const conversation = await deps.conversations.setHandoff(conversationId, enabled);
  if (!conversation) throw new HttpError(404, "não encontrado");
  return { id: conversation.id, handoff: conversation.handoff };
}
