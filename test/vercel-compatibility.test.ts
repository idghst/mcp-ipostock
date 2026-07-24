import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

test("installed TypeScript exposes the compiler host API required by Vercel", () => {
  const typescript = require("typescript") as {
    sys?: { readFile?: unknown };
  };

  assert.equal(typeof typescript.sys?.readFile, "function");
});

test("TypeScript rewrites relative .ts imports for the Vercel runtime", () => {
  const typescript = require("typescript") as typeof import("typescript");
  const configPath = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
  const { config, error } = typescript.readConfigFile(
    configPath,
    typescript.sys.readFile,
  );
  assert.equal(error, undefined);

  const { options } = typescript.parseJsonConfigFileContent(
    config,
    typescript.sys,
    path.dirname(configPath),
  );
  const { outputText } = typescript.transpileModule(
    'import value from "./dependency.ts";\nconsole.log(value);',
    { compilerOptions: options },
  );

  assert.match(outputText, /from "\.\/dependency\.js"/);
});
