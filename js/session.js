// 로그인 한 곳 — 공개 · 학부모(가족 코드) · 스탭(개인 코드) · 관리자(관리자 비밀번호)
//
// 로그인 화면은 하나: "이름" + "코드(또는 관리자 비밀번호)". 역할은 고르지 않고 들어온 열쇠로 정해진다.
//   1. 공개 keyring.json 에서 이름의 칸을 찾아 코드로 연다 → 그 칸의 묶음에 역할(parent/staff)과 열쇠가 있다
//   2. 칸이 없거나 안 열리면, 이 기기가 관리자 기기로 연결되어 있으면 관리자 비밀번호로 core 를 열어 본다 → admin
// 기억: 가족·스탭은 사람 키(꺼낼 수 없는 키)를 이 기기에 둬서 다음엔 코드를 묻지 않는다(탈퇴로 칸이 없어지면 다시 묻는다).
//       관리자는 core 의 "이 기기 기억"(30일).

import { KV } from './core/kv.js';
import { createKeyringProvider, roleClosure, ROLES } from './core/access.js';
import { openItem, CONTENT_PATH, KEYRING_PATH, PUBLIC_PATH, STAFF_PATH, albumPath } from './tier.js';
import { readEntry, readThumb, fetchPublic } from './media.js';

async function fetchSite(path) {
  let r;
  try {
    r = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
  } catch {
    throw Object.assign(new Error('인터넷에 연결되어 있지 않아요.'), { status: 0 });
  }
  if (r.status === 404) return null;
  if (!r.ok) throw Object.assign(new Error(`내용을 받지 못했어요 (${r.status})`), { status: r.status });
  return r.text();
}

export function createSession({ getText = fetchSite, read = fetchPublic, dbName = 'jayangchoir-session', core = null } = {}) {
  const kv = new KV(dbName);
  const st = { role: 'public', person: null, keys: {}, token: null, bundle: null, staff: null, pub: null, offline: false, notice: '' };

  // 사이트 파일 받기. 인터넷이 없으면 마지막으로 받은 것
  async function fetchJSON(path) {
    try {
      const t = await getText(path);
      const v = t ? JSON.parse(t) : null;
      await kv.set(`f:${path}`, v);
      st.offline = false;
      return v;
    } catch (e) {
      if (e.status !== 0) throw e;
      st.offline = true;
      return (await kv.get(`f:${path}`)) || null;
    }
  }
  const provider = createKeyringProvider({ fetchKeyring: () => fetchJSON(KEYRING_PATH) });

  function reset() { Object.assign(st, { role: 'public', person: null, keys: {}, token: null, bundle: null, staff: null }); }
  function apply(b) { st.role = b.role; st.keys = { ...b.keys }; st.token = b.token || null; st.person = b.person || null; }

  function asAdmin() {
    const p = core.collection('settings').get('parent') || {};
    st.role = 'admin';
    st.keys = { ...(p.k ? { parent: p.k } : {}), ...(p.ks ? { staff: p.ks } : {}) };
    st.token = core.writeToken();
    st.person = { id: 'admin', name: core.status().user || '관리자' };
  }

  // 학부모·스탭 내용 풀기 (반영 전이거나 열쇠가 바뀌는 중이면 비어 있음)
  async function loadContent() {
    st.bundle = null;
    st.staff = null;
    if (st.keys.parent) {
      const env = await fetchJSON(CONTENT_PATH);
      if (env?.wk) { try { st.bundle = await openItem(st.keys.parent, env, CONTENT_PATH); } catch (e) { console.warn('[session] content', e); } }
    }
    if (st.keys.staff) {
      const env = await fetchJSON(STAFF_PATH);
      if (env?.wk) { try { st.staff = await openItem(st.keys.staff, env, STAFF_PATH); } catch (e) { console.warn('[session] staff', e); } }
    }
  }

  async function load() {
    st.notice = '';
    const pub = await fetchJSON(PUBLIC_PATH).catch(() => null);
    st.pub = pub?.v ? pub : null;
    reset();
    if (core?.status().open) asAdmin();
    else {
      const cred = await kv.get('cred');
      if (cred) {
        const r = await provider.resume(cred.lookup, cred.pk).catch(() => null);
        if (r) apply(r.bundle);
        else if (!st.offline) { await kv.del('cred'); st.notice = '이 기기의 접속이 끝났어요. 코드가 바뀌었거나 합창단을 떠난 경우예요. 새 코드는 총무님께 받을 수 있어요.'; }
      }
    }
    await loadContent();
    return st.role;
  }

  // → 역할. 틀리면 오류(code 'bad-login')
  async function login(identifier, secret, { remember = true } = {}) {
    let err;
    try {
      const r = await provider.login(identifier, secret);
      apply(r.bundle);
      if (remember) await kv.set('cred', { lookup: r.lookup, pk: r.pk, at: Date.now() });
      await loadContent();
      return st.role;
    } catch (e) { err = e; }
    // 관리자 기기면 관리자 비밀번호로
    if (core?.status().connected) {
      try {
        await core.open(secret, { remember });
        if (identifier && !core.status().user) await core.setUser(identifier);
        asAdmin();
        await loadContent();
        return 'admin';
      } catch (e) { if (e.code !== 'bad-password') throw e; }
    }
    if (err.code === 'none' && !core?.status().connected) throw err;
    throw Object.assign(new Error('이름이나 코드가 맞지 않아요. 초대 메시지의 이름과 코드를 그대로 넣어 주세요.'), { code: 'bad-login' });
  }

  async function logout() {
    await kv.del('cred');
    if (core?.status().open) await core.lock();
    reset();
  }

  const has = role => roleClosure(ROLES, st.role).has(role);
  const albumCache = new Map();
  async function album(meta) {
    const k = `${meta.id}@${meta.rev || ''}`;
    if (albumCache.has(k)) return albumCache.get(k);
    const env = await fetchJSON(albumPath(meta.id));
    if (!env?.wk) return { id: meta.id, photos: [] };
    const a = await openItem(st.keys.parent, env, albumPath(meta.id));
    albumCache.set(k, a);
    return a;
  }

  return {
    load, login, logout, has, album, loadContent,
    refreshAdmin: async () => { if (core?.status().open) { asAdmin(); await loadContent(); } },
    file: (id, e, onProgress) => readEntry(id, e, read, onProgress),
    thumb: (id, e) => readThumb(id, e, read),
    read,
    get role() { return st.role; }, get person() { return st.person; }, get keys() { return st.keys; }, get token() { return st.token; },
    get bundle() { return st.bundle; }, get staff() { return st.staff; }, get pub() { return st.pub; }, get offline() { return st.offline; }, get notice() { return st.notice; },
  };
}
