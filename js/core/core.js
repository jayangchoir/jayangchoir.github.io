// 자양교회 어린이 합창단 — 관리자 데이터 암호화 저장·동기화 (core)
// (자양교회 유년부 사이트 jayangchild-site 의 js/core 를 복사해 합창단용으로 고친 것. 바뀐 점은 README.md 맨 아래)
//
// 화면 코드는 이 파일(또는 index.js 의 core)만 부른다. 자세한 사용법: js/core/README.md
//
// ── 데이터 저장소(비공개 jayangchoir/jayangchoir-data) 구조 ──
//   vault.json                 데이터 키(DEK)를 비밀번호·복구 코드로 감싼 값 + DEK로 암호화한 토큰. 그 밖에 비밀 정보 없음
//   data/<목록>/<nn>.enc        기록 묶음(조각). 기록 id의 해시로 조각이 정해진다 (목록마다 16개, media·giftLog 는 64개)
//                              내용 = AES-GCM({ v, recs: [기록…] }), AAD = 경로
//   files/<파일id>.bin          암호화한 사진·그림 ([iv 12바이트][암호문], AAD = 'file:<id>'). 한 번 올리면 바꾸지 않는다
//
// ── 기록 하나의 모양 ──
//   { id, …내용…, createdAt, createdBy, updatedAt, updatedBy, deletedAt, deletedBy, _conflicts? }
//   지우기는 deletedAt 을 채우는 것뿐(휴지통). 기록·파일을 정말로 없애는 함수는 없다.
//
// ── 이 기기(IndexedDB) ──
//   device      { owner, repo, branch, user, deviceId }
//   vault       vault.json 사본 (인터넷 없이도 비밀번호로 열 수 있게)   vaultSha
//   s:<경로>     { sha, dirty, cur, base }  조각의 암호문. cur = 이 기기의 지금 내용, base = 마지막으로 GitHub와 맞춘 내용(dirty일 때만)
//   fb:<파일id>  { enc, up }  암호화한 파일. up=false 면 아직 못 올린 것
//   session     비밀번호 없이 다시 열기 (켠 경우만). DEK·토큰을 이 기기 전용 키(꺼낼 수 없는 키)로 암호화
//
// ── 동기화 ──
//   put() 은 먼저 이 기기에 암호화해 저장하고(dirty), 1.5초 뒤 sync() 가 GitHub에 올린다.
//   sync(): 저장소 목록(tree) 한 번 → 바뀐 조각만 받아 기록마다 합치기(merge.js) → 고친 조각만 올리기.
//   올릴 때 다른 기기가 먼저 고쳤으면(409) 다시 받아 합친 뒤 올린다. 누구의 고친 것도 덮어쓰지 않는다.
//   못 올린 변경은 IndexedDB에 남아 있어서 탭을 닫거나 잠가도 다음에 열 때 올라간다.

import { KV } from './kv.js';
import * as C from './crypto.js';
import { GitHubBackend, GitHubAccount, isConflict } from './github.js';
import { mergeRecord, same, sameContent, META } from './merge.js';
import { prepareImage } from './image.js';

export const DEFAULT_REPO = { owner: 'jayangchoir', repo: 'jayangchoir-data', branch: 'main' };
export const COLLECTIONS = ['notices', 'events', 'songs', 'videos', 'albums', 'members', 'media', 'settings', 'files']; // 사이트가 쓰는 목록 (다른 이름도 된다)
const SHARD_COUNT = { media: 64, giftLog: 64 }; // 바꾸지 말 것 (바꾸면 기록이 다른 조각으로 간다)
const DEFAULT_SHARDS = 16;
export const MAX_FILE = 8e6; // 줄인 뒤 파일 하나 최대 8MB
export const MIN_PASSWORD = 8;
const COL_RE = /^[a-z][A-Za-z0-9]{0,39}$/;
const VAULT = 'vault.json';
const SESSION_DAYS = 30;

export class CoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const nowISO = () => new Date().toISOString();
export const uid = () => Date.now().toString(36) + Array.from(crypto.getRandomValues(new Uint8Array(8)), b => (b % 36).toString(36)).join('');
const clone = v => (v == null ? v : structuredClone(v));

function h32(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
export function shardPath(col, id) {
  const n = SHARD_COUNT[col] || DEFAULT_SHARDS;
  return `data/${col}/${(h32(String(id)) % n).toString(16).padStart(2, '0')}.enc`;
}
const colOfPath = p => p.split('/')[1];
const filePath = id => `files/${id}.bin`;
const toMap = recs => new Map(recs.map(r => [r.id, r]));

async function pool(list, n, fn) {
  const q = [...list];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => {
    while (q.length) await fn(q.shift());
  }));
}

export function createCore(opts = {}) {
  const kv = new KV(opts.dbName || 'jayangchoir-core');
  const backendFor = opts.backend || ((token, dev) => new GitHubBackend({ token, ...dev }));
  const accountFor = opts.account || (token => new GitHubAccount({ token, owner: DEFAULT_REPO.owner }));
  const autoSync = opts.autoSync !== false;
  const syncDelay = opts.syncDelay ?? 1500;
  const pollMs = opts.pollMs ?? 120000;

  const st = {
    device: null,
    vault: null,
    vaultSha: null,
    dek: null, // { raw, key }
    token: null,
    be: null,
    cols: new Map(), // 목록 → Map(id → 기록)
    shards: new Map(), // 경로 → { sha, base: Map, dirty, ver }
    fileQueue: new Set(),
    state: 'locked',
    error: '',
    errorCode: '',
    lastSync: null,
  };
  let epoch = 0; // 잠글 때마다 늘림 — 진행 중이던 동기화가 잠긴 뒤에 손대지 않게
  const changeFns = new Set();
  const statusFns = new Set();
  const urls = new Map();
  const pq = new Map(); // 경로 → 이 기기 저장 대기열 (순서대로 저장)

  const ready = (async () => {
    st.device = (await kv.get('device')) || null;
    st.vault = (await kv.get('vault')) || null;
    st.vaultSha = (await kv.get('vaultSha')) || null;
  })();

  // ---------- 상태 ----------

  const pendingCount = () => [...st.shards.values()].filter(s => s.dirty).length + st.fileQueue.size;

  function status() {
    return {
      state: st.state, // locked | saved | pending | syncing | offline | error
      connected: !!st.device,
      open: !!st.dek,
      user: st.device?.user || '',
      repo: st.device ? `${st.device.owner}/${st.device.repo}` : '',
      pending: st.dek ? pendingCount() : null,
      lastSync: st.lastSync,
      error: st.error,
      errorCode: st.errorCode, // bad-password | password-changed | token | unsaved | …
      memoryOnly: kv.useMem,
    };
  }

  function setState(s) {
    st.state = s;
    const snap = status();
    for (const fn of statusFns) try { fn(snap); } catch (e) { console.error(e); }
  }

  function emitChange(collections, source) {
    if (!collections.length) return;
    const ev = { collections, source };
    for (const fn of changeFns) try { fn(ev); } catch (e) { console.error(e); }
  }

  const userName = () => st.device?.user || `기기-${(st.device?.deviceId || '????').slice(-4)}`;

  function assertOpen() {
    if (!st.dek) throw new CoreError('locked', '잠겨 있어요. 비밀번호로 먼저 열어 주세요.');
  }

  function checkNewPassword(pw) {
    if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) throw new CoreError('weak-password', `비밀번호는 ${MIN_PASSWORD}자 이상으로 정해 주세요.`);
  }

  const repoOf = d => ({ owner: d.owner, repo: d.repo, branch: d.branch || 'main' });

  // ---------- 조각 암호화 / 이 기기에 저장 ----------

  const encShard = (path, recs) => C.encryptText(st.dek.key, JSON.stringify({ v: 1, recs }), path);
  const decShard = async (path, env) => JSON.parse(await C.decryptText(st.dek.key, env, path)).recs || [];
  const shardBytes = env => C.utf8(JSON.stringify({ v: 1, iv: env.iv, ct: env.ct }));
  const parseShard = bytes => JSON.parse(C.unutf8(bytes));

  function ensureCol(col) {
    if (!st.cols.has(col)) st.cols.set(col, new Map());
    return st.cols.get(col);
  }

  function shardOf(path) {
    if (!st.shards.has(path)) st.shards.set(path, { sha: null, base: new Map(), dirty: false, ver: 0 });
    return st.shards.get(path);
  }

  function recsOf(path) {
    const col = colOfPath(path);
    const out = [];
    for (const [id, r] of ensureCol(col)) if (shardPath(col, id) === path) out.push(r);
    return out.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  // 조각 하나를 이 기기에 저장. 같은 조각은 순서대로, 저장하는 그때의 최신 내용으로
  function persist(path) {
    const prev = pq.get(path) || Promise.resolve();
    const next = prev.then(async () => {
      const sh = st.shards.get(path);
      if (!sh || !st.dek) return;
      const cur = await encShard(path, recsOf(path));
      const base = sh.dirty && sh.base.size ? await encShard(`${path}#base`, [...sh.base.values()]) : null;
      await kv.set(`s:${path}`, { sha: sh.sha, dirty: sh.dirty, cur, base });
    });
    pq.set(path, next.catch(() => {}));
    return next;
  }
  const flushPersist = () => Promise.all([...pq.values()]);

  async function loadLocal() {
    st.cols = new Map();
    st.shards = new Map();
    st.fileQueue = new Set();
    for (const c of COLLECTIONS) ensureCol(c);
    for (const k of await kv.keys()) {
      if (typeof k !== 'string') continue;
      if (k.startsWith('s:')) {
        const path = k.slice(2);
        const rec = await kv.get(k);
        const cur = await decShard(path, rec.cur);
        const base = rec.dirty ? (rec.base ? await decShard(`${path}#base`, rec.base) : []) : cur;
        st.shards.set(path, { sha: rec.sha || null, base: toMap(base), dirty: !!rec.dirty, ver: 0 });
        const cm = ensureCol(colOfPath(path));
        for (const r of cur) {
          const old = cm.get(r.id);
          if (!old || (r.updatedAt || '') > (old.updatedAt || '')) cm.set(r.id, r);
        }
      } else if (k.startsWith('fb:')) {
        const f = await kv.get(k);
        if (f && !f.up) st.fileQueue.add(k.slice(3));
      }
    }
  }

  // 이 기기에 아직 못 올린 것이 있는가 (잠겨 있어도 알 수 있다)
  async function hasUnsaved() {
    if (st.dek) await flushPersist();
    for (const k of await kv.keys()) {
      if (typeof k !== 'string') continue;
      if (k.startsWith('s:') && (await kv.get(k))?.dirty) return true;
      if (k.startsWith('fb:') && !(await kv.get(k))?.up) return true;
    }
    return false;
  }

  // ---------- 열기 / 잠그기 ----------

  async function enter(dek, token) {
    epoch++;
    st.dek = dek;
    st.token = token;
    st.be = backendFor(token, repoOf(st.device));
    st.error = '';
    st.errorCode = '';
    await loadLocal();
    setState(pendingCount() ? 'pending' : 'saved');
    startTimers();
    try { await navigator.storage?.persist?.(); } catch {}
    if (autoSync) sync();
  }

  async function open(password, { remember = false, days = SESSION_DAYS } = {}) {
    await ready;
    if (!st.device || !st.vault) throw new CoreError('not-connected', '이 기기는 아직 연결되지 않았어요. 연결된 기기의 QR을 찍어 주세요.');
    if (st.dek) return status();
    const dek = await C.openWrap(password, st.vault.pw);
    if (!dek) {
      st.errorCode = 'bad-password';
      throw new CoreError('bad-password', '비밀번호가 맞지 않아요. (최근에 비밀번호가 바뀌었다면, 예전 비밀번호로 한 번 열면 새 비밀번호 정보를 받아와요.)');
    }
    const token = await C.decryptText(dek.key, st.vault.tok, 'tok');
    await enter(dek, token);
    if (remember) await rememberDevice(days);
    return status();
  }

  async function lock() {
    epoch++;
    stopTimers();
    if (syncP) { try { await syncP; } catch {} }
    await flushPersist();
    for (const u of urls.values()) URL.revokeObjectURL(u);
    urls.clear();
    st.dek = null;
    st.token = null;
    st.be = null;
    st.cols = new Map();
    st.shards = new Map();
    st.fileQueue = new Set();
    setState('locked');
  }

  // 비밀번호 없이 다시 열기 (이 기기만, 30일. 쓸 때마다 연장). 공용 PC에서는 켜지 말 것
  async function rememberDevice(days = SESSION_DAYS) {
    assertOpen();
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const env = await C.encryptText(key, JSON.stringify({ dek: C.b64(st.dek.raw), token: st.token }));
    await kv.set('session', { key, env, salt: st.vault.pw.salt, days, until: Date.now() + days * 864e5 });
  }
  const forgetSession = () => kv.del('session');
  async function sessionInfo() {
    const s = await kv.get('session');
    return s && s.until > Date.now() ? { until: s.until } : null;
  }

  // 저장해 둔 열기 정보로 연다. 못 쓰게 되었으면(만료·비밀번호 바뀜) false
  async function resume() {
    await ready;
    if (st.dek) return true;
    const s = await kv.get('session');
    if (!s || s.until < Date.now() || !st.vault || s.salt !== st.vault.pw.salt) { await forgetSession(); return false; }
    let sec;
    try { sec = JSON.parse(await C.decryptText(s.key, s.env)); } catch { await forgetSession(); return false; }
    s.until = Date.now() + (s.days || SESSION_DAYS) * 864e5;
    await kv.set('session', s);
    const raw = C.unb64(sec.dek);
    await enter({ raw, key: await C.importDEK(raw) }, sec.token);
    return true;
  }

  async function refreshSession() {
    if (await kv.get('session')) await rememberDevice((await kv.get('session')).days);
  }

  // ---------- 기기 연결 ----------

  async function saveDevice(dev, vault, vaultSha) {
    const old = st.device;
    st.device = { ...repoOf(dev), user: old?.user || opts.user || '', deviceId: old?.deviceId || uid() };
    st.vault = vault;
    st.vaultSha = vaultSha || null;
    await kv.set('device', st.device);
    await kv.set('vault', vault);
    await kv.set('vaultSha', st.vaultSha);
  }

  // 다른 저장소로 바꿀 때: 이 기기의 예전 사본은 못 올린 것이 없을 때만 비운다
  async function switchRepo(dev) {
    if (st.dek) await lock();
    const d = st.device;
    if (d && (d.owner !== dev.owner || d.repo !== dev.repo)) {
      if (await hasUnsaved()) throw new CoreError('unsaved', '이 기기에 아직 올리지 못한 변경이 있어서 다른 저장소로 바꾸지 않았어요.');
      for (const k of await kv.keys()) if (typeof k === 'string' && /^(s|fb):/.test(k)) await kv.del(k);
      await forgetSession();
    }
  }

  // 관리자: 처음 한 번. 빈 데이터 저장소에 vault.json 을 만들고 복구 코드를 돌려준다 (이 코드는 다시 볼 수 없다)
  async function setup(token, password, { user, owner, repo } = {}) {
    await ready;
    checkNewPassword(password);
    const dev = { ...DEFAULT_REPO, ...(owner ? { owner } : {}), ...(repo ? { repo } : {}) };
    const be = backendFor(token, dev);
    dev.branch = (await be.check()).branch || dev.branch;
    if (await be.get(VAULT)) throw new CoreError('already-setup', '이미 설정된 저장소예요. 연결된 기기의 QR로 연결하거나, 관리자는 토큰으로 연결(connectWithToken)하세요.');
    await switchRepo(dev);
    const dek = await C.newDEK();
    const code = C.newRecoveryCode();
    const now = nowISO();
    const vault = {
      v: 1,
      app: 'jayangchoir',
      kdf: 'PBKDF2-SHA256 → AES-256-GCM',
      pw: await C.makeWrap(password, C.ITER, dek.raw),
      rc: await C.makeWrap(C.normCode(code), C.RITER, dek.raw),
      tok: await C.encryptText(dek.key, token, 'tok'),
      createdAt: now,
      pwAt: now,
      rcAt: now,
      tokAt: now,
    };
    const sha = await be.put(VAULT, C.utf8(JSON.stringify(vault, null, 2)), null, 'vault');
    await saveDevice(dev, vault, sha);
    if (user) await setUser(user);
    await enter(dek, token);
    return code;
  }

  // 관리자: 토큰과 비밀번호로 이 기기를 연결 (모든 기기를 잃었을 때, 또는 관리자 PC)
  async function connectWithToken(token, password, { owner, repo } = {}) {
    await ready;
    const dev = { ...DEFAULT_REPO, ...(owner ? { owner } : {}), ...(repo ? { repo } : {}) };
    const be = backendFor(token, dev);
    dev.branch = (await be.check()).branch || dev.branch;
    const got = await be.get(VAULT);
    if (!got) throw new CoreError('not-setup', '아직 설정되지 않은 저장소예요. 먼저 setup 을 하세요.');
    const vault = JSON.parse(C.unutf8(got.bytes));
    const dek = await C.openWrap(password, vault.pw);
    if (!dek) throw new CoreError('bad-password', '비밀번호가 맞지 않아요.');
    await switchRepo(dev);
    await saveDevice(dev, vault, got.sha);
    await enter(dek, token);
    return status();
  }

  // 연결된 기기에서: 새 기기용 QR (안에 든 토큰·데이터 키는 사이트 비밀번호 없이는 풀리지 않는다)
  function joinLink() {
    assertOpen();
    const v = st.vault;
    const d = st.device;
    const j = { o: d.owner, r: d.repo, b: d.branch, s: v.pw.salt, i: v.pw.iter, w: v.pw.wrap, t: v.tok };
    const base = opts.siteUrl || `${location.origin}${location.pathname}`;
    return `${base}#join=${C.b64url(C.utf8(JSON.stringify(j)))}`;
  }

  async function connectDeviceQR() {
    const link = joinLink();
    const { default: qrcode } = await import('./qrcode.js');
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    return { link, svg: qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true }) };
  }

  const hasJoinLink = s => /[#&?]join=[A-Za-z0-9_-]{20,}/.test(String(s || ''));

  // 새 기기에서: QR 링크(또는 location.hash)를 받아 이 기기를 연결해 둔다. 그다음 open(비밀번호)
  async function joinFromQR(linkOrHash) {
    await ready;
    const m = String(linkOrHash || '').match(/[#&?]join=([A-Za-z0-9_-]+)/);
    if (!m) throw new CoreError('bad-link', '연결 QR이 아니에요.');
    let j;
    try { j = JSON.parse(C.unutf8(C.unb64url(m[1]))); } catch { throw new CoreError('bad-link', '연결 링크가 잘렸어요. QR을 다시 찍어 주세요.'); }
    if (!j?.o || !j.r || !j.s || !j.i || !j.w?.ct || !j.t?.ct) throw new CoreError('bad-link', '연결 링크가 잘렸어요. QR을 다시 찍어 주세요.');
    const dev = { owner: j.o, repo: j.r, branch: j.b || 'main' };
    await switchRepo(dev);
    // QR은 지금 열려 있는 기기가 보여 준 것이라 이 기기 사본보다 새것이다 (예: 토큰이 바뀐 뒤 다시 연결).
    // vaultSha 를 비워서 열면 바로 저장소의 vault.json 을 다시 받게 한다
    const sameRepo = st.device?.repo === dev.repo && st.device?.owner === dev.owner && st.vault;
    await saveDevice(dev, { ...(sameRepo ? st.vault : { v: 1, partial: true }), pw: { salt: j.s, iter: j.i, wrap: j.w }, tok: j.t }, null);
    return { owner: dev.owner, repo: dev.repo };
  }

  // 이 기기의 연결과 사본을 지운다 (GitHub 데이터는 그대로). 못 올린 변경이 있으면 지우지 않는다
  async function forgetDevice() {
    await ready;
    if (st.dek) await sync();
    if (await hasUnsaved()) throw new CoreError('unsaved', '아직 GitHub에 올리지 못한 변경이 있어서 연결을 끊지 않았어요. 인터넷에 연결된 상태로 열어 "저장됨"이 된 뒤 다시 하세요.');
    await lock();
    await kv.clear();
    st.device = null;
    st.vault = null;
    st.vaultSha = null;
    setState('locked');
  }

  async function setUser(name) {
    await ready;
    if (!st.device) throw new CoreError('not-connected', '먼저 기기를 연결하세요.');
    st.device = { ...st.device, user: String(name || '').trim().slice(0, 40) };
    await kv.set('device', st.device);
    setState(st.state);
  }

  // ---------- 비밀번호 / 복구 코드 / 토큰 ----------

  // vault.json 고치기: 최신본을 받아 fn 으로 고치고, 그사이 누가 고쳤으면 다시
  async function updateVault(be, fn) {
    for (let i = 0; i < 5; i++) {
      const got = await be.get(VAULT);
      if (!got) throw new CoreError('not-setup', '저장소에 vault.json 이 없어요.');
      const next = await fn(JSON.parse(C.unutf8(got.bytes)));
      try {
        const sha = await be.put(VAULT, C.utf8(JSON.stringify(next, null, 2)), got.sha, 'vault');
        st.vault = next;
        st.vaultSha = sha;
        await kv.set('vault', next);
        await kv.set('vaultSha', sha);
        return next;
      } catch (e) {
        if (!isConflict(e)) throw e;
      }
    }
    throw new CoreError('busy', '다른 기기와 동시에 고치느라 저장하지 못했어요. 다시 해 주세요.');
  }

  // 지금 사이트 비밀번호가 맞는지 (비밀번호 바꾸기 전에 확인용. 인터넷 필요 없음)
  async function checkPassword(password) {
    await ready;
    if (!st.vault?.pw) return false;
    return !!(await C.openWrap(password, st.vault.pw));
  }

  async function changePassword(newPassword) {
    assertOpen();
    checkNewPassword(newPassword);
    await updateVault(st.be, async v => ({ ...v, pw: await C.makeWrap(newPassword, C.ITER, st.dek.raw), pwAt: nowISO() }));
    await refreshSession();
  }

  // 새 복구 코드 (예전 코드는 바로 못 쓰게 된다)
  async function newRecoveryCode() {
    assertOpen();
    const code = C.newRecoveryCode();
    await updateVault(st.be, async v => ({ ...v, rc: await C.makeWrap(C.normCode(code), C.RITER, st.dek.raw), rcAt: nowISO() }));
    return code;
  }

  // 비밀번호를 잊었을 때: 복구 코드로 열고 새 비밀번호를 정한다 (인터넷 필요).
  // 이 기기가 연결된 적이 없으면 관리자 token 도 넣는다
  async function recover(code, newPassword, token) {
    await ready;
    checkNewPassword(newPassword);
    if (st.dek) await lock();
    const nc = C.normCode(code);
    let dev = st.device ? repoOf(st.device) : { ...DEFAULT_REPO };
    let v = st.vault;
    if (token) {
      const be = backendFor(token, dev);
      dev.branch = (await be.check()).branch || dev.branch;
      const got = await be.get(VAULT);
      if (!got) throw new CoreError('not-setup', '저장소에 vault.json 이 없어요.');
      v = JSON.parse(C.unutf8(got.bytes));
    }
    if (!v?.rc) throw new CoreError('need-token', '이 기기에는 복구에 필요한 정보가 없어요. 관리자 토큰과 함께 복구하세요.');
    const dek = await C.openWrap(nc, v.rc);
    if (!dek) throw new CoreError('bad-code', '복구 코드가 맞지 않아요.');
    token ||= await C.decryptText(dek.key, v.tok, 'tok');
    if (!st.device || st.device.repo !== dev.repo || st.device.owner !== dev.owner) {
      await switchRepo(dev);
      await saveDevice(dev, v, null);
    }
    const be = backendFor(token, dev);
    st.dek = dek; // updateVault 안에서 makeWrap 에 쓴다
    try {
      await updateVault(be, async cur => {
        if (cur.rc.salt !== v.rc.salt && !(await C.openWrap(nc, cur.rc))) throw new CoreError('bad-code', '복구 코드가 바뀌었어요. 새 복구 코드를 넣어 주세요.');
        return { ...cur, pw: await C.makeWrap(newPassword, C.ITER, dek.raw), pwAt: nowISO() };
      });
    } finally {
      st.dek = null;
    }
    await forgetSession();
    await enter(dek, token);
  }

  // 관리자: 토큰 바꾸기. 새 토큰을 vault.json 에 넣으면, 다른 기기는 다음 동기화 때 (예전 토큰으로 읽어서) 새 토큰으로 바꾼다.
  // 그래서 예전 토큰은 모든 기기가 한 번씩 열린 뒤(1~2주) 지운다. 바로 막아야 하면 바로 지우고 기기마다 QR로 다시 연결.
  async function rotateToken(newToken) {
    assertOpen();
    const be = backendFor(newToken, repoOf(st.device));
    await be.check();
    await updateVault(be, async v => ({ ...v, tok: await C.encryptText(st.dek.key, newToken, 'tok'), tokAt: nowISO() }));
    st.token = newToken;
    st.be = be;
    await refreshSession();
  }

  // 다른 기기가 vault.json 을 바꿨을 때
  async function refreshVault() {
    const got = await st.be.get(VAULT);
    if (!got) return;
    const v = JSON.parse(C.unutf8(got.bytes));
    const old = st.vault;
    st.vault = v;
    st.vaultSha = got.sha;
    await kv.set('vault', v);
    await kv.set('vaultSha', got.sha);
    if (!same(v.tok, old?.tok)) {
      const t = await C.decryptText(st.dek.key, v.tok, 'tok');
      if (t !== st.token) {
        st.token = t;
        st.be = backendFor(t, repoOf(st.device));
        await refreshSession();
      }
    }
    if (old?.pw && v.pw.salt !== old.pw.salt) {
      await forgetSession();
      throw new CoreError('password-changed', '다른 기기에서 사이트 비밀번호가 바뀌었어요. 새 비밀번호로 다시 열어 주세요. (이 기기에 저장한 것은 그대로 있어요)');
    }
  }

  // ---------- 동기화 ----------

  let syncP = null;
  let again = false;
  let timer = null;
  let pollT = null;

  function scheduleSync(delay = syncDelay) {
    if (!autoSync || !st.dek) return;
    clearTimeout(timer);
    timer = setTimeout(() => sync(), delay);
  }

  function startTimers() {
    if (!autoSync) return;
    stopTimers();
    pollT = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') sync();
    }, pollMs);
  }

  function stopTimers() {
    clearTimeout(timer);
    clearInterval(pollT);
    pollT = null;
  }

  if (autoSync && typeof addEventListener === 'function') {
    addEventListener('online', () => { if (st.dek) sync(); });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && st.dek) sync(); });
    }
  }

  // 받은 조각을 이 기기 내용과 기록마다 합친다. 기다림(await) 없이 한 번에 — 그사이 고친 것을 잃지 않게
  function applyRemote(path, sha, remoteRecs) {
    const col = colOfPath(path);
    const cm = ensureCol(col);
    const sh = shardOf(path);
    const remote = toMap(remoteRecs);
    const local = toMap(recsOf(path));
    let changed = false;
    let needPush = false;
    for (const id of new Set([...local.keys(), ...remote.keys()])) {
      const m = mergeRecord(sh.base.get(id), local.get(id), remote.get(id));
      if (m === undefined) continue;
      if (!same(m, local.get(id))) { cm.set(id, m); changed = true; }
      if (!same(m, remote.get(id))) needPush = true;
    }
    sh.base = remote;
    sh.sha = sha;
    if (needPush) { sh.dirty = true; sh.ver++; } else if (sh.dirty) { sh.dirty = false; sh.ver++; }
    return changed;
  }

  async function pull(path, chk, changed) {
    const got = await st.be.get(path);
    chk();
    if (!got) return false;
    const recs = await decShard(path, parseShard(got.bytes));
    chk();
    if (applyRemote(path, got.sha, recs)) changed.add(colOfPath(path));
    await persist(path);
    return true;
  }

  async function push(path, chk, changed) {
    for (let i = 0; i < 6; i++) {
      const sh = st.shards.get(path);
      if (!sh?.dirty) return;
      const ver = sh.ver;
      const recs = recsOf(path);
      const env = await encShard(path, recs);
      chk();
      try {
        const sha = await st.be.put(path, shardBytes(env), sh.sha, 'save');
        chk();
        sh.sha = sha;
        sh.base = toMap(recs);
        if (sh.ver === ver) sh.dirty = false;
        await persist(path);
        return;
      } catch (e) {
        if (!isConflict(e)) throw e;
        // 다른 기기가 먼저 고쳤다 → 받아서 합친 뒤 다시 올린다
        if (!(await pull(path, chk, changed))) sh.sha = null;
      }
    }
    throw new CoreError('busy', '다른 기기와 동시에 저장하느라 아직 못 올렸어요. 잠시 뒤 다시 올려요.');
  }

  async function uploadFile(id, chk) {
    const f = await kv.get(`fb:${id}`);
    if (!f || f.up) { st.fileQueue.delete(id); return; }
    try {
      await st.be.put(filePath(id), f.enc, null, 'file');
    } catch (e) {
      // 이미 올라가 있음(지난번에 올리고 답을 못 받음)인지 확인
      if (!isConflict(e) || !(await st.be.get(filePath(id)))) throw e;
    }
    chk();
    await kv.set(`fb:${id}`, { ...f, up: true });
    st.fileQueue.delete(id);
  }

  let fileError = '';

  async function syncOnce(ep) {
    const chk = () => { if (ep !== epoch) throw new CoreError('locked', '잠겼어요.'); };
    const tree = await st.be.tree();
    chk();
    const rmap = new Map(tree.map(x => [x.path, x.sha]));
    const vsha = rmap.get(VAULT);
    if (vsha && vsha !== st.vaultSha) { await refreshVault(); chk(); }

    // 1. 파일 먼저 (기록이 가리키는 파일이 먼저 올라가 있게)
    fileError = '';
    for (const id of [...st.fileQueue]) {
      try {
        await uploadFile(id, chk);
      } catch (e) {
        if (e.status === 0 || e.code === 'locked' || e.status === 401) throw e;
        fileError = `파일 하나를 올리지 못했어요: ${e.message}`; // 다른 것은 계속 올린다
      }
    }

    // 2. 바뀐 조각 받기
    const changed = new Set();
    const need = [...rmap].filter(([p, sha]) => p.startsWith('data/') && p.endsWith('.enc') && st.shards.get(p)?.sha !== sha);
    await pool(need, 6, ([p]) => pull(p, chk, changed));
    // GitHub에서 없어진 조각(예: 저장소를 되돌림)은 이 기기 것을 다시 올린다 — 데이터를 잃지 않게
    for (const [p, sh] of st.shards) {
      if (sh.sha && !rmap.has(p)) { sh.sha = null; sh.base = new Map(); sh.dirty = true; sh.ver++; }
    }

    // 3. 고친 조각 올리기
    for (const [p, sh] of [...st.shards]) if (sh.dirty) await push(p, chk, changed);
    if (changed.size) emitChange([...changed], 'remote');
  }

  let lockAfterSync = false;

  async function sync() {
    await ready;
    if (!st.dek) return status();
    if (syncP) { again = true; await syncP; return status(); }
    const ep = epoch;
    clearTimeout(timer);
    setState('syncing');
    syncP = (async () => {
      try {
        await syncOnce(ep);
        st.lastSync = nowISO();
        st.error = fileError;
        st.errorCode = '';
        setState(pendingCount() ? 'pending' : 'saved');
      } catch (e) {
        if (ep !== epoch) return;
        st.error = e.message || String(e);
        st.errorCode = e.code || (e.status === 401 ? 'token' : e.status === 0 ? 'offline' : '');
        if (e.code === 'password-changed') { lockAfterSync = true; return; }
        if (e.code !== 'locked') console.warn('[core] sync', e);
        setState(e.status === 0 ? 'offline' : 'error');
        scheduleSync(30000);
      }
    })().finally(() => {
      syncP = null;
      if (again) { again = false; scheduleSync(300); }
    });
    await syncP;
    if (lockAfterSync) {
      lockAfterSync = false;
      const err = st.error;
      await lock();
      st.error = err;
      st.errorCode = 'password-changed';
      setState('locked');
    }
    return status();
  }

  // ---------- 기록 (목록) ----------

  function stamp(prev) {
    let now = nowISO();
    // 이 기기 시계가 뒤로 갔어도 고친 때가 앞 기록보다 늦게
    if (prev?.updatedAt && now <= prev.updatedAt) now = new Date(Date.parse(prev.updatedAt) + 1).toISOString();
    return now;
  }

  async function writeRecords(col, recs) {
    const cm = ensureCol(col);
    const paths = new Set();
    for (const r of recs) {
      cm.set(r.id, r);
      paths.add(shardPath(col, r.id));
    }
    for (const p of paths) {
      const sh = shardOf(p);
      sh.dirty = true;
      sh.ver++;
    }
    await Promise.all([...paths].map(persist));
    setState('pending');
    emitChange([col], 'local');
    scheduleSync();
  }

  function cleanBody(rec) {
    const body = {};
    for (const k of Object.keys(rec)) if (!META.has(k) && !k.startsWith('_') && rec[k] !== undefined) body[k] = rec[k];
    return JSON.parse(JSON.stringify(body)); // JSON으로 저장할 수 있는 값만
  }

  function nextRecord(col, rec) {
    if (!rec || typeof rec !== 'object') throw new CoreError('bad-record', '기록은 객체여야 해요.');
    const id = rec.id != null && rec.id !== '' ? String(rec.id) : uid();
    const prev = ensureCol(col).get(id);
    const body = cleanBody(rec);
    if (prev && sameContent(prev, body)) return null;
    const now = stamp(prev);
    const who = userName();
    const next = {
      ...body,
      id,
      createdAt: prev?.createdAt || now,
      createdBy: prev?.createdBy || who,
      updatedAt: now,
      updatedBy: who,
      deletedAt: prev?.deletedAt || null,
      deletedBy: prev?.deletedBy || null,
    };
    if (prev?._conflicts) next._conflicts = prev._conflicts;
    return next;
  }

  const collections = new Map();

  function collection(name) {
    if (!COL_RE.test(name)) throw new CoreError('bad-collection', `목록 이름이 올바르지 않아요: ${name}`);
    if (collections.has(name)) return collections.get(name);
    const cm = () => { assertOpen(); return ensureCol(name); };
    const order = (a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || (a.id < b.id ? -1 : 1);
    const api = {
      name,
      // deleted: false(기본, 휴지통 뺌) | true(휴지통만) | 'all'
      list({ deleted = false } = {}) {
        return [...cm().values()]
          .filter(r => (deleted === 'all' ? true : deleted ? !!r.deletedAt : !r.deletedAt))
          .sort(order)
          .map(clone);
      },
      get(id) { return clone(cm().get(String(id))) || null; },
      trash() { return api.list({ deleted: true }); },
      async put(rec) {
        cm();
        const next = nextRecord(name, rec);
        if (!next) return clone(cm().get(String(rec.id)));
        await writeRecords(name, [next]);
        return clone(next);
      },
      // 여러 개를 한 번에 (가져오기·옮기기용). 조각마다 한 번만 저장한다
      async putMany(list) {
        cm();
        const out = [];
        const nexts = [];
        for (const rec of list) {
          const next = nextRecord(name, rec);
          if (next) { nexts.push(next); cm().set(next.id, next); }
          out.push(clone(next || cm().get(String(rec.id))));
        }
        if (nexts.length) await writeRecords(name, nexts);
        return out;
      },
      async patch(id, fields) {
        const prev = cm().get(String(id));
        if (!prev) throw new CoreError('not-found', '기록을 찾을 수 없어요.');
        const body = {};
        for (const k of Object.keys(prev)) if (!META.has(k)) body[k] = prev[k];
        return api.put({ ...body, ...fields, id: prev.id });
      },
      async softDelete(id) {
        const prev = cm().get(String(id));
        if (!prev) throw new CoreError('not-found', '기록을 찾을 수 없어요.');
        if (prev.deletedAt) return clone(prev);
        const now = stamp(prev);
        const next = { ...prev, deletedAt: now, deletedBy: userName(), updatedAt: now, updatedBy: userName() };
        await writeRecords(name, [next]);
        return clone(next);
      },
      async restore(id) {
        const prev = cm().get(String(id));
        if (!prev) throw new CoreError('not-found', '기록을 찾을 수 없어요.');
        if (!prev.deletedAt) return clone(prev);
        const now = stamp(prev);
        const next = { ...prev, deletedAt: null, deletedBy: null, updatedAt: now, updatedBy: userName() };
        await writeRecords(name, [next]);
        return clone(next);
      },
      // 동시에 고쳐서 진 값이 남은 기록들 (화면에서 "다른 선생님이 같은 때 고쳤어요" 표시)
      conflicts() { return [...cm().values()].filter(r => r._conflicts?.length).map(clone); },
      async clearConflicts(id) {
        const prev = cm().get(String(id));
        if (!prev?._conflicts) return clone(prev) || null;
        const next = { ...prev, updatedAt: stamp(prev), updatedBy: userName() };
        delete next._conflicts;
        await writeRecords(name, [next]);
        return clone(next);
      },
      onChange(fn) {
        return onChange(ev => { if (ev.collections.includes(name)) fn(ev); });
      },
    };
    collections.set(name, api);
    return api;
  }

  // ---------- 파일 (사진·그림) ----------

  const files = {
    // blob(File) → 줄이고 암호화해 이 기기에 저장 → 다음 동기화 때 올린다. 돌려주는 meta.id 를 기록에 넣어 쓴다
    // id: 예전 데이터를 옮길 때만 — 그 id 로 저장한다. 이미 있는 id 면 내용을 바꾸지 않고 그 정보를 돌려준다 (파일은 바뀌지 않는다)
    async put(blob, { id: keepId, name, maxDim = 1600, quality = 0.85, maxBytes = 1.5e6, resize = true, extra } = {}) {
      assertOpen();
      if (keepId != null) {
        keepId = String(keepId);
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(keepId)) throw new CoreError('bad-id', `파일 id 가 올바르지 않아요: ${keepId}`);
        if (await kv.get(`fb:${keepId}`)) {
          const have = collection('files').get(keepId);
          return have || collection('files').put({ ...(extra || {}), id: keepId, name: name || blob.name || '', type: blob.type || '', size: blob.size });
        }
      }
      const p = resize ? await prepareImage(blob, { maxDim, quality, maxBytes }) : { blob, type: blob.type, w: 0, h: 0 };
      if (p.blob.size > MAX_FILE) throw new CoreError('too-big', `파일이 너무 커요 (${Math.round(p.blob.size / 1e6)}MB). ${MAX_FILE / 1e6}MB 이하만 올릴 수 있어요.`);
      const id = keepId ?? uid();
      const bytes = new Uint8Array(await p.blob.arrayBuffer());
      const enc = await C.encryptBytes(st.dek.key, bytes, `file:${id}`);
      await kv.set(`fb:${id}`, { enc, up: false });
      st.fileQueue.add(id);
      return collection('files').put({
        ...(extra || {}),
        id,
        name: name || blob.name || '',
        type: p.type || '',
        size: bytes.length,
        w: p.w,
        h: p.h,
        origSize: blob.size,
      });
    },
    // → Blob. 이 기기에 없으면 GitHub에서 받아 둔다
    async get(id) {
      assertOpen();
      let f = await kv.get(`fb:${id}`);
      if (!f) {
        const got = await st.be.get(filePath(id));
        if (!got) throw new CoreError('file-missing', '아직 올라오지 않은 파일이에요. 올린 기기가 인터넷에 연결되면 보여요.');
        f = { enc: got.bytes, up: true };
        await kv.set(`fb:${id}`, f);
      }
      const bytes = await C.decryptBytes(st.dek.key, f.enc, `file:${id}`);
      return new Blob([bytes], { type: collection('files').get(id)?.type || '' });
    },
    // 화면에 쓸 blob: 주소 (잠그면 없어진다)
    async url(id) {
      if (urls.has(id)) return urls.get(id);
      const u = URL.createObjectURL(await files.get(id));
      urls.set(id, u);
      return u;
    },
    meta: id => collection('files').get(id),
    list: o => collection('files').list(o),
    softDelete: id => collection('files').softDelete(id),
    restore: id => collection('files').restore(id),
  };

  // ---------- 다른 저장소 (합창단: 공개 사이트 저장소·사진 저장소) ----------
  // 같은 토큰으로 다른 저장소를 읽고 쓴다. 토큰 자체는 화면 코드에 내보내지 않는다
  function backend(dev) {
    assertOpen();
    return backendFor(st.token, { branch: 'main', ...dev });
  }
  // 저장소 정보·만들기 (GitHubAccount 모양: repoInfo(name), createRepo(name, { description, private }))
  function account() {
    assertOpen();
    return accountFor(st.token);
  }

  // ---------- 백업 ----------

  // 지금 데이터 전체를 암호화된 그대로 한 파일로 (vault 포함 — 그 당시 비밀번호나 복구 코드로 열린다). 사진은 빠진다
  async function exportBackup() {
    assertOpen();
    const shards = {};
    for (const p of st.shards.keys()) shards[p] = await encShard(p, recsOf(p));
    return JSON.stringify({ kind: 'jayangchoir-core-backup', v: 1, at: nowISO(), vault: st.vault, shards });
  }

  // ---------- 이벤트 ----------

  function onChange(fn) {
    changeFns.add(fn);
    return () => changeFns.delete(fn);
  }
  function onStatus(fn) {
    statusFns.add(fn);
    return () => statusFns.delete(fn);
  }

  return {
    ready,
    status,
    onStatus,
    onChange,
    // 열기
    open,
    resume,
    lock,
    rememberDevice,
    forgetSession,
    sessionInfo,
    // 연결
    setup,
    connectWithToken,
    connectDeviceQR,
    joinLink,
    hasJoinLink,
    joinFromQR,
    forgetDevice,
    setUser,
    // 비밀
    checkPassword,
    changePassword,
    newRecoveryCode,
    recover,
    rotateToken,
    // 데이터
    collection,
    files,
    sync,
    exportBackup,
    hasUnsaved,
    backend,
    account,
    // 시험용
    _st: st,
  };
}
