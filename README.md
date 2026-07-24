# Supabase CRUD MCP

Vercel에 배포하는 stateless Streamable HTTP MCP 서버입니다.

## Tools

| Tool | 기능 | 제한 |
|---|---|---|
| `select_rows` | 행 조회 | equality filter, 최대 100행 |
| `insert_rows` | 행 입력 | 호출당 최대 100행 |
| `update_rows` | 행 수정 | filter 1개 이상 필수 |

`delete`와 임의 SQL 실행은 제공하지 않습니다.

## 환경 변수

`.env.example`을 `.env.local`로 복사하고 값을 채웁니다.

```bash
cp .env.example .env.local
openssl rand -hex 32
```

- `SUPABASE_URL`: Supabase Project URL
- `SUPABASE_SECRET_KEY`: 새 server-side secret key
- `SUPABASE_SERVICE_ROLE_KEY`: legacy 대체 키
- `SUPABASE_ALLOWED_TABLES`: 접근 허용 테이블 이름, 쉼표로 구분
- `MCP_API_KEY`: MCP endpoint용 Bearer token

`SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY`는 RLS를 우회할 수 있습니다. 브라우저에 노출하지 말고, `SUPABASE_ALLOWED_TABLES`를 최소 범위로 지정하십시오. 새 Supabase 프로젝트는 테이블이 Data API에 자동 노출되지 않을 수 있으므로 해당 테이블의 Data API 노출과 `service_role` 권한도 확인해야 합니다.

## 로컬 실행

```bash
npm install
npm run dev
```

MCP URL:

```text
http://localhost:3000/mcp
```

클라이언트에는 다음 HTTP header를 설정합니다.

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

```bash
npx vercel@57.0.0
npx vercel@57.0.0 env add SUPABASE_URL production
npx vercel@57.0.0 env add SUPABASE_SECRET_KEY production
npx vercel@57.0.0 env add SUPABASE_ALLOWED_TABLES production
npx vercel@57.0.0 env add MCP_API_KEY production
npx vercel@57.0.0 --prod
```

배포 후 MCP URL은 `https://<project>.vercel.app/mcp`입니다.

## 검증

```bash
npm test
npm run typecheck
```
