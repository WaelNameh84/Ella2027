const timeout = (ms) => AbortSignal.timeout(ms);

async function checkAiHorde() {
  const url = "https://aihorde.net/api/v2/status/models?type=image&min_count=1&model_state=known";
  const response = await fetch(url, {
    headers: { "Client-Agent": "Ella2027:1.0.0-live-smoke" },
    signal: timeout(20_000),
  });
  const payload = await response.json().catch(() => null);
  if (!Array.isArray(payload) || ![200, 403].includes(response.status)) {
    throw new Error(`AI Horde model catalogue failed: HTTP ${response.status}`);
  }
  const models = payload
    .filter((item) => item && item.type === "image" && typeof item.name === "string" && Number(item.count) > 0)
    .sort((a, b) => Number(b.count) - Number(a.count))
    .slice(0, 5);
  if (!models.length) throw new Error("AI Horde responded but reported no active image models.");
  console.log("AI Horde live model catalogue: OK");
  for (const model of models) {
    console.log(`- ${model.name}: ${model.count} workers; ETA ${model.eta ?? "n/a"} seconds`);
  }
}

async function checkPuterSdk() {
  const response = await fetch("https://js.puter.com/v2/", { signal: timeout(20_000) });
  if (!response.ok) throw new Error(`Puter SDK CDN failed: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!/javascript|ecmascript|text\/plain/i.test(contentType)) {
    throw new Error(`Puter SDK CDN returned an unexpected content type: ${contentType || "missing"}`);
  }
  console.log(`Puter SDK CDN: OK (HTTP ${response.status}; ${contentType})`);
  console.log("Puter authenticated test-mode generation must be completed in the user's browser session.");
}

try {
  await Promise.all([checkAiHorde(), checkPuterSdk()]);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
