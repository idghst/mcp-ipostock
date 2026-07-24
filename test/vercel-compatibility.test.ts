import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

test("installed TypeScript exposes the compiler host API required by Vercel", () => {
  const typescript = require("typescript") as {
    sys?: { readFile?: unknown };
  };

  assert.equal(typeof typescript.sys?.readFile, "function");
});
