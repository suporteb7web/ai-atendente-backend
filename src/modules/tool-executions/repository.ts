import type { ToolExecution, ToolStatus, TimeIdCursor } from "../../domain.js";

export interface InsertToolExecutionInput {
  conversationId: string;
  messageId: string;
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
  status: ToolStatus;
  createdAt?: Date;
}

export interface ToolExecutionRepository {
  insert(input: InsertToolExecutionInput): Promise<ToolExecution>;
  listForMessage(messageId: string): Promise<ToolExecution[]>;
  listRecent(conversationId: string, limit: number): Promise<ToolExecution[]>;
  listPage(input: {
    conversationId: string;
    limit: number;
    cursor?: TimeIdCursor;
  }): Promise<{ items: ToolExecution[]; hasMore: boolean }>;
}
