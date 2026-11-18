import type { Conversation, ConversationListItem, TimeIdCursor } from "../../domain.js";

export interface ConversationRepository {
  upsertByPhone(input: { phone: string; pushName: string | null }): Promise<Conversation>;
  findById(id: string): Promise<Conversation | null>;
  setHandoff(id: string, enabled: boolean): Promise<Conversation | null>;
  list(input: { limit: number; cursor?: TimeIdCursor }): Promise<{ items: ConversationListItem[]; hasMore: boolean }>;
  touch(id: string, at: Date): Promise<void>;
}
