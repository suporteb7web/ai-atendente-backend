import type { Express, RequestHandler } from "express";
import { requireBearer } from "../../http/auth.js";
import { toConversationDetail, toConversationItem, toMessage, toToolExecution } from "../../http/dto.js";
import { HttpError, parseHandoffEnabled } from "../../http/validate.js";
import {
  getConversation,
  listConversations,
  listMessages,
  listToolExecutions,
  sendOperatorMessage,
  setConversationHandoff,
  type OperatorDeps,
} from "./service.js";

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function registerOperatorRoutes(app: Express, token: string, deps: OperatorDeps): void {
  const auth = requireBearer(token);

  app.get(
    "/conversations",
    auth,
    asyncRoute(async (req, res) => {
      const page = await listConversations(deps, req.query);
      res.json({
        items: page.items.map(toConversationItem),
        nextCursor: page.nextCursor,
      });
    }),
  );

  app.get(
    "/conversations/:id",
    auth,
    asyncRoute(async (req, res) => {
      const detail = await getConversation(deps, routeId(req.params.id));
      res.json(toConversationDetail(detail.conversation, detail.lastMessage, detail.tools));
    }),
  );

  app.get(
    "/conversations/:id/messages",
    auth,
    asyncRoute(async (req, res) => {
      const page = await listMessages(deps, routeId(req.params.id), req.query);
      res.json({ items: page.items.map(toMessage), nextCursor: page.nextCursor });
    }),
  );

  app.get(
    "/conversations/:id/tool-executions",
    auth,
    asyncRoute(async (req, res) => {
      const page = await listToolExecutions(deps, routeId(req.params.id), req.query);
      res.json({ items: page.items.map(toToolExecution), nextCursor: page.nextCursor });
    }),
  );

  app.post(
    "/conversations/:id/messages",
    auth,
    asyncRoute(async (req, res) => {
      const message = await sendOperatorMessage(deps, routeId(req.params.id), req.body);
      res.status(202).json(toMessage(message));
    }),
  );

  app.post(
    "/conversations/:id/handoff",
    auth,
    asyncRoute(async (req, res) => {
      const enabled = parseHandoffEnabled(req.body);
      const result = await setConversationHandoff(deps, routeId(req.params.id), enabled);
      res.json(result);
    }),
  );
}

function routeId(id: string | string[] | undefined): string {
  if (typeof id !== "string") throw new HttpError(404, "não encontrado");
  return id;
}
