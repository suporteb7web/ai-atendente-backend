import express, { type ErrorRequestHandler, type Express } from "express";
import type { AppConfig } from "./config.js";
import type { WhatsappConnectionPort } from "./ports.js";
import { HttpError } from "./http/validate.js";
import { logger } from "./logger.js";
import { registerWhatsappRoutes } from "./modules/whatsapp/controller.js";
import { registerOperatorRoutes } from "./modules/operator/controller.js";
import type { OperatorDeps } from "./modules/operator/service.js";
import { createWebhookHandler } from "./modules/webhook/controller.js";

export interface AppDeps {
  config: AppConfig;
  operator: OperatorDeps;
  whatsapp: WhatsappConnectionPort;
  enqueueInbound: (envelope: unknown) => Promise<void>;
  checkReady: () => Promise<boolean>;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  if (deps.config.corsOrigin) {
    app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", deps.config.corsOrigin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
      }
      next();
    });
  }
  app.use(express.json({ limit: "25mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/ready", async (_req, res) => {
    const ready = await deps.checkReady();
    if (!ready) {
      res.status(503).json({ error: "indisponível" });
      return;
    }
    res.json({ ok: true });
  });

  app.post(
    "/webhooks/evolution",
    createWebhookHandler({
      token: deps.config.evolutionWebhookToken,
      enqueue: deps.enqueueInbound,
    }),
  );

  registerOperatorRoutes(app, deps.config.apiToken, deps.operator);
  registerWhatsappRoutes(app, deps.config.apiToken, deps.whatsapp);

  app.use((_req, res) => {
    res.status(404).json({ error: "não encontrado" });
  });

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ error: "body inválido" });
      return;
    }
    logger.error({ err: error instanceof Error ? error.name : "error" }, "request falhou");
    res.status(500).json({ error: "erro interno" });
  };
  app.use(onError);
  return app;
}
