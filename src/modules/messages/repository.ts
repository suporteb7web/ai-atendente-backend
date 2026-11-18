import type { Author, LastMessage, Message, MessageStatus, MessageType, TimeIdCursor } from "../../domain.js";

export interface InsertInboundInput {
  conversationId: string;
  type: MessageType;
  body: string;
  status: Extract<MessageStatus, "stored" | "failed">;
  providerMessageId: string;
  providerTimestamp: Date | null;
  failureReason: string | null;
  createdAt?: Date;
}

export interface InsertOutboundInput {
  conversationId: string;
  author: Extract<Author, "agent" | "operator">;
  body: string;
  replyToMessageId: string | null;
  createdAt?: Date;
}

export interface InsertResult {
  created: boolean;
  message: Message;
}

export interface MessageRepository {
  insertInbound(input: InsertInboundInput): Promise<InsertResult>;
  insertOutbound(input: InsertOutboundInput): Promise<Message>;
  findById(id: string): Promise<Message | null>;
  findAgentReply(inboundId: string): Promise<Message | null>;
  updateBody(id: string, body: string): Promise<void>;
  markFailedIfStored(id: string, reason: string): Promise<void>;
  markFailedIfQueued(id: string, reason: string): Promise<void>;
  markSentIfQueued(id: string, providerMessageId: string): Promise<boolean>;
  listHistory(conversationId: string, limit: number): Promise<Message[]>;
  latestWithBody(conversationId: string): Promise<LastMessage | null>;
  listPage(input: {
    conversationId: string;
    limit: number;
    cursor?: TimeIdCursor;
  }): Promise<{ items: Message[]; hasMore: boolean }>;
}
