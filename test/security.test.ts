import assert from "node:assert/strict";
import test from "node:test";

import { isAuthorized } from "../lib/security.ts";

test("isAuthorized accepts the configured bearer token", () => {
  assert.equal(isAuthorized("Bearer mcp-secret", "mcp-secret"), true);
});

test("isAuthorized rejects missing, malformed, or different tokens", () => {
  assert.equal(isAuthorized(null, "mcp-secret"), false);
  assert.equal(isAuthorized("Basic mcp-secret", "mcp-secret"), false);
  assert.equal(isAuthorized("Bearer other", "mcp-secret"), false);
});
