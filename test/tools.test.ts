import assert from "node:assert/strict";
import test from "node:test";

import { registerSupabaseTools } from "../lib/tools.ts";

type ToolHandler = (input: any) => Promise<any>;

class FakeServer {
  readonly tools = new Map<string, ToolHandler>();
  readonly definitions = new Map<string, any>();

  registerTool(
    name: string,
    definition: unknown,
    handler: ToolHandler,
  ) {
    this.definitions.set(name, definition);
    this.tools.set(name, handler);
  }
}

test("registerSupabaseTools exposes select, insert, and update", () => {
  const server = new FakeServer();
  const database = {
    selectRows: async () => [],
    insertRows: async () => [],
    updateRows: async () => [],
  };

  registerSupabaseTools(server as never, database, new Set(["todos"]));

  assert.deepEqual([...server.tools.keys()], [
    "select_rows",
    "insert_rows",
    "update_rows",
  ]);
});

test("tool schemas expose configured table names as the only options", () => {
  const server = new FakeServer();
  const database = {
    selectRows: async () => [],
    insertRows: async () => [],
    updateRows: async () => [],
  };

  registerSupabaseTools(
    server as never,
    database,
    new Set(["ipo_stocks"]),
  );

  const tableSchema =
    server.definitions.get("select_rows").inputSchema.table;

  assert.deepEqual(tableSchema.options, ["ipo_stocks"]);
  assert.equal(tableSchema.safeParse("ipo_stocks").success, true);
  assert.equal(tableSchema.safeParse("ipo_list").success, false);
});

test("select_rows returns database rows as JSON text", async () => {
  const server = new FakeServer();
  const database = {
    selectRows: async () => [{ id: 1, title: "Ship MCP" }],
    insertRows: async () => [],
    updateRows: async () => [],
  };
  registerSupabaseTools(server as never, database, new Set(["todos"]));

  const result = await server.tools.get("select_rows")!({
    table: "todos",
    columns: ["id", "title"],
    filters: {},
    limit: 50,
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(result.content[0].text), [
    { id: 1, title: "Ship MCP" },
  ]);
});

test("tool failures are returned as MCP errors", async () => {
  const server = new FakeServer();
  const database = {
    selectRows: async () => {
      throw new Error("Table is not allowed");
    },
    insertRows: async () => [],
    updateRows: async () => [],
  };
  registerSupabaseTools(server as never, database, new Set(["users"]));

  const result = await server.tools.get("select_rows")!({
    table: "users",
    columns: ["*"],
    filters: {},
    limit: 50,
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not allowed/);
});
