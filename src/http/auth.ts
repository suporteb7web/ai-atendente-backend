import type { RequestHandler } from "express";
import { safeEqual } from "../auth.js";

export function requireBearer(expected: string): RequestHandler {
  return (req, res, next) => {
    const header = req.header("authorization") ?? "";
    const match = /^Bearer (.+)$/.exec(header);
    if (!match || !safeEqual(match[1] ?? "", expected)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}
