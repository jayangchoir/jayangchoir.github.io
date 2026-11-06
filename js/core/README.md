# js/core — 암호화 저장·동기화

화면 코드(필사노트·선물·회원 등)는 이 폴더의 API만 쓴다. GitHub·암호화·IndexedDB는 여기 안에 숨어 있다.
시험: `core-test.html`, `access-test.html` (가짜 GitHub, 인터넷 필요 없음). 운영자용 인수인계: [HANDOVER.md](HANDOVER.md)
등급별 보기 권한(공개·학부모·선생님·임원·관리자): 아래 [등급별 보기 권한 (access.js)](#등급별-보기-권한-accessjs), 명세 [ACCESS-SPEC.md](ACCESS-SPEC.md)

| 파일 | 내용 |
|---|---|
| `index.js` | 사이트에서 쓰는 core 하나 (`import core from './core/index.js'`) |
| `core.js` | `createCore(opts)` — 열기·연결·기록·파일·동기화 |
| `merge.js` | 동시에 고친 기록 합치기 (순수 함수) |
| `crypto.js` | AES-256-GCM, PBKDF2, 복구 코드 |
| `github.js` | GitHub 백엔드 (`tree/get/put/check` + access 용 `head/commit/createRepo`, 지우는 함수 없음), `publicReader` |
| `fake-backend.js` | 시험용 메모리 백엔드 (`FakeRepo`, 여러 저장소 `FakeGitHub`) |
| `access.js` | 등급별 보기 권한: 역할 설정 · 코드 로그인 · 봉투 암호화 · 사람 관리(한 명·여러 명) · 공개 저장소에 올리기(한 개·여러 개, 커밋 하나) |
| `access-ui.js` | 한국어 화면 조각: 로그인 카드 · 안내문(복사·인쇄) · 사람 명단 · 막기 확인 |
| `access-ui.css` | 화면 조각의 모양 (`ax-*`). 사이트가 `<link>` 로 넣는다 (엄격한 CSP 용, 인라인 style 없음) |
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
- `checkPassword(pw)` → `true|false` — 지금 사이트 비밀번호가 맞는지 (바꾸기 전 확인용, 인터넷 필요 없음)
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
- `files.put(blob, { id, resize: false })` — 예전 데이터 옮기기·백업 불러오기 전용: 정한 id 로 저장한다. 그 id 가 이미 이 기기에 있으면 내용을 바꾸지 않고 그 정보를 돌려준다.

### 동기화 · 백업
- `sync()` → `status()`. 보통은 부를 필요 없음 (고친 뒤 1.5초, 2분마다, 화면이 다시 보일 때, 인터넷이 다시 연결될 때 자동)
- `exportBackup()` → JSON 글자 (암호화된 그대로 + vault. 사진 빠짐). 내려받기 버튼에 쓸 것
- `hasUnsaved()` → 이 기기에만 있는 변경이 있는지

## 저장 구조
- 데이터 저장소 `jayangchild/jayangchild-data` (비공개):
  `vault.json` (DEK를 비밀번호·복구 코드로 감싼 값 + DEK로 암호화한 토큰),
  `data/<목록>/<00-0f>.enc` (기록 묶음, giftLog 는 64개), `files/<id>.bin`.
  모든 내용은 AES-256-GCM, 경로를 AAD로 묶음. 저장소에서 아무것도 지우지 않는다 (git 기록이 곧 이력).
- 이 기기: IndexedDB `jayangchild-core` — 연결 정보, vault 사본, 조각 암호문(`s:`), 파일 암호문(`fb:`), 기억 정보(`session`).

## 동시에 고칠 때 (merge.js)
조각을 올릴 때 GitHub의 sha 가 달라졌으면(다른 기기가 먼저 올림) 받아서 **기록마다** 3-way 로 합친 뒤 다시 올린다.
기준(base)은 이 기기가 마지막으로 GitHub와 맞춘 내용. 한쪽만 바꾼 항목은 그쪽 것, 둘 다 바꾼 항목은 나중 것 + `_conflicts`,
한쪽에만 있는 기록은 남김, 지움 vs 고침은 남김. 그래서 "파일 통째로 마지막 저장이 이김" 이 일어나지 않는다.

**숫자 세기(선물 재고)는 덮어쓰지 말고 쌓을 것**: 두 사람이 동시에 `giftStock.qty` 를 10→9, 10→8 로 바꾸면 하나는 `_conflicts` 로 밀린다.
`giftLog` 에 { gift, qty: -1, member } 를 한 줄씩 **새 기록으로** 추가하고, 재고 = 기준 수량(`giftStock`) + giftLog 합계로 계산하면 충돌이 생기지 않는다.

## 사이트(셸)에 필요한 것
- CSP `connect-src https://api.github.com`, `img-src blob:` (지금 index.html 에 이미 있음)
- 화면: 비밀번호 입력, QR 보여 주기/찍고 들어오기, 이름 정하기, 상태 표시(저장됨/올리는 중/오프라인/오류), 휴지통, 충돌 표시, 관리자 메뉴(setup·토큰 바꾸기·비밀번호 바꾸기·새 복구 코드·백업)


---

## 등급별 보기 권한 (access.js)

서버 없이 "누가 무엇을 보나"를 나눈다. 첫 화면은 공개 페이지이고, **로그인은 하나(아이디 + 접속 코드)** — 역할은 고르지 않고 그 사람의 자리(slot)가 정한다.

### 역할 (사이트 설정)
```js
import { createAccess } from './core/access.js';
const access = createAccess({
  site: 'jayangchild', title: '자양교회 유년부',
  owner: 'jayangchild', repo: 'jayangchild.github.io', branch: 'main', siteUrl: 'https://jayangchild.github.io/',
  roles: [
    { id: 'public' },                                   // 꼭 있어야 함. 평문
    { id: 'parent', inherits: ['public'] },             // 이름은 기본표(학부모·선생님·임원·관리자…) 또는 name: '…'
    { id: 'teacher', inherits: ['parent'] },
    { id: 'officer', inherits: ['teacher'], write: true, labels: ['부장', '부감', '총무', '회계', '서기'] },
    { id: 'admin', inherits: ['officer'], write: true }, // 관리자 역할은 하나 (id 'admin' 또는 admin: true)
  ],
  files: { repos: true, prefix: 'jayangchild-files', limit: 900e6 }, // repos:false 면 사이트 저장소 access/f/ 에
});
```
- 물려받기는 여러 갈래도 된다(`inherits: ['a','b']`). `write: true` 역할의 꾸러미에만 쓰기 토큰이 들어간다.
- `access.roles`: `closure(id)` 볼 수 있는 등급 · `tiersOf(id)` 열쇠 있는 등급 · `canWrite` · `isAdmin` · `name` · `display(id, labels)` → `'임원 (총무)'`.

### 로그인 · 보기 (모든 사람)
- `login(identifier, secret, { remember })` → `{ role, roleName, labels, name, tiers, canWrite, isAdmin, bundle }`. 틀리면 `AccessError('bad-login')`
- `resume()` (이 기기 기억 30일) · `logout()` · `me()` · `tiers()` · `canSee(tier)` · `onChange(fn)`
- `list(tier, { deleted })` → `[{ id, tier, data, file: { name, type, size, repo, path, stored } | null, at, deletedAt }]` · `listAll()` · `file(id, tier)` → Blob · `fileUrl(id, tier)`
- 공개(`public`)는 로그인 없이 `list('public')`.
- 열쇠가 바뀌었으면(누가 막힘) 꾸러미를 저절로 새로 받는다. 막힌 사람은 `AccessError('revoked')` 로 로그아웃된다.
- `changeSecret(지금 코드, 새 비밀문장)` — 10자 이상. 숫자만(생일·전화번호·PIN)·흔한 말·같은 글자 반복은 `weak-passphrase`.
  쓰기 역할은 바로 바뀌고 `{ done: true }`. 읽기 역할은 올릴 수 없어서 `{ request: 'ACX1.…' }` 를 관리자에게 보낸다(비밀문장은 들어 있지 않음).

### 올리기 (쓰기 역할: 임원·관리자)
- `publish({ id?, tier, data })` — 글(JSON). 고칠 때마다 새 항목 열쇠
- `publishFile(blob, { tier, name?, type?, data?, resize? })` → `{ id, repo, path, size }` — 파일 저장소 `<site>-files-N` 에 암호화해 올린다. 한도(900MB)를 넘게 되면 쓰기 토큰으로 다음 저장소를 만든다. 95MB 넘는 파일은 거부(동영상은 링크로)
- `unpublish(id, tier)` / `restore(id, tier)` — 휴지통 (암호문·파일은 지우지 않음)
- `publishMany(items, { message? })` → `[{ id, tier, done, trash?, restore? }]` — 여러 글을 여러 등급에 걸쳐 **커밋 하나**로 (가져오기·게시용).
  `items`: `{ id?, tier, data }`(올리기, `publish` 와 같음) · `{ id, tier, trash: true }`(휴지통) · `{ id, tier, restore: true }`(되살리기).
  휴지통·되살리기는 할 것이 없으면(없는 항목·이미 그 상태) `done: false`. 같은 항목이 두 번 있거나 파일 항목을 고치려 하면 `bad-id`, 읽기 역할은 `read-only`, 못 보는 등급은 `no-access` (아무것도 올리지 않음).
  API 요청은 항목 수와 상관없이 `브랜치 끝 1 + 등급 목록 읽기 T + 커밋(1 + 바뀐 목록 수 + 3)` (T = 들어 있는 등급 수). 300개를 두 등급에 = 9번.
- 공개 저장소에는 **커밋 하나**로 올린다 (git trees API). 누가 먼저 올렸으면(409) 다시 읽어 합친 뒤 다시 (6번까지, 그래도 안 되면 `busy`).

### 관리자
```js
// 처음 한 번: core 를 연 관리자 PC 에서 (core.setup 다음)
const { code, recoveryCode, admin } = await access.setup(core, { token: 공개저장소쓰기토큰, name: '이관리', identifier: 'yunyeon-admin' });
// 그다음부터: 다른 사람과 같은 로그인 → 데이터 저장소(core)까지 열림 (사이트 비밀번호 필요 없음)
await access.login('yunyeon-admin', code);
const admin = await access.openAdmin(core);
```
- `admin.people()` → `[{ id, name, identifier, role, roleName, roleLabel, labels, status: 'active'|'revoked', issuedAt, revokedAt, secret: 'code'|'passphrase', canWrite }]`
- `admin.addPerson({ name, identifier, role, labels?, code? })` → `{ person, code, invitation }` — 코드는 이때 한 번만 보인다(어디에도 저장 안 함).
  `code` 를 넣으면(가져온 인증번호) 그것을 쓰고, 40비트보다 약하면 `weak-code` (`acceptWeak: true` 로 알고 쓰기)
- `admin.resetCode(id)` — 새 코드(예전 코드 바로 무효, 개인 열쇠도 새로). 막은 사람이면 다시 허용 (`reinstate(id)` 와 같음)
- `admin.changeRole(id, role, labels)` — 낮추면 잃는 등급의 열쇠를 바꾼다 → `{ rotated, tokenExposed, recoveryCode }`
- `admin.addPeople(rows, { acceptWeak?, atomic?, concurrency: 4, onProgress(done, total)? })` → 넣은 순서대로 `[{ person, code, invitation, bits, weak } | { error: { code, message }, input }]` —
  여러 사람(CSV 수백 줄)을 **공개 저장소 커밋 하나**로. `rows` 는 `addPerson` 과 같은 모양 (줄마다 `code`·`acceptWeak` 가능).
  같은 아이디(이미 있거나 같은 묶음 안에서 겹침)·약한 번호·없는 역할·직분 같은 잘못된 줄은 `error` 로 돌려주고 나머지는 넣는다. `atomic: true` 면 첫 오류를 던지고 아무것도 넣지 않는다.
  걸리는 시간은 거의 사람마다 PBKDF2 60만 회(0.1~0.5초)라 4개씩 동시에 하고 `onProgress` 로 알린다. `addPerson` 도 이것을 한 줄로 부른다.
- **API 요청 수 (GitHub 한도 5000번/시간)** — 사람 수 N 과 상관없다:
  공개 사이트 저장소 = `브랜치 끝 1 + keyring 1(1MB 넘으면 2) + 등급 목록 T + 커밋(1 + 바뀐 파일 수 + 3)` (유년부 T=4 → 11번, forcsoz T=17 → 약 24번),
  비공개 데이터 저장소(core) = 다음 동기화 때 `tree 1 + 바뀐 조각마다 PUT 1` (명단 `accessPeople` 조각 16개 + `accessSys` → 커밋 17개 이하).
  예전처럼 한 줄씩 `addPerson` 하면 줄마다 공개 저장소 커밋 하나(11~24번)라 300줄 = 3300~7200번으로 한 시간 한도를 넘는다.
  `access-test.html` 의 "큰 묶음" 시험이 300명에 공개 저장소 커밋 1개·요청 11번, 데이터 저장소 커밋 16개를 확인한다.
- `admin.revokeMany(ids, { newToken? })` → `{ people, rotated, tokenExposed, recoveryCode }` — 여러 사람을 한 번에 막기. 등급 열쇠는 등급마다 **한 번만** 바꾸고 커밋 하나 (100명을 막아도 열쇠 판은 1 올라감).
  이미 막은 사람만 있으면 아무것도 안 함(`rotated: []`). 없는 id 는 `not-found`, 나 자신은 `self` (아무것도 안 함). `revoke(id)` 도 이것을 한 명으로 부른다.
- `admin.revoke(id, { newToken? })` — 자리를 지우고, 그 사람이 가졌던 등급 열쇠를 모두 바꾸고, 항목 열쇠·남은 사람 꾸러미를 다시 감싸 **커밋 하나**로 올린다.
  파일 암호문은 그대로. 쓰기 역할이었으면 `tokenExposed: true` → `admin.setToken(새토큰)` 후 예전 토큰을 GitHub에서 지운다. 관리자를 막으면 새 명단 복구 코드를 준다.
- `admin.applySecretChange(request)` · `admin.setToken(token)` · `admin.newRecoveryCode()` · `admin.republish()` (올리다 끊겼을 때 다시 맞추기)
- 관리자 코드를 잃었을 때: core 를 사이트 비밀번호로 연 뒤 `access.recoverAdmin(core, 명단복구코드)` → `admin.resetCode(내 id)`

### 화면 조각 (access-ui.js · access-ui.css)
모양은 `access-ui.css` 파일 하나 (이름은 모두 `ax-` 로 시작, 바꾸지 않음). 엄격한 CSP(`style-src 'self'`, `'unsafe-inline'` 없음)에서도 되게
`<style>` 도 `style=""` 도 쓰지 않는다. 사이트 `<head>` 에 `<link rel="stylesheet" href="js/core/access-ui.css">` 를 넣을 것
(넣지 않았으면 access-ui.js 가 처음 쓸 때 같은 파일을 `<link>` 로 붙인다 — 그래도 'self' 라 CSP 에 걸리지 않지만, 잠깐 모양 없이 보일 수 있다). 주소는 `CSS_URL`.
```js
import { loginCard, invitationCard, printCard, peopleTable, confirmRevoke, revokeMessage } from './core/access-ui.js';
el.append(loginCard({ access, onLogin: r => route(r.role) }));       // 아이디 + 코드, 역할 고르기 없음
el.append(peopleTable({ admin, access }));                           // 추가 · 새 코드 · 역할 · 막기(확인 창) · 다시 허용
el.append(invitationCard({ title, siteUrl, name, identifier, code, roleLabel }));  // 안내문 + 복사 + 카드 인쇄
```
막기 확인 창은 "앞으로 올리는 새 내용은 못 보지만, 이미 내려받은 예전 내용은 그 기기에 남을 수 있다"고 그대로 말한다. "마지막 접속"은 보여 주지 않는다(서버가 없어 알 수 없음).

### 저장 구조
- 공개 사이트 저장소: `keyring.json` (자리: `SHA-256(사이트 소금 + 아이디)` → `{ s, i, t, at, w, b }`, 이름·아이디·역할 없음),
  `access/<등급>/index.json` (항목마다 `{ kv, k: K_등급으로 감싼 항목 열쇠, r: 글 암호문, m: 파일 정보 암호문, f: { repo, path, size }, at, del? }`),
  `access/public/index.json` (평문), `access/files.json` (파일 저장소와 쓴 크기)
- 파일 저장소 `<site>-files-N` (공개): `f/<id>.bin` 암호문
- 비공개 데이터 저장소(core): `accessSys/state` · `accessPeople/<id>` — 관리자 열쇠 M 으로 한 번 더 잠김. 사이트 비밀번호를 아는 사람도 명단·열쇠는 못 본다
- 열쇠: 코드 → PBKDF2 60만 회 → 개인 열쇠 P → 꾸러미 `{ keys: { 등급: { kv, k } }, token?(쓰기만), am·vault?(관리자만) }`

### 알아 둘 것 (한계)
- 공개 저장소에 있는 것은 누구나 내려받아 집에서 맞혀 볼 수 있다. 그래서 코드는 60비트 무작위, 비밀문장은 10자 이상이다. 생일·PIN 만으로는 안 된다(그건 인증 서버가 있어야 함).
- 자리 이름은 아이디의 해시라서, 아이디가 전화번호처럼 맞히기 쉬우면 "그 번호가 명단에 있는지"는 알 수 있다(내용은 못 봄).
- 막힌 사람이 이미 받은 것은 되돌릴 수 없다. 막은 뒤 올린 것과 고친 것(새 항목 열쇠)만 막힌다.
- 공개 사이트(Pages)는 1~2분 늦게 바뀐다. 새로 추가한 사람이 바로 로그인이 안 되면 잠시 뒤 다시.
- 관리자 꾸러미에는 core 데이터 키와 토큰이 들어 있다(같은 로그인으로 열기). 관리자 코드는 사이트 비밀번호만큼 중요하다.
- 사이트 CSP `connect-src` 에 `https://raw.githubusercontent.com` (파일 저장소 읽기) 가 필요하다.
- 쓰기 토큰(fine-grained): 공개 사이트 저장소 + 파일 저장소에 Contents 쓰기, 새 파일 저장소를 만들려면 Administration 쓰기. "All repositories" 로 하면 비공개 데이터 저장소도 닿지만 그 안은 사이트 비밀번호(DEK)로 암호화되어 있다. 아니면 `-files-1~3` 을 미리 만들어 토큰에 넣어 둔다.

### 인증 서버로 바꾸기 (authProvider)
`createAccess(config, { provider })` — `{ login(identifier, secret) → bundle, refresh?(bundle) → bundle | null }`.
기본은 `localSlotProvider({ fetchKeyring })` (keyring.json 을 이 기기에서 연다). 나중에 Cloudflare Worker(생일 + 횟수 제한, 이메일 OTP, 고객 DB 확인)가 같은 모양의 꾸러미를 돌려주면 화면은 그대로다.

### 다른 사이트에 옮기기 (jayangchoir · forcsoz)
1. `js/core/` 를 통째로 복사한다 (`crypto · kv · github · image · core · access · access-ui · access-ui.css`, 시험용 `fake-backend` 와 `core-test.html` · `access-test.html`).
2. `core.js` 의 `DEFAULT_REPO` 와 IndexedDB 이름(`index.js`)을 그 사이트 것으로 바꾼다.
3. `createAccess({ site, title, owner, repo, siteUrl, roles, files })` 에 그 사이트의 역할표를 넣는다.
   - jayangchoir: `public → parent(가족마다 코드, 그만두면 막기) → admin`
   - forcsoz: `public → customer(인증번호: addPerson({ code }) 로 가져오기, 40비트 미만은 경고) → staff(@forcs.com 주소마다 코드) → writer(write) → admin`
4. CSP 에 `https://raw.githubusercontent.com` 를 더하고, 첫 화면은 공개 페이지 + `loginCard` 하나.
5. `access-test.html` 의 `ROLES`·`CFG` 를 그 사이트 것으로 바꿔 헤드리스 Edge 로 돌린다 (`node tools/serve.mjs` → `/access-test.html?report`).

---

## 합창단 사이트에서 바꾼 점 (jayangchild-site 의 js/core 를 복사, 커밋 24479ba)
- `core.js`: `DEFAULT_REPO` = `jayangchoir/jayangchoir-data`, IndexedDB `jayangchoir-core`, vault `app: 'jayangchoir'`, 백업 `kind: 'jayangchoir-core-backup'`,
  `COLLECTIONS` 에 합창단 목록(notices·events·songs·videos·albums·members·families·media·settings·accessSys·accessPeople), `media` 조각 64개,
  그리고 `core.backend(dev)` 하나 더함 — 같은 토큰으로 사진 저장소 `choir-photos-N` 에 올리고 만들 때.
- `access.js`, `access-ui.js`, `access-ui.css`, `github.js`, `fake-backend.js`, `ACCESS-SPEC.md`: 그대로 복사 (고치지 않음). 설정은 `js/access-config.js`.
- 반영(`js/publish.js`)은 바뀐 항목을 모아 `access.publishMany` 로 커밋 하나, "명단으로 가족 만들기"는 `addFamilies` → `admin.addPeople` 로 커밋 하나.
- 사진·악보 PDF 는 `access.publishFile` 대신 `js/media.js`(choir-photos-N, 파일마다 키, 앨범마다 목록)를 쓴다.
  수천 장이 되면 등급 목록(`access/parent/index.json`)에 사진마다 한 줄씩 들어가 학부모 휴대폰이 매번 크게 받기 때문.
  사진 키는 학부모 등급 항목(`content`, `album-<id>`) 안에만 있으므로 가족을 막으면 똑같이 새 내용을 못 연다.
  스탭 회의자료 첨부는 `access.publishFile`(choir-files-N)을 그대로 쓴다.
