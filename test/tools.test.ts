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

const defaultSchema = {
  describeTable: async (table: string) => ({
    table,
    columns: [
      {
        name: "id",
        type: "number",
        nullable: false,
        required: true,
      },
      {
        name: "title",
        type: "text",
        nullable: true,
        required: false,
      },
    ],
  }),
  assertColumns: async () => undefined,
};

test("registerSupabaseTools exposes schema, select, insert, and update", () => {
  const server = new FakeServer();
  const database = {
    selectRows: async () => [],
    insertRows: async () => [],
    updateRows: async () => [],
  };

  registerSupabaseTools(
    server as never,
    database,
    defaultSchema,
    new Set(["todos"]),
  );

  assert.deepEqual([...server.tools.keys()], [
    "describe_table",
    "select_rows",
    "insert_rows",
    "update_rows",
  ]);
});

test("describe_table returns the allowed table schema as JSON text", async () => {
  const server = new FakeServer();
  const database = {
    selectRows: async () => [],
    insertRows: async () => [],
    updateRows: async () => [],
  };
  registerSupabaseTools(
    server as never,
    database,
    defaultSchema,
    new Set(["ipo_stocks"]),
  );

  const result = await server.tools.get("describe_table")!({
    table: "ipo_stocks",
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(result.content[0].text), {
    table: "ipo_stocks",
    columns: [
      {
        name: "id",
        type: "number",
        nullable: false,
        required: true,
      },
      {
        name: "title",
        type: "text",
        nullable: true,
        required: false,
      },
    ],
  });
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
    defaultSchema,
    new Set(["ipo_stocks"]),
  );

  const tableSchema =
    server.definitions.get("select_rows").inputSchema.table;

  assert.deepEqual(tableSchema.options, ["ipo_stocks"]);
  assert.equal(tableSchema.safeParse("ipo_stocks").success, true);
  assert.equal(tableSchema.safeParse("ipo_list").success, false);
});

test("tool schemas accept safe Korean column identifiers", () => {
  const server = new FakeServer();
  const database = {
    selectRows: async () => [],
    insertRows: async () => [],
    updateRows: async () => [],
  };

  registerSupabaseTools(
    server as never,
    database,
    defaultSchema,
    new Set(["ipo_stocks"]),
  );

  const inputSchema =
    server.definitions.get("select_rows").inputSchema;

  assert.equal(
    inputSchema.columns.safeParse(["종목명", "청약시작일"]).success,
    true,
  );
  assert.equal(
    inputSchema.filters.safeParse({ 종목명: "테스트" }).success,
    true,
  );
  assert.equal(
    inputSchema.columns.safeParse(["종목명,created_at"]).success,
    false,
  );
  assert.equal(
    inputSchema.conditions.safeParse([
      {
        column: "청약시작일",
        operator: "gte",
        value: "2026-07-01",
      },
      {
        column: "종목명",
        operator: "ilike",
        value: "%테크%",
      },
    ]).success,
    true,
  );
  assert.equal(
    inputSchema.conditions.safeParse([
      { column: "종목명", operator: "sql", value: "drop table" },
    ]).success,
    false,
  );
});

test("select_rows returns database rows as JSON text", async () => {
  const server = new FakeServer();
  const database = {
    selectRows: async () => [{ id: 1, title: "Ship MCP" }],
    insertRows: async () => [],
    updateRows: async () => [],
  };
  registerSupabaseTools(
    server as never,
    database,
    defaultSchema,
    new Set(["todos"]),
  );

  const result = await server.tools.get("select_rows")!({
    table: "todos",
    columns: ["id", "title"],
    filters: {},
    conditions: [],
    order_by: [],
    limit: 50,
    offset: 0,
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(result.content[0].text), [
    { id: 1, title: "Ship MCP" },
  ]);
});

test("tool handlers validate every referenced column before database calls", async () => {
  const server = new FakeServer();
  const assertColumnCalls: [string, readonly string[]][] = [];
  const databaseCalls: [string, unknown][] = [];
  const database = {
    selectRows: async (input: unknown) => {
      databaseCalls.push(["select", input]);
      return [];
    },
    insertRows: async (input: unknown) => {
      databaseCalls.push(["insert", input]);
      return [];
    },
    updateRows: async (input: unknown) => {
      databaseCalls.push(["update", input]);
      return [];
    },
  };
  const schema = {
    describeTable: defaultSchema.describeTable,
    assertColumns: async (
      table: string,
      columns: readonly string[],
    ) => {
      assertColumnCalls.push([table, columns]);
    },
  };
  registerSupabaseTools(
    server as never,
    database,
    schema,
    new Set(["ipo_stocks"]),
  );

  await server.tools.get("select_rows")!({
    table: "ipo_stocks",
    columns: ["종목명", "청약시작일"],
    filters: { 업종: "소프트웨어" },
    conditions: [
      {
        column: "청약시작일",
        operator: "gte",
        value: "2026-07-01",
      },
    ],
    order_by: [
      { column: "종목명", direction: "asc" },
    ],
    limit: 20,
    offset: 40,
  });
  await server.tools.get("insert_rows")!({
    table: "ipo_stocks",
    rows: [
      { 종목명: "테스트", 업종: "소프트웨어" },
      { 종목명: "두번째", 청약시작일: "2026-07-01" },
    ],
  });
  await server.tools.get("update_rows")!({
    table: "ipo_stocks",
    values: { 업종: "AI" },
    filters: { 종목명: "테스트" },
  });

  assert.deepEqual(assertColumnCalls, [
    [
      "ipo_stocks",
      ["종목명", "청약시작일", "업종"],
    ],
    [
      "ipo_stocks",
      ["종목명", "업종", "청약시작일"],
    ],
    ["ipo_stocks", ["업종", "종목명"]],
  ]);
  assert.deepEqual(
    databaseCalls.map(([operation]) => operation),
    ["select", "insert", "update"],
  );
  assert.deepEqual(databaseCalls[0]![1], {
    table: "ipo_stocks",
    columns: ["종목명", "청약시작일"],
    filters: { 업종: "소프트웨어" },
    conditions: [
      {
        column: "청약시작일",
        operator: "gte",
        value: "2026-07-01",
      },
    ],
    orderBy: [
      { column: "종목명", direction: "asc" },
    ],
    limit: 20,
    offset: 40,
  });
});

test("select_rows omits wildcard schema validation", async () => {
  const server = new FakeServer();
  const assertColumnCalls: [string, readonly string[]][] = [];
  const schema = {
    describeTable: defaultSchema.describeTable,
    assertColumns: async (
      table: string,
      columns: readonly string[],
    ) => {
      assertColumnCalls.push([table, columns]);
    },
  };
  const database = {
    selectRows: async () => [],
    insertRows: async () => [],
    updateRows: async () => [],
  };
  registerSupabaseTools(
    server as never,
    database,
    schema,
    new Set(["todos"]),
  );

  await server.tools.get("select_rows")!({
    table: "todos",
    columns: ["*"],
    filters: {},
    conditions: [],
    order_by: [],
    limit: 50,
    offset: 0,
  });

  assert.deepEqual(assertColumnCalls, [["todos", []]]);
});

test("schema validation failures stop database calls", async () => {
  const server = new FakeServer();
  let databaseCalls = 0;
  const database = {
    selectRows: async () => {
      databaseCalls += 1;
      return [];
    },
    insertRows: async () => [],
    updateRows: async () => [],
  };
  const schema = {
    describeTable: defaultSchema.describeTable,
    assertColumns: async () => {
      throw new Error('Column "없는컬럼" was not found');
    },
  };
  registerSupabaseTools(
    server as never,
    database,
    schema,
    new Set(["ipo_stocks"]),
  );

  const result = await server.tools.get("select_rows")!({
    table: "ipo_stocks",
    columns: ["없는컬럼"],
    filters: {},
    conditions: [],
    order_by: [],
    limit: 50,
    offset: 0,
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /없는컬럼/);
  assert.equal(databaseCalls, 0);
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
  registerSupabaseTools(
    server as never,
    database,
    defaultSchema,
    new Set(["users"]),
  );

  const result = await server.tools.get("select_rows")!({
    table: "users",
    columns: ["*"],
    filters: {},
    conditions: [],
    order_by: [],
    limit: 50,
    offset: 0,
  });

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not allowed/);
});
