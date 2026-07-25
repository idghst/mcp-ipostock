import assert from "node:assert/strict";
import test from "node:test";

import { createSchemaGateway } from "../lib/schema.ts";

const openApi = {
  swagger: "2.0",
  definitions: {
    ipo_stocks: {
      required: ["id"],
      properties: {
        id: { type: "string", format: "uuid" },
        종목명: { type: "string", format: "text" },
        청약시작일: {
          type: "string",
          format: "date",
          nullable: true,
        },
      },
    },
    users: {
      properties: {
        email: { type: "string", format: "text" },
      },
    },
  },
};

const createFetch = (
  body: unknown = openApi,
  status = 200,
) => {
  let calls = 0;
  let request: Parameters<typeof fetch> | undefined;
  const fetchImpl = async (...args: Parameters<typeof fetch>) => {
    calls += 1;
    request = args;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response;
  };
  return {
    fetchImpl: fetchImpl as typeof fetch,
    calls: () => calls,
    request: () => request,
  };
};

test("schema gateway normalizes only an allowed table", async () => {
  const request = createFetch();
  const gateway = createSchemaGateway({
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: "sb_secret_example",
    allowedTables: new Set(["ipo_stocks"]),
    fetchImpl: request.fetchImpl,
  });

  assert.deepEqual(
    await gateway.describeTable("ipo_stocks"),
    {
      table: "ipo_stocks",
      columns: [
        {
          name: "id",
          type: "uuid",
          nullable: false,
          required: true,
        },
        {
          name: "종목명",
          type: "text",
          nullable: true,
          required: false,
        },
        {
          name: "청약시작일",
          type: "date",
          nullable: true,
          required: false,
        },
      ],
    },
  );
  await assert.rejects(
    () => gateway.describeTable("users"),
    /not allowed/i,
  );
  assert.equal(request.calls(), 1);
  assert.deepEqual(request.request(), [
    "https://example.supabase.co/rest/v1/",
    {
      headers: {
        apikey: "sb_secret_example",
        Accept: "application/openapi+json",
      },
    },
  ]);
});

test("schema gateway asserts columns and caches OpenAPI", async () => {
  const request = createFetch();
  const gateway = createSchemaGateway({
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: "sb_secret_example",
    allowedTables: new Set(["ipo_stocks"]),
    fetchImpl: request.fetchImpl,
  });

  await gateway.assertColumns(
    "ipo_stocks",
    ["종목명", "청약시작일"],
  );
  await assert.rejects(
    () => gateway.assertColumns("ipo_stocks", ["없는컬럼"]),
    /Column "없는컬럼".*not found/,
  );
  await gateway.describeTable("ipo_stocks");
  await gateway.describeTable("ipo_stocks");

  assert.equal(request.calls(), 1);
});

test("schema gateway reports missing tables and HTTP failures", async () => {
  const missing = createFetch({
    swagger: "2.0",
    definitions: {},
  });
  const missingGateway = createSchemaGateway({
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: "sb_secret_example",
    allowedTables: new Set(["ipo_stocks"]),
    fetchImpl: missing.fetchImpl,
  });

  await assert.rejects(
    () => missingGateway.describeTable("ipo_stocks"),
    /Table "ipo_stocks".*not found/,
  );

  const unauthorized = createFetch({}, 401);
  const unauthorizedGateway = createSchemaGateway({
    supabaseUrl: "https://example.supabase.co",
    supabaseKey: "sb_secret_example",
    allowedTables: new Set(["ipo_stocks"]),
    fetchImpl: unauthorized.fetchImpl,
  });

  await assert.rejects(
    () => unauthorizedGateway.describeTable("ipo_stocks"),
    /Supabase schema request failed: HTTP 401/,
  );
});
