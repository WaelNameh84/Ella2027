import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("ELLA Wan 2.2 has an isolated queue and Kaggle worker endpoint", async () => {
  const [index, generation, jobs, route, worker, studio] = await Promise.all([
    fs.readFile(new URL("../src/routes/index.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/routes/generation.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/lib/studioJobs.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/routes/kaggleWan22Worker.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../../../services/kaggle-wan22-worker/wan22_worker.py", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/routes/studio.ts", import.meta.url), "utf8"),
  ]);
  assert.match(index, /kaggle-wan22-worker/);
  assert.match(generation, /wan22_waiting/);
  assert.match(generation, /kaggle-wan22/);
  assert.match(jobs, /wan22_waiting/);
  assert.match(jobs, /wan22_generating/);
  assert.match(route, /KAGGLE_LTX_WORKER_TOKEN/);
  assert.match(route, /ELLA_KAGGLE_WORKER_TOKEN/);
  assert.match(route, /reportedProgress/);
  assert.match(route, /ella-wan22-\$\{jobId\}/);
  assert.match(route, /input\?\.worker !== "kaggle-wan22"/);
  assert.match(route, /referenceImageBase64/);
  assert.match(worker, /API_PREFIX = "\/api\/kaggle-wan22-worker"/);
  assert.match(worker, /runner\.run\(args\)/);
  assert.match(worker, /chunk_seconds/);
  assert.match(worker, /check_api_response/);
  assert.match(worker, /HTTP 401 from Ella API/);
  assert.match(worker, /state\["progress"\] = min\(95/);
  assert.match(worker, /continuation_/);
  assert.match(worker, /\/complete/);
  assert.match(studio, /delete retryInput\.kaggleLeaseToken/);
  assert.match(studio, /"wan22_waiting"/);
});
