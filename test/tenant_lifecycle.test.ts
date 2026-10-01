import assert from "node:assert/strict";
import test from "node:test";
import type { TenantControlPlane } from "../src/infrai_control_plane.ts";
import { MEDIA_SCOPES, TenantMediaLifecycle } from "../src/tenant_media_lifecycle.ts";

test("offboarding never deletes the creator when key revocation is rejected", async () => {
  const calls: string[] = [];
  const controlPlane: TenantControlPlane = {
    async createUser() {
      calls.push("create-user");
      return { id: "user-42" };
    },
    async createScopedKey(input) {
      calls.push(`create-key:${input.scopes.join(",")}`);
      return { id: "key-42", key: "one-time-credential" };
    },
    async revokeKey() {
      calls.push("revoke-key");
      throw new Error("revocation rejected");
    },
    async deleteUser() {
      calls.push("delete-user");
    }
  };
  const lifecycle = new TenantMediaLifecycle(controlPlane);

  await lifecycle.provision({
    requestId: "1747ef6c-4c9a-46d7-a2f5-70e5ef9630fe",
    tenantId: "north-channel-studio",
    creatorEmail: "editor@northchannel.example"
  });

  await assert.rejects(() => lifecycle.offboard("north-channel-studio"));
  assert.equal(lifecycle.find("north-channel-studio")?.status, "active");
  assert.equal(calls.includes("delete-user"), false);
  assert.deepEqual(MEDIA_SCOPES, [
    "media:assets:ingest",
    "media:jobs:process",
    "media:creator:deliver"
  ]);
});
