import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import { InfraiControlPlane, InfraiError } from "./infrai_control_plane.ts";
import { TenantMediaLifecycle, TenantNotFoundError } from "./tenant_media_lifecycle.ts";

const provisionBody = z.object({
  request_id: z.string().uuid(),
  tenant_id: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  creator_email: z.string().email(),
  creator_name: z.string().min(1).max(120).optional()
}).strict();

const apiKey = process.env.INFRAI_API_KEY;
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error("INFRAI_API_KEY is required");
}

const lifecycle = new TenantMediaLifecycle(new InfraiControlPlane(apiKey));
const port = Number(process.env.PORT ?? "3000");

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "POST" && url.pathname === "/tenants") {
      const body = provisionBody.parse(await readJson(request));
      const result = await lifecycle.provision({
        requestId: body.request_id,
        tenantId: body.tenant_id,
        creatorEmail: body.creator_email,
        creatorName: body.creator_name
      });
      return sendJson(response, 201, result);
    }

    const match = url.pathname.match(/^\/tenants\/([^/]+)$/);
    if (request.method === "DELETE" && match !== null) {
      const tenantId = decodeURIComponent(match[1]);
      const result = await lifecycle.offboard(tenantId);
      return sendJson(response, 200, result);
    }

    return sendJson(response, 404, { error: "route_not_found" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return sendJson(response, 400, { error: "invalid_request", issues: error.issues });
    }
    if (error instanceof TenantNotFoundError) {
      return sendJson(response, 404, { error: "tenant_not_found" });
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return sendJson(response, status, { error: error.code });
    }
    console.error(error);
    return sendJson(response, 502, { error: "upstream_request_failed" });
  }
}).listen(port, () => {
  console.log(`Creator delivery service listening on http://localhost:${port}`);
});

async function readJson(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_768) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}
