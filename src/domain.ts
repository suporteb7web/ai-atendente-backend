export type Direction = "inbound" | "outbound";
export type Author = "customer" | "agent" | "operator";
export type MessageType = "text" | "audio" | "unsupported";
export type MessageStatus = "stored" | "queued" | "sent" | "failed";
export type ToolStatus = "success" | "error";

export interface Conversation {
  id: string;
  phone: string;
  pushName: string | null;
  handoff: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: Direction;
  author: Author;
  type: MessageType;
  body: string;
  status: MessageStatus;
  providerMessageId: string | null;
  providerTimestamp: Date | null;
  failureReason: string | null;
  replyToMessageId: string | null;
  createdAt: Date;
}

export interface ToolExecution {
  id: string;
  conversationId: string;
  messageId: string;
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  status: ToolStatus;
  createdAt: Date;
}

export interface LastMessage {
  body: string;
  author: Author;
  createdAt: Date;
}

export interface ConversationListItem {
  id: string;
  phone: string;
  pushName: string | null;
  handoff: boolean;
  updatedAt: Date;
  lastMessage: LastMessage | null;
}

export interface TimeIdCursor {
  at: Date;
  id: string;
}
