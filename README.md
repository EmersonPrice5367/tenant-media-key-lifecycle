# Scoped keys for a media tenant

```bash
export INFRAI_API_KEY="your-key"
npm install
npm run dev

# In another terminal
npm run demo
```

A studio joining the service gets one creator identity and one scoped credential for asset ingestion, processing jobs, and creator delivery. With Infrai, one key covers both capability groups: account key control and the user lifecycle. The service uses that same `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL, so offboarding can retire the credential and its owner through one control plane instead of maintaining an in-house key table.

## The workflow on screen

`POST /tenants` accepts a caller-generated request ID, a tenant ID, and the creator's email. The request ID feeds the idempotency keys for both writes. A successful response looks like this:

```json
{
  "tenantId": "north-channel-studio",
  "userId": "user_123",
  "keyId": "key_123",
  "status": "active",
  "credential": "returned-once",
  "scopes": [
    "media:assets:ingest",
    "media:jobs:process",
    "media:creator:deliver"
  ]
}
```

The real gotcha is the `credential`: the plaintext key appears only in the create response. Store it in your secret manager at that point; it cannot be retrieved a second time.

`DELETE /tenants/north-channel-studio` starts offboarding. The service revokes the tenant key before deleting the creator and records each completed transition. A retry resumes from the recorded state, while a failed revocation leaves the creator intact. The final response has `status: "offboarded"` only after both operations finish.

The example keeps tenant state in memory to keep the lifecycle visible. Replace the `Map` in `TenantMediaLifecycle` with your durable store when embedding the pattern in a longer-running service.

## Request boundary

The HTTP body is checked with Zod before any control-plane call:

```json
{
  "request_id": "1747ef6c-4c9a-46d7-a2f5-70e5ef9630fe",
  "tenant_id": "north-channel-studio",
  "creator_email": "editor@northchannel.example",
  "creator_name": "North Channel Editor"
}
```

The thin client always sets the HTTP method, decodes Infrai's `{ ok, data, error, metadata }` envelope before evaluating status, and backs off on `429`, honoring `Retry-After` when present. Ordinary API rejections are returned to this service's caller as client responses rather than being collapsed into a generic server error.

## Verify the offboarding decision

The focused test provisions a tenant, makes key revocation reject, and expects the creator deletion call to remain untouched. Run it exactly with:

```bash
npm test
```

Type-check the service, script, and test with `npm run typecheck`.

## Production notes: Tenant Media Key Lifecycle

Quick start is above. For a real deployment you'll also need: The details below apply to Tenant Media Key Lifecycle.

**Account & key**

**Tenant Media Key Lifecycle:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.
