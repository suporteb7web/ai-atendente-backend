import { and, desc, eq, lt, ne, or, sql } from "drizzle-orm";
import { nowTimestamp } from "../../clock.js";
import type { Database } from "../../db/client.js";
import { asAuthor, isUniqueViolation, mapMessage } from "../../db/mapping.js";
import { conversations, messages } from "../../db/schema.js";
import type { LastMessage, Message } from "../../domain.js";
import type { InsertInboundInput, InsertOutboundInput, InsertResult, MessageRepository } from "./repository.js";

export class PostgresMessageRepository implements MessageRepository {
  constructor(private readonly db: Database) {}

  async insertInbound(input: InsertInboundInput): Promise<InsertResult> {
    const createdAt = input.createdAt ?? nowTimestamp();
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(messages)
          .values({
            conversationId: input.conversationId,
            direction: "inbound",
            author: "customer",
            type: input.type,
            body: input.body,
            status: input.status,
            providerMessageId: input.providerMessageId,
            providerTimestamp: input.providerTimestamp,
            failureReason: input.failureReason,
            createdAt,
          })
          .returning();
        if (!row) throw new Error("mensagem não gravada");
        await tx.update(conversations).set({ updatedAt: createdAt }).where(eq(conversations.id, input.conversationId));
        return { created: true, message: mapMessage(row) };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.findByProviderMessageId(input.providerMessageId);
      if (!existing) throw error;
      return { created: false, message: existing };
    }
  }

  async insertOutbound(input: InsertOutboundInput): Promise<Message> {
    const createdAt = input.createdAt ?? nowTimestamp();
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(messages)
        .values({
          conversationId: input.conversationId,
          direction: "outbound",
          author: input.author,
          type: "text",
          body: input.body,
          status: "queued",
          replyToMessageId: input.replyToMessageId,
          createdAt,
        })
        .returning();
      if (!row) throw new Error("mensagem não gravada");
      await tx.update(conversations).set({ updatedAt: createdAt }).where(eq(conversations.id, input.conversationId));
      return mapMessage(row);
    });
  }

  async findById(id: string): Promise<Message | null> {
    const [row] = await this.db.select().from(messages).where(eq(messages.id, id)).limit(1);
    return row ? mapMessage(row) : null;
  }

  async findAgentReply(inboundId: string): Promise<Message | null> {
    const [row] = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.replyToMessageId, inboundId), eq(messages.author, "agent")))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(1);
    return row ? mapMessage(row) : null;
  }

  async updateBody(id: string, body: string): Promise<void> {
    await this.db.update(messages).set({ body }).where(eq(messages.id, id));
  }

  async markFailedIfStored(id: string, reason: string): Promise<void> {
    await this.db
      .update(messages)
      .set({ status: "failed", failureReason: reason.slice(0, 500) })
      .where(and(eq(messages.id, id), eq(messages.status, "stored")));
  }

  async markFailedIfQueued(id: string, reason: string): Promise<void> {
    await this.db
      .update(messages)
      .set({ status: "failed", failureReason: reason.slice(0, 500) })
      .where(and(eq(messages.id, id), eq(messages.status, "queued")));
  }

  async markSentIfQueued(id: string, providerMessageId: string): Promise<boolean> {
    const rows = await this.db
      .update(messages)
      .set({ status: "sent", providerMessageId })
      .where(and(eq(messages.id, id), eq(messages.status, "queued")))
      .returning({ id: messages.id });
    return rows.length > 0;
  }

  async latestWithBody(conversationId: string): Promise<LastMessage | null> {
    const [row] = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), sql`btrim(${messages.body}) <> ''`))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(1);
    if (!row) return null;
    return { body: row.body, author: asAuthor(row.author), createdAt: row.createdAt };
  }

  async listHistory(conversationId: string, limit: number): Promise<Message[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), ne(messages.status, "failed")))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit);
    return rows.reverse().map(mapMessage);
  }

  async listPage(input: {
    conversationId: string;
    limit: number;
    cursor?: { at: Date; id: string };
  }): Promise<{ items: Message[]; hasMore: boolean }> {
    const older = input.cursor
      ? or(lt(messages.createdAt, input.cursor.at), and(eq(messages.createdAt, input.cursor.at), lt(messages.id, input.cursor.id)))
      : undefined;
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.conversationId, input.conversationId), older))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit).reverse().map(mapMessage);
    return { items: page, hasMore };
  }

  private async findByProviderMessageId(providerMessageId: string): Promise<Message | null> {
    const [row] = await this.db
      .select()
      .from(messages)
      .where(eq(messages.providerMessageId, providerMessageId))
      .limit(1);
    return row ? mapMessage(row) : null;
  }
}
