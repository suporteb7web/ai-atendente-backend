import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { nowTimestamp } from "../../clock.js";
import type { Conversation, ConversationListItem } from "../../domain.js";
import type { Database } from "../../db/client.js";
import { conversations } from "../../db/schema.js";
import { asAuthor } from "../../db/mapping.js";
import type { ConversationRepository } from "./repository.js";

export class PostgresConversationRepository implements ConversationRepository {
  constructor(private readonly db: Database) {}

  async upsertByPhone(input: { phone: string; pushName: string | null }): Promise<Conversation> {
    const [row] = await this.db
      .insert(conversations)
      .values({ phone: input.phone, pushName: input.pushName })
      .onConflictDoUpdate({
        target: conversations.phone,
        set: {
          pushName: sql`coalesce(excluded.push_name, ${conversations.pushName})`,
        },
      })
      .returning();
    if (!row) throw new Error("conversa não gravada");
    return mapConversation(row);
  }

  async findById(id: string): Promise<Conversation | null> {
    const [row] = await this.db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
    return row ? mapConversation(row) : null;
  }

  async setHandoff(id: string, enabled: boolean): Promise<Conversation | null> {
    const [row] = await this.db
      .update(conversations)
      .set({ handoff: enabled })
      .where(eq(conversations.id, id))
      .returning();
    return row ? mapConversation(row) : null;
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.db.update(conversations).set({ updatedAt: at }).where(eq(conversations.id, id));
  }

  async list(input: {
    limit: number;
    cursor?: { at: Date; id: string };
  }): Promise<{ items: ConversationListItem[]; hasMore: boolean }> {
    const cursorFilter = input.cursor
      ? or(
          lt(conversations.updatedAt, input.cursor.at),
          and(eq(conversations.updatedAt, input.cursor.at), lt(conversations.id, input.cursor.id)),
        )
      : undefined;
    const rows = await this.db
      .select()
      .from(conversations)
      .where(cursorFilter)
      .orderBy(desc(conversations.updatedAt), desc(conversations.id))
      .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit);
    const lastMessages = await this.lastMessages(page.map((row) => row.id));
    return {
      hasMore,
      items: page.map((row) => ({
        ...mapConversation(row),
        lastMessage: lastMessages.get(row.id) ?? null,
      })),
    };
  }

  private async lastMessages(ids: string[]) {
    const found = new Map<string, { body: string; author: ReturnType<typeof asAuthor>; createdAt: Date }>();
    if (ids.length === 0) return found;
    const result = await this.db.execute<{
      conversation_id: string;
      body: string;
      author: string;
      created_at: Date | string;
    }>(sql`
      select distinct on (conversation_id)
        conversation_id, body, author, created_at
      from messages
      where conversation_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
        and btrim(body) <> ''
      order by conversation_id, created_at desc, id desc
    `);
    const list = "rows" in result ? result.rows : result;
    for (const row of list) {
      found.set(row.conversation_id, {
        body: row.body,
        author: asAuthor(row.author),
        createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
      });
    }
    return found;
  }
}

function mapConversation(row: typeof conversations.$inferSelect): Conversation {
  return {
    id: row.id,
    phone: row.phone,
    pushName: row.pushName,
    handoff: row.handoff,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function conversationTimestamp(): Date {
  return nowTimestamp();
}