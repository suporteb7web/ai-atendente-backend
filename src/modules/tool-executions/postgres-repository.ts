import { and, desc, eq, lt, or } from "drizzle-orm";
import { nowTimestamp } from "../../clock.js";
import type { Database } from "../../db/client.js";
import { mapToolExecution } from "../../db/mapping.js";
import { toolExecutions } from "../../db/schema.js";
import type { ToolExecution } from "../../domain.js";
import type { InsertToolExecutionInput, ToolExecutionRepository } from "./repository.js";

export class PostgresToolExecutionRepository implements ToolExecutionRepository {
  constructor(private readonly db: Database) {}

  async insert(input: InsertToolExecutionInput): Promise<ToolExecution> {
    const [row] = await this.db
      .insert(toolExecutions)
      .values({
        conversationId: input.conversationId,
        messageId: input.messageId,
        name: input.name,
        arguments: input.arguments,
        result: input.result ?? {},
        status: input.status,
        createdAt: input.createdAt ?? nowTimestamp(),
      })
      .returning();
    if (!row) throw new Error("tool não gravada");
    return mapToolExecution(row);
  }

  async listForMessage(messageId: string): Promise<ToolExecution[]> {
    const rows = await this.db
      .select()
      .from(toolExecutions)
      .where(eq(toolExecutions.messageId, messageId))
      .orderBy(desc(toolExecutions.createdAt), desc(toolExecutions.id));
    return rows.map(mapToolExecution);
  }

  async listRecent(conversationId: string, limit: number): Promise<ToolExecution[]> {
    const rows = await this.db
      .select()
      .from(toolExecutions)
      .where(eq(toolExecutions.conversationId, conversationId))
      .orderBy(desc(toolExecutions.createdAt), desc(toolExecutions.id))
      .limit(limit);
    return rows.map(mapToolExecution);
  }

  async listPage(input: {
    conversationId: string;
    limit: number;
    cursor?: { at: Date; id: string };
  }): Promise<{ items: ToolExecution[]; hasMore: boolean }> {
    const older = input.cursor
      ? or(
          lt(toolExecutions.createdAt, input.cursor.at),
          and(eq(toolExecutions.createdAt, input.cursor.at), lt(toolExecutions.id, input.cursor.id)),
        )
      : undefined;
    const rows = await this.db
      .select()
      .from(toolExecutions)
      .where(and(eq(toolExecutions.conversationId, input.conversationId), older))
      .orderBy(desc(toolExecutions.createdAt), desc(toolExecutions.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    return { items: rows.slice(0, input.limit).map(mapToolExecution), hasMore };
  }
}
