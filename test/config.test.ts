import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../lib/config.ts";

test("loadConfig parses the table allowlist and prefers the secret key", () => {
  const config = loadConfig({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_example",
    SUPABASE_SERVICE_ROLE_KEY: "legacy",
    SUPABASE_ALLOWED_TABLES: "todos, notes, todos",
    MCP_API_KEY: "mcp-secret",
  });

  assert.equal(config.supabaseKey, "sb_secret_example");
  assert.deepEqual([...config.allowedTables], ["todos", "notes"]);
});

test("loadConfig accepts the legacy service role key", () => {
  const config = loadConfig({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "legacy",
    SUPABASE_ALLOWED_TABLES: "todos",
    MCP_API_KEY: "mcp-secret",
  });

  assert.equal(config.supabaseKey, "legacy");
});

test("loadConfig rejects missing required variables", () => {
  assert.throws(
    () => loadConfig({}),
    /SUPABASE_URL/,
  );
});

test("loadConfig rejects invalid or empty table names", () => {
  assert.throws(
    () =>
      loadConfig({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "secret",
        SUPABASE_ALLOWED_TABLES: "todos,public.users",
        MCP_API_KEY: "mcp-secret",
      }),
    /SUPABASE_ALLOWED_TABLES/,
  );
});
