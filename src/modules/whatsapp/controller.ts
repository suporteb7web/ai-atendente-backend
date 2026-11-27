import type { Express, RequestHandler } from "express";
import { requireBearer } from "../../http/auth.js";
import { HttpError } from "../../http/validate.js";
import { WhatsappConnectionError, type WhatsappConnectionPort } from "../../ports.js";

function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((error: unknown) => next(toHttpError(error)));
  };
}

function toHttpError(error: unknown): unknown {
  if (!(error instanceof WhatsappConnectionError)) return error;
  const status = { license: 409, invalid: 400, config: 500, upstream: 502 }[error.kind];
  return new HttpError(status, error.message);
}

export function registerWhatsappRoutes(app: Express, token: string, whatsapp: WhatsappConnectionPort): void {
  const auth = requireBearer(token);

  // Estado da conexão: o frontend faz polling aqui.
  app.get(
    "/whatsapp",
    auth,
    asyncRoute(async (_req, res) => {
      res.json(await whatsapp.getState());
    }),
  );

  // Cria a instância (se faltar) e começa a gerar o QR.
  app.post(
    "/whatsapp/connect",
    auth,
    asyncRoute(async (_req, res) => {
      await whatsapp.connect();
      res.json(await whatsapp.getState());
    }),
  );

  app.get(
    "/whatsapp/qr",
    auth,
    asyncRoute(async (_req, res) => {
      res.json({ qrcode: await whatsapp.getQr() });
    }),
  );

  app.post(
    "/whatsapp/disconnect",
    auth,
    asyncRoute(async (_req, res) => {
      await whatsapp.disconnect();
      res.json(await whatsapp.getState());
    }),
  );

  // Licença do EvolutionGo: 1) pega o link de cadastro, 2) o provedor volta com ?code=, 3) ativa.
  app.get(
    "/whatsapp/license",
    auth,
    asyncRoute(async (req, res) => {
      const redirectUri = req.query.redirectUri;
      if (typeof redirectUri !== "string" || !/^https?:\/\//.test(redirectUri)) {
        throw new HttpError(400, "redirectUri inválido");
      }
      res.json({ registerUrl: await whatsapp.getLicenseRegisterUrl(redirectUri) });
    }),
  );

  app.post(
    "/whatsapp/license",
    auth,
    asyncRoute(async (req, res) => {
      const code = (req.body as { code?: unknown } | undefined)?.code;
      if (typeof code !== "string" || code.trim() === "" || code.length > 2000) {
        throw new HttpError(400, "body inválido");
      }
      await whatsapp.activateLicense(code.trim());
      res.json(await whatsapp.getState());
    }),
  );
}
