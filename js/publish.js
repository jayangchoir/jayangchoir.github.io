// "학부모 화면에 반영" — 관리자 데이터(비공개) → 학부모용 암호문(공개 사이트 저장소 p/)
//
// 1. 먼저 비공개 데이터 저장소와 동기화 (다른 관리자가 고친 것까지 합쳐서)
// 2. bundle.js 로 학부모용 묶음을 만든다 (허용한 칸만) → assertNoContacts 로 한 번 더 확인
// 3. 바뀐 파일만 커밋 하나로: p/content.json (+ 바뀐 앨범의 p/a/<id>.json)
// 학부모 비밀번호·내용 키(CK)는 관리자 데이터의 settings/parent 에 있다 (비공개 저장소, 관리자 비밀번호로 암호화).

import { buildBundle, assertNoContacts } from './bundle.js';
import { newParentKey, contentFile, albumFile, CONTENT_PATH, albumPath, weakReasons } from './tier.js';
import { canon } from './core/merge.js';

export const SITE_REPO = { owner: 'jayangchoir', repo: 'jayangchoir.github.io' };
const COLS = ['settings', 'notices', 'events', 'songs', 'videos', 'albums', 'members', 'media'];

async function sha(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

export function createPublisher({ core, site = SITE_REPO }) {
  const settings = () => core.collection('settings');
  const parentRec = () => settings().get('parent');

  function gather() {
    const data = {};
    for (const c of COLS) data[c] = core.collection(c).list();
    return data;
  }

  // 지금 묶음과 그 지문(hash). 앨범마다 지문도
  async function compute() {
    const data = gather();
    const { bundle, albums } = buildBundle(data);
    const albumHashes = {};
    for (const [id, a] of albums) albumHashes[id] = await sha(canon(a));
    for (const a of bundle.albums) a.rev = albumHashes[a.id];
    const key = parentRec();
    const hash = await sha(canon(bundle) + (key?.kdf?.salt || ''));
    return { data, bundle, albums, albumHashes, hash };
  }

  // { configured, dirty, publishedAt, publishedBy, weak }
  async function state() {
    const p = parentRec();
    if (!p?.ck) return { configured: false, dirty: true };
    const { hash } = await compute();
    return { configured: true, dirty: hash !== p.publishedHash, publishedAt: p.publishedAt || '', publishedBy: p.publishedBy || '', weak: weakReasons(p.password) };
  }

  let running = null;
  // → { changed: 파일 수 } . all=true 면 앨범 파일까지 모두 다시 암호화(비밀번호 바꿀 때)
  function publish({ all = false } = {}) {
    if (!running) running = doPublish(all).finally(() => { running = null; });
    return running;
  }

  async function doPublish(all) {
    await core.sync();
    const key = parentRec();
    if (!key?.ck) throw Object.assign(new Error('먼저 학부모 비밀번호를 정해 주세요.'), { code: 'no-parent-key' });
    const { data, bundle, albums, albumHashes, hash } = await compute();
    // 올리기 전 마지막 확인: 연락처·부모님 이름·예금주가 없어야 한다
    assertNoContacts([bundle, ...albums.values()], data);
    const prev = all ? {} : key.albumHashes || {};
    const files = [];
    for (const [id, a] of albums) {
      if (prev[id] !== albumHashes[id]) files.push({ path: albumPath(id), text: await albumFile(key, id, a) });
    }
    if (all || hash !== key.publishedHash || files.length) files.push({ path: CONTENT_PATH, text: await contentFile(key, bundle, hash) });
    if (!files.length) return { changed: 0 };
    const be = core.backend(site);
    await be.commitFiles(files, `학부모 화면 반영 (${files.length}개)`);
    await settings().put({ ...key, publishedHash: hash, albumHashes, publishedAt: new Date().toISOString(), publishedBy: core.status().user || '' });
    core.sync();
    return { changed: files.length };
  }

  // 학부모 비밀번호 정하기·바꾸기 → 새 키로 모두 다시 암호화해서 반영
  async function setParentPassword(password) {
    const pw = String(password || '');
    if ([...pw].length < 6) throw Object.assign(new Error('학부모 비밀번호는 6자 이상으로 정해 주세요.'), { code: 'too-short' });
    const k = await newParentKey(pw);
    const prev = parentRec() || {};
    await settings().put({ id: 'parent', password: pw, kdf: k.kdf, wrap: k.wrap, ck: k.ck, setAt: new Date().toISOString(), setBy: core.status().user || '', albumHashes: {}, publishedHash: '', history: [...(prev.history || []), ...(prev.setAt ? [prev.setAt] : [])].slice(-10) });
    return publish({ all: true });
  }

  return { gather, compute, state, publish, setParentPassword, parentRec };
}
