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

  is(column: string, value: null) {
    this.calls.push(["is", column, value]);
    return this;
  }

  limit(limit: number) {
    this.calls.push(["limit", limit]);
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

test("selectRows applies columns, equality filters, null filters, and limit", async () => {
  const client = new FakeClient();
  const database = createDatabaseGateway(client, new Set(["todos"]));

  const rows = await database.selectRows({
    table: "todos",
    columns: ["id", "title"],
    filters: { done: false, owner_id: null },
    limit: 20,
  });

  assert.deepEqual(rows, [{ id: 1 }]);
  assert.equal(client.table, "todos");
  assert.deepEqual(client.query.calls, [
    ["select", "id,title"],
    ["eq", "done", false],
    ["is", "owner_id", null],
    ["limit", 20],
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
        limit: 10,
      }),
    /not allowed/i,
  );
});
