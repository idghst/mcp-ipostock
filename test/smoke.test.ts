import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("smoke command explains its required deployment URL and API key", () => {
  const result = spawnSync(process.execPath, ["scripts/smoke.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      MCP_API_KEY: "",
      MCP_URL: "",
    },
  });

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Usage: MCP_API_KEY=<key> npm run smoke -- https:\/\/<project>\.vercel\.app\/mcp/,
  );
});
