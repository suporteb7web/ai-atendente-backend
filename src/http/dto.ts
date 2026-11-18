import type { Conversation, ConversationListItem, LastMessage, Message, ToolExecution } from "../domain.js";

export function toLastMessage(message: LastMessage | null) {
  if (!message) return null;
  return {
    body: message.body,
    author: message.author,
    createdAt: message.createdAt.toISOString(),
  };
}

export function toConversationItem(item: ConversationListItem) {
  return {
    id: item.id,
    phone: item.phone,
    pushName: item.pushName,
    handoff: item.handoff,
    lastMessage: toLastMessage(item.lastMessage),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function toMessage(message: Message) {
  return {
    id: message.id,
    direction: message.direction,
    author: message.author,
    type: message.type,
    body: message.body,
    status: message.status,
    failureReason: message.failureReason,
    createdAt: message.createdAt.toISOString(),
  };
}

export function toToolExecution(execution: ToolExecution) {
  return {
    id: execution.id,
    messageId: execution.messageId,
    name: execution.name,
    arguments: execution.arguments,
    result: execution.result,
    status: execution.status,
    createdAt: execution.createdAt.toISOString(),
  };
}

export function toConversationDetail(conversation: Conversation, lastMessage: LastMessage | null, tools: ToolExecution[]) {
  return {
    id: conversation.id,
    phone: conversation.phone,
    pushName: conversation.pushName,
    handoff: conversation.handoff,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    lastMessage: toLastMessage(lastMessage),
    recentToolExecutions: tools.map(toToolExecution),
  };
}
