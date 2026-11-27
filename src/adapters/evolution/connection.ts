import {
  WhatsappConnectionError,
  type WhatsappConnectionPort,
  type WhatsappState,
} from "../../ports.js";

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

interface Options {
  baseUrl: string;
  /** Token da instância (header apikey nas rotas /instance/*). */
  instanceToken: string;
  /** GLOBAL_API_KEY do EvolutionGo. Só é necessária para criar a instância e ler o telefone. */
  globalApiKey?: string;
  instanceName: string;
  /** URL que o EvolutionGo chama a cada mensagem (alcançável DE DENTRO do EvolutionGo). */
  webhookUrl: string;
  fetchImpl?: FetchImpl;
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Fala com a API de instâncias do EvolutionGo. É o único lugar, junto com client.ts,
 * que conhece o formato do EvolutionGo: chaves em PascalCase no status
 * ({ data: { Connected, LoggedIn, Name } }) e `data.qrcode` como data URL PNG no /instance/qr.
 */
export class EvolutionConnection implements WhatsappConnectionPort {
  constructor(private readonly options: Options) {}

  async getState(): Promise<WhatsappState> {
    let reply: Reply;
    try {
      reply = await this.call("GET", "/instance/status", { apikey: this.options.instanceToken });
    } catch {
      return state("unavailable");
    }
    if (reply.status === 503 || reply.body.code === "LICENSE_REQUIRED") return state("license_required");
    if (reply.status === 401) return state("not_created");
    if (reply.status !== 200) return state("unavailable");

    const data = record(reply.body.data);
    const name = typeof data.Name === "string" && data.Name ? data.Name : null;
    if (data.LoggedIn === true) return { status: "connected", name, phone: await this.readPhone() };
    // Connected sem LoggedIn = socket aberto esperando o QR ser lido.
    if (data.Connected === true) return state("connecting");
    return state("disconnected");
  }

  async connect(): Promise<void> {
    const current = await this.getState();
    if (current.status === "license_required") {
      throw new WhatsappConnectionError("license", "Ative a licença do EvolutionGo antes de conectar.");
    }
    if (current.status === "unavailable") {
      throw new WhatsappConnectionError("upstream", "Não consegui falar com o EvolutionGo.");
    }
    if (current.status === "connected") return;

    if (current.status === "not_created") await this.createInstance();

    const reply = await this.safeCall("POST", "/instance/connect", {
      headers: { apikey: this.options.instanceToken },
      body: { webhookUrl: this.options.webhookUrl, subscribe: ["MESSAGE"], immediate: true },
    });
    if (reply.status !== 200) {
      throw new WhatsappConnectionError("upstream", "O EvolutionGo recusou iniciar a conexão.");
    }
  }

  async getQr(): Promise<string | null> {
    const reply = await this.safeCall("GET", "/instance/qr", {
      headers: { apikey: this.options.instanceToken },
    });
    // 400 cobre "já conectado" e "QR ainda não disponível": nos dois casos não há QR para mostrar.
    if (reply.status !== 200) return null;
    const qrcode = record(reply.body.data).qrcode;
    return typeof qrcode === "string" && qrcode.startsWith("data:image") ? qrcode : null;
  }

  async disconnect(): Promise<void> {
    const headers = { apikey: this.options.instanceToken };
    const logout = await this.safeCall("DELETE", "/instance/logout", { headers });
    if (logout.status === 200) return;
    // Sem sessão pareada (só QR pendente): logout recusa, então derruba a conexão.
    const disconnect = await this.safeCall("POST", "/instance/disconnect", { headers });
    if (disconnect.status !== 200 && disconnect.status !== 400 && disconnect.status !== 401) {
      throw new WhatsappConnectionError("upstream", "O EvolutionGo recusou desconectar.");
    }
  }

  async getLicenseRegisterUrl(redirectUri: string): Promise<string> {
    const reply = await this.safeCall("GET", `/license/register?redirect_uri=${encodeURIComponent(redirectUri)}`, {
      headers: this.globalHeaders(),
    });
    const url = reply.body.register_url;
    if (reply.status !== 200 || typeof url !== "string" || !/^https?:\/\//.test(url)) {
      throw new WhatsappConnectionError("upstream", "Não consegui obter o link de cadastro da licença.");
    }
    return url;
  }

  async activateLicense(code: string): Promise<void> {
    const reply = await this.safeCall("GET", `/license/activate?code=${encodeURIComponent(code)}`, {
      headers: this.globalHeaders(),
    });
    if (reply.status >= 500) throw new WhatsappConnectionError("upstream", "O EvolutionGo não conseguiu ativar a licença.");
    if (reply.status !== 200) throw new WhatsappConnectionError("invalid", "Código de licença inválido ou expirado.");
  }

  // ---- internos ----

  private async createInstance(): Promise<void> {
    if (!this.options.globalApiKey) {
      throw new WhatsappConnectionError(
        "config",
        "A instância não existe e EVOLUTION_GLOBAL_API_KEY não está configurada para criá-la.",
      );
    }
    const reply = await this.safeCall("POST", "/instance/create", {
      headers: { apikey: this.options.globalApiKey },
      body: { name: this.options.instanceName, token: this.options.instanceToken },
    });
    if (reply.status !== 200) {
      throw new WhatsappConnectionError("upstream", "O EvolutionGo recusou criar a instância.");
    }
  }

  /** Telefone vem do `jid` da instância (ex.: 5511999999999:12@s.whatsapp.net). */
  private async readPhone(): Promise<string | null> {
    if (!this.options.globalApiKey) return null;
    try {
      const reply = await this.call("GET", "/instance/all", this.globalHeaders());
      const list = Array.isArray(reply.body.data) ? reply.body.data : [];
      const mine = list.map(record).find((i) => i.token === this.options.instanceToken || i.name === this.options.instanceName);
      const jid = typeof mine?.jid === "string" ? mine.jid : "";
      const digits = /^(\d+)[:@]/.exec(jid)?.[1];
      return digits ?? null;
    } catch {
      return null;
    }
  }

  private globalHeaders(): Record<string, string> {
    return this.options.globalApiKey ? { apikey: this.options.globalApiKey } : {};
  }

  private async safeCall(
    method: string,
    path: string,
    init: { headers?: Record<string, string>; body?: unknown } = {},
  ): Promise<Reply> {
    try {
      return await this.call(method, path, init.headers ?? {}, init.body);
    } catch {
      throw new WhatsappConnectionError("upstream", "Não consegui falar com o EvolutionGo.");
    }
  }

  private async call(method: string, path: string, headers: Record<string, string>, body?: unknown): Promise<Reply> {
    const fetchImpl = this.options.fetchImpl ?? ((url: string, init?: RequestInit) => fetch(url, init));
    const response = await fetchImpl(`${this.options.baseUrl}${path}`, {
      method,
      headers: { ...headers, ...(body !== undefined && { "content-type": "application/json" }) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const parsed: unknown = await response.json().catch(() => ({}));
    return { status: response.status, body: record(parsed) };
  }
}

const state = (status: WhatsappState["status"]): WhatsappState => ({ status, name: null, phone: null });

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
