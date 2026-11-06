# 자양교회 어린이 합창단 사이트

https://jayangchoir.github.io — 학부모는 **학부모 비밀번호** 하나로, 임원(관리자)은 **관리자 비밀번호**로 씁니다.
PC를 켜 두지 않아도 늘 동작합니다 (GitHub Pages + GitHub 저장소).

## 한눈에 보기

| 무엇 | 어디 | 누가 열 수 있나 |
|---|---|---|
| 사이트 화면(이 저장소) + 학부모용 내용의 **암호문** `p/` | 공개 저장소 `jayangchoir/jayangchoir.github.io` | 화면은 누구나, 내용은 **학부모 비밀번호**가 있어야 |
| 사진·악보 PDF 의 **암호문** | 공개 저장소 `jayangchoir/choir-photos-1`, `-2`, … (900MB 차면 다음 것을 저절로 만듦) | 열쇠는 학부모용 내용 안에만 → 학부모 비밀번호가 있어야 |
| 관리자 데이터 전체 (연락처 포함) | 비공개 저장소 `jayangchoir/jayangchoir-data` (암호화) | **관리자 비밀번호** (+ 연결된 기기) |
| 사진 원본 (줄이기 전, 촬영 정보 포함) | 합창단 Google 계정 `jayangchoir@gmail.com` 의 Google 포토 (또는 Drive) | 그 Google 계정 |

- 학부모 화면: 홈(다음 일정·공지·새 사진·새 영상) · 일정(목록·달력·내 달력에 추가) · 연주곡(공연별·곡별 악보 PDF·연습 음원·참고 영상) · 영상(공연·연습) · 사진(앨범·크게 보기·넘기기) · 명단(**이름과 학년만**) · 공지(새 글 표시)
- **부모님 이름·연락처·비고·성별·입단일, 회비 계좌 예금주, 문의 담당자·전화는 관리자 화면에만** 있습니다.
  학부모용 내용을 만들 때 허용한 칸만 옮기고(`js/bundle.js`), 올리기 전에 한 번 더 훑어서 연락처가 보이면 반영하지 않습니다.
  그래서 학부모 비밀번호가 새어 나가도 연락처는 드러나지 않습니다.
- 지우기는 모두 **휴지통**입니다. 되살릴 수 있고, 정말로 없애는 기능은 없습니다.

## 처음 한 번 (임원)

1. **GitHub 저장소 두 개** (계정 `jayangchoir`)
   - `jayangchoir.github.io` — 공개. 이 폴더의 파일을 올리고 Settings → Pages → Branch `main` / `(root)`.
   - `jayangchoir-data` — **비공개(Private)**, 비어 있어도 됨.
2. **토큰 만들기** — GitHub → 오른쪽 위 사진 → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token
   - Token name: `jayangchoir-site-2026` / Expiration: 가장 길게(1년) — **만료일을 달력에 적어 두세요**
   - Resource owner: `jayangchoir` / Repository access: **All repositories** (사진 저장소 `choir-photos-N` 을 사이트가 저절로 만들기 때문)
   - Repository permissions: **Contents: Read and write**, **Administration: Read and write** (저장소 만들기), Metadata: Read-only(저절로)
   - 만들기가 막히면 GitHub에서 `choir-photos-1` 을 **공개(Public)** 로 직접 만들어도 됩니다 (README 하나 넣어서).
3. 사이트 → 오른쪽 위 ⚙ (또는 `#/admin`) → **처음 설정**: 토큰, 관리자 비밀번호(8자 이상, 임원끼리만), 내 이름 → **복구 코드**를 종이에 적기.
4. 관리자 → **가져오기**
   - **준비된 자료 JSON** (`jayangchoir-seed.json`, 노션 공개 페이지에서 미리 옮긴 것: 첫 화면 글·일정 표·회비·활동 안내·연주곡 링크·공연/연습 영상·명단). 불러온 뒤 그 파일은 지우세요(연락처가 들어 있음).
   - **노션 zip**: 노션 페이지 → ··· → 내보내기 → *Markdown & CSV*, *하위 페이지 포함* → 받은 zip. 전체일정 데이터베이스, 사진첩 사진, 악보 PDF(14개)를 가져옵니다. 노션 페이지는 그대로 둡니다.
5. 관리자 → 대시보드 → **학부모 비밀번호 정하기** (추천 단추: "낱말-낱말-낱말-낱말-숫자"). 10자 미만·흔한 모양이면 경고합니다.
6. 학부모 단체방에 주소와 학부모 비밀번호를 알립니다. 학부모는 휴대폰에서 한 번 넣으면 그 휴대폰에서는 계속 열립니다.

## Google 설정 (사진 원본 보관, 한 번만)

사진을 올릴 때 **원본**을 합창단 Google 계정에 따로 보관합니다. 사이트에 올라가는 것은 줄이고 위치 정보(EXIF)를 지운 사본입니다.

1. `jayangchoir@gmail.com` 으로 https://console.cloud.google.com 에 로그인 → 새 프로젝트 `jayangchoir-site`.
2. API 및 서비스 → 라이브러리 → **Photos Library API** 사용. (예비용으로 **Google Drive API** 도 사용)
3. OAuth 동의 화면 → User Type **외부** → 앱 이름 "자양교회 어린이 합창단", 지원 이메일 jayangchoir@gmail.com →
   범위는 비워 둬도 됨 → **테스트 사용자**에 `jayangchoir@gmail.com` 과 사진을 올릴 임원들의 Gmail 을 넣기 → **게시 상태는 "테스트"로 둡니다.**
4. 사용자 인증 정보 → 사용자 인증 정보 만들기 → **OAuth 클라이언트 ID** → 애플리케이션 유형 **웹 애플리케이션** →
   승인된 자바스크립트 원본: `https://jayangchoir.github.io` 과 `http://localhost:8080` (PC에서 시험할 때 쓰는 주소·포트) → 만들기.
5. 나온 **클라이언트 ID**(`…apps.googleusercontent.com`)를 사이트 관리자 → 설정 → "사진 원본 보관 (Google)" 에 붙여 넣고 저장.
6. 사진을 올릴 때 Google 로그인 창이 뜨면 **꼭 jayangchoir@gmail.com 으로** 로그인하고 권한에 체크합니다.
   - 로그인 정보(토큰)는 이 탭에만 1시간 남고, 관리자 화면을 잠그면 취소됩니다. 원본 올리기가 실패해도 사이트 올리기는 따로 끝나고, 상황판의 **원본 다시**로 다시 올립니다. 새로고침해도 대기열은 남습니다.
   - Google 포토가 막히면(브라우저 보안 또는 권한) 설정에서 보관할 곳을 **Google Drive** 로 바꾸세요 ("합창단 사진 원본/<앨범>" 폴더).
   - 테스트 모드 앱의 Google 로그인은 7일마다 다시 동의를 물을 수 있습니다.

## 자주 하는 일

- **휴대폰에서 빠르게**: 관리자 화면 오른쪽 아래 **+** → 일정 추가 / 공지 쓰기 / 사진 올리기 / 악보 PDF 올리기.
- **사진 올리기**: 사진 → 사진첩(행사+날짜) → 사진·PDF 올리기 → 여러 장 고르기. 긴 변 1600px·400KB 이하로 줄이고 작은 그림(400px)을 따로 만듭니다. 진행 막대가 보이고, 끊기면 이어서 올립니다.
- **PDF**: 20MB 넘으면 한 번 더 묻고, 95MB 넘으면 올리지 않습니다. 학부모는 "보기"(PC는 화면 안, 휴대폰은 새 탭)·"내려받기"(원래 이름)로 엽니다.
- **학부모 화면에 반영**: 고친 뒤 20초 지나면 저절로, 또는 위의 "지금 반영". 1~2분 뒤 학부모 화면에 보입니다.
- **학부모 비밀번호 바꾸기**: 대시보드 → 바꾸기. 내용을 새 비밀번호로 다시 암호화합니다. 학부모 휴대폰은 다음에 열 때 새 비밀번호를 묻습니다.
  (공개 저장소의 git 기록에는 예전 암호문이 남으므로, 예전 비밀번호를 아는 사람은 그때까지의 내용은 볼 수 있습니다. 새 내용은 못 봅니다.)
- **새 임원 휴대폰 연결**: 연결된 기기 → 설정 → 새 기기 연결(QR) → 새 휴대폰으로 찍고 관리자 비밀번호.
- **관리자 비밀번호·복구 코드·토큰 바꾸기, 모든 기기를 잃었을 때, 임원이 바뀔 때**: [js/core/HANDOVER.md](js/core/HANDOVER.md)

## 꼭 넘겨받아 보관할 것
Gmail(jayangchoir@gmail.com) 비밀번호 · GitHub `jayangchoir` 비밀번호와 2단계 인증 복구 코드 · 관리자 비밀번호 · **관리자 복구 코드** · 학부모 비밀번호(관리자 대시보드에서 볼 수 있음).
관리자 비밀번호와 복구 코드를 둘 다 잃으면 아무도 관리자 데이터를 열 수 없습니다.

## 개발 (코드를 고치는 사람만)

| 파일 | 내용 |
|---|---|
| `index.html`, `css/style.css`, `js/main.js` | 사이트 틀 (CSP 포함), 시작 |
| `js/app.js` | 주소(#/…)별 화면, 그림 불러오기, 올리기 상황판, 자동 반영 |
| `js/views-parent.js`, `js/views-admin.js`, `js/ui.js`, `js/ics.js` | 학부모 화면, 관리자 화면, 화면 도우미, 달력 파일 |
| `js/tier.js` | 학부모 단계 암호화 (scrypt N=2^16 r=8 p=2 → 내용 키), 약한 비밀번호 검사, 추천 비밀번호 |
| `js/bundle.js` | 관리자 데이터 → 학부모용 묶음 (허용 목록) + 연락처 검사 |
| `js/publish.js`, `js/parent.js` | 반영(공개 저장소에 커밋 하나로), 학부모 쪽 열기 |
| `js/media.js`, `js/uploads.js`, `js/google.js` | 사진 저장소(choir-photos-N), 올리기 대기열, Google 원본 보관 |
| `js/plan.js`, `js/notion-import.js` | 가져오기(준비된 자료·노션 zip) |
| `js/core/` | 유년부 사이트에서 복사한 암호화 저장·동기화 ([README](js/core/README.md)) + `scrypt.js` |
| `js/vendor/jszip.min.js` | JSZip 3.10.1 (MIT) — 노션 zip 읽기 |
| `fonts/Jua-Regular.woff2` | 주아체 (OFL) |
| `core-test.html`, `tier-test.html(.js)` | 시험 (가짜 GitHub·가짜 Google) |
| `tools/run-tests.mjs`, `tools/shots.mjs`, `tools/demo.html` | 헤드리스 Edge 로 시험 돌리기 · 화면 찍기 · 가짜 저장소 데모 |

```
node tools/run-tests.mjs                       # core-test + tier-test (헤드리스 Edge)
node tools/shots.mjs <seed.json> <폴더>         # 휴대폰 400×850 · PC 1280 화면 찍기
```
개인정보(이름·연락처·계좌)는 이 저장소에 넣지 않습니다. `*seed*.json` 은 `.gitignore` 에 있습니다.
