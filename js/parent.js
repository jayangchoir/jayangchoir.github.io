// 학부모 쪽: 공개 사이트의 p/content.json 을 받아 학부모 비밀번호로 연다 (토큰 필요 없음)
//
// - 비밀번호가 맞으면 내용 키(CK)를 "꺼낼 수 없는 키"로 이 기기 IndexedDB 에 기억한다(켠 경우). 다음부터는 비밀번호 없이.
// - 관리자가 학부모 비밀번호를 바꾸면 salt 가 달라져서 기억한 키가 맞지 않음 → 다시 비밀번호를 묻는다.
// - 마지막으로 받은 암호문도 기억해 두어 인터넷이 없어도 마지막 내용은 보인다.

import { KV } from './core/kv.js';
import { openParentKey, openJSON, CONTENT_PATH, albumPath, TierError } from './tier.js';
import { readEntry, readThumb, fetchPublic } from './media.js';

const sitePath = p => `${p}?t=${Date.now()}`;
async function fetchSite(path) {
  let r;
  try {
    r = await fetch(sitePath(path), { cache: 'no-store' });
  } catch {
    throw Object.assign(new Error('인터넷에 연결되어 있지 않아요.'), { status: 0 });
  }
  if (r.status === 404) return null;
  if (!r.ok) throw Object.assign(new Error(`내용을 받지 못했어요 (${r.status})`), { status: r.status });
  return r.text();
}

export function createParent({ getText = fetchSite, read = fetchPublic, dbName = 'jayangchoir-parent' } = {}) {
  const kv = new KV(dbName);
  const st = { env: null, ck: null, bundle: null, offline: false };

  async function fetchEnv() {
    try {
      const t = await getText(CONTENT_PATH);
      st.offline = false;
      if (!t) return null;
      const env = JSON.parse(t);
      await kv.set('env', env);
      return env;
    } catch (e) {
      if (e.status !== 0) throw e;
      st.offline = true;
      return (await kv.get('env')) || null;
    }
  }

  async function decrypt(ck) {
    return openJSON(ck, { iv: st.env.iv, ct: st.env.ct }, CONTENT_PATH);
  }

  // → 'none'(아직 반영된 내용 없음) | 'locked' | 'open'
  async function load() {
    st.env = await fetchEnv();
    if (!st.env?.kdf) { st.env = null; return 'none'; } // 아직 반영 전(자리 표시 파일)
    const saved = await kv.get('ck');
    if (saved?.salt === st.env.kdf.salt && saved.key) {
      try {
        st.bundle = await decrypt(saved.key);
        st.ck = saved.key;
        return 'open';
      } catch {}
    }
    if (saved) await kv.del('ck');
    st.ck = null;
    st.bundle = null;
    return 'locked';
  }

  async function login(password, { remember = true } = {}) {
    if (!st.env) st.env = await fetchEnv();
    if (!st.env?.kdf) throw new TierError('none', '아직 학부모 화면이 준비되지 않았어요.');
    const ck = await openParentKey(password, st.env);
    st.bundle = await decrypt(ck);
    st.ck = ck;
    if (remember) await kv.set('ck', { key: ck, salt: st.env.kdf.salt, at: Date.now() });
    return st.bundle;
  }

  async function logout() {
    st.ck = null;
    st.bundle = null;
    await kv.del('ck');
  }

  const albumCache = new Map();
  async function album(meta) {
    const k = `${meta.id}@${meta.rev || ''}`;
    if (albumCache.has(k)) return albumCache.get(k);
    const t = await getText(`${albumPath(meta.id)}${meta.rev ? '' : ''}`);
    if (!t) return { id: meta.id, photos: [] };
    const env = JSON.parse(t);
    const a = await openJSON(st.ck, env, albumPath(meta.id));
    albumCache.set(k, a);
    return a;
  }

  // 파일 칸(묶음의 files[id] 또는 앨범 사진) → Blob
  const file = (id, e, onProgress) => readEntry(id, e, read, onProgress);
  const thumb = (id, e) => readThumb(id, e, read);

  return { load, login, logout, album, file, thumb, get bundle() { return st.bundle; }, get offline() { return st.offline; }, get env() { return st.env; } };
}
