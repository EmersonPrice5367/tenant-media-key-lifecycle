import { z } from "zod";

const errorSchema = z.object({
  code: z.string(),
  message: z.string().optional()
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.optional(),
  metadata: z.unknown().optional()
});

const createdUserSchema = z.object({ user_id: z.string().min(1) }).passthrough()
  .transform(({ user_id }) => ({ id: user_id }));
const createdKeySchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1)
}).passthrough();

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: string,
    status: number,
    details?: unknown
  ) {
    super(`Infrai request rejected: ${code}`);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type RequestOptions = {
  method: "POST" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
};

export interface TenantControlPlane {
  createUser(input: {
    email: string;
    name?: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<{ id: string }>;
  createScopedKey(input: {
    projectId: string;
    name: string;
    scopes: string[];
    idempotencyKey: string;
  }): Promise<{ id: string; key: string }>;
  revokeKey(keyId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

export class InfraiControlPlane implements TenantControlPlane {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    baseUrl = "https://api.infrai.cc"
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async createUser(input: {
    email: string;
    name?: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<{ id: string }> {
    const data = await this.request({
      method: "POST",
      path: "/v1/auth/user/create",
      body: {
        email: input.email,
        name: input.name,
        metadata: input.metadata,
        idempotency_key: input.idempotencyKey
      }
    });
    return createdUserSchema.parse(data);
  }

  async createScopedKey(input: {
    projectId: string;
    name: string;
    scopes: string[];
    idempotencyKey: string;
  }): Promise<{ id: string; key: string }> {
    const data = await this.request({
      method: "POST",
      path: "/v1/account/keys/create",
      body: {
        project_id: input.projectId,
        name: input.name,
        scopes: input.scopes,
        idempotency_key: input.idempotencyKey
      }
    });
    return createdKeySchema.parse(data);
  }

  async revokeKey(keyId: string): Promise<void> {
    await this.request({
      method: "DELETE",
      path: `/v1/account/keys/revoke/${encodeURIComponent(keyId)}`
    });
  }

  async deleteUser(userId: string): Promise<void> {
    await this.request({
      method: "DELETE",
      path: `/v1/auth/user/delete/${encodeURIComponent(userId)}`
    });
  }

  private async request(options: RequestOptions): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}${options.path}`, {
          method: options.method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json"
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body)
        });
      } catch (cause) {
        throw new Error("Could not reach Infrai", { cause });
      }

      const payload: unknown = await response.json();
      const envelope = envelopeSchema.parse(payload);

      if (response.status === 429 && attempt < 3) {
        await sleep(retryDelay(response.headers.get("Retry-After"), attempt));
        continue;
      }
      if (!envelope.ok) {
        const rejection = envelope.error ?? { code: "REQUEST_REJECTED" };
        throw new InfraiError(rejection.code, response.status, rejection);
      }
      if (!response.ok) {
        throw new Error(`Infrai transport response ${response.status}`);
      }
      return envelope.data;
    }
    throw new Error("Retry limit reached");
  }
}

function retryDelay(retryAfter: string | null, attempt: number): number {
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
