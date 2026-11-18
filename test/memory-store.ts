import { randomUUID } from "node:crypto";
import { nowTimestamp } from "../src/clock.js";
import { compareTimeId } from "../src/db/mapping.js";
import type { Conversation, LastMessage, Message, ToolExecution } from "../src/domain.js";
import type { ConversationRepository } from "../src/modules/conversations/repository.js";
import type { MessageRepository } from "../src/modules/messages/repository.js";
import type { ToolExecutionRepository } from "../src/modules/tool-executions/repository.js";

export interface MemoryStore {
  conversations: ConversationRepository;
  messages: MessageRepository;
  toolExecutions: ToolExecutionRepository;
}

export function createMemoryStore(): MemoryStore {
  const conversations: Conversation[] = [];
  const messages: Message[] = [];
  const tools: ToolExecution[] = [];

  const conversationRepo: ConversationRepository = {
    async upsertByPhone(input) {
      const existing = conversations.find((item) => item.phone === input.phone);
      if (existing) {
        if (input.pushName) existing.pushName = input.pushName;
        return { ...existing };
      }
      const created: Conversation = {
        id: randomUUID(),
        phone: input.phone,
        pushName: input.pushName,
        handoff: false,
        createdAt: nowTimestamp(),
        updatedAt: nowTimestamp(),
      };
      conversations.push(created);
      return { ...created };
    },
    async findById(id) {
      const found = conversations.find((item) => item.id === id);
      return found ? { ...found } : null;
    },
    async setHandoff(id, enabled) {
      const found = conversations.find((item) => item.id === id);
      if (!found) return null;
      found.handoff = enabled;
      return { ...found };
    },
    async touch(id, at) {
      const found = conversations.find((item) => item.id === id);
      if (found) found.updatedAt = at;
    },
    async list(input) {
      const sorted = [...conversations].sort((left, right) =>
        compareTimeId({ at: right.updatedAt, id: right.id }, { at: left.updatedAt, id: left.id }),
      );
      const filtered = input.cursor
        ? sorted.filter((item) => compareTimeId({ at: item.updatedAt, id: item.id }, input.cursor!) < 0)
        : sorted;
      const hasMore = filtered.length > input.limit;
      const page = filtered.slice(0, input.limit);
      return {
        hasMore,
        items: page.map((item) => ({ ...item, lastMessage: latestBody(item.id) })),
      };
    },
  };

  const messageRepo: MessageRepository = {
    async insertInbound(input) {
      const existing = messages.find((item) => item.providerMessageId === input.providerMessageId);
      if (existing) return { created: false, message: { ...existing } };
      const message = pushMessage({
        conversationId: input.conversationId,
        direction: "inbound",
        author: "customer",
        type: input.type,
        body: input.body,
        status: input.status,
        providerMessageId: input.providerMessageId,
        providerTimestamp: input.providerTimestamp,
        failureReason: input.failureReason,
        replyToMessageId: null,
        createdAt: input.createdAt,
      });
      conversationRepo.touch(input.conversationId, message.createdAt);
      return { created: true, message };
    },
    async insertOutbound(input) {
      const message = pushMessage({
        conversationId: input.conversationId,
        direction: "outbound",
        author: input.author,
        type: "text",
        body: input.body,
        status: "queued",
        providerMessageId: null,
        providerTimestamp: null,
        failureReason: null,
        replyToMessageId: input.replyToMessageId,
        createdAt: input.createdAt,
      });
      conversationRepo.touch(input.conversationId, message.createdAt);
      return message;
    },
    async findById(id) {
      const found = messages.find((item) => item.id === id);
      return found ? { ...found } : null;
    },
    async findAgentReply(inboundId) {
      const found = messages
        .filter((item) => item.replyToMessageId === inboundId && item.author === "agent")
        .sort((left, right) => compareTimeId({ at: right.createdAt, id: right.id }, { at: left.createdAt, id: left.id }));
      return found[0] ? { ...found[0] } : null;
    },
    async updateBody(id, body) {
      const found = messages.find((item) => item.id === id);
      if (found) found.body = body;
    },
    async markFailedIfStored(id, reason) {
      const found = messages.find((item) => item.id === id && item.status === "stored");
      if (!found) return;
      found.status = "failed";
      found.failureReason = reason.slice(0, 500);
    },
    async markFailedIfQueued(id, reason) {
      const found = messages.find((item) => item.id === id && item.status === "queued");
      if (!found) return;
      found.status = "failed";
      found.failureReason = reason.slice(0, 500);
    },
    async markSentIfQueued(id, providerMessageId) {
      const found = messages.find((item) => item.id === id && item.status === "queued");
      if (!found) return false;
      found.status = "sent";
      found.providerMessageId = providerMessageId;
      return true;
    },
    async listHistory(conversationId, limit) {
      return messages
        .filter((item) => item.conversationId === conversationId && item.status !== "failed")
        .sort((left, right) => compareTimeId({ at: right.createdAt, id: right.id }, { at: left.createdAt, id: left.id }))
        .slice(0, limit)
        .reverse()
        .map((item) => ({ ...item }));
    },
    async latestWithBody(conversationId) {
      return latestBody(conversationId);
    },
    async listPage(input) {
      const sorted = messages
        .filter((item) => item.conversationId === input.conversationId)
        .sort((left, right) => compareTimeId({ at: right.createdAt, id: right.id }, { at: left.createdAt, id: left.id }));
      const filtered = input.cursor
        ? sorted.filter((item) => compareTimeId({ at: item.createdAt, id: item.id }, input.cursor!) < 0)
        : sorted;
      const hasMore = filtered.length > input.limit;
      return { hasMore, items: filtered.slice(0, input.limit).reverse().map((item) => ({ ...item })) };
    },
  };

  const toolRepo: ToolExecutionRepository = {
    async insert(input) {
      const created: ToolExecution = {
        id: randomUUID(),
        conversationId: input.conversationId,
        messageId: input.messageId,
        name: input.name,
        arguments: input.arguments,
        result: input.result,
        status: input.status,
        createdAt: input.createdAt ?? nowTimestamp(),
      };
      tools.push(created);
      return { ...created, arguments: { ...created.arguments } };
    },
    async listForMessage(messageId) {
      return tools
        .filter((item) => item.messageId === messageId)
        .sort((left, right) => compareTimeId({ at: right.createdAt, id: right.id }, { at: left.createdAt, id: left.id }))
        .map((item) => ({ ...item }));
    },
    async listRecent(conversationId, limit) {
      return tools
        .filter((item) => item.conversationId === conversationId)
        .sort((left, right) => compareTimeId({ at: right.createdAt, id: right.id }, { at: left.createdAt, id: left.id }))
        .slice(0, limit)
        .map((item) => ({ ...item }));
    },
    async listPage(input) {
      const sorted = tools
        .filter((item) => item.conversationId === input.conversationId)
        .sort((left, right) => compareTimeId({ at: right.createdAt, id: right.id }, { at: left.createdAt, id: left.id }));
      const filtered = input.cursor
        ? sorted.filter((item) => compareTimeId({ at: item.createdAt, id: item.id }, input.cursor!) < 0)
        : sorted;
      const hasMore = filtered.length > input.limit;
      return { hasMore, items: filtered.slice(0, input.limit).map((item) => ({ ...item })) };
    },
  };

  return { conversations: conversationRepo, messages: messageRepo, toolExecutions: toolRepo };

  function latestBody(conversationId: string): LastMessage | null {
    const found = messages
      .filter((item) => item.conversationId === conversationId && item.body.trim() !== "")
      .sort((left, right) => compareTimeId({ at: right.createdAt, id: right.id }, { at: left.createdAt, id: left.id }))[0];
    if (!found) return null;
    return { body: found.body, author: found.author, createdAt: found.createdAt };
  }

  function pushMessage(input: {
    conversationId: string;
    direction: Message["direction"];
    author: Message["author"];
    type: Message["type"];
    body: string;
    status: Message["status"];
    providerMessageId: string | null;
    providerTimestamp: Date | null;
    failureReason: string | null;
    replyToMessageId: string | null;
    createdAt?: Date;
  }): Message {
    const message: Message = {
      id: randomUUID(),
      conversationId: input.conversationId,
      direction: input.direction,
      author: input.author,
      type: input.type,
      body: input.body,
      status: input.status,
      providerMessageId: input.providerMessageId,
      providerTimestamp: input.providerTimestamp,
      failureReason: input.failureReason,
      replyToMessageId: input.replyToMessageId,
      createdAt: input.createdAt ?? nowTimestamp(),
    };
    messages.push(message);
    return { ...message };
  }
}
