# K1 부품 일상점검 시스템 (Daily Check List)

부품 등록(자동 코드채번) → QR 발행/재발행 → 일상점검(QR스캔) → 이상 발견 시 조치(2단계 승인) → KPI 대시보드까지 이어지는
부품 일상점검 관리 시스템입니다.

## 1. 구성

- **프론트엔드**: 순수 HTML/CSS/JS (페이지별 파일 분리), GitHub Pages 배포
- **백엔드**: Supabase (Postgres + 자동 REST/RPC), 무료 티어로 충분
- **QR**: `qrcode` 라이브러리로 생성, `html5-qrcode` 라이브러리로 카메라 스캔
- **AI 어시스턴트**: 기본 규칙기반 동작, Gemini/Groq 무료 API 키 입력 시 자연어 품질 향상 (`js/ai-config.js`)
- **오프라인 대응**: Service Worker(`sw.js`)로 앱쉘 캐시 + 점검결과 로컬 큐잉 후 자동 동기화

```
index.html        로그인(점검자 선택)
dashboard.html     KPI 대시보드
inspect.html       QR 스캔 + 점검 수행 (모바일 중심)
actions.html       조치 관리 (2단계 승인)
parts.html         부품 마스터 관리 (관리자)
qr.html            QR 발행/재발행/인쇄 (관리자)
types.html         부품유형 / 점검항목 템플릿 (관리자)
inspectors.html    점검자/역할 관리 (관리자)
css/style.css       공통 디자인시스템 (파스텔톤)
js/common.js        공통 유틸/인증/네비게이션
js/ai.js             AI 어시스턴트 + AI 자동진단
js/supabase-config.js  Supabase 접속정보 (직접 입력 필요)
js/ai-config.js         AI API 키 (선택)
sql/schema.sql       Supabase 스키마 전체
sw.js / manifest.webmanifest   PWA/오프라인
```

## 2. Supabase 설정 (최초 1회)

1. https://supabase.com 에서 무료 프로젝트 생성
2. 좌측 **SQL Editor** 에서 `sql/schema.sql` 파일 전체 내용을 붙여넣고 **Run**
   - 부품/유형/점검/조치 등 전체 테이블, RLS, RPC 함수, 예시 부품유형 3종이 생성됩니다.
3. **최초 관리자 계정 등록** (SQL Editor에서 1회 실행, 본인 이름으로 수정):
   ```sql
   insert into inspectors (name, role) values ('강성환', 'admin');
   ```
   이후 로그인 화면에서 이 이름을 선택해 접속하면, `inspectors.html` 화면에서 나머지 점검자를 추가할 수 있습니다.
4. **Project Settings > API** 메뉴에서 `Project URL` 과 `anon public` 키를 확인
5. `js/supabase-config.js` 파일을 열어 아래 두 값을 붙여넣습니다.
   ```js
   window.SUPABASE_CONFIG = {
     url: "https://xxxxxxxx.supabase.co",
     anonKey: "eyJhbGciOi..."
   };
   ```

> 보안 참고: `anon key`는 공개되어도 되는 키입니다. 실제 데이터 쓰기는 전부 SQL 함수(RPC, `security definer`)를 통해서만
> 가능하도록 테이블 직접 write 권한을 회수(REVOKE)해 두었습니다 (`sql/schema.sql` 9번 섹션 참고).

## 3. (선택) AI 어시스턴트 고도화

`js/ai-config.js` 에서 무료 API 키를 넣으면 자연어 질의응답과 이상 자동진단이 더 자연스러워집니다. 비워두면
규칙기반으로 정상 동작합니다.

- Gemini: https://aistudio.google.com/apikey (무료)
- Groq: https://console.groq.com/keys (무료)

```js
window.AI_CONFIG = { provider: "gemini", geminiApiKey: "발급받은키" };
```

## 4. 로컬에서 미리보기

정적 파일이므로 아무 로컬 서버로 열면 됩니다.

```bash
cd daily-check-list
python3 -m http.server 8080
# 브라우저에서 http://localhost:8080 접속
```

## 5. GitHub Pages 배포

1. GitHub에 새 저장소 생성 (예: `daily-check-list`)
2. 이 폴더 전체를 저장소에 업로드(커밋/푸시)
3. 저장소 **Settings > Pages** 에서 `Deploy from a branch` → `main` / `/(root)` 선택
4. 잠시 후 `https://<계정>.github.io/daily-check-list/` 로 접속 가능

모바일에서 QR 스캔 카메라를 쓰려면 **HTTPS 접속이 필수**입니다 (GitHub Pages는 기본 HTTPS라 문제없음).

## 6. 사용 흐름

1. **부품유형/점검항목 템플릿** (`types.html`) 에서 부품 유형과 유형별 표준 점검항목을 먼저 정의합니다.
2. **부품 마스터** (`parts.html`) 에서 부품을 등록하면 유형의 코드접두어로 코드가 자동 채번되고
   (예: `MTR-0001`), 템플릿의 점검항목이 해당 부품에 자동 복사됩니다. 담당 점검자도 배정합니다.
3. **QR 발행** (`qr.html`) 에서 부품을 선택해 QR을 생성/인쇄하여 부품에 부착합니다. 라벨 훼손 시 같은 화면에서
   재발행(사유 기록, 버전 증가)할 수 있습니다.
4. **점검 수행** (`inspect.html`, 모바일 권장) 에서 QR을 스캔하면 해당 부품의 점검항목이 표시되고, 점검자가
   항목별로 입력합니다. 이상 항목은 사진 첨부(항목별 설정 시 필수)와 함께 기록되며 **조치 티켓이 자동 생성**됩니다.
5. **조치 관리** (`actions.html`) 에서 담당자 지정 → 조치완료 등록 → 점검자/관리자 승인의 2단계로 마무리합니다.
6. **대시보드** (`dashboard.html`) 에서 금일 점검율/미점검/이상건수/조치이행율 KPI와 기간별 추이를 확인합니다.
   각 KPI의 ✦ 칩을 클릭하면 AI가 원인/영향/조치가이드를 제시합니다.

## 7. 커스터마이징 포인트

- 조치 기본 기한: `sql/schema.sql` 의 `fn_submit_inspection` 함수 내 `interval '3 day'` 값 조정
- 대시보드 목표치(점검율 95%, 조치이행율 90% 등): `js/dashboard.js` 의 `wireAiChips()` 내 `lower_limit` 값 조정
- 색상/테마: `css/style.css` 상단 `:root` 변수 (파스텔톤 유지 권장)
- 네비게이션 메뉴/권한: `js/common.js` 의 `NAV_ITEMS` 배열
