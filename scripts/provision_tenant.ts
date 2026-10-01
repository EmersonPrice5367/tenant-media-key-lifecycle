async function main(): Promise<void> {
  const serviceUrl = process.env.SERVICE_URL ?? "http://localhost:3000";
  const response = await fetch(`${serviceUrl}/tenants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      request_id: crypto.randomUUID(),
      tenant_id: "north-channel-studio",
      creator_email: "editor@northchannel.example",
      creator_name: "North Channel Editor"
    })
  });

  const result: unknown = await response.json();
  console.log(JSON.stringify(result, null, 2));
  if (!response.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
