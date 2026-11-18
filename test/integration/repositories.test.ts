import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { conversations, messages, toolExecutions } from "../../src/db/schema.js";
import { PostgresConversationRepository } from "../../src/modules/conversations/postgres-repository.js";
import { PostgresMessageRepository } from "../../src/modules/messages/postgres-repository.js";
import { PostgresToolExecutionRepository } from "../../src/modules/tool-executions/postgres-repository.js";
import type pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
const describeIf = databaseUrl ? describe : describe.skip;

describeIf("repositórios", () => {
  let db: Database;
  let pool: pg.Pool;
  let conversationRepo: PostgresConversationRepository;
  let messageRepo: PostgresMessageRepository;
  let toolRepo: PostgresToolExecutionRepository;

  beforeAll(async () => {
    const created = createDatabase(databaseUrl!);
    db = created.db;
    pool = created.pool;
    await runMigrations(db);
  });

  beforeEach(async () => {
    await db.delete(toolExecutions);
    await db.delete(messages);
    await db.delete(conversations);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("grava conversa, mensagem e tool e lê na ordem pedida", async () => {
    conversationRepo = new PostgresConversationRepository(db);
    messageRepo = new PostgresMessageRepository(db);
    toolRepo = new PostgresToolExecutionRepository(db);

    const conversation = await conversationRepo.upsertByPhone({ phone: "5511999999999", pushName: "Ana" });
    await messageRepo.insertInbound({
      conversationId: conversation.id,
      type: "text",
      body: "primeiro",
      status: "stored",
      providerMessageId: "p1",
      providerTimestamp: new Date("2026-11-17T12:00:00.000Z"),
      failureReason: null,
      createdAt: new Date("2026-11-17T12:00:00.000Z"),
    });
    await messageRepo.insertInbound({
      conversationId: conversation.id,
      type: "text",
      body: "",
      status: "failed",
      providerMessageId: "p-failed",
      providerTimestamp: null,
      failureReason: "falhou",
      createdAt: new Date("2026-11-17T12:00:02.000Z"),
    });
    const newer = await messageRepo.insertInbound({
      conversationId: conversation.id,
      type: "text",
      body: "segundo",
      status: "stored",
      providerMessageId: "p2",
      providerTimestamp: null,
      failureReason: null,
      createdAt: new Date("2026-11-17T12:00:03.000Z"),
    });
    await toolRepo.insert({
      conversationId: conversation.id,
      messageId: newer.message.id,
      name: "current_time",
      arguments: {},
      result: { iso: "2026-11-17T09:00:00.000-03:00" },
      status: "success",
    });

    const listed = await conversationRepo.list({ limit: 10 });
    expect(listed.items[0]?.lastMessage).toMatchObject({ body: "segundo", author: "customer" });
    const history = await messageRepo.listHistory(conversation.id, 40);
    expect(history.map((item) => item.body)).toEqual(["primeiro", "segundo"]);
    const recent = await messageRepo.listPage({ conversationId: conversation.id, limit: 1 });
    expect(recent.items.map((item) => item.body)).toEqual(["segundo"]);
    expect(recent.hasMore).toBe(true);
    const olderPage = await messageRepo.listPage({
      conversationId: conversation.id,
      limit: 10,
      cursor: { at: recent.items[0]!.createdAt, id: recent.items[0]!.id },
    });
    expect(olderPage.items.map((item) => item.body)).toEqual(["primeiro", ""]);
    const tools = await toolRepo.listRecent(conversation.id, 20);
    expect(tools[0]).toMatchObject({ name: "current_time", messageId: newer.message.id, status: "success" });
  });

  it("não duplica phone nem provider_message_id", async () => {
    conversationRepo = new PostgresConversationRepository(db);
    messageRepo = new PostgresMessageRepository(db);
    const first = await conversationRepo.upsertByPhone({ phone: "551188887777", pushName: "Ana" });
    const second = await conversationRepo.upsertByPhone({ phone: "551188887777", pushName: null });
    expect(second.id).toBe(first.id);
    expect(second.pushName).toBe("Ana");
    const renamed = await conversationRepo.upsertByPhone({ phone: "551188887777", pushName: "Ana Souza" });
    expect(renamed.pushName).toBe("Ana Souza");

    const created = await messageRepo.insertInbound({
      conversationId: first.id,
      type: "text",
      body: "oi",
      status: "stored",
      providerMessageId: "mesmo-id",
      providerTimestamp: null,
      failureReason: null,
    });
    const duplicate = await messageRepo.insertInbound({
      conversationId: first.id,
      type: "text",
      body: "outro",
      status: "stored",
      providerMessageId: "mesmo-id",
      providerTimestamp: null,
      failureReason: null,
    });
    expect(created.created).toBe(true);
    expect(duplicate).toMatchObject({ created: false, message: { id: created.message.id, body: "oi" } });
    const rows = await db.select().from(messages).where(eq(messages.conversationId, first.id));
    expect(rows).toHaveLength(1);
  });
});
