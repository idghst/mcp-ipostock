# Schema-aware Supabase MCP 개선 설계

## 목표

n8n AI Agent가 `SUPABASE_ALLOWED_TABLES`에 등록된 Supabase 테이블을
추측 없이 탐색하고, 자연어 요청을 안전한 조회·입력·수정 작업으로
변환할 수 있게 한다.

현재 우선 대상은 `public.ipo_stocks`다. 다음 요청을 안정적으로 처리해야
한다.

- 이번 달 또는 특정 기간의 청약 일정 조회
- 종목명 부분 검색
- 청약일·상장일 기준 정렬
- 기존 행 입력 및 특정 행 수정
- allowlist에 추가된 다른 테이블에도 같은 도구 적용

## 확인된 문제

1. `SUPABASE_SECRET_KEY`에 `sb_publishable_...` 키가 들어가도 설정 검증을
   통과한다. 이 경우 RLS에 의해 실제 34행이 있는 `ipo_stocks`가 MCP에서는
   빈 배열로 반환된다.
2. 기존 컬럼 검증은 ASCII SQL 식별자만 허용한다. `종목명`,
   `청약시작일`, `상장일` 같은 실제 한글 컬럼을 선택하거나 필터링할 수
   없다.
3. AI가 테이블 컬럼과 타입을 확인할 도구가 없다. 테이블명과 컬럼명을
   추측하게 된다.
4. 조회는 equality filter만 지원한다. 기간 검색, 부분 검색, 정렬,
   pagination을 표현할 수 없다.

## 범위

### 포함

- publishable key 오설정 차단
- 안전한 한글·영문·숫자·underscore 컬럼 식별자
- 허용 테이블 스키마 탐색 도구
- 범위·문자열·목록 조건 조회
- 다중 정렬과 pagination
- insert/update 컬럼 검증
- 단위 테스트, Vercel 빌드, Production MCP 실조회
- README와 smoke 절차 갱신

### 제외

- delete 도구
- 임의 SQL 실행
- Supabase schema 변경 또는 RLS 정책 변경
- OAuth Authorization Server
- IPO 전용 하드코딩 도구
- 허용 목록 밖 테이블 메타데이터 노출

## 구조

### 설정 계층

`loadConfig`는 다음을 검증한다.

- `SUPABASE_URL`은 HTTP 또는 HTTPS URL이다.
- `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY`가 존재한다.
- `SUPABASE_SECRET_KEY` 값이 `sb_publishable_`로 시작하면 거부한다.
- `MCP_API_KEY`는 최소 32자다.
- `SUPABASE_ALLOWED_TABLES`는 안전한 쉼표 구분 테이블명 목록이다.

설정 오류는 `/health`와 `/mcp`에서 `503`으로 반환한다. 오류 메시지는
환경변수 이름과 해결 방향만 포함하고 실제 값은 포함하지 않는다.

### Schema gateway

새 schema gateway는 Supabase Data API의 OpenAPI 문서를 읽고 다음 정보만
정규화한다.

- table
- column
- PostgreSQL/Data API type
- nullable
- required

응답은 `SUPABASE_ALLOWED_TABLES`로 다시 필터링한다. 다른 public table,
auth/storage schema, 함수, relation 정보는 MCP에 노출하지 않는다.

OpenAPI 응답은 Vercel Function 인스턴스 메모리에 캐시한다. cache는
인스턴스 생존 기간까지만 유지하며 외부 저장소나 새 의존성을 추가하지
않는다. 스키마 조회가 실패하면 오래된 임의 값으로 대체하지 않고 명확한
MCP 오류를 반환한다.

### Database gateway

기존 Supabase client 기반 gateway를 유지한다. 조회 조건은 허용된
연산자만 메서드로 매핑하고 문자열 query 조립이나 임의 SQL을 사용하지
않는다.

지원 연산자:

- `eq`, `neq`
- `gt`, `gte`, `lt`, `lte`
- `like`, `ilike`
- `in`
- `is`

정렬은 Supabase client의 `order`, pagination은 `range`를 사용한다.

## MCP 도구 계약

### `describe_table`

입력:

- `table`: allowlist 기반 enum

출력:

- 테이블명
- 컬럼 배열
- 각 컬럼의 이름, 타입, nullable, required

AI가 컬럼을 모르거나 insert/update payload를 만들기 전 우선 호출하도록
도구 설명에 명시한다.

### `select_rows`

입력:

- `table`: allowlist 기반 enum
- `columns`: 기본 `["*"]`, 최대 100개
- `filters`: 기존 호환용 equality filter record
- `conditions`: 최대 10개의 `{ column, operator, value }`
- `order_by`: 최대 3개의 `{ column, direction }`
- `limit`: 1 이상 100 이하, 기본 50
- `offset`: 0 이상, 기본 0

`filters`와 `conditions`는 함께 사용할 수 있으며 AND로 결합한다.
`in`은 scalar 배열을 받고 `is`는 `null`, boolean을 받는다. 컬럼과
조건은 schema gateway 결과에 존재해야 한다.

출력은 기존 호환성을 위해 JSON row 배열을 유지한다.

### `insert_rows`

입력:

- `table`: allowlist 기반 enum
- `rows`: 1개 이상 100개 이하

각 row의 키가 실제 테이블 컬럼인지 확인한다. 알려지지 않은 컬럼은
Supabase 호출 전에 거부한다. 성공하면 삽입된 행을 반환한다.

### `update_rows`

입력:

- `table`: allowlist 기반 enum
- `values`: 비어 있지 않은 수정 값
- `filters`: 하나 이상의 equality filter

`values`와 `filters`의 컬럼을 실제 스키마와 대조한다. filter 없는
전체 수정은 계속 금지한다. 성공하면 수정된 행을 반환한다.

## 데이터 흐름

1. MCP client가 Bearer token으로 `/mcp`에 연결한다.
2. 서버가 환경변수와 token을 검증한다.
3. AI는 `tools/list`에서 허용 테이블 enum과 상세 설명을 받는다.
4. 컬럼이 필요하면 `describe_table`을 호출한다.
5. 도구 handler가 table allowlist, schema 컬럼, operator를 검증한다.
6. database gateway가 Supabase client method chain을 만든다.
7. Supabase 오류는 비밀값을 제외한 MCP error로 변환한다.
8. 성공 결과는 JSON으로 반환한다.

## 오류 처리

- publishable key 오설정: 설정 단계 실패
- allowlist 밖 table: MCP error
- 존재하지 않는 column: Supabase 호출 전 MCP error
- 지원하지 않는 operator: input schema validation error
- filter 없는 update: MCP error
- Supabase Data API/OpenAPI 오류: 상태를 설명하는 MCP error
- 인증 실패: `401`과 `WWW-Authenticate: Bearer`

서버 로그와 MCP 응답에 API key, Bearer token, row 전체를 기록하지 않는다.

## 테스트

모든 동작 변경은 red-green TDD로 구현한다.

단위 테스트:

- publishable key가 server secret으로 사용되면 실패
- secret/service role key 계약 유지
- 한글 컬럼 식별자 허용 및 query syntax 거부
- OpenAPI schema 정규화와 allowlist 필터
- 모든 조회 operator의 Supabase method 매핑
- equality filters와 conditions 결합
- 정렬 순서와 pagination range
- 존재하지 않는 컬럼의 select/insert/update 거부
- filter 없는 update 거부

회귀 검증:

- `npm test`
- `npm run typecheck`
- `npx vercel@57.0.0 build --prod`

Production 검증:

- `/health` HTTP 200
- MCP initialize 및 tools/list
- `describe_table(ipo_stocks)`에서 실제 한글 컬럼 확인
- `select_rows`로 날짜순 조회
- `ilike`로 종목명 부분 검색
- `MCP_SMOKE_TABLE=ipo_stocks` 조회가 최소 1행을 반환

insert/update Production probe는 실제 데이터를 변경하므로 자동으로
실행하지 않는다. 테스트 더블에서 쿼리와 안전장치를 검증한다.

## 배포

배포 전 `.env.local`과 Vercel Production/Preview의
`SUPABASE_SECRET_KEY`를 실제 `sb_secret_...` 키로 교체한다.
publishable key 상태에서는 새 코드를 배포하지 않는다.

배포 순서:

1. 로컬 전체 검증
2. Vercel Production build
3. 코드 commit/push
4. Git 연동 Production deployment가 READY인지 확인
5. health, schema, 실제 read smoke 확인
6. runtime error log 확인

검증 실패 시 새 배포를 정상으로 보고하지 않으며 기존 정상 deployment를
유지하거나 rollback한다.

## 보안 주의

`SUPABASE_SECRET_KEY`와 `SUPABASE_SERVICE_ROLE_KEY`는 브라우저나 n8n
workflow payload에 넣지 않는다. n8n에는 MCP 서버용 `MCP_API_KEY`만
Bearer token으로 제공한다.

이번 변경은 MCP allowlist 밖 테이블의 RLS 상태를 수정하지 않는다.
별도 점검에서 RLS 비활성화가 확인된 테이블은 별도 승인과 정책 설계 후
처리한다.
