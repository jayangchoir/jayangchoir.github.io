# js/core — 암호화 저장·동기화

화면 코드(필사노트·선물·회원 등)는 이 폴더의 API만 쓴다. GitHub·암호화·IndexedDB는 여기 안에 숨어 있다.
시험: `core-test.html` (가짜 GitHub, 인터넷 필요 없음). 운영자용 인수인계: [HANDOVER.md](HANDOVER.md)

| 파일 | 내용 |
|---|---|
| `index.js` | 사이트에서 쓰는 core 하나 (`import core from './core/index.js'`) |
| `core.js` | `createCore(opts)` — 열기·연결·기록·파일·동기화 |
| `merge.js` | 동시에 고친 기록 합치기 (순수 함수) |
| `crypto.js` | AES-256-GCM, PBKDF2, 복구 코드 |
| `github.js` | GitHub 백엔드 (`tree/get/put/check`, 지우는 함수 없음) |
| `fake-backend.js` | 시험용 메모리 백엔드 |
| `kv.js` | IndexedDB 키-값 (메모리 대체) |
| `image.js` | 사진 줄이기 (긴 변 1600px, EXIF 제거) |
| `qrcode.js` | qrcode-generator 1.4.4 (MIT) + `export default` 한 줄 |

## 시작하기 (화면 쪽 흐름)

```js
import core from './core/index.js';

await core.ready;
if (core.hasJoinLink(location.hash)) {           // QR을 찍고 들어온 새 기기
  await core.joinFromQR(location.hash);
  history.replaceState(null, '', location.pathname); // 주소창에서 링크 지우기
}
const s = core.status();
if (!s.connected) showConnectHelp();             // "연결된 기기의 QR을 찍어 주세요" (관리자만: setup / connectWithToken)
else if (!(await core.resume())) showPasswordForm(); // → core.open(pw, { remember: true })
```

## API

### 상태 · 이벤트
- `status()` → `{ state, connected, open, user, repo, pending, lastSync, error, errorCode, memoryOnly }`
  - `state`: `locked` · `saved`(다 올림) · `pending`(이 기기에만 있음) · `syncing` · `offline` · `error`
  - `errorCode`: `bad-password` · `password-changed`(다른 기기에서 비밀번호 바뀜 → 잠김) · `token`(토큰 만료/교체 → QR 재연결) · `unsaved` · `busy` …
- `onStatus(fn)` / `onChange(fn)` → 해제 함수. `onChange` 는 `{ collections: ['members'], source: 'local'|'remote' }`
- 오류는 `CoreError` (`e.code`, `e.message` 는 화면에 그대로 보여 줄 수 있는 한국어)

### 열기 · 잠그기
- `open(password, { remember?: boolean, days?: 30 })` — 인터넷 없이도 열림(이 기기의 vault 사본). 열린 뒤 뒤에서 동기화
- `resume()` → `true|false` — `remember` 로 열었던 기기는 비밀번호 없이 (30일, 쓸 때마다 연장. 비밀번호가 바뀌면 무효)
- `lock()` — 메모리의 키를 지움. 못 올린 변경은 이 기기에 암호화되어 남고 다음에 열 때 올라감
- `rememberDevice(days)` · `forgetSession()` · `sessionInfo()`

### 기기 연결
- `setup(token, password, { user })` → **복구 코드**(한 번만 보여 줌). 빈 데이터 저장소에 `vault.json` 을 만든다. 관리자 한 번
- `connectWithToken(token, password)` — 관리자: 토큰으로 직접 연결 (모든 기기를 잃었을 때)
- `connectDeviceQR()` → `{ link, svg }` — 연결된 기기에서 새 기기용 QR. 링크 안의 토큰·데이터 키는 사이트 비밀번호 없이는 풀리지 않는다 (그래도 남에게 보이지 말 것)
- `hasJoinLink(hash)` · `joinFromQR(linkOrHash)` — 새 기기. 그다음 `open(password)`
- `setUser(name)` — 이 기기 사용자 이름. 기록의 `createdBy/updatedBy/deletedBy` 에 들어간다
- `forgetDevice()` — 이 기기의 연결·사본만 지움 (GitHub 데이터는 그대로). **못 올린 변경이 있으면 거부**

### 비밀번호 · 복구 코드 · 토큰 (인터넷 필요)
- `changePassword(newPw)` — 8자 이상. 다른 기기는 다음 동기화 때 잠기고 새 비밀번호를 묻는다
- `newRecoveryCode()` → 새 코드 (예전 코드는 바로 무효)
- `recover(code, newPw, token?)` — 비밀번호를 잊었을 때. 연결된 적 없는 기기면 관리자 `token` 도
- `rotateToken(newToken)` — 관리자. 다른 기기는 다음 동기화 때 새 토큰으로 바꿔 쓴다 ([HANDOVER.md](HANDOVER.md) 참고)

### 기록 (목록)
```js
const members = core.collection('members');   // lessons · themes · files · sys · members · gifts · giftStock · giftLog (다른 이름도 됨: 소문자로 시작, 영문·숫자)
members.list()                    // 휴지통 뺀 것. { deleted: true } 휴지통만, { deleted: 'all' } 전부
members.get(id)                   // 복사본 (고쳐도 저장 안 됨 → put/patch)
await members.put({ id?, ...내용 })  // id 없으면 새로 만듦. 내용 전체를 바꿈. 같은 내용이면 아무것도 안 함
await members.patch(id, { grade: 3 })
await members.putMany(list)       // 가져오기·옮기기용
await members.softDelete(id)      // 휴지통 (deletedAt/deletedBy). 진짜로 지우는 함수는 없다
await members.restore(id)
members.trash()
members.conflicts()               // 동시에 고쳐서 진 값이 남은 기록들
await members.clearConflicts(id)  // 사용자가 확인한 뒤
members.onChange(fn)
```
- 기록 모양: `{ id, ...내용, createdAt, createdBy, updatedAt, updatedBy, deletedAt, deletedBy, _conflicts? }`.
  `_` 로 시작하는 키와 메타 키는 `put` 할 때 무시된다. 값은 JSON으로 저장할 수 있는 것만.
- `_conflicts: [{ field, value, by, at, note? }]` — 같은 항목을 두 사람이 같은 때 다르게 고치면 나중 것이 이기고, 진 값이 여기 남는다.
  `note: 'kept'` 는 "한 사람이 지웠지만 다른 사람이 같은 때 고쳐서 지우지 않았다"는 뜻.
- `put` 은 이 기기에 저장한 뒤 돌아오고(오프라인도 됨), 1.5초 뒤 자동으로 올린다. 글자 칠 때마다 부르지 말고 저장 버튼·입력 끝에 부를 것.

### 파일 (사진·그림)
```js
const meta = await core.files.put(file, { name?, maxDim: 1600, quality: 0.85, resize: true })
// → { id, name, type, size, w, h, ... }  기록에는 meta.id 만 넣는다: members.patch(id, { photo: meta.id })
const url = await core.files.url(meta.id)   // <img src>. 이 기기에 없으면 GitHub에서 받아 둔다
const blob = await core.files.get(meta.id)
core.files.softDelete(id) / restore(id) / list()
```
- 사진은 올리기 전에 긴 변 1600px·1.5MB 이하로 줄이고 다시 저장(위치 정보 등 EXIF 제거). PNG·WebP는 PNG, 그 밖은 JPEG. 줄인 뒤 8MB 넘으면 거부.
- 파일은 한 번 올리면 바뀌지 않는다(새 그림 = 새 id).

### 동기화 · 백업
- `sync()` → `status()`. 보통은 부를 필요 없음 (고친 뒤 1.5초, 2분마다, 화면이 다시 보일 때, 인터넷이 다시 연결될 때 자동)
- `exportBackup()` → JSON 글자 (암호화된 그대로 + vault. 사진 빠짐). 내려받기 버튼에 쓸 것
- `hasUnsaved()` → 이 기기에만 있는 변경이 있는지

## 저장 구조
- 데이터 저장소 `jayangchoir/jayangchoir-data` (비공개):
  `vault.json` (DEK를 비밀번호·복구 코드로 감싼 값 + DEK로 암호화한 토큰),
  `data/<목록>/<00-0f>.enc` (기록 묶음, giftLog 는 64개), `files/<id>.bin`.
  모든 내용은 AES-256-GCM, 경로를 AAD로 묶음. 저장소에서 아무것도 지우지 않는다 (git 기록이 곧 이력).
- 이 기기: IndexedDB `jayangchoir-core` — 연결 정보, vault 사본, 조각 암호문(`s:`), 파일 암호문(`fb:`), 기억 정보(`session`).

## 동시에 고칠 때 (merge.js)
조각을 올릴 때 GitHub의 sha 가 달라졌으면(다른 기기가 먼저 올림) 받아서 **기록마다** 3-way 로 합친 뒤 다시 올린다.
기준(base)은 이 기기가 마지막으로 GitHub와 맞춘 내용. 한쪽만 바꾼 항목은 그쪽 것, 둘 다 바꾼 항목은 나중 것 + `_conflicts`,
한쪽에만 있는 기록은 남김, 지움 vs 고침은 남김. 그래서 "파일 통째로 마지막 저장이 이김" 이 일어나지 않는다.

**숫자 세기(선물 재고)는 덮어쓰지 말고 쌓을 것**: 두 사람이 동시에 `giftStock.qty` 를 10→9, 10→8 로 바꾸면 하나는 `_conflicts` 로 밀린다.
`giftLog` 에 { gift, qty: -1, member } 를 한 줄씩 **새 기록으로** 추가하고, 재고 = 기준 수량(`giftStock`) + giftLog 합계로 계산하면 충돌이 생기지 않는다.

## 사이트(셸)에 필요한 것
- CSP `connect-src https://api.github.com`, `img-src blob:` (지금 index.html 에 이미 있음)
- 화면: 비밀번호 입력, QR 보여 주기/찍고 들어오기, 이름 정하기, 상태 표시(저장됨/올리는 중/오프라인/오류), 휴지통, 충돌 표시, 관리자 메뉴(setup·토큰 바꾸기·비밀번호 바꾸기·새 복구 코드·백업)

## 합창단 사이트에서 바뀐 점 (jayangchild-site 의 core 를 복사)
- `DEFAULT_REPO` = `jayangchoir/jayangchoir-data`, IndexedDB `jayangchoir-core`, vault `app: 'jayangchoir'`, 백업 `kind: 'jayangchoir-core-backup'`.
- `COLLECTIONS` = notices · events · songs · videos · albums · members · media · settings · files. `media` 는 조각 64개(사진이 수천 장이 되어도 조각 하나가 작게).
- `core.backend(dev)` — 같은 토큰으로 다른 저장소(공개 사이트 저장소·사진 저장소)를 읽고 쓴다. 토큰은 밖으로 내보내지 않는다.
- `core.account()` — 저장소 정보 보기·만들기 (`GitHubAccount`: `repoInfo`, `createRepo`). 사진 저장소 choir-photos-N 을 자동으로 만들 때.
- `GitHubBackend.commitFiles(files, message)` — 여러 파일을 커밋 하나로 (학부모용 내용이 반쯤 바뀐 채로 보이지 않게).
- `fake-backend.js` 에 `FakeGitHub` (저장소 여러 개 + `raw()` 공개 읽기 흉내) 와 `commitFiles`.
- `access.js` — ACCESS-SPEC.md(jayangchild-site/js/core) 를 따른 역할·코드·keyring·authProvider. 공유 모듈이 오면 교체.
- `core.writeToken()` — 스탭(쓰기 역할) keyring 묶음에 넣을 토큰.
- `people` 목록 (가족·스탭).
- 사진·PDF 는 core 의 `files`(비공개 저장소) 대신 `js/media.js` 가 공개 사진 저장소에 파일마다 다른 키로 암호화해 둔다. 키는 `media` 기록(관리자)과 학부모용 묶음(학부모 열쇠)에만 있다.
