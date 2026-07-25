import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { DatabaseGateway } from "./database.ts";
import type { SchemaGateway } from "./schema.ts";

export function registerSupabaseTools(
  server: McpServer,
  database: DatabaseGateway,
  schema: SchemaGateway,
  allowedTables: ReadonlySet<string>,
) {
  const identifierPattern = /^[\p{L}_][\p{L}\p{N}_]*$/u;
  const identifier = z
    .string()
    .regex(
      identifierPattern,
      "Use a column name containing only letters, numbers, or underscores",
    );
  const table = z.enum(
    [...allowedTables] as [string, ...string[]],
  );
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
          identifierPattern.test(key),
        ),
      "Use at most 10 plain column names",
    );
  const comparisonCondition = z.object({
    column: identifier,
    operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
    value: filterValue,
  });
  const textCondition = z.object({
    column: identifier,
    operator: z.enum(["like", "ilike"]),
    value: z.string(),
  });
  const inCondition = z.object({
    column: identifier,
    operator: z.literal("in"),
    value: z
      .array(z.union([z.string(), z.number(), z.boolean()]))
      .min(1)
      .max(100),
  });
  const isCondition = z.object({
    column: identifier,
    operator: z.literal("is"),
    value: z.union([z.boolean(), z.null()]),
  });
  const conditions = z
    .array(
      z.union([
        comparisonCondition,
        textCondition,
        inCondition,
        isCondition,
      ]),
    )
    .max(10)
    .default([]);
  const orderBy = z
    .array(
      z.object({
        column: identifier,
        direction: z.enum(["asc", "desc"]),
      }),
    )
    .max(3)
    .default([]);
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
    "describe_table",
    {
      title: "Describe Supabase table",
      description:
        "Inspect the columns and types of an allowed Supabase table. Call this before select_rows, insert_rows, or update_rows when the table schema is unknown.",
      inputSchema: { table },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ table }) => {
      try {
        return result(await schema.describeTable(table));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "select_rows",
    {
      title: "Select Supabase rows",
      description:
        "Read rows from an allowed Supabase table. filters use exact equality, conditions support ranges and text search, and order_by provides stable ordering.",
      inputSchema: {
        table,
        columns,
        filters: filters.default({}),
        conditions,
        order_by: orderBy,
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (input) => {
      try {
        const referencedColumns = new Set([
          ...input.columns.filter((column) => column !== "*"),
          ...Object.keys(input.filters),
          ...input.conditions.map(({ column }) => column),
          ...input.order_by.map(({ column }) => column),
        ]);
        await schema.assertColumns(
          input.table,
          [...referencedColumns],
        );
        return result(
          await database.selectRows({
            table: input.table,
            columns: input.columns,
            filters: input.filters,
            conditions: input.conditions,
            orderBy: input.order_by,
            limit: input.limit,
            offset: input.offset,
          }),
        );
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
        table,
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
        await schema.assertColumns(
          input.table,
          [...new Set(input.rows.flatMap(Object.keys))],
        );
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
        table,
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
        await schema.assertColumns(
          input.table,
          [
            ...new Set([
              ...Object.keys(input.values),
              ...Object.keys(input.filters),
            ]),
          ],
        );
        return result(await database.updateRows(input));
      } catch (error) {
        return failure(error);
      }
    },
  );
}
