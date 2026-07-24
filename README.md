# Supabase CRUD MCP

Vercel Function에서 실행되는 stateless Streamable HTTP MCP 서버입니다.

## 제공 도구

| Tool | 기능 | 제한 |
|---|---|---|
| `select_rows` | 행 조회 | equality filter, 최대 100행 |
| `insert_rows` | 행 입력 | 호출당 최대 100행 |
| `update_rows` | 행 수정 | filter 1개 이상 필수 |

`delete`와 임의 SQL 실행은 제공하지 않습니다.

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
| `SUPABASE_SECRET_KEY` | 둘 중 하나 | 권장 server-side secret key |
| `SUPABASE_SERVICE_ROLE_KEY` | 둘 중 하나 | legacy 대체 키 |
| `SUPABASE_ALLOWED_TABLES` | 필수 | 접근 허용 테이블, 쉼표 구분 |
| `MCP_API_KEY` | 필수 | MCP Bearer token, 최소 32자 |

`SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ACCESS_TOKEN`은 이 서버가 사용하지 않습니다.

`SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY`는 RLS를 우회할 수 있습니다. 브라우저에 노출하지 말고 `SUPABASE_ALLOWED_TABLES`를 최소 범위로 지정하십시오. 대상 테이블은 Supabase Data API에 노출되어 있어야 하며 `service_role`에 필요한 `SELECT`, `INSERT`, `UPDATE` 권한이 있어야 합니다.

## 로컬 실행

요구사항: Node.js 22 이상.

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

Production에 아래 4개 값을 등록합니다. `SUPABASE_SECRET_KEY`가 없을 때만 `SUPABASE_SERVICE_ROLE_KEY`를 대신 등록합니다.

```bash
npx vercel@57.0.0 env add SUPABASE_URL production
npx vercel@57.0.0 env add SUPABASE_SECRET_KEY production
npx vercel@57.0.0 env add SUPABASE_ALLOWED_TABLES production
npx vercel@57.0.0 env add MCP_API_KEY production
```

Git 연동 Preview 배포도 검사하려면 같은 값을 `preview` 환경에도 별도로 등록합니다.

```bash
npx vercel@57.0.0 env add SUPABASE_URL preview
npx vercel@57.0.0 env add SUPABASE_SECRET_KEY preview
npx vercel@57.0.0 env add SUPABASE_ALLOWED_TABLES preview
npx vercel@57.0.0 env add MCP_API_KEY preview
```

Vercel Dashboard의 Project Settings에서 Node.js 22 이상과 Supabase에 가까운 Function Region도 확인합니다. Preview Deployment Protection이 켜져 있으면 외부 MCP 클라이언트의 요청이 Vercel 인증 화면에서 차단될 수 있습니다.

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
```

이 probe는 `select_rows`를 `limit: 1`로 실행하며 데이터를 수정하지 않습니다.

문제가 있으면 배포 로그를 확인하고 이전 정상 배포로 되돌립니다.

```bash
npx vercel@57.0.0 inspect https://<deployment>.vercel.app --logs
npx vercel@57.0.0 logs https://<deployment>.vercel.app
npx vercel@57.0.0 rollback https://<previous-deployment>.vercel.app
```

## 인증 호환성

현재 템플릿은 사전에 공유한 고정 `Authorization: Bearer <MCP_API_KEY>` header 방식입니다. 고정 header를 설정할 수 없는 클라이언트나 OAuth 자동 발견을 요구하는 클라이언트에는 그대로 연결할 수 없습니다. 그런 대상에는 Authorization Server, `withMcpAuth`, `/.well-known/oauth-protected-resource` endpoint를 추가해야 합니다.
