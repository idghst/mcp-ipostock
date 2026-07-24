import assert from "node:assert/strict";
import test from "node:test";

import { POST } from "../api/server.ts";

const validEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_example",
  SUPABASE_ALLOWED_TABLES: "todos",
  MCP_API_KEY: "mcp-secret",
};

test("MCP route rejects requests when env is incomplete", async () => {
  const original = { ...process.env };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_ALLOWED_TABLES;
  delete process.env.MCP_API_KEY;

  try {
    const response = await POST(
      new Request("http://localhost/api/mcp", { method: "POST" }),
    );
    assert.equal(response.status, 503);
  } finally {
    process.env = original;
  }
});

test("MCP route requires its bearer token", async () => {
  const original = { ...process.env };
  Object.assign(process.env, validEnv);

  try {
    const response = await POST(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { authorization: "Bearer wrong" },
      }),
    );
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
  } finally {
    process.env = original;
  }
});
