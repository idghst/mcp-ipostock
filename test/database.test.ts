import assert from "node:assert/strict";
import test from "node:test";

import { createDatabaseGateway } from "../lib/database.ts";

type Call = [string, ...unknown[]];

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  calls: Call[] = [];

  select(columns: string) {
    this.calls.push(["select", columns]);
    return this;
  }

  insert(rows: Record<string, unknown>[]) {
    this.calls.push(["insert", rows]);
    return this;
  }

  update(values: Record<string, unknown>) {
    this.calls.push(["update", values]);
    return this;
  }

  eq(column: string, value: unknown) {
    this.calls.push(["eq", column, value]);
    return this;
  }

  neq(column: string, value: unknown) {
    this.calls.push(["neq", column, value]);
    return this;
  }

  gt(column: string, value: unknown) {
    this.calls.push(["gt", column, value]);
    return this;
  }

  gte(column: string, value: unknown) {
    this.calls.push(["gte", column, value]);
    return this;
  }

  lt(column: string, value: unknown) {
    this.calls.push(["lt", column, value]);
    return this;
  }

  lte(column: string, value: unknown) {
    this.calls.push(["lte", column, value]);
    return this;
  }

  like(column: string, value: string) {
    this.calls.push(["like", column, value]);
    return this;
  }

  ilike(column: string, value: string) {
    this.calls.push(["ilike", column, value]);
    return this;
  }

  in(column: string, value: unknown[]) {
    this.calls.push(["in", column, value]);
    return this;
  }

  is(column: string, value: boolean | null) {
    this.calls.push(["is", column, value]);
    return this;
  }

  order(column: string, options: { ascending: boolean }) {
    this.calls.push(["order", column, options]);
    return this;
  }

  range(from: number, to: number) {
    this.calls.push(["range", from, to]);
    return this;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: [{ id: 1 }], error: null }).then(
      onfulfilled,
      onrejected,
    );
  }
}

class FakeClient {
  readonly query = new FakeQuery();
  table?: string;

  from(table: string) {
    this.table = table;
    return this.query;
  }
}

test("selectRows applies columns, equality filters, null filters, and pagination", async () => {
  const client = new FakeClient();
  const database = createDatabaseGateway(client, new Set(["todos"]));

  const rows = await database.selectRows({
    table: "todos",
    columns: ["id", "title"],
    filters: { done: false, owner_id: null },
    conditions: [],
    orderBy: [],
    limit: 20,
    offset: 0,
  });

  assert.deepEqual(rows, [{ id: 1 }]);
  assert.equal(client.table, "todos");
  assert.deepEqual(client.query.calls, [
    ["select", "id,title"],
    ["eq", "done", false],
    ["is", "owner_id", null],
    ["range", 0, 19],
  ]);
});

test("selectRows applies conditions, ordering, and pagination", async () => {
  const client = new FakeClient();
  const database = createDatabaseGateway(
    client,
    new Set(["ipo_stocks"]),
  );

  await database.selectRows({
    table: "ipo_stocks",
    columns: ["종목명", "청약시작일"],
    filters: { 업종: "소프트웨어" },
    conditions: [
      {
        column: "청약시작일",
        operator: "gte",
        value: "2026-07-01",
      },
      {
        column: "청약시작일",
        operator: "lte",
        value: "2026-07-31",
      },
      {
        column: "종목명",
        operator: "ilike",
        value: "%테크%",
      },
      {
        column: "확정공모가",
        operator: "in",
        value: ["10000", "12000"],
      },
    ],
    orderBy: [
      { column: "청약시작일", direction: "asc" },
      { column: "종목명", direction: "desc" },
    ],
    limit: 20,
    offset: 40,
  });

  assert.deepEqual(client.query.calls, [
    ["select", "종목명,청약시작일"],
    ["eq", "업종", "소프트웨어"],
    ["gte", "청약시작일", "2026-07-01"],
    ["lte", "청약시작일", "2026-07-31"],
    ["ilike", "종목명", "%테크%"],
    ["in", "확정공모가", ["10000", "12000"]],
    ["order", "청약시작일", { ascending: true }],
    ["order", "종목명", { ascending: false }],
    ["range", 40, 59],
  ]);
});

test("selectRows maps every supported condition operator", async () => {
  const client = new FakeClient();
  const database = createDatabaseGateway(client, new Set(["todos"]));

  await database.selectRows({
    table: "todos",
    columns: ["*"],
    filters: {},
    conditions: [
      { column: "id", operator: "eq", value: 1 },
      { column: "id", operator: "neq", value: 2 },
      { column: "score", operator: "gt", value: 10 },
      { column: "score", operator: "lt", value: 20 },
      { column: "title", operator: "like", value: "Ship%" },
      { column: "archived_at", operator: "is", value: null },
      { column: "done", operator: "is", value: false },
    ],
    orderBy: [],
    limit: 5,
    offset: 0,
  });

  assert.deepEqual(client.query.calls, [
    ["select", "*"],
    ["eq", "id", 1],
    ["neq", "id", 2],
    ["gt", "score", 10],
    ["lt", "score", 20],
    ["like", "title", "Ship%"],
    ["is", "archived_at", null],
    ["is", "done", false],
    ["range", 0, 4],
  ]);
});

test("insertRows returns inserted rows", async () => {
  const client = new FakeClient();
  const database = createDatabaseGateway(client, new Set(["todos"]));
  const rows = [{ title: "Ship MCP" }];

  await database.insertRows({ table: "todos", rows });

  assert.deepEqual(client.query.calls, [
    ["insert", rows],
    ["select", "*"],
  ]);
});

test("updateRows requires at least one filter", async () => {
  const client = new FakeClient();
  const database = createDatabaseGateway(client, new Set(["todos"]));

  await assert.rejects(
    () =>
      database.updateRows({
        table: "todos",
        values: { done: true },
        filters: {},
      }),
    /filter/i,
  );
  assert.equal(client.table, undefined);
});

test("updateRows updates and returns only filtered rows", async () => {
  const client = new FakeClient();
  const database = createDatabaseGateway(client, new Set(["todos"]));

  await database.updateRows({
    table: "todos",
    values: { done: true },
    filters: { id: 1 },
  });

  assert.deepEqual(client.query.calls, [
    ["update", { done: true }],
    ["eq", "id", 1],
    ["select", "*"],
  ]);
});

test("database operations reject tables outside the allowlist", async () => {
  const database = createDatabaseGateway(
    new FakeClient(),
    new Set(["todos"]),
  );

  await assert.rejects(
    () =>
      database.selectRows({
        table: "users",
        columns: ["*"],
        filters: {},
        conditions: [],
        orderBy: [],
        limit: 10,
        offset: 0,
      }),
    /not allowed/i,
  );
});
