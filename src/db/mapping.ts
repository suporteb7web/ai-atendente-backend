import type { Author, Direction, Message, MessageStatus, MessageType, ToolExecution, ToolStatus } from "../domain.js";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUniqueViolation(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if ("code" in current && (current as { code?: unknown }).code === "23505") return true;
    if ("cause" in current) queue.push((current as { cause?: unknown }).cause);
  }
  return false;
}

export function asDirection(value: string): Direction {
  if (value === "inbound" || value === "outbound") return value;
  throw new Error(`direction inválida: ${value}`);
}

export function asAuthor(value: string): Author {
  if (value === "customer" || value === "agent" || value === "operator") return value;
  throw new Error(`author inválido: ${value}`);
}

export function asMessageType(value: string): MessageType {
  if (value === "text" || value === "audio" || value === "unsupported") return value;
  throw new Error(`type inválido: ${value}`);
}

export function asMessageStatus(value: string): MessageStatus {
  if (value === "stored" || value === "queued" || value === "sent" || value === "failed") return value;
  throw new Error(`status inválido: ${value}`);
}

export function asToolStatus(value: string): ToolStatus {
  if (value === "success" || value === "error") return value;
  throw new Error(`status de tool inválido: ${value}`);
}

export function compareTimeId(
  left: { at: Date; id: string },
  right: { at: Date; id: string },
): number {
  const delta = left.at.getTime() - right.at.getTime();
  if (delta !== 0) return delta;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function mapMessage(row: {
  id: string;
  conversationId: string;
  direction: string;
  author: string;
  type: string;
  body: string;
  status: string;
  providerMessageId: string | null;
  providerTimestamp: Date | null;
  failureReason: string | null;
  replyToMessageId: string | null;
  createdAt: Date;
}): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    direction: asDirection(row.direction),
    author: asAuthor(row.author),
    type: asMessageType(row.type),
    body: row.body,
    status: asMessageStatus(row.status),
    providerMessageId: row.providerMessageId,
    providerTimestamp: row.providerTimestamp,
    failureReason: row.failureReason,
    replyToMessageId: row.replyToMessageId,
    createdAt: row.createdAt,
  };
}

export function mapToolExecution(row: {
  id: string;
  conversationId: string;
  messageId: string;
  name: string;
  arguments: unknown;
  result: unknown;
  status: string;
  createdAt: Date;
}): ToolExecution {
  return {
    id: row.id,
    conversationId: row.conversationId,
    messageId: row.messageId,
    name: row.name,
    arguments:
      row.arguments && typeof row.arguments === "object" && !Array.isArray(row.arguments)
        ? (row.arguments as Record<string, unknown>)
        : {},
    result: row.result,
    status: asToolStatus(row.status),
    createdAt: row.createdAt,
  };
}
