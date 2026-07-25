# Supabase CRUD MCP

Vercel Function에서 실행되는 stateless Streamable HTTP MCP 서버입니다.

## 제공 도구

| Tool | 기능 | 제한 |
|---|---|---|
| `describe_table` | 허용 테이블의 컬럼·타입 조회 | allowlist 밖 metadata 비노출 |
| `select_rows` | equality·범위·부분 검색, 정렬, pagination | 조건 10개, 정렬 3개, 최대 100행 |
| `insert_rows` | 행 입력 | 호출당 최대 100행 |
| `update_rows` | 행 수정 | filter 1개 이상 필수 |

`delete`와 임의 SQL 실행은 제공하지 않습니다.

`select_rows`는 기존 `filters` equality 입력과 함께 다음 입력을 지원합니다.

- `conditions`: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `in`, `is`
- `order_by`: `{ column, direction: "asc" | "desc" }` 배열
- `limit`: 기본 50, 최대 100
- `offset`: 기본 0

모든 select/insert/update 컬럼은 Supabase Data API schema와 먼저 대조합니다.

## n8n AI Agent 권장 호출 순서

1. `describe_table`로 실제 컬럼명과 타입 확인
2. `select_rows`로 대상 행 확인
3. 변경 요청일 때만 `insert_rows` 또는 `update_rows` 호출

한글 컬럼명도 지원합니다. 예:

```json
{
  "table": "ipo_stocks",
  "columns": ["종목명", "청약시작일", "상장일"],
  "conditions": [
    {
      "column": "청약시작일",
      "operator": "gte",
      "value": "2026-07-01"
    },
    {
      "column": "종목명",
      "operator": "ilike",
      "value": "%테크%"
    }
  ],
  "order_by": [
    { "column": "청약시작일", "direction": "asc" }
  ],
  "limit": 20,
  "offset": 0
}
```

## 환경 변수

로컬에서 읽는 파일명은 `.env.local`입니다.

```bash
cp .env.example .env.local
openssl rand -hex 32
```

서버 동작에 실제로 사용되는 키:

| 이름 | 필수 | 용도 |
|---|---|---|
| `SUPABASE_URL` | 필수 | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 필수 | server-side database 접근 |
| `SUPABASE_ALLOWED_TABLES` | 필수 | 접근 허용 테이블, 쉼표 구분 |
| `MCP_API_KEY` | 필수 | MCP Bearer token, 최소 32자 |

`SUPABASE_ACCESS_TOKEN`, `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISH_KEY`는 이 서버가 사용하지 않습니다. `SUPABASE_SECRET_KEY`도 하위 호환을 위해 지원하지만 이 설정에서는 사용하지 않습니다.

`SUPABASE_SERVICE_ROLE_KEY`는 RLS를 우회할 수 있습니다. 브라우저에 노출하지 말고 `SUPABASE_ALLOWED_TABLES`를 최소 범위로 지정하십시오. 대상 테이블은 Supabase Data API에 노출되어 있어야 하며 `service_role`에 필요한 `SELECT`, `INSERT`, `UPDATE` 권한이 있어야 합니다.

## 로컬 실행

요구사항: Node.js 24.

```bash
npm ci
npm run check
npm run dev
```

MCP URL은 `http://localhost:3000/mcp`, readiness URL은 `http://localhost:3000/health`입니다.

고정 Bearer header를 지원하는 MCP 클라이언트에는 다음처럼 등록합니다.

```json
{
  "mcpServers": {
    "supabase-crud": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_API_KEY>"
      }
    }
  }
}
```

## Vercel 배포

### 1. 프로젝트 연결

```bash
npx vercel@57.0.0 link
```

### 2. 환경 변수 등록

Production에 아래 4개 값을 등록합니다. 기존의 잘못된 `SUPABASE_SECRET_KEY`가 있으면 삭제하십시오.

```bash
npx vercel@57.0.0 env add SUPABASE_URL production
npx vercel@57.0.0 env add SUPABASE_SERVICE_ROLE_KEY production
npx vercel@57.0.0 env add SUPABASE_ALLOWED_TABLES production
npx vercel@57.0.0 env add MCP_API_KEY production
```

Git 연동 Preview 배포도 검사하려면 같은 값을 `preview` 환경에도 별도로 등록합니다.

```bash
npx vercel@57.0.0 env add SUPABASE_URL preview
npx vercel@57.0.0 env add SUPABASE_SERVICE_ROLE_KEY preview
npx vercel@57.0.0 env add SUPABASE_ALLOWED_TABLES preview
npx vercel@57.0.0 env add MCP_API_KEY preview
```

Vercel Dashboard의 Project Settings에서 Node.js 24와 Supabase에 가까운 Function Region도 확인합니다. Preview Deployment Protection이 켜져 있으면 외부 MCP 클라이언트의 요청이 Vercel 인증 화면에서 차단될 수 있습니다.

### 3. Production 배포

```bash
npm run check
npx vercel@57.0.0 --prod
```

배포 후 endpoint:

- MCP: `https://<project>.vercel.app/mcp`
- readiness: `https://<project>.vercel.app/health`

`/health`는 필수 환경 변수의 형식만 확인합니다. Supabase 연결과 테이블 권한은 아래 smoke의 선택적 read probe로 확인합니다.

### 4. 배포 검증

```bash
curl --fail --silent --show-error https://<project>.vercel.app/health
npm run smoke -- https://<project>.vercel.app/mcp
```

`npm run smoke`는 `.env.local`의 `MCP_API_KEY`를 읽고 MCP `initialize`와 `tools/list`를 실제 호출합니다. 실제 Supabase 읽기 권한까지 확인하려면 `.env.local`에 허용 테이블을 추가합니다.

```dotenv
MCP_SMOKE_TABLE=your_table
MCP_SMOKE_MIN_ROWS=1
```

이 probe는 `describe_table`과 `select_rows(limit: 1)`를 실행하고 schema 컬럼 수와 반환 행 수를 출력합니다. `MCP_SMOKE_MIN_ROWS`보다 적은 행이 반환되면 실패하며 데이터를 수정하지 않습니다.

문제가 있으면 배포 로그를 확인하고 이전 정상 배포로 되돌립니다.

```bash
npx vercel@57.0.0 inspect https://<deployment>.vercel.app --logs
npx vercel@57.0.0 logs https://<deployment>.vercel.app
npx vercel@57.0.0 rollback https://<previous-deployment>.vercel.app
```

## 인증 호환성

현재 템플릿은 사전에 공유한 고정 `Authorization: Bearer <MCP_API_KEY>` header 방식입니다. 고정 header를 설정할 수 없는 클라이언트나 OAuth 자동 발견을 요구하는 클라이언트에는 그대로 연결할 수 없습니다. 그런 대상에는 Authorization Server, `withMcpAuth`, `/.well-known/oauth-protected-resource` endpoint를 추가해야 합니다.

## Codex 개인 플러그인

Codex 개인 marketplace 플러그인은 `bearer_token_env_var`로 기존 인증을 그대로 사용할 수 있습니다.

- 플러그인: `~/plugins/mcp-ipostock`
- marketplace: `~/.agents/plugins/marketplace.json`
- MCP: `https://mcp-ipostock.vercel.app/mcp`
- token 환경 변수: `MCP_IPOSTOCK_API_KEY`

macOS에서 Codex 앱을 다시 열기 전에 다음 값을 설정합니다.

```bash
launchctl setenv MCP_IPOSTOCK_API_KEY "<MCP_API_KEY과 같은 값>"
```

Codex 앱의 Plugins에서 `Personal` → `IPOStock`을 설치하면 됩니다. ChatGPT/Codex의 새 플러그인 화면에 직접 등록하거나 공개 배포하려면 고정 API key가 아닌 OAuth 2.1 인증이 별도로 필요합니다.
