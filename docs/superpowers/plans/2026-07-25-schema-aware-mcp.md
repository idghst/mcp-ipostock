# Schema-aware Supabase MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** n8n AI Agent가 허용된 Supabase 테이블의 실제 스키마를 탐색하고 한글 컬럼, 기간·부분 검색, 정렬, pagination을 사용해 안전하게 조회·입력·수정할 수 있는 MCP를 만든다.

**Architecture:** 기존 Vercel Streamable HTTP MCP와 Supabase client gateway를 유지하고, Data API OpenAPI를 allowlist로 필터링하는 `SchemaGateway`를 추가한다. MCP handler는 스키마 검증 후 database gateway를 호출하며, database gateway는 허용된 operator만 Supabase query builder method로 매핑한다.

**Tech Stack:** Node.js 24, TypeScript 5.9.3, `@modelcontextprotocol/sdk` 1.26.0, `@supabase/supabase-js` 2.110.8, `mcp-handler` 1.1.0, Zod 3.25.76, Vercel CLI 57.0.0

## Global Constraints

- 새 runtime 또는 dev dependency를 추가하지 않는다.
- `SUPABASE_ALLOWED_TABLES` 밖의 table·column metadata를 MCP에 노출하지 않는다.
- delete와 임의 SQL 실행 도구를 추가하지 않는다.
- `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `MCP_API_KEY`, row 전체를 로그에 기록하지 않는다.
- 기존 `filters` equality 입력과 JSON row 배열 출력의 호환성을 유지한다.
- `select_rows`는 최대 100행, 조건은 최대 10개, 정렬은 최대 3개다.
- `update_rows`는 하나 이상의 equality filter를 계속 요구한다.
- Production에는 실제 `sb_secret_...` 또는 legacy `service_role` key가 준비된 뒤에만 배포한다.
- 별도 확인된 RLS 비활성 테이블은 이번 구현에서 변경하지 않는다.

---

## File Structure

- Create `lib/schema.ts`: OpenAPI fetch, allowlist filtering, table description cache, column assertion
- Create `test/schema.test.ts`: OpenAPI normalization, allowlist isolation, cache, missing table/column behavior
- Modify `lib/config.ts`: publishable key rejection
- Modify `lib/database.ts`: condition operators, ordering, pagination
- Modify `lib/tools.ts`: Unicode identifiers, `describe_table`, schema-aware validation, richer query schema
- Modify `api/server.ts`: one `SchemaGateway` instance를 tool registration에 주입
- Modify `scripts/smoke.mjs`: `describe_table`, schema enum, optional minimum-row production probe
- Modify `test/config.test.ts`: publishable key regression
- Modify `test/database.test.ts`: operator/order/range mapping
- Modify `test/tools.test.ts`: Korean identifiers, describe tool, schema validation, query input forwarding
- Modify `test/smoke.test.ts`: 새 smoke 환경변수 usage contract
- Modify `.env.example`: server secret와 optional smoke minimum 명확화
- Modify `README.md`: tool contract, n8n usage order, deployment verification

---

### Task 1: Reject public keys and support safe Unicode identifiers

**Files:**
- Modify: `lib/config.ts`
- Modify: `lib/tools.ts`
- Test: `test/config.test.ts`
- Test: `test/tools.test.ts`

**Interfaces:**
- Consumes: 기존 `loadConfig(env)`와 `registerSupabaseTools(...)`
- Produces: publishable key를 거부하는 `loadConfig`; 한글·영문·숫자·underscore를 허용하는 identifier schema

> Incident diagnosis 중 이 task의 red-green cycle은 이미 실행됐다. 현재 working tree의 네 파일을 먼저 diff로 검토하고 아래 테스트와 구현이 정확히 일치하는지 확인한다.

- [ ] **Step 1: Confirm the credential regression test**

`test/config.test.ts`에 다음 동작 테스트가 있어야 한다.

```ts
test("loadConfig rejects a publishable key used as the server secret", () => {
  assert.throws(
    () =>
      loadConfig({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEY: "sb_publishable_example",
        SUPABASE_ALLOWED_TABLES: "todos",
        MCP_API_KEY: "0123456789abcdef0123456789abcdef",
      }),
    /SUPABASE_SECRET_KEY.*publishable/,
  );
});
```

- [ ] **Step 2: Confirm the Unicode identifier regression test**

`test/tools.test.ts`에서 `select_rows` input schema가 아래 결과를 내야 한다.

```ts
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
```

- [ ] **Step 3: Confirm the minimal implementation**

`lib/config.ts`:

```ts
if (supabaseKey.startsWith("sb_publishable_")) {
  throw new Error(
    "SUPABASE_SECRET_KEY cannot use a publishable key",
  );
}
```

`lib/tools.ts`:

```ts
const identifierPattern = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const identifier = z.string().regex(
  identifierPattern,
  "Use a column name containing only letters, numbers, or underscores",
);
```

`filters`의 key 검사에도 동일한 `identifierPattern`을 사용한다.

- [ ] **Step 4: Run focused and full checks**

Run:

```bash
npm test -- --test-name-pattern='publishable key|Korean column identifiers'
npm run check
git diff --check
```

Expected: 26개 이상의 test가 모두 PASS, typecheck exit 0, whitespace error 없음.

- [ ] **Step 5: Commit**

```bash
git add lib/config.ts lib/tools.ts test/config.test.ts test/tools.test.ts
git commit -m "Supabase 키와 한글 컬럼 검증 강화"
```

---

### Task 2: Add an allowlisted schema gateway

**Files:**
- Create: `lib/schema.ts`
- Create: `test/schema.test.ts`

**Interfaces:**
- Consumes:
  - `supabaseUrl: string`
  - `supabaseKey: string`
  - `allowedTables: ReadonlySet<string>`
- Produces:

```ts
export type TableColumn = {
  name: string;
  type: string;
  nullable: boolean;
  required: boolean;
};

export type TableDescription = {
  table: string;
  columns: TableColumn[];
};

export type SchemaGateway = {
  describeTable(table: string): Promise<TableDescription>;
  assertColumns(table: string, columns: readonly string[]): Promise<void>;
};

export function createSchemaGateway(
  options: {
    supabaseUrl: string;
    supabaseKey: string;
    allowedTables: ReadonlySet<string>;
    fetchImpl?: typeof fetch;
  },
): SchemaGateway;
```

- [ ] **Step 1: Write failing OpenAPI normalization tests**

`test/schema.test.ts`에 실제 PostgREST 형태의 최소 fixture를 사용한다.

```ts
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
```

Fake fetch는 status 200과 `json: async () => openApi`를 반환한다.

Assertions:

```ts
assert.deepEqual(
  await gateway.describeTable("ipo_stocks"),
  {
    table: "ipo_stocks",
    columns: [
      { name: "id", type: "uuid", nullable: false, required: true },
      { name: "종목명", type: "text", nullable: true, required: false },
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
```

- [ ] **Step 2: Run the schema test and verify RED**

Run:

```bash
npm test -- --test-name-pattern='schema gateway'
```

Expected: FAIL because `lib/schema.ts` or `createSchemaGateway` does not exist.

- [ ] **Step 3: Implement OpenAPI fetch and normalization**

`lib/schema.ts`의 fetch contract:

```ts
const response = await fetchImpl(`${supabaseUrl}/rest/v1/`, {
  headers: {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    Accept: "application/openapi+json",
  },
});
```

규칙:

- non-2xx면 `Supabase schema request failed: HTTP <status>`를 throw한다.
- `definitions[table]`만 읽는다.
- type은 `property.format || property.type || "unknown"`이다.
- `required`는 definition의 `required` 배열 포함 여부다.
- `nullable`은 `property.nullable ?? property["x-nullable"] ?? !required`다.
- table allowlist 검사는 fetch 전에 수행한다.
- 첫 schema fetch Promise를 closure에 보관해 같은 Function instance에서 재사용한다.

- [ ] **Step 4: Add column assertion and cache tests**

Assertions:

```ts
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
assert.equal(fetchCalls, 1);
```

HTTP 401 fixture는 다음 오류를 확인한다.

```ts
await assert.rejects(
  () => gateway.describeTable("ipo_stocks"),
  /Supabase schema request failed: HTTP 401/,
);
```

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
npm test -- --test-name-pattern='schema gateway'
npm run typecheck
```

Expected: schema tests PASS, typecheck exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/schema.ts test/schema.test.ts
git commit -m "허용 테이블 스키마 탐색 추가"
```

---

### Task 3: Add query conditions, ordering, and pagination

**Files:**
- Modify: `lib/database.ts`
- Modify: `test/database.test.ts`

**Interfaces:**
- Consumes: Supabase query builder methods `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `in`, `is`, `order`, `range`
- Produces:

```ts
export type FilterValue = string | number | boolean | null;

export type QueryCondition =
  | {
      column: string;
      operator:
        | "eq"
        | "neq"
        | "gt"
        | "gte"
        | "lt"
        | "lte";
      value: FilterValue;
    }
  | {
      column: string;
      operator: "like" | "ilike";
      value: string;
    }
  | {
      column: string;
      operator: "in";
      value: Exclude<FilterValue, null>[];
    }
  | {
      column: string;
      operator: "is";
      value: boolean | null;
    };

export type QueryOrder = {
  column: string;
  direction: "asc" | "desc";
};

export type SelectInput = {
  table: string;
  columns: string[];
  filters: Record<string, FilterValue>;
  conditions: QueryCondition[];
  orderBy: QueryOrder[];
  limit: number;
  offset: number;
};
```

- [ ] **Step 1: Extend the fake query and write the failing mapping test**

`test/database.test.ts`의 `FakeQuery`에 다음 method를 추가하고 각각
`calls`에 method name과 arguments를 기록한다.

```ts
neq(column: string, value: unknown)
gt(column: string, value: unknown)
gte(column: string, value: unknown)
lt(column: string, value: unknown)
lte(column: string, value: unknown)
like(column: string, value: string)
ilike(column: string, value: string)
in(column: string, value: unknown[])
order(column: string, options: { ascending: boolean })
range(from: number, to: number)
```

`selectRows` input:

```ts
{
  table: "ipo_stocks",
  columns: ["종목명", "청약시작일"],
  filters: { 업종: "소프트웨어" },
  conditions: [
    { column: "청약시작일", operator: "gte", value: "2026-07-01" },
    { column: "청약시작일", operator: "lte", value: "2026-07-31" },
    { column: "종목명", operator: "ilike", value: "%테크%" },
    { column: "확정공모가", operator: "in", value: ["10000", "12000"] },
  ],
  orderBy: [
    { column: "청약시작일", direction: "asc" },
    { column: "종목명", direction: "desc" },
  ],
  limit: 20,
  offset: 40,
}
```

Expected method tail:

```ts
[
  ["select", "종목명,청약시작일"],
  ["eq", "업종", "소프트웨어"],
  ["gte", "청약시작일", "2026-07-01"],
  ["lte", "청약시작일", "2026-07-31"],
  ["ilike", "종목명", "%테크%"],
  ["in", "확정공모가", ["10000", "12000"]],
  ["order", "청약시작일", { ascending: true }],
  ["order", "종목명", { ascending: false }],
  ["range", 40, 59],
]
```

- [ ] **Step 2: Run the mapping test and verify RED**

Run:

```bash
npm test -- --test-name-pattern='conditions, ordering, and pagination'
```

Expected: FAIL because the new fields and query methods are not applied.

- [ ] **Step 3: Implement condition and ordering dispatch**

`lib/database.ts`에 exhaustive `switch`를 사용한다.

```ts
const conditioned = (query: any, conditions: QueryCondition[]) => {
  for (const condition of conditions) {
    switch (condition.operator) {
      case "eq":
      case "neq":
      case "gt":
      case "gte":
      case "lt":
      case "lte":
      case "like":
      case "ilike":
      case "in":
      case "is":
        query = query[condition.operator](
          condition.column,
          condition.value,
        );
        break;
    }
  }
  return query;
};
```

`selectRows` 순서는 `select → filters → conditions → orderBy → range`다.

```ts
for (const order of input.orderBy) {
  query = query.order(order.column, {
    ascending: order.direction === "asc",
  });
}
return data(
  query.range(input.offset, input.offset + input.limit - 1),
);
```

- [ ] **Step 4: Add remaining operator tests**

한 test table에서 `neq`, `gt`, `lt`, `like`, `is`가 같은 이름의
`FakeQuery` method로 전달되는지 literal call 배열로 확인한다. `is`는
`null`과 `false` 두 case를 포함한다.

- [ ] **Step 5: Run database tests and full checks**

Run:

```bash
npm test -- --test-name-pattern='selectRows|database'
npm run check
```

Expected: database tests와 전체 suite PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/database.ts test/database.test.ts
git commit -m "Supabase 고급 조회 조건 추가"
```

---

### Task 4: Expose schema-aware MCP tools

**Files:**
- Modify: `lib/tools.ts`
- Modify: `api/server.ts`
- Modify: `test/tools.test.ts`

**Interfaces:**
- Consumes:
  - `DatabaseGateway`
  - `SchemaGateway`
  - `ReadonlySet<string>`
- Produces:

```ts
export function registerSupabaseTools(
  server: McpServer,
  database: DatabaseGateway,
  schema: SchemaGateway,
  allowedTables: ReadonlySet<string>,
): void;
```

- [ ] **Step 1: Add a schema fake and failing describe tool test**

`test/tools.test.ts`:

```ts
const schema = {
  describeTable: async () => ({
    table: "ipo_stocks",
    columns: [
      {
        name: "종목명",
        type: "text",
        nullable: true,
        required: false,
      },
    ],
  }),
  assertColumns: async () => undefined,
};
```

Expected registered tool names:

```ts
[
  "describe_table",
  "select_rows",
  "insert_rows",
  "update_rows",
]
```

Calling `describe_table` with `{ table: "ipo_stocks" }` must return the
description as JSON text.

- [ ] **Step 2: Run the describe test and verify RED**

Run:

```bash
npm test -- --test-name-pattern='describe_table'
```

Expected: FAIL because `describe_table` is not registered.

- [ ] **Step 3: Implement the tool input schemas**

In `lib/tools.ts`:

```ts
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
  value: z.array(
    z.union([z.string(), z.number(), z.boolean()]),
  ).min(1).max(100),
});

const isCondition = z.object({
  column: identifier,
  operator: z.literal("is"),
  value: z.union([z.boolean(), z.null()]),
});

const conditions = z.array(
  z.union([
    comparisonCondition,
    textCondition,
    inCondition,
    isCondition,
  ]),
).max(10).default([]);

const orderBy = z.array(
  z.object({
    column: identifier,
    direction: z.enum(["asc", "desc"]),
  }),
).max(3).default([]);
```

`select_rows`에 `conditions`, `order_by`, `offset`을 추가하고 handler에서
database camelCase input인 `orderBy`로 변환한다.

- [ ] **Step 4: Add schema validation tests for every operation**

`assertColumns` fake가 받은 call을 기록한다.

Expected:

- select: explicit columns, filter keys, condition columns, order columns
- insert: every row key의 unique union
- update: values keys와 filter keys의 unique union
- `columns: ["*"]`는 `"*"`를 assertColumns에 전달하지 않음

Example select assertion:

```ts
assert.deepEqual(assertColumnCalls, [
  [
    "ipo_stocks",
    ["종목명", "청약시작일", "업종"],
  ],
]);
```

Schema assertion이 throw하면 database fake 호출 횟수가 0이고 MCP result의
`isError`가 `true`여야 한다.

- [ ] **Step 5: Implement schema-aware handlers and descriptions**

`describe_table` description:

```text
Inspect the columns and types of an allowed Supabase table. Call this
before select_rows, insert_rows, or update_rows when the table schema is
unknown.
```

`select_rows` description에는 `filters`는 exact equality,
`conditions`는 range/search, `order_by`는 stable ordering임을 명시한다.

각 handler는 column union을 만들고 `await schema.assertColumns(...)`
후 database를 호출한다. 오류는 기존 `failure(error)`로 반환한다.

- [ ] **Step 6: Wire the schema gateway into the server**

`api/server.ts`:

```ts
const schema = createSchemaGateway({
  supabaseUrl: config.supabaseUrl,
  supabaseKey: config.supabaseKey,
  allowedTables: config.allowedTables,
});

registerSupabaseTools(
  server,
  createDatabaseGateway(client, config.allowedTables),
  schema,
  config.allowedTables,
);
```

`createSchemaGateway` import는 `../lib/schema.ts`를 사용한다.

- [ ] **Step 7: Run tools, route, and full checks**

Run:

```bash
npm test -- --test-name-pattern='describe_table|tool schemas|select_rows|tool failures'
npm run check
```

Expected: 4개 tool 등록, schema validation tests PASS, 전체 suite PASS.

- [ ] **Step 8: Commit**

```bash
git add api/server.ts lib/tools.ts test/tools.test.ts
git commit -m "MCP 스키마 탐색과 조회 계약 확장"
```

---

### Task 5: Update smoke checks, documentation, and deploy safely

**Files:**
- Modify: `scripts/smoke.mjs`
- Modify: `test/smoke.test.ts`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes:
  - `MCP_URL`
  - `MCP_API_KEY`
  - optional `MCP_SMOKE_TABLE`
  - optional `MCP_SMOKE_MIN_ROWS`
- Produces: schema-aware smoke JSON with `tools`, `schemaColumns`,
  `databaseRows`

- [ ] **Step 1: Write the failing smoke usage test**

`test/smoke.test.ts`에서 missing endpoint/key 실행 결과가 다음 환경변수를
포함하도록 기대한다.

```ts
assert.match(result.stderr, /MCP_SMOKE_TABLE/);
assert.match(result.stderr, /MCP_SMOKE_MIN_ROWS/);
```

- [ ] **Step 2: Run the smoke test and verify RED**

Run:

```bash
npm test -- --test-name-pattern='smoke command'
```

Expected: FAIL because current usage text does not mention the optional probe
variables.

- [ ] **Step 3: Extend the smoke script**

Required tool names:

```js
const expectedTools = [
  "describe_table",
  "insert_rows",
  "select_rows",
  "update_rows",
];
```

When `MCP_SMOKE_TABLE` exists:

1. call `describe_table`
2. parse its JSON text and count `columns.length`
3. call `select_rows` with `limit: 1`
4. parse the row array and record `rows.length`
5. when `MCP_SMOKE_MIN_ROWS` is set, validate it is a non-negative integer
6. fail when returned row count is smaller than the configured minimum

Success output:

```js
{
  status: "ok",
  endpoint: url.toString(),
  tools: toolNames,
  databaseProbe: smokeTable || "skipped",
  schemaColumns,
  databaseRows,
}
```

- [ ] **Step 4: Update environment and README contracts**

`.env.example`:

```dotenv
SUPABASE_SECRET_KEY=sb_secret_replace_me
# Do not put sb_publishable_... in SUPABASE_SECRET_KEY.
SUPABASE_ALLOWED_TABLES=your_table
MCP_API_KEY=replace_with_a_long_random_value
# Optional deployment probe:
# MCP_SMOKE_TABLE=your_table
# MCP_SMOKE_MIN_ROWS=1
```

`README.md`의 tool table에 `describe_table`과 `select_rows`의 새 조건,
정렬, pagination을 기록한다. n8n AI Agent 권장 순서는 다음으로 명시한다.

1. `describe_table`
2. `select_rows`
3. 변경 요청일 때만 `insert_rows` 또는 `update_rows`

publishable key를 `SUPABASE_SECRET_KEY`에 넣으면 503으로 거부된다고
명시한다.

- [ ] **Step 5: Run full local verification**

Run:

```bash
npm run check
npx --yes vercel@57.0.0 pull --yes --environment production
npx --yes vercel@57.0.0 build --prod
git diff --check
```

Expected: all tests PASS, typecheck exit 0, Vercel build status `ok`.

- [ ] **Step 6: Stop if the real server secret is absent**

Run a prefix-only check that never prints the key:

```bash
node --env-file=.env.local --input-type=module -e '
const key = process.env.SUPABASE_SECRET_KEY || "";
console.log(key.startsWith("sb_secret_") ? "secret-key-ok" : "secret-key-missing");
'
```

Expected before deployment: `secret-key-ok`.

If it prints `secret-key-missing`, do not modify Vercel env, push, or deploy.
Local commits from Tasks 1-4 may remain, but do not push them.
Ask the user to replace `.env.local` with a real `sb_secret_...` value.

- [ ] **Step 7: Update Vercel Production and Preview secrets**

After `secret-key-ok`, pipe the value without echoing it:

```bash
node --env-file=.env.local --input-type=module -e '
process.stdout.write(process.env.SUPABASE_SECRET_KEY);
' | npx --yes vercel@57.0.0 env update SUPABASE_SECRET_KEY production

node --env-file=.env.local --input-type=module -e '
process.stdout.write(process.env.SUPABASE_SECRET_KEY);
' | npx --yes vercel@57.0.0 env update SUPABASE_SECRET_KEY preview
```

Confirm only presence, never the value:

```bash
npx --yes vercel@57.0.0 env ls
```

- [ ] **Step 8: Commit and push**

```bash
git add .env.example README.md scripts/smoke.mjs test/smoke.test.ts
git commit -m "MCP 운영 검증과 사용 문서 강화"
git push
```

If push is non-fast-forward, stop without pull/rebase/merge.

- [ ] **Step 9: Wait for the Git production deployment**

```bash
mcp_deployment_url=$(
  npx --yes vercel@57.0.0 ls mcp-ipostock --format=json --limit 1 |
    node --input-type=module -e '
      let body = "";
      for await (const chunk of process.stdin) body += chunk;
      const deployments = JSON.parse(body);
      process.stdout.write(deployments.deployments[0].url);
    '
)
npx --yes vercel@57.0.0 inspect \
  "$mcp_deployment_url" \
  --wait \
  --timeout 45s \
  --format=json
```

Expected: target `production`, `readyState` `READY`, production alias
`mcp-ipostock.vercel.app`.

- [ ] **Step 10: Run real Production schema and row probes**

```bash
curl -fsS https://mcp-ipostock.vercel.app/health
MCP_SMOKE_TABLE=ipo_stocks MCP_SMOKE_MIN_ROWS=1 \
  npm run smoke -- https://mcp-ipostock.vercel.app/mcp
```

Expected:

- health JSON status `ok`
- tools include all 4 names
- `schemaColumns` is at least 13 for current `ipo_stocks`
- `databaseRows` is 1

Use a one-off MCP client to verify an ordered date query:

```js
await client.callTool({
  name: "select_rows",
  arguments: {
    table: "ipo_stocks",
    columns: ["종목명", "청약시작일", "상장일"],
    conditions: [
      {
        column: "청약시작일",
        operator: "gte",
        value: "2026-01-01",
      },
    ],
    order_by: [
      { column: "청약시작일", direction: "asc" },
    ],
    limit: 3,
    offset: 0,
  },
});
```

Verify the returned JSON is a non-empty array and the dates are ascending.
Do not print secret values or unnecessary row contents.

- [ ] **Step 11: Scan runtime errors and repository state**

```bash
npx --yes vercel@57.0.0 logs \
  --environment production \
  --level error \
  --since 10m \
  --limit 50
git status --short --branch
git log -5 --oneline
```

Expected: no new Production errors, `main...origin/main`, no uncommitted files.
