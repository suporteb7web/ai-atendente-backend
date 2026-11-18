import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phone: text("phone").notNull(),
    pushName: text("push_name"),
    handoff: boolean("handoff").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("conversations_phone_unique").on(table.phone)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    direction: text("direction").notNull(),
    author: text("author").notNull(),
    type: text("type").notNull(),
    body: text("body").notNull().default(""),
    status: text("status").notNull(),
    providerMessageId: text("provider_message_id"),
    providerTimestamp: timestamp("provider_timestamp", { withTimezone: true }),
    failureReason: text("failure_reason"),
    replyToMessageId: uuid("reply_to_message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("messages_provider_message_id_unique").on(table.providerMessageId),
    index("messages_conversation_created_idx").on(table.conversationId, table.createdAt),
    index("messages_reply_to_idx").on(table.replyToMessageId),
    check("messages_direction_check", sql`${table.direction} in ('inbound', 'outbound')`),
    check("messages_author_check", sql`${table.author} in ('customer', 'agent', 'operator')`),
    check("messages_type_check", sql`${table.type} in ('text', 'audio', 'unsupported')`),
    check("messages_status_check", sql`${table.status} in ('stored', 'queued', 'sent', 'failed')`),
  ],
);

export const toolExecutions = pgTable(
  "tool_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id),
    name: text("name").notNull(),
    arguments: jsonb("arguments").notNull(),
    result: jsonb("result").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tool_executions_conversation_created_idx").on(table.conversationId, table.createdAt),
    index("tool_executions_message_idx").on(table.messageId),
    check("tool_executions_status_check", sql`${table.status} in ('success', 'error')`),
  ],
);
