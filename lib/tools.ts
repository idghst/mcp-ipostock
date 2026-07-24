import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { DatabaseGateway } from "./database.ts";

export function registerSupabaseTools(
  server: McpServer,
  database: DatabaseGateway,
) {
  const identifier = z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Use a plain SQL identifier");
  const columns = z
    .array(z.union([z.literal("*"), identifier]))
    .min(1)
    .max(100)
    .refine(
      (items) => !items.includes("*") || items.length === 1,
      '"*" cannot be combined with other columns',
    )
    .default(["*"]);
  const filterValue = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
  ]);
  const filters = z
    .record(filterValue)
    .refine(
      (value) =>
        Object.keys(value).length <= 10 &&
        Object.keys(value).every((key) =>
          /^[A-Za-z_][A-Za-z0-9_]*$/.test(key),
        ),
      "Use at most 10 plain column names",
    );
  const row = z.record(z.unknown());

  const result = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  });
  const failure = (error: unknown) => ({
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : "Unknown error",
      },
    ],
    isError: true,
  });

  server.registerTool(
    "select_rows",
    {
      title: "Select Supabase rows",
      description:
        "Read rows from an allowed Supabase table using equality filters.",
      inputSchema: {
        table: identifier,
        columns,
        filters: filters.default({}),
        limit: z.number().int().min(1).max(100).default(50),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input) => {
      try {
        return result(await database.selectRows(input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "insert_rows",
    {
      title: "Insert Supabase rows",
      description: "Insert up to 100 rows into an allowed Supabase table.",
      inputSchema: {
        table: identifier,
        rows: z.array(row).min(1).max(100),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async (input) => {
      try {
        return result(await database.insertRows(input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "update_rows",
    {
      title: "Update Supabase rows",
      description:
        "Update rows in an allowed Supabase table. At least one equality filter is required.",
      inputSchema: {
        table: identifier,
        values: row.refine(
          (value) => Object.keys(value).length > 0,
          "At least one value is required",
        ),
        filters: filters.refine(
          (value) => Object.keys(value).length > 0,
          "At least one filter is required",
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async (input) => {
      try {
        return result(await database.updateRows(input));
      } catch (error) {
        return failure(error);
      }
    },
  );
}
