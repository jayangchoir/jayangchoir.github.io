// 등급별 보기 권한 (공개 · 학부모 · 선생님 · 임원 · 관리자 …) — 서버 없는 GitHub Pages 용. 명세: ACCESS-SPEC.md, 사용법: README.md
//
// ── 무엇이 어디에 있나 ──
//   공개 사이트 저장소 (예: jayangchild/jayangchild.github.io)
//     keyring.json                사람마다 "자리(slot)" 하나: 아이디의 해시 → 코드로 잠근 접속 꾸러미. 이름·아이디·역할은 들어 있지 않다
//     access/<등급>/index.json     그 등급의 글·파일 목록. 항목마다 열쇠(item key)를 등급 열쇠 K_등급으로 감싼 값 + 암호문
//     access/public/index.json    공개 등급은 암호화하지 않는다
//     access/files.json           파일 저장소 목록과 쓴 크기 [{ name, bytes }]
//   공개 파일 저장소 <site>-files-1, -2 … (쓰기 토큰이 900MB 가까이 되면 다음 것을 만든다)
//     f/<id>.bin                  암호화한 파일. 한 번 올리면 바뀌지 않는다 (열쇠를 바꿔도 그대로)
//   비공개 데이터 저장소(core vault) — 관리자만
//     accessSys/state             등급 열쇠(예전 것까지), 쓰기 토큰, 사이트 소금 — 관리자 열쇠 M 으로 한 번 더 암호화
//     accessPeople/<id>           사람 명단 (이름·아이디·역할·직분·상태·발급일·막은 날·개인 열쇠 P) — M 으로 암호화
//
// ── 열쇠 ──
//   K_등급   등급마다 무작위 256비트. 사람을 막으면(revoke) 그 사람이 가졌던 등급의 K 를 새로 만든다 (kv 가 1 늘어남)
//   P        사람마다 개인 열쇠. 접속 꾸러미(bundle)를 P 로 암호화한다. 그래서 관리자는 코드를 몰라도 꾸러미를 다시 만들 수 있다
//   KEK      PBKDF2-SHA256(코드 또는 비밀문장, 자리 소금, 60만 회) → P 를 감싼다
//   M        관리자 열쇠. 명단·등급 열쇠 원본을 잠근다. 관리자 꾸러미와 복구 코드로만 열린다
//
// ── 접속 꾸러미 (bundle) ──
//   { v, site, pid, name, role, labels, keys: { 등급: { kv, k } }, token?(쓰기 역할만), am?·vault?(관리자만), session: { lid, pk } }
//   읽기 역할 꾸러미에는 토큰이 절대 들어가지 않는다.

import * as C from './crypto.js';
import { KV } from './kv.js';
import { GitHubBackend, isConflict, publicReader } from './github.js';
import { prepareImage, isRaster } from './image.js';

export const KEYRING = 'keyring.json';
export const MANIFEST = 'access/files.json';
export const indexPath = tier => `access/${tier}/index.json`;
export const MIN_PASSPHRASE = 10;
export const MIN_CODE_BITS = 40; // 가져온 인증번호의 최소 무작위성 (그보다 작으면 경고)
export const FILE_REPO_LIMIT = 900e6;
export const MAX_ACCESS_FILE = 95e6; // GitHub 파일 하나 100MB 제한
const SESSION_DAYS = 30;

export class AccessError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const err = (code, message) => new AccessError(code, message);

const nowISO = () => new Date().toISOString();
export const uid = () => Date.now().toString(36) + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => (b % 36).toString(36)).join('');
const json = o => C.utf8(JSON.stringify(o));
const unjson = u8 => (u8 ? JSON.parse(C.unutf8(u8)) : null);
const pretty = o => C.utf8(`${JSON.stringify(o, null, 1)}\n`);
const rand32 = () => crypto.getRandomValues(new Uint8Array(32));

// 키 순서와 상관없는 비교
function canon(v) {
  if (v === undefined) return 'u';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
}
const same = (a, b) => canon(a) === canon(b);

// n 개씩 동시에 (PBKDF2 처럼 오래 걸리는 일을 여러 개 할 때)
async function pool(list, n, fn) {
  let i = 0;
  const run = async () => { while (i < list.length) { const j = i++; await fn(list[j], j); } };
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, run));
}
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ===================================================================
// 역할 (설정으로 정한다)
// ===================================================================

const ROLE_NAMES = { public: '공개', parent: '학부모', teacher: '선생님', officer: '임원', admin: '관리자', member: '회원', customer: '유지보수고객', staff: '컨설팅팀원', writer: '작성자' };

// list: [{ id, name?, inherits?: [id], write?: true, admin?: true, labels?: ['부장', …] }]
// 'public' 역할은 꼭 있어야 한다. 관리자 역할(admin:true 또는 id 'admin')은 하나.
export function defineRoles(list) {
  if (!Array.isArray(list) || !list.length) throw err('bad-roles', '역할 목록이 비어 있어요.');
  const byId = new Map();
  for (const r of list) {
    if (!r?.id || !/^[a-z][a-z0-9_]{0,31}$/.test(r.id)) throw err('bad-roles', `역할 id 가 올바르지 않아요: ${r?.id}`);
    if (byId.has(r.id)) throw err('bad-roles', `역할 id 가 겹쳐요: ${r.id}`);
    byId.set(r.id, { inherits: [], labels: [], ...r, inherits: [...(r.inherits || [])], labels: [...(r.labels || [])] });
  }
  if (!byId.has('public')) throw err('bad-roles', "'public' 역할이 있어야 해요.");
  for (const r of byId.values()) for (const p of r.inherits) if (!byId.has(p)) throw err('bad-roles', `${r.id} 가 없는 역할 ${p} 를 물려받아요.`);
  const memo = new Map();
  const close = (id, path = []) => {
    if (memo.has(id)) return memo.get(id);
    if (path.includes(id)) throw err('bad-roles', `역할이 돌고 돌아요: ${[...path, id].join(' → ')}`);
    const s = new Set([id]);
    for (const p of byId.get(id).inherits) for (const x of close(p, [...path, id])) s.add(x);
    s.add('public');
    memo.set(id, s);
    return s;
  };
  for (const id of byId.keys()) close(id);
  const admins = [...byId.values()].filter(r => r.admin || r.id === 'admin');
  if (admins.length !== 1) throw err('bad-roles', '관리자 역할(admin)은 하나여야 해요.');
  const ids = [...byId.keys()];
  const nameOf = id => byId.get(id).name || ROLE_NAMES[id] || id;
  const get = id => {
    const r = byId.get(id);
    if (!r) throw err('bad-role', `없는 역할이에요: ${id}`);
    return r;
  };
  const closure = id => { get(id); return ids.filter(x => memo.get(id).has(x)); };
  return {
    list: [...byId.values()],
    ids,
    keyed: ids.filter(x => x !== 'public'), // 열쇠가 있는 등급
    adminId: admins[0].id,
    get,
    has: id => byId.has(id),
    closure, // 볼 수 있는 등급 (자기 + 물려받은 것 + public), 설정 순서
    tiersOf: id => closure(id).filter(x => x !== 'public'), // 꾸러미에 열쇠가 들어가는 등급
    canWrite: id => !!get(id).write,
    isAdmin: id => id === admins[0].id,
    name: id => nameOf(get(id).id),
    labelsOf: id => [...get(id).labels],
    // 역할을 바꾸면 더는 못 보는 등급
    lost: (from, to) => { const keep = new Set(closure(to)); return closure(from).filter(x => x !== 'public' && !keep.has(x)); },
    // 화면에 보일 역할 이름: '임원 (총무)'
    display: (id, labels = []) => { const n = byId.has(id) ? nameOf(id) : id; return labels?.length ? `${n} (${labels.join('·')})` : n; },
  };
}

// ===================================================================
// 코드 · 비밀문장 · 아이디
// ===================================================================

// 접속 코드: 헷갈리는 0/O, 1/I 를 뺀 32글자 × 12자리 = 60비트. 예) K7QX-M2PA-9TRD
const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newAccessCode(len = 12) {
  const out = [];
  for (const b of crypto.getRandomValues(new Uint8Array(len))) out.push(CODE_ALPHA[b % 32]); // 256 = 32 × 8, 고르게
  return out.join('').match(/.{1,4}/g).join('-');
}
export const ACCESS_CODE_BITS = 60;
export const normAccessCode = s => String(s ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normPass = s => String(s ?? '').normalize('NFKC').trim();

// 대략의 무작위성(비트). 관리자가 가져온 번호(예: 회사 DB 인증번호)가 충분한지 보는 데 쓴다
export function codeBits(code) {
  const s = String(code ?? '');
  if (!s) return 0;
  if (new Set(s).size === 1) return 0;
  let pool = 0;
  if (/[0-9]/.test(s)) pool += 10;
  if (/[A-Z]/.test(s)) pool += 26;
  if (/[a-z]/.test(s)) pool += 26;
  if (/[^A-Za-z0-9]/.test(s)) pool += 33;
  return Math.floor(s.length * Math.log2(pool));
}

const COMMON = ['password', 'qwerty', 'qwertyuiop', 'asdfghjkl', 'iloveyou', 'abcd1234', '1q2w3e4r', '1q2w3e4r5t', 'qwer1234', 'admin1234', 'letmein', 'welcome', 'sarang', 'saranghae'];

// 사람이 직접 정하는 비밀문장: 10자 이상, 생일·전화번호·PIN 처럼 숫자만은 안 됨. 문제가 있으면 AccessError('weak-passphrase')
export function checkPassphrase(pass, { identifier = '', name = '' } = {}) {
  const p = normPass(pass);
  const weak = msg => { throw err('weak-passphrase', msg); };
  if ([...p].length < MIN_PASSPHRASE) weak(`비밀문장은 ${MIN_PASSPHRASE}자 이상으로 정해 주세요. 짧은 글보다 낱말 서너 개가 기억하기도 쉽고 안전해요.`);
  if (/^[\d\s\-./:]+$/.test(p)) weak('숫자만으로는 안 돼요. 생일·전화번호·PIN 은 컴퓨터가 몇 시간이면 맞혀요. 글자를 섞어 주세요.');
  if (new Set(p.toLowerCase()).size < 5) weak('같은 글자가 너무 많아요. 서로 다른 글자를 더 섞어 주세요.');
  const low = p.toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  const letters = low.replace(/[0-9]/g, '');
  if (COMMON.some(c => low === c || letters === c || low.startsWith(c) && low.length - c.length < 4)) weak('너무 흔한 비밀문장이에요. 나만 아는 낱말을 섞어 주세요.');
  const codes = [...low].map(c => c.codePointAt(0));
  if (codes.length > 3 && codes.every((c, i) => !i || Math.abs(c - codes[i - 1]) === 1)) weak('abcd·1234 처럼 이어지는 글자는 안 돼요.');
  for (const x of [identifier, name]) {
    const n = normIdentifier(x);
    if (n.length >= 3 && normIdentifier(p).includes(n)) weak('아이디나 이름이 들어간 비밀문장은 안 돼요.');
  }
  return true;
}

// 아이디: 글자 모양 통일, 소문자, 띄어쓰기·하이픈·점·괄호 무시 (010-1234-5678 = 01012345678, "김 철수" = "김철수")
export const normIdentifier = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s\-_.()]/g, '');

const hex = u8 => Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');
// 자리 찾는 값 = SHA-256(사이트 소금 + 정리한 아이디). keyring.json 에는 이것만 보인다
export async function lookupId(siteSalt, identifier) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', C.utf8(siteSalt + normIdentifier(identifier)))));
}

// ===================================================================
// 자리(slot) · 꾸러미(bundle) 암호화
// ===================================================================

const secretOf = (kind, secret) => (kind === 'p' ? normPass(secret) : normAccessCode(secret));
const pkKey = raw => C.importDEK(raw);

export async function sealBundle(pkRaw, lid, bundle) {
  const { session, ...b } = bundle;
  return C.encryptText(await pkKey(pkRaw), JSON.stringify(b), `bundle:${lid}`);
}
export async function openBundle(pkRaw, lid, env) {
  return JSON.parse(await C.decryptText(await pkKey(pkRaw), env, `bundle:${lid}`));
}

// 코드(kind 'c') 또는 비밀문장(kind 'p')으로 P 를 감싼 자리. b(꾸러미)는 따로 채운다
export async function makeSlot({ secret, kind = 'c', pkRaw, lid, iter = C.ITER, at = nowISO() }) {
  const s = C.newSalt();
  const kek = await C.deriveKEK(secretOf(kind, secret), s, iter);
  return { s, i: iter, t: kind, at, w: await C.encryptText(kek, C.b64(pkRaw), `slot:${lid}`), b: null };
}

// 틀리면 null
export async function openSlot(slot, lid, secret) {
  try {
    const kek = await C.deriveKEK(secretOf(slot.t, secret), slot.s, slot.i || C.ITER);
    const pkRaw = C.unb64(await C.decryptText(kek, slot.w, `slot:${lid}`));
    return { pkRaw, bundle: await openBundle(pkRaw, lid, slot.b) };
  } catch {
    return null;
  }
}

// 항목 열쇠 감싸기: K_등급 으로, AAD 에 등급·항목 id 를 묶는다 (다른 항목·등급에 옮겨 붙이면 안 풀림)
const importK = b64k => C.importDEK(C.unb64(b64k));
const wrapItem = async (kB64, tier, id, itemRaw) => C.encryptText(await importK(kB64), C.b64(itemRaw), `item:${tier}:${id}`);
const unwrapItem = async (kB64, tier, id, env) => C.unb64(await C.decryptText(await importK(kB64), env, `item:${tier}:${id}`));

// ===================================================================
// 로그인 방법 (authProvider)
// ===================================================================
// authProvider 모양:
//   login(identifier, secret) → bundle          틀리면 AccessError('bad-login')
//   refresh?(bundle)          → bundle | null   열쇠가 바뀐 뒤 새 꾸러미 (막힌 사람은 null)
// 나중에 인증 서버(예: Cloudflare Worker 의 생일+횟수 제한, 이메일 OTP, 고객 DB 확인)가 생기면
// 같은 모양의 provider 를 만들어 createAccess({ provider }) 로 넣으면 화면은 그대로다.

const BAD_LOGIN = '아이디 또는 코드가 맞지 않아요. 받은 안내문에 적힌 그대로 넣어 주세요. (대소문자·띄어쓰기·- 는 상관없어요)';

// 기본: keyring.json 의 자리를 이 기기에서 연다 (서버 없음)
export function localSlotProvider({ fetchKeyring }) {
  return {
    name: 'local',
    async login(identifier, secret) {
      if (!normIdentifier(identifier) || !String(secret ?? '').trim()) throw err('bad-login', '아이디와 코드를 모두 넣어 주세요.');
      const ring = await fetchKeyring();
      if (!ring?.slots) throw err('not-setup', '아직 사람 명단이 만들어지지 않은 사이트예요.');
      const lid = await lookupId(ring.salt, identifier);
      const slot = ring.slots[lid];
      if (!slot) throw err('bad-login', BAD_LOGIN);
      const got = await openSlot(slot, lid, secret);
      if (!got) throw err('bad-login', BAD_LOGIN);
      return { ...got.bundle, session: { provider: 'local', lid, pk: C.b64(got.pkRaw) } };
    },
    async refresh(bundle) {
      const s = bundle?.session;
      if (!s?.lid) return null;
      const ring = await fetchKeyring();
      const slot = ring?.slots?.[s.lid];
      if (!slot?.b) return null;
      try {
        return { ...(await openBundle(C.unb64(s.pk), s.lid, slot.b)), session: s };
      } catch {
        return null; // 코드를 새로 발급받음(P 가 바뀜) → 새 코드로 다시 로그인
      }
    },
  };
}

// ===================================================================
// createAccess
// ===================================================================
// config: {
//   site: 'jayangchild',                 이름 (파일 저장소 이름 앞부분, IndexedDB 이름)
//   title: '자양교회 유년부',              안내문에 쓰는 이름
//   owner: 'jayangchild', repo: 'jayangchild.github.io', branch: 'main',   공개 사이트 저장소
//   siteUrl: 'https://jayangchild.github.io/',
//   roles: [...],                        defineRoles 모양
//   files: { repos: true, prefix: 'jayangchild-files', limit: 900e6, org: false }   repos:false 면 사이트 저장소 access/f/ 에
//   iter: 600000                         (바꾸지 말 것. 시험만)
// }
// opts: { reader, backendFor(token, { owner, repo, branch }), provider, kvName }
export function createAccess(config, opts = {}) {
  const cfg = { branch: 'main', title: config.site, ...config };
  const roles = defineRoles(cfg.roles);
  const fileCfg = { repos: true, prefix: `${cfg.site}-files`, limit: FILE_REPO_LIMIT, org: false, ...(cfg.files || {}) };
  const iter = cfg.iter || C.ITER;
  const reader = opts.reader || publicReader({ siteUrl: cfg.siteUrl, owner: cfg.owner, branch: cfg.branch });
  const backendFor = opts.backendFor || ((token, r) => new GitHubBackend({ token, ...r }));
  const kv = new KV(opts.kvName || `access-${cfg.site}`);
  const siteRepo = { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch };

  let bundle = null;
  const items = new Map(); // id → { tier, entry, itemRaw?, meta? }  (list 로 본 것. 파일 열기용)
  const changeFns = new Set();

  // ---------- 공개 저장소 읽기 ----------
  // 쓰기 토큰이 있으면 GitHub API 로(바로 최신), 없으면 공개 사이트(Pages)에서
  async function readSite(path, token = bundle?.token) {
    try {
      if (token) {
        try {
          return unjson((await backendFor(token, siteRepo).get(path))?.bytes);
        } catch (e) {
          if (e.status !== 401 && e.status !== 403) throw e; // 토큰이 바뀌어 지워짐 → 공개 사이트에서 읽고, 새 꾸러미로 새 토큰을 받는다
        }
      }
      return unjson(await reader.site(path));
    } catch (e) {
      if (e.status === 0) throw err('offline', '인터넷에 연결되어 있지 않아요.');
      throw e;
    }
  }
  const fetchKeyring = () => readSite(KEYRING);
  const provider = opts.provider || localSlotProvider({ fetchKeyring });

  // ---------- 커밋 하나로 올리기 ----------
  // mutate(get) → [{ path, bytes }]. get 은 같은 커밋(parent)에서 읽는다. 누가 먼저 올렸으면 처음부터 다시
  async function commitSite(token, mutate, message) {
    const be = backendFor(token, siteRepo);
    for (let i = 0; i < 6; i++) {
      const parent = await be.head();
      const get = async path => unjson((await be.get(path, parent))?.bytes);
      const files = await mutate(get);
      if (!files.length) return null;
      try {
        return await be.commit(files, message, parent);
      } catch (e) {
        if (!isConflict(e)) throw e;
      }
    }
    throw err('busy', '다른 사람과 동시에 올리느라 저장하지 못했어요. 잠시 뒤 다시 해 주세요.');
  }

  // ---------- 로그인 ----------

  function info() {
    if (!bundle) return null;
    return {
      pid: bundle.pid,
      name: bundle.name,
      role: bundle.role,
      roleName: roles.has(bundle.role) ? roles.name(bundle.role) : bundle.role,
      labels: bundle.labels || [],
      tiers: tiers(),
      canWrite: !!bundle.token,
      isAdmin: roles.has(bundle.role) && roles.isAdmin(bundle.role),
      bundle,
    };
  }

  function setBundle(b) {
    bundle = b;
    items.clear();
    for (const fn of changeFns) try { fn(info()); } catch (e) { console.error(e); }
  }

  // 아이디 + 코드(또는 비밀문장) 하나로 들어온다. 역할은 고르지 않는다 — 자리(slot)가 정한다.
  // → { role, roleName, labels, name, tiers, canWrite, isAdmin, bundle }
  async function login(identifier, secret, { remember = false, days = SESSION_DAYS } = {}) {
    const b = await provider.login(identifier, secret);
    if (b.site && b.site !== cfg.site) throw err('bad-login', BAD_LOGIN);
    setBundle(b);
    if (remember) await rememberDevice(days); else await forgetSession();
    return info();
  }

  async function logout() {
    setBundle(null);
    await forgetSession();
  }

  // 이 기기 기억 (공용 PC 에서는 켜지 말 것). 꾸러미를 꺼낼 수 없는 기기 열쇠로 암호화해 둔다
  async function rememberDevice(days = SESSION_DAYS) {
    if (!bundle) return;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const env = await C.encryptText(key, JSON.stringify(bundle));
    await kv.set('session', { key, env, days, until: Date.now() + days * 864e5 });
  }
  const forgetSession = () => kv.del('session');
  async function saveSessionIfAny() {
    const s = await kv.get('session');
    if (s && bundle) await rememberDevice(s.days || SESSION_DAYS);
  }

  // 기억해 둔 로그인으로 다시 들어오기 → info() | null
  async function resume() {
    if (bundle) return info();
    const s = await kv.get('session');
    if (!s || s.until < Date.now()) { await forgetSession(); return null; }
    try {
      const b = JSON.parse(await C.decryptText(s.key, s.env));
      setBundle(b);
      s.until = Date.now() + (s.days || SESSION_DAYS) * 864e5;
      await kv.set('session', s);
      return info();
    } catch {
      await forgetSession();
      return null;
    }
  }

  // 열쇠가 바뀐 뒤 새 꾸러미 받기. 막혔으면 로그아웃하고 AccessError('revoked')
  async function refresh() {
    if (!bundle) throw err('locked', '먼저 로그인해 주세요.');
    const b = provider.refresh ? await provider.refresh(bundle) : null;
    if (!b) {
      await logout();
      throw err('revoked', '이 코드로는 더 이상 볼 수 없어요. 코드가 새로 발급되었거나 권한이 바뀌었을 수 있어요. 관리자에게 물어봐 주세요.');
    }
    setBundle(b);
    await saveSessionIfAny();
    return info();
  }

  function tiers() {
    if (!bundle) return ['public'];
    return roles.has(bundle.role) ? roles.closure(bundle.role) : ['public'];
  }
  const canSee = tier => tiers().includes(tier);

  function needKey(tier) {
    if (!roles.has(tier)) throw err('bad-role', `없는 등급이에요: ${tier}`);
    if (!canSee(tier)) throw err('no-access', `이 계정으로는 '${roles.name(tier)}' 내용을 볼 수 없어요.`);
  }

  // 목록이 내 열쇠보다 새 열쇠로 되어 있으면 꾸러미를 새로 받는다
  async function keyFor(tier, kvNeeded) {
    let k = bundle.keys?.[tier];
    if (!k || k.kv < kvNeeded) {
      await refresh();
      k = bundle.keys?.[tier];
      if (!k) throw err('no-access', `이 계정으로는 '${roles.name(tier)}' 내용을 볼 수 없어요.`);
      if (k.kv < kvNeeded) throw err('stale', '사이트가 방금 바뀌어서 아직 새 열쇠가 보이지 않아요. 1~2분 뒤 다시 열어 주세요.');
    }
    return k;
  }

  // ---------- 읽기 ----------

  async function openEntry(tier, id, e, k) {
    const fileOf = meta => (e.f ? { ...meta, repo: e.f.repo, path: e.f.path, stored: e.f.size } : null); // size = 원래 크기, stored = 올린 암호문 크기
    if (tier === 'public') return { id, tier, data: e.d ?? null, file: fileOf(e.m || {}), at: e.at, deletedAt: e.del || null };
    if (e.kv !== k.kv) throw err('stale', '열쇠 판이 맞지 않아요.');
    const itemRaw = await unwrapItem(k.k, tier, id, e.k);
    const ik = await C.importDEK(itemRaw);
    const data = e.r ? JSON.parse(await C.decryptText(ik, e.r, `rec:${id}`)) : null;
    const meta = e.m ? JSON.parse(await C.decryptText(ik, e.m, `meta:${id}`)) : null;
    items.set(id, { tier, entry: e, itemRaw, meta });
    return { id, tier, data, file: fileOf(meta || {}), at: e.at, deletedAt: e.del || null };
  }

  // 등급 하나의 글·파일 목록 (복호화한 것). deleted: false(기본) | true(휴지통만) | 'all'
  async function list(tier, { deleted = false } = {}) {
    if (tier !== 'public') { if (!bundle) throw err('locked', '먼저 로그인해 주세요.'); needKey(tier); }
    const idx = await readSite(indexPath(tier));
    if (!idx) return [];
    const k = tier === 'public' ? null : await keyFor(tier, idx.kv);
    const out = [];
    for (const [id, e] of Object.entries(idx.items || {})) {
      if (deleted === false && e.del) continue;
      if (deleted === true && !e.del) continue;
      if (tier === 'public') items.set(id, { tier, entry: e, meta: e.m || null });
      out.push(await openEntry(tier, id, e, k));
    }
    return out.sort((a, b) => (a.at || '').localeCompare(b.at || ''));
  }

  // 볼 수 있는 모든 등급
  async function listAll(o) {
    const out = [];
    for (const t of tiers()) out.push(...(await list(t, o)));
    return out;
  }

  // 파일 내려받아 풀기 → Blob
  async function file(id, tier) {
    let it = items.get(id);
    if (!it && tier) { await list(tier, { deleted: 'all' }); it = items.get(id); }
    if (!it && !tier) { for (const t of tiers()) { await list(t, { deleted: 'all' }); if ((it = items.get(id))) break; } }
    if (!it?.entry?.f) throw err('not-found', '파일을 찾을 수 없어요.');
    const f = it.entry.f;
    let bytes;
    try {
      bytes = f.repo === cfg.repo ? await reader.site(f.path) : await reader.file(f.repo, f.path);
    } catch (e) {
      if (e.status === 0) throw err('offline', '인터넷에 연결되어 있지 않아요.');
      throw e;
    }
    if (!bytes) throw err('file-missing', '파일이 아직 올라오지 않았어요. 1~2분 뒤 다시 해 주세요.');
    if (it.tier !== 'public') bytes = await C.decryptBytes(await C.importDEK(it.itemRaw), bytes, `file:${id}`);
    return new Blob([bytes], { type: it.meta?.type || '' });
  }

  // ---------- 쓰기 (쓰기 역할: 꾸러미에 토큰이 있음) ----------

  function needWrite(tier) {
    if (!bundle) throw err('locked', '먼저 로그인해 주세요.');
    if (!bundle.token) throw err('read-only', '이 계정은 보기만 할 수 있어요. 올리기는 임원·관리자만 할 수 있어요.');
    needKey(tier);
  }

  // 목록 파일 하나 고치기. 내 열쇠가 목록보다 예전 것이면(누가 막혀서 열쇠가 바뀜) 꾸러미를 새로 받고 다시
  async function editIndex(tier, fn, message, extra = async () => []) {
    return commitSite(bundle.token, async get => {
      const idx = (await get(indexPath(tier))) || { v: 1, tier, kv: tier === 'public' ? 0 : bundle.keys[tier].kv, items: {} };
      let k = null;
      if (tier !== 'public') {
        k = await keyFor(tier, idx.kv);
        if (k.kv > idx.kv) throw err('stale', '열쇠를 바꾸는 중이에요. 잠시 뒤 다시 해 주세요.');
      }
      const changed = await fn(idx, k);
      if (changed === false) return [];
      return [{ path: indexPath(tier), bytes: pretty(idx) }, ...(await extra(get))];
    }, message);
  }

  async function sealEntry(tier, id, k, { data, meta, f }) {
    if (tier === 'public') return { d: data ?? null, ...(meta ? { m: meta } : {}), ...(f ? { f } : {}), at: nowISO() };
    const itemRaw = rand32(); // 고칠 때마다 새 항목 열쇠 (막힌 사람이 예전 항목 열쇠로 새 내용을 못 보게)
    const ik = await C.importDEK(itemRaw);
    return {
      kv: k.kv,
      k: await wrapItem(k.k, tier, id, itemRaw),
      ...(data !== undefined ? { r: await C.encryptText(ik, JSON.stringify(data), `rec:${id}`) } : {}),
      ...(meta ? { m: await C.encryptText(ik, JSON.stringify(meta), `meta:${id}`) } : {}),
      ...(f ? { f } : {}),
      at: nowISO(),
      itemRaw,
    };
  }

  // 글(기록) 올리기 → { id, tier }. 같은 id 면 바꿔 쓴다 (예전 것은 git 이력에 남음)
  async function publish({ id, tier, data }) {
    needWrite(tier);
    id = id ? String(id) : uid();
    if (!ID_RE.test(id)) throw err('bad-id', `id 가 올바르지 않아요: ${id}`);
    await editIndex(tier, async (idx, k) => {
      if (idx.items[id]?.f) throw err('bad-id', '파일 항목은 publish 로 바꿀 수 없어요 (새 파일로 올려 주세요).');
      const { itemRaw, ...e } = await sealEntry(tier, id, k, { data });
      idx.items[id] = e;
    }, `올리기: ${tier}`);
    return { id, tier };
  }

  // 여러 글을 여러 등급에 걸쳐 커밋 하나로 → [{ id, tier, done }]. 가져오기(seed)·게시처럼 한 번에 많이 올릴 때.
  //   items: [{ id?, tier, data }]                 올리기 (publish 와 같음, 고칠 때마다 새 항목 열쇠)
  //          [{ id, tier, trash: true }]           휴지통 (unpublish 와 같음. 없거나 이미 휴지통이면 done:false)
  //          [{ id, tier, restore: true }]         되살리기 (휴지통에 없으면 done:false)
  // 등급마다 목록 파일 하나만 다시 쓴다 (GitHub trees API). 누가 먼저 올렸으면(409) 다시 읽어 합친 뒤 다시.
  // API 요청: 브랜치 끝 1 + 등급 목록 읽기 T + 커밋(1 + 바뀐 목록 T + 3) — 항목 수와 상관없다
  async function publishMany(list, { message } = {}) {
    if (!Array.isArray(list)) throw err('bad-items', 'publishMany 에는 목록(배열)을 주세요.');
    const ops = [];
    const seen = new Set();
    for (const it of list) {
      const tier = it?.tier;
      needWrite(tier);
      const kind = it.trash ? 'trash' : it.restore ? 'restore' : 'put';
      const id = it.id != null && it.id !== '' ? String(it.id) : kind === 'put' ? uid() : '';
      if (!ID_RE.test(id)) throw err('bad-id', `id 가 올바르지 않아요: ${id}`);
      if (seen.has(`${tier}/${id}`)) throw err('bad-id', `같은 항목이 두 번 있어요: ${tier}/${id}`);
      seen.add(`${tier}/${id}`);
      ops.push({ id, tier, kind, data: it.data });
    }
    if (!ops.length) return [];
    const tierList = [...new Set(ops.map(o => o.tier))];
    let done;
    await commitSite(bundle.token, async get => {
      done = new Map();
      const files = [];
      for (const tier of tierList) {
        const idx = (await get(indexPath(tier))) || { v: 1, tier, kv: tier === 'public' ? 0 : bundle.keys[tier].kv, items: {} };
        let k = null;
        if (tier !== 'public') {
          k = await keyFor(tier, idx.kv);
          if (k.kv > idx.kv) throw err('stale', '열쇠를 바꾸는 중이에요. 잠시 뒤 다시 해 주세요.');
        }
        let changed = false;
        for (const o of ops.filter(x => x.tier === tier)) {
          const cur = idx.items[o.id];
          let ok = false;
          if (o.kind === 'put') {
            if (cur?.f) throw err('bad-id', `파일 항목은 publishMany 로 바꿀 수 없어요: ${o.id}`);
            const { itemRaw, ...e } = await sealEntry(tier, o.id, k, { data: o.data });
            idx.items[o.id] = e;
            ok = true;
          } else if (o.kind === 'trash' && cur && !cur.del) { cur.del = nowISO(); ok = true; }
          else if (o.kind === 'restore' && cur?.del) { delete cur.del; ok = true; }
          done.set(`${tier}/${o.id}`, ok);
          changed ||= ok;
        }
        if (changed) files.push({ path: indexPath(tier), bytes: pretty(idx) });
      }
      return files;
    }, message || `올리기 ${ops.length}개: ${tierList.join(', ')}`);
    return ops.map(o => ({ id: o.id, tier: o.tier, done: !!done?.get(`${o.tier}/${o.id}`), ...(o.kind !== 'put' ? { [o.kind]: true } : {}) }));
  }

  // 파일 하나 올리기 → { id, tier, repo, path, size }. 파일 저장소가 limit 를 넘게 되면 다음 저장소(-files-N+1)를 만든다
  async function publishFile(blob, { tier, name, type, id, data, resize = false, maxDim = 1600, quality = 0.85 } = {}) {
    needWrite(tier);
    id = id ? String(id) : uid();
    if (!ID_RE.test(id)) throw err('bad-id', `id 가 올바르지 않아요: ${id}`);
    let src = blob;
    let w = 0;
    let h = 0;
    if (resize && isRaster(blob.type)) ({ blob: src, w, h } = await prepareImage(blob, { maxDim, quality }));
    const plain = new Uint8Array(await src.arrayBuffer());
    const meta = { name: name || blob.name || '', type: type || src.type || '', size: plain.length, ...(w ? { w, h } : {}) };
    // 항목 열쇠는 여기서 정한다 (파일을 먼저 올리고 목록은 나중에 — 파일은 다시 암호화하지 않는다)
    const itemRaw = rand32();
    const bytes = tier === 'public' ? plain : await C.encryptBytes(await C.importDEK(itemRaw), plain, `file:${id}`);
    if (bytes.length > MAX_ACCESS_FILE) throw err('too-big', `파일이 너무 커요 (${Math.round(bytes.length / 1e6)}MB). ${MAX_ACCESS_FILE / 1e6}MB 이하만 올릴 수 있어요. 동영상은 유튜브 링크로 올려 주세요.`);
    const path = fileCfg.repos ? `f/${id}.bin` : `access/f/${id}.bin`;
    let repo = cfg.repo;
    if (fileCfg.repos) {
      repo = await pickFileRepo(bytes.length);
      const be = backendFor(bundle.token, { owner: cfg.owner, repo, branch: cfg.branch });
      try {
        await be.put(path, bytes, null, `파일 ${id}`);
      } catch (e) {
        if (!isConflict(e)) throw e; // 이미 있음 = 지난번에 올리고 답을 못 받음
      }
    }
    const f = { repo, path, size: bytes.length };
    await editIndex(tier, async (idx, k) => {
      let e;
      if (tier === 'public') e = { d: data ?? null, m: meta, f, at: nowISO() };
      else {
        const ik = await C.importDEK(itemRaw);
        e = {
          kv: k.kv,
          k: await wrapItem(k.k, tier, id, itemRaw),
          ...(data !== undefined ? { r: await C.encryptText(ik, JSON.stringify(data), `rec:${id}`) } : {}),
          m: await C.encryptText(ik, JSON.stringify(meta), `meta:${id}`),
          f,
          at: nowISO(),
        };
      }
      idx.items[id] = e;
    }, `파일 올리기: ${tier}`, async get => {
      if (!fileCfg.repos) return [{ path, bytes }];
      const man = (await get(MANIFEST)) || { v: 1, repos: [] };
      let r = man.repos.find(x => x.name === repo);
      if (!r) man.repos.push((r = { name: repo, bytes: 0, at: nowISO() }));
      r.bytes += bytes.length;
      return [{ path: MANIFEST, bytes: pretty(man) }];
    });
    return { id, tier, repo, path, size: bytes.length };
  }

  // 지금 쓸 파일 저장소. 넘치면 다음 것을 만든다
  async function pickFileRepo(size) {
    const man = (await readSite(MANIFEST)) || { v: 1, repos: [] };
    const last = man.repos[man.repos.length - 1];
    if (last && last.bytes + size <= fileCfg.limit) return last.name;
    if (last && !last.bytes) return last.name; // 빈 저장소에는 큰 파일 하나라도 넣는다
    const name = `${fileCfg.prefix}-${man.repos.length + 1}`;
    const be = backendFor(bundle.token, { owner: cfg.owner, repo: name, branch: cfg.branch });
    await be.createRepo(name, { org: fileCfg.org, description: `${cfg.title} 파일 (암호화됨)` });
    return name;
  }

  // 휴지통 (목록에서 빠짐, 되살릴 수 있음. 파일·암호문은 지우지 않는다)
  async function unpublish(id, tier) {
    needWrite(tier);
    await editIndex(tier, async idx => {
      if (!idx.items[id]) throw err('not-found', '항목을 찾을 수 없어요.');
      if (idx.items[id].del) return false;
      idx.items[id].del = nowISO();
    }, `휴지통: ${tier}`);
  }
  async function restore(id, tier) {
    needWrite(tier);
    await editIndex(tier, async idx => {
      if (!idx.items[id]) throw err('not-found', '항목을 찾을 수 없어요.');
      if (!idx.items[id].del) return false;
      delete idx.items[id].del;
    }, `되살리기: ${tier}`);
  }

  // ---------- 내 코드를 내 비밀문장으로 바꾸기 ----------
  // 쓰기 역할은 바로 올린다 → { done: true }
  // 읽기 역할은 올릴 수 없으니 관리자에게 보낼 글자를 돌려준다 → { request }. 관리자가 applySecretChange(request) 하면 바뀐다.
  // (그 글자에는 비밀문장이 들어 있지 않다. 새 자리와, 내 개인 열쇠로 만든 확인 값만)
  async function changeSecret(oldSecret, newPassphrase) {
    if (!bundle?.session?.lid) throw err('locked', '먼저 로그인해 주세요.');
    checkPassphrase(newPassphrase, { name: bundle.name });
    const { lid, pk } = bundle.session;
    const ring = await fetchKeyring();
    const cur = ring?.slots?.[lid];
    if (!cur || !(await openSlot(cur, lid, oldSecret))) throw err('bad-login', '지금 쓰는 코드(또는 비밀문장)가 맞지 않아요.');
    const pkRaw = C.unb64(pk);
    const slot = { ...(await makeSlot({ secret: newPassphrase, kind: 'p', pkRaw, lid, iter })), b: cur.b };
    if (bundle.token) {
      await commitSite(bundle.token, async get => {
        const r = await get(KEYRING);
        if (!r?.slots?.[lid] || r.slots[lid].s !== cur.s) throw err('busy', '그사이 코드가 바뀌었어요. 다시 로그인해 주세요.');
        r.slots[lid] = { ...slot, b: r.slots[lid].b };
        return [{ path: KEYRING, bytes: pretty(r) }];
      }, '비밀문장 바꾸기');
      return { done: true };
    }
    const proof = await C.encryptText(await pkKey(pkRaw), JSON.stringify({ lid, pid: bundle.pid, s: slot.s, at: slot.at }), `change:${lid}`);
    return { request: `ACX1.${C.b64url(json({ pid: bundle.pid, lid, slot, proof }))}` };
  }

  // ===================================================================
  // 관리자 (명단은 비공개 데이터 저장소 = core vault 에, 관리자 열쇠 M 으로 한 번 더 잠가 둔다)
  // ===================================================================

  const SYS = 'accessSys';
  const PEOPLE = 'accessPeople';

  // 처음 한 번: core 가 열린 상태에서. 등급 열쇠·관리자 열쇠·첫 관리자 자리를 만들고 keyring.json·목록들을 올린다.
  // token = 공개 사이트 저장소에 쓰는 토큰(쓰기 역할 꾸러미에 들어감). → { code, recoveryCode, admin }
  async function setup(core, { token, name, identifier, code, passphrase } = {}) {
    if (!core?.status?.().open) throw err('vault-locked', '먼저 데이터 저장소(core)를 열어 주세요.');
    if (!token) throw err('need-token', '공개 사이트 저장소에 쓸 토큰이 필요해요.');
    if (!normIdentifier(identifier)) throw err('need-id', '관리자 아이디를 정해 주세요.');
    if (passphrase) checkPassphrase(passphrase, { identifier, name });
    if (await readSite(KEYRING, token)) throw err('already-setup', '이미 설정된 사이트예요. 관리자 아이디·코드로 로그인하세요.');
    if (core.collection(SYS).get('state')) throw err('already-setup', '데이터 저장소에 이미 명단이 있어요.');
    const keys = {};
    for (const t of roles.keyed) keys[t] = [{ kv: 1, k: C.b64(rand32()), at: nowISO() }];
    const state = { v: 1, salt: C.b64(rand32()), keys, token };
    const M = rand32();
    const recoveryCode = C.newRecoveryCode();
    const a = adminHandle(core, M, 1);
    await a._saveState(state, await C.makeWrap(C.normCode(recoveryCode), C.RITER, M));
    const res = await a.addPerson({ name: name || '관리자', identifier, role: roles.adminId, code: passphrase ? undefined : code, passphrase });
    await forgetSession();
    await a._adopt(res.person.id); // 관리자로 로그인된 상태
    return { code: passphrase ? null : res.code, recoveryCode, admin: a };
  }

  // 관리자로 로그인한 뒤: 데이터 저장소를 열고(같은 로그인으로) 명단 관리 손잡이를 준다
  async function openAdmin(core) {
    if (!bundle) throw err('locked', '먼저 로그인해 주세요.');
    if (!roles.isAdmin(bundle.role) || !bundle.am) throw err('not-admin', '관리자만 할 수 있어요.');
    if (!core.status().open) {
      if (!bundle.vault) throw err('vault-locked', '데이터 저장소를 열 열쇠가 꾸러미에 없어요.');
      await core.openWithKey(bundle.vault);
    }
    let rec = core.collection(SYS).get('state');
    if (!rec) { await core.sync?.(); rec = core.collection(SYS).get('state'); }
    if (!rec) throw err('not-setup', '데이터 저장소에 명단이 없어요. (다른 기기에서 아직 올리지 않았다면 그 기기를 인터넷에 연결해 주세요)');
    if (rec.mv !== bundle.am.mv) await refresh();
    if (rec.mv !== bundle.am.mv) throw err('stale', '관리자 열쇠가 맞지 않아요. 데이터 저장소를 동기화한 뒤 다시 해 주세요.');
    return adminHandle(core, C.unb64(bundle.am.k), rec.mv);
  }

  // 관리자 코드를 잃었을 때: core 를 사이트 비밀번호로 연 뒤, 명단 복구 코드로 → admin (그다음 admin.resetCode(내 id))
  async function recoverAdmin(core, recoveryCode) {
    if (!core?.status?.().open) throw err('vault-locked', '먼저 데이터 저장소(core)를 사이트 비밀번호로 열어 주세요.');
    const rec = core.collection(SYS).get('state');
    if (!rec?.rc) throw err('not-setup', '데이터 저장소에 명단이 없어요.');
    const M = await C.openWrap(C.normCode(recoveryCode), rec.rc);
    if (!M) throw err('bad-code', '명단 복구 코드가 맞지 않아요.');
    return adminHandle(core, M.raw, rec.mv);
  }

  function adminHandle(core, Mraw, mv) {
    const sys = core.collection(SYS);
    const peo = core.collection(PEOPLE);
    let M = Mraw;
    const mKey = () => C.importDEK(M);

    async function loadState() {
      const rec = sys.get('state');
      if (!rec) throw err('not-setup', '명단이 없어요.');
      if (rec.mv !== mv) throw err('stale', '다른 기기에서 관리자 열쇠가 바뀌었어요. 다시 로그인해 주세요.');
      return JSON.parse(await C.decryptText(await mKey(), rec.sealed, 'access-state'));
    }
    async function saveState(state, rc) {
      const prev = sys.get('state');
      await sys.put({ id: 'state', mv, rc: rc || prev.rc, sealed: await C.encryptText(await mKey(), JSON.stringify(state), 'access-state') });
    }
    async function loadPeople() {
      const out = [];
      const key = await mKey();
      for (const r of peo.list({ deleted: 'all' })) out.push(JSON.parse(await C.decryptText(key, r.sealed, `person:${r.id}`)));
      return out;
    }
    async function savePerson(p) {
      await peo.put({ id: p.id, sealed: await C.encryptText(await mKey(), JSON.stringify(p), `person:${p.id}`) });
    }
    // 여러 사람을 한 번에 (core 의 조각마다 한 번만 저장 → 다음 동기화 때 조각 수만큼만 올라간다)
    async function savePeople(list) {
      if (!list.length) return;
      const key = await mKey();
      const recs = [];
      for (const p of list) recs.push({ id: p.id, sealed: await C.encryptText(key, JSON.stringify(p), `person:${p.id}`) });
      await peo.putMany(recs);
    }
    const coreKey = () => (core.status().open && core.vaultKey ? core.vaultKey() : null);

    function buildBundle(p, state) {
      const b = { v: 1, site: cfg.site, pid: p.id, name: p.name, role: p.role, labels: p.labels || [], keys: {} };
      for (const t of roles.tiersOf(p.role)) { const last = state.keys[t].at(-1); b.keys[t] = { kv: last.kv, k: last.k }; }
      if (roles.canWrite(p.role)) b.token = state.token;
      if (roles.isAdmin(p.role)) {
        b.am = { mv, k: C.b64(M) };
        const ck = coreKey() || state.vault;
        if (ck) b.vault = ck;
      }
      return b;
    }

    // 명단(비공개)에 맞춰 keyring.json 과 등급 목록들을 커밋 하나로 맞춘다
    async function reconcile(message) {
      const state = await loadState();
      const people = await loadPeople();
      const ck = coreKey();
      if (ck && !same(ck, state.vault)) { state.vault = ck; await saveState(state); }
      await commitSite(state.token, async get => {
        const files = [];
        const ring0 = await get(KEYRING);
        const ring = ring0 ? structuredClone(ring0) : { v: 1, site: cfg.site, salt: state.salt, kdf: 'PBKDF2-SHA256', slots: {} };
        const slots = {};
        for (const p of people.filter(x => x.status === 'active').sort((a, b) => (a.lid < b.lid ? -1 : 1))) {
          const cur = ring.slots[p.lid];
          const base = !cur || (p.slot && p.slot.at > cur.at) ? p.slot : cur;
          const want = buildBundle(p, state);
          const pk = C.unb64(p.pk);
          let ok = false;
          if (base.b) { try { ok = same(await openBundle(pk, p.lid, base.b), want); } catch {} }
          slots[p.lid] = { ...base, b: ok ? base.b : await sealBundle(pk, p.lid, want) };
        }
        ring.slots = slots;
        if (!ring0 || !same(ring0, ring)) files.push({ path: KEYRING, bytes: pretty(ring) });
        for (const t of roles.keyed) {
          const cur = state.keys[t].at(-1);
          const idx0 = await get(indexPath(t));
          const idx = idx0 ? structuredClone(idx0) : { v: 1, tier: t, kv: cur.kv, items: {} };
          let changed = !idx0;
          for (const [id, e] of Object.entries(idx.items)) {
            if (e.kv === cur.kv) continue;
            const old = state.keys[t].find(x => x.kv === e.kv);
            if (!old) throw err('lost-key', `${roles.name(t)} 목록의 예전 열쇠(판 ${e.kv})가 없어요.`);
            e.k = await wrapItem(cur.k, t, id, await unwrapItem(old.k, t, id, e.k));
            e.kv = cur.kv;
            changed = true;
          }
          if (idx.kv !== cur.kv) { idx.kv = cur.kv; changed = true; }
          if (changed) files.push({ path: indexPath(t), bytes: pretty(idx) });
        }
        return files;
      }, message);
      // 나 자신의 꾸러미도 새것으로 (막 올린 것은 공개 사이트에 1~2분 뒤에 보이므로 여기서 바로 바꾼다)
      if (bundle?.pid) await adopt(bundle.pid, state, people);
    }

    async function adopt(pid, state, people) {
      state ||= await loadState();
      people ||= await loadPeople();
      const me = people.find(p => p.id === pid && p.status === 'active');
      if (!me) return null;
      setBundle({ ...buildBundle(me, state), session: { provider: 'local', lid: me.lid, pk: me.pk } });
      await saveSessionIfAny();
      return info();
    }

    function view(p) {
      return {
        id: p.id,
        name: p.name,
        identifier: p.identifier,
        role: p.role,
        roleName: roles.has(p.role) ? roles.name(p.role) : p.role,
        roleLabel: roles.display(p.role, p.labels || []),
        labels: [...(p.labels || [])],
        status: p.status, // active | revoked
        issuedAt: p.issuedAt,
        revokedAt: p.revokedAt || null,
        secret: p.slot?.t === 'p' || p.secret === 'passphrase' ? 'passphrase' : 'code',
        canWrite: roles.has(p.role) && roles.canWrite(p.role),
      };
    }
    async function findPerson(pid) {
      const p = (await loadPeople()).find(x => x.id === pid);
      if (!p) throw err('not-found', '그런 사람이 명단에 없어요.');
      return p;
    }
    function rotate(state, tiersToRotate) {
      for (const t of new Set(tiersToRotate)) {
        const last = state.keys[t].at(-1);
        state.keys[t].push({ kv: last.kv + 1, k: C.b64(rand32()), at: nowISO() });
      }
    }
    // 관리자 열쇠 M 바꾸기 (관리자를 막을 때). 명단을 새 M 으로 다시 잠그고 새 복구 코드를 돌려준다
    async function rotateM(state, people) {
      M = rand32();
      mv += 1;
      const recoveryCode = C.newRecoveryCode();
      await saveState(state, await C.makeWrap(C.normCode(recoveryCode), C.RITER, M));
      for (const p of people) await savePerson(p);
      return recoveryCode;
    }
    function checkLabels(role, labels = []) {
      const allowed = roles.labelsOf(role);
      for (const l of labels) if (!allowed.includes(l)) throw err('bad-label', `'${roles.name(role)}' 에는 '${l}' 직분이 없어요.`);
      return [...labels];
    }
    // 코드·비밀문장 고르기 (확인만, 느린 일 없음). 약하면 AccessError
    function pickSecret(p, { code, passphrase, acceptWeak }) {
      if (passphrase) { checkPassphrase(passphrase, { identifier: p.identifier, name: p.name }); return { secret: passphrase, kind: 'p', bits: null }; }
      if (code != null) {
        const bits = codeBits(normAccessCode(code));
        if (bits < MIN_CODE_BITS && !acceptWeak) throw err('weak-code', `이 번호는 너무 쉽게 맞힐 수 있어요 (약 ${bits}비트, ${MIN_CODE_BITS}비트 이상 필요). 더 긴 번호를 쓰거나 자동으로 만든 코드를 쓰세요.`);
        return { secret: code, kind: 'c', bits };
      }
      return { secret: newAccessCode(), kind: 'c', bits: ACCESS_CODE_BITS };
    }
    // 자리 만들기 (PBKDF2 60만 회 — 한 사람에 0.1~0.5초)
    async function sealSlot(p, { secret, kind, bits }) {
      p.pk = C.b64(rand32()); // 코드를 새로 줄 때마다 개인 열쇠도 새로 (예전 코드가 새어도 새 꾸러미는 못 열게)
      p.slot = await makeSlot({ secret, kind, pkRaw: C.unb64(p.pk), lid: p.lid, iter });
      p.secret = kind === 'p' ? 'passphrase' : 'code';
      return { code: kind === 'c' ? secret : null, bits, weak: bits != null && bits < MIN_CODE_BITS };
    }
    const newSlotFor = (p, o) => sealSlot(p, pickSecret(p, o));
    // 새 사람 기록 (확인만). taken = 이미 쓰는 자리(lid)들 — 같은 묶음 안의 겹침도 잡는다
    async function newPerson({ name, identifier, role, labels = [] }, state, taken) {
      roles.get(role);
      if (role === 'public') throw err('bad-role', '공개 등급은 로그인이 필요 없어요.');
      if (!String(name ?? '').trim()) throw err('need-name', '이름을 넣어 주세요.');
      if (!normIdentifier(identifier)) throw err('need-id', '아이디를 넣어 주세요.');
      const lid = await lookupId(state.salt, identifier);
      if (taken.has(lid)) throw err('duplicate', '같은 아이디를 쓰는 사람이 이미 있어요. 다른 아이디(예: 이름+숫자, 전화번호)를 정해 주세요.');
      return { id: uid(), name: String(name).trim().slice(0, 60), identifier: String(identifier).trim(), lid, role, labels: checkLabels(role, labels), status: 'active', issuedAt: nowISO(), revokedAt: null };
    }

    // 여러 사람 추가 — 공개 저장소 커밋 하나 (+ 데이터 저장소는 다음 동기화 때 조각 수만큼, 사람 수와 상관없음)
    async function addPeople(list, { acceptWeak = false, atomic = false, concurrency = 4, onProgress = () => {} } = {}) {
      if (!Array.isArray(list)) throw err('bad-items', 'addPeople 에는 목록(배열)을 주세요.');
      const state = await loadState();
      const taken = new Set((await loadPeople()).filter(p => p.status === 'active').map(p => p.lid));
      const out = new Array(list.length);
      const todo = [];
      for (const [i, row] of list.entries()) {
        try {
          const p = await newPerson(row || {}, state, taken);
          const sec = pickSecret(p, { code: row.code, passphrase: row.passphrase, acceptWeak: row.acceptWeak ?? acceptWeak });
          taken.add(p.lid);
          todo.push({ i, p, sec });
        } catch (e) {
          if (atomic || !(e instanceof AccessError)) throw e;
          out[i] = { error: { code: e.code, message: e.message }, input: row };
        }
      }
      let n = 0;
      onProgress(0, todo.length);
      await pool(todo, Math.max(1, concurrency), async t => { t.r = await sealSlot(t.p, t.sec); onProgress(++n, todo.length); });
      if (todo.length) {
        await savePeople(todo.map(t => t.p));
        await reconcile(todo.length === 1 ? '사람 추가' : `사람 추가 ${todo.length}명`);
      }
      for (const { i, p, r } of todo) out[i] = { person: view(p), code: r.code, invitation: invite(p, r.code), bits: r.bits, weak: r.weak };
      return out;
    }

    // 여러 사람 막기 — 등급 열쇠는 한 번만 바꾸고 공개 저장소 커밋 하나
    async function revokeMany(pids, { newToken } = {}) {
      const state = await loadState();
      const people = await loadPeople();
      const list = [];
      for (const pid of new Set(pids || [])) {
        const p = people.find(x => x.id === pid);
        if (!p) throw err('not-found', '그런 사람이 명단에 없어요.');
        if (bundle?.pid === pid) throw err('self', '나 자신은 막을 수 없어요.');
        list.push(p);
      }
      const act = list.filter(p => p.status === 'active');
      if (!act.length) return { people: list.map(view), rotated: [], tokenExposed: false, recoveryCode: null };
      const at = nowISO();
      for (const p of act) { p.status = 'revoked'; p.revokedAt = at; }
      const rotated = roles.keyed.filter(t => act.some(p => roles.tiersOf(p.role).includes(t)));
      rotate(state, rotated);
      const writer = act.some(p => roles.canWrite(p.role));
      if (writer && newToken) state.token = newToken;
      let recoveryCode = null;
      if (act.some(p => roles.isAdmin(p.role))) recoveryCode = await rotateM(state, people);
      else { await saveState(state); await savePeople(act); }
      await reconcile(act.length === 1 ? '권한 회수(막기)' : `권한 회수(막기) ${act.length}명`);
      return { people: list.map(view), rotated, tokenExposed: writer && !newToken, recoveryCode };
    }
    const invite = (p, code) => (code ? invitationText({ title: cfg.title, siteUrl: cfg.siteUrl, name: p.name, identifier: p.identifier, code, roleLabel: roles.display(p.role, p.labels) }) : null);

    return {
      _saveState: saveState,
      _adopt: pid => adopt(pid),
      roles,
      // 명단 (지운 사람 없음. 막은 사람은 status 'revoked')
      async people() {
        return (await loadPeople()).map(view).sort((a, b) => (a.issuedAt || '').localeCompare(b.issuedAt || ''));
      },
      // 사람 추가 → { person, code, invitation, bits, weak }. code 를 넣으면(가져온 인증번호) 그것을 쓴다
      async addPerson(row) {
        return (await addPeople([row], { atomic: true }))[0];
      },
      // 여러 사람 추가 (CSV 가져오기 등) → 넣은 순서대로 [{ person, code, invitation, bits, weak } | { error: { code, message }, input }]
      //   잘못된 줄(같은 아이디·약한 번호·없는 역할…)은 error 로 돌려주고 나머지는 넣는다. atomic: true 면 첫 오류에서 아무것도 넣지 않고 멈춘다.
      //   공개 저장소 커밋 하나. 시간은 거의 PBKDF2(사람마다 60만 회)라 onProgress(done, total) 로 보여 줄 것.
      addPeople,
      // 코드 새로 발급 (예전 코드는 바로 못 씀). 막은 사람에게 쓰면 다시 허용
      async resetCode(pid, { code, acceptWeak = false } = {}) {
        const p = await findPerson(pid);
        if (p.status !== 'active') { p.status = 'active'; p.revokedAt = null; }
        const r = await newSlotFor(p, { code, acceptWeak });
        await savePerson(p);
        await reconcile('코드 새로 발급');
        return { person: view(p), code: r.code, invitation: invite(p, r.code), bits: r.bits, weak: r.weak };
      },
      // 다시 허용 (막은 사람에게 새 코드)
      async reinstate(pid) { return this.resetCode(pid); },
      // 역할 바꾸기. 더는 못 보게 되는 등급의 열쇠는 바꾼다 (막기와 같음)
      async changeRole(pid, role, labels = []) {
        const state = await loadState();
        const people = await loadPeople();
        const p = people.find(x => x.id === pid);
        if (!p) throw err('not-found', '그런 사람이 명단에 없어요.');
        roles.get(role);
        if (role === 'public') throw err('bad-role', '공개 등급으로는 바꿀 수 없어요. 막기를 쓰세요.');
        if (bundle?.pid === pid && roles.isAdmin(p.role) && !roles.isAdmin(role)) throw err('self', '나 자신의 관리자 권한은 뺄 수 없어요. 다른 관리자가 해야 해요.');
        const lost = p.status === 'active' ? roles.lost(p.role, role) : [];
        const wasWriter = roles.canWrite(p.role) && !roles.canWrite(role);
        const wasAdmin = roles.isAdmin(p.role) && !roles.isAdmin(role);
        p.role = role;
        p.labels = checkLabels(role, labels);
        rotate(state, lost);
        let recoveryCode = null;
        if (wasAdmin) recoveryCode = await rotateM(state, people);
        else { await saveState(state); await savePerson(p); }
        await reconcile('역할 바꾸기');
        return { person: view(p), rotated: lost, tokenExposed: wasWriter && p.status === 'active', recoveryCode };
      },
      // 막기: 자리를 지우고, 그 사람이 가졌던 등급 열쇠를 모두 바꾸고, 남은 사람 꾸러미와 항목 열쇠를 다시 감싼다 — 커밋 하나.
      // 쓰기 역할이었다면 토큰을 그 사람이 알고 있으므로 newToken 을 주거나, 뒤에 setToken 으로 바꾸고 예전 토큰을 GitHub 에서 지울 것
      async revoke(pid, { newToken } = {}) {
        const { people: [person], ...r } = await revokeMany([pid], { newToken });
        return { person, ...r };
      },
      // 여러 사람 막기 (예: 계약이 끝난 고객 목록) → { people, rotated, tokenExposed, recoveryCode }. 열쇠는 등급마다 한 번만 바꾼다
      revokeMany,
      // 쓰기 토큰 바꾸기 (쓰기 역할 꾸러미를 모두 새 토큰으로)
      async setToken(newToken) {
        const state = await loadState();
        state.token = newToken;
        await saveState(state);
        await reconcile('쓰기 토큰 바꾸기');
      },
      // 읽기 역할이 보낸 비밀문장 바꾸기 요청 (changeSecret 의 request) 적용
      async applySecretChange(request) {
        const m = String(request || '').trim().match(/^ACX1\.([A-Za-z0-9_-]+)$/);
        if (!m) throw err('bad-request', '비밀문장 바꾸기 요청 글자가 아니에요. 받은 글자를 통째로 붙여 넣어 주세요.');
        let req;
        try { req = unjson(C.unb64url(m[1])); } catch { throw err('bad-request', '요청 글자가 잘렸어요.'); }
        const p = await findPerson(req.pid);
        if (p.status !== 'active' || p.lid !== req.lid) throw err('bad-request', '이 요청은 지금 명단과 맞지 않아요.');
        let proof;
        try { proof = JSON.parse(await C.decryptText(await pkKey(C.unb64(p.pk)), req.proof, `change:${p.lid}`)); } catch { throw err('bad-request', '이 요청은 그 사람이 만든 것이 아니거나, 그 뒤 코드가 새로 발급되었어요.'); }
        if (proof.s !== req.slot?.s || proof.lid !== p.lid || req.slot.t !== 'p') throw err('bad-request', '요청 내용이 맞지 않아요.');
        p.slot = { ...req.slot, b: null };
        p.secret = 'passphrase';
        await savePerson(p);
        await reconcile('비밀문장 바꾸기');
        return view(p);
      },
      // 새 명단 복구 코드 (예전 것은 바로 못 씀)
      async newRecoveryCode() {
        const state = await loadState();
        const recoveryCode = C.newRecoveryCode();
        await saveState(state, await C.makeWrap(C.normCode(recoveryCode), C.RITER, M));
        return recoveryCode;
      },
      // 명단·keyring·목록을 다시 맞추기 (지난번에 올리다 끊겼을 때)
      republish: () => reconcile('다시 맞추기'),
      invitation: (person, code) => invitationText({ title: cfg.title, siteUrl: cfg.siteUrl, name: person.name, identifier: person.identifier, code, roleLabel: person.roleLabel || roles.display(person.role, person.labels) }),
    };
  }

  return {
    config: cfg,
    roles,
    // 로그인 (아이디 + 코드 하나. 역할은 자리가 정한다)
    login,
    logout,
    resume,
    refresh,
    rememberDevice,
    forgetSession,
    me: info,
    tiers,
    canSee,
    onChange(fn) { changeFns.add(fn); return () => changeFns.delete(fn); },
    // 읽기
    list,
    listAll,
    file,
    async fileUrl(id, tier) { return URL.createObjectURL(await file(id, tier)); },
    keyring: fetchKeyring,
    // 쓰기
    publish,
    publishMany,
    publishFile,
    unpublish,
    restore,
    changeSecret,
    // 관리자
    setup,
    openAdmin,
    recoverAdmin,
    provider,
  };
}

// ===================================================================
// 안내문 (UI 키트와 관리자가 같이 쓴다)
// ===================================================================

export function invitationText({ title, siteUrl, name, identifier, code, roleLabel }) {
  return [
    `[${title}] ${name}님 접속 안내`,
    '',
    `${name}님, ${title} 사이트에서 ${roleLabel ? `${roleLabel} ` : ''}내용을 보실 수 있게 준비했어요.`,
    '',
    `■ 주소: ${siteUrl}`,
    `■ 아이디: ${identifier}`,
    `■ 접속 코드: ${code}`,
    '',
    '처음 화면에서 "로그인"을 누르고 아이디와 접속 코드를 넣으면 돼요. (대소문자·띄어쓰기·- 는 상관없어요)',
    '',
    '이 코드는 ' + name + '님 전용이에요. 다른 사람에게 보내지 말아 주세요.',
    '코드를 잃어버리거나 남이 봤다면 관리자에게 말해 주세요. 새 코드를 드리면 예전 코드는 그 자리에서 못 쓰게 돼요.',
    '원하시면 로그인한 뒤 나만 아는 비밀문장(10자 이상)으로 바꿀 수 있어요.',
  ].join('\n');
}
