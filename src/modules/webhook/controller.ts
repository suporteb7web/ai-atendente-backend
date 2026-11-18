import type { RequestHandler } from "express";
import { tokenMatches } from "./parser.js";

export function createWebhookHandler(deps: {
  token: string;
  enqueue: (envelope: unknown) => Promise<void>;
}): RequestHandler {
  return async (req, res, next) => {
    try {
      if (!tokenMatches(req.body, deps.token)) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      await deps.enqueue(req.body);
      res.status(200).end();
    } catch (error) {
      next(error);
    }
  };
}
