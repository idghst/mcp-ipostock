import assert from "node:assert/strict";
import test from "node:test";

const validEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_example",
  SUPABASE_ALLOWED_TABLES: "todos",
  MCP_API_KEY: "0123456789abcdef0123456789abcdef",
};

async function loadHealthHandler() {
  try {
    const module = await import("../api/health.ts");
    return module.GET;
  } catch {
    return undefined;
  }
}

test("health route reports ready without exposing configuration", async () => {
  const GET = await loadHealthHandler();
  assert.equal(typeof GET, "function");

  const original = { ...process.env };
  Object.assign(process.env, validEnv);

  try {
    const response = await GET!(new Request("http://localhost/health"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      service: "supabase-crud-mcp",
    });
  } finally {
    process.env = original;
  }
});

test("health route reports a missing configuration without its value", async () => {
  const GET = await loadHealthHandler();
  assert.equal(typeof GET, "function");

  const original = { ...process.env };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_ALLOWED_TABLES;
  delete process.env.MCP_API_KEY;

  try {
    const response = await GET!(new Request("http://localhost/health"));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      status: "error",
      error: "SUPABASE_URL is required",
    });
  } finally {
    process.env = original;
  }
});
