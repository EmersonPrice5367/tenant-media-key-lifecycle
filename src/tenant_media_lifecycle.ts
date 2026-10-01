import type { TenantControlPlane } from "./infrai_control_plane.ts";

export const MEDIA_SCOPES = [
  "media:assets:ingest",
  "media:jobs:process",
  "media:creator:deliver"
] as const;

export type TenantRecord = {
  tenantId: string;
  userId: string;
  keyId: string;
  status: "active" | "key_revoked" | "offboarded";
};

export class TenantMediaLifecycle {
  private readonly tenants = new Map<string, TenantRecord>();
  private readonly controlPlane: TenantControlPlane;

  constructor(controlPlane: TenantControlPlane) {
    this.controlPlane = controlPlane;
  }

  async provision(input: {
    requestId: string;
    tenantId: string;
    creatorEmail: string;
    creatorName?: string;
  }): Promise<TenantRecord & { credential: string; scopes: readonly string[] }> {
    const user = await this.controlPlane.createUser({
      email: input.creatorEmail,
      name: input.creatorName,
      metadata: { tenant_id: input.tenantId, role: "media_creator" },
      idempotencyKey: `${input.requestId}:creator`
    });
    const scopedKey = await this.controlPlane.createScopedKey({
      projectId: input.tenantId,
      name: `${input.tenantId}-media-delivery`,
      scopes: Array.from(MEDIA_SCOPES),
      idempotencyKey: `${input.requestId}:media-key`
    });
    const record: TenantRecord = {
      tenantId: input.tenantId,
      userId: user.id,
      keyId: scopedKey.id,
      status: "active"
    };
    this.tenants.set(input.tenantId, record);
    return Object.assign({}, record, {
      credential: scopedKey.key,
      scopes: MEDIA_SCOPES
    });
  }

  async offboard(tenantId: string): Promise<TenantRecord> {
    const record = this.tenants.get(tenantId);
    if (record === undefined) throw new TenantNotFoundError(tenantId);

    if (record.status === "active") {
      await this.controlPlane.revokeKey(record.keyId);
      record.status = "key_revoked";
    }
    if (record.status === "key_revoked") {
      await this.controlPlane.deleteUser(record.userId);
      record.status = "offboarded";
    }
    return Object.assign({}, record);
  }

  find(tenantId: string): TenantRecord | undefined {
    const record = this.tenants.get(tenantId);
    return record === undefined ? undefined : Object.assign({}, record);
  }
}

export class TenantNotFoundError extends Error {
  constructor(tenantId: string) {
    super(`Unknown tenant: ${tenantId}`);
    this.name = "TenantNotFoundError";
  }
}
