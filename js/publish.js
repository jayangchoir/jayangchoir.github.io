// "학부모 화면에 반영" + 가족 접속 코드 관리 — 관리자 데이터(비공개) → 공개 사이트 저장소 p/
//
// 1. 비공개 데이터 저장소와 먼저 동기화 (다른 관리자가 고친 것까지 합쳐서)
// 2. bundle.js 로 학부모용 묶음·공개 페이지를 만든다 (허용한 칸만) → assertNoContacts 로 한 번 더 확인
// 3. 바뀐 파일만 커밋 하나로: p/public.json · p/keyring.json · p/content.json · 바뀐 p/a/<앨범>.json
//
// 관리자 데이터:
//   settings/parent  { k: 학부모 키 K_parent, ks: 스탭 키 K_staff, kid, kidS, siteSalt, rotatedAt, rotations: [{ at, by, why, roles }], staffToken?, tokenWarn?,
//                      publishedHash, albumHashes, keyringHash, publicHash, staffHash, … }
//   people           가족(role 'parent')·스탭(role 'staff', 개인)마다 하나 (ACCESS-SPEC 의 people):
//                    { name, role, labels, status: 'active'|'revoked', login, code, pk, head, memberIds, issuedAt, revokedAt }
//                    code = 발급한 접속 코드(초대 메시지를 다시 보여 주려고), pk = 사람 키, head = 칸 머리(코드로 pk 를 감싼 것)
//   탈퇴한 가족도 지우지 않는다(status 'revoked'). 코드·사람 키만 비우고, 공개 keyring 에서 칸을 빼고, K_parent 를 바꾼다.

import { buildBundle, buildPublic, assertNoContacts, sortMembers, SITE_PRIVATE, SITE_PUBLIC } from './bundle.js';
import { sealItem, rewrapItem, CONTENT_PATH, KEYRING_PATH, PUBLIC_PATH, STAFF_PATH, albumPath } from './tier.js';
import { newAccessCode, newKey, keyId, makeSlotHead, sealSlot, lookupId, normIdentifier, ROLES } from './core/access.js';
import { canon } from './core/merge.js';
import { b64url } from './core/crypto.js';

export const SITE_REPO = { owner: 'jayangchoir', repo: 'jayangchoir.github.io' };
const COLS = ['settings', 'notices', 'events', 'songs', 'videos', 'albums', 'members', 'media'];

async function sha(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

export function createPublisher({ core, site = SITE_REPO }) {
  const settings = () => core.collection('settings');
  const people = () => core.collection('people');
  const parentRec = () => settings().get('parent');
  const who = () => core.status().user || '';

  function gather() {
    const data = {};
    for (const c of COLS) data[c] = core.collection(c).list();
    return data;
  }

  // 학부모 내용 키가 없으면 만든다
  async function ensureKey() {
    const p = parentRec();
    if (p?.k && p.ks) return p;
    const k = p?.k || newKey();
    const ks = p?.ks || newKey();
    const rec = { ...(p || {}), id: 'parent', k, ks, kid: await keyId(k), kidS: await keyId(ks), siteSalt: p?.siteSalt || b64url(crypto.getRandomValues(new Uint8Array(16))), rotatedAt: new Date().toISOString(), rotations: p?.rotations || [], albumHashes: p?.albumHashes || {} };
    await settings().put(rec);
    return settings().get('parent');
  }

  const active = () => people().list().filter(p => p.status !== 'revoked' && p.pk && p.head);

  // 스탭 단계 묶음: 연락처가 든 명단 전체, 비공개 안내, 가족·스탭 목록(코드 없이), 사진 저장소 번호(첨부 올릴 곳)
  function buildStaff(data) {
    const site = (data.settings || []).find(x => x.id === 'site') || {};
    const storage = (data.settings || []).find(x => x.id === 'storage') || {};
    const ppl = people().list();
    return {
      v: 1,
      members: sortMembers(data.members || []).map(m => ({ id: m.id, name: m.name, grade: m.grade, gender: m.gender || '', parentName: m.parentName || '', phone: m.phone || '', note: m.note || '', joined: m.joined || '' })),
      site: Object.fromEntries([...SITE_PUBLIC, ...SITE_PRIVATE].filter(k => site[k]).map(k => [k, site[k]])),
      families: ppl.filter(p => p.role === 'parent' && p.status !== 'revoked').map(p => ({ id: p.id, name: p.name, memberIds: p.memberIds || [] })),
      staff: ppl.filter(p => p.role === 'staff' && p.status !== 'revoked').map(p => ({ id: p.id, name: p.name, labels: p.labels || [] })),
      repo: Math.max(1, ...(storage.repos || [1])),
    };
  }

  async function compute() {
    const data = gather();
    const { bundle, albums } = buildBundle(data);
    const pub = buildPublic(data);
    const albumHashes = {};
    for (const [id, a] of albums) albumHashes[id] = await sha(canon(a));
    for (const a of bundle.albums) a.rev = albumHashes[a.id];
    const key = parentRec();
    const hash = await sha(canon(bundle) + (key?.kid || ''));
    const keyringHash = await sha(canon({ kid: key?.kid, kidS: key?.kidS, s: key?.siteSalt, t: key?.staffToken || '', p: active().map(p => [p.id, p.role, normIdentifier(p.login), p.head.salt, p.name, p.pk]).sort() }));
    const publicHash = await sha(canon(pub));
    const staff = buildStaff(data);
    const staffHash = await sha(canon(staff) + (key?.kidS || ''));
    return { data, bundle, albums, albumHashes, hash, keyringHash, pub, publicHash, staff, staffHash };
  }

  async function state() {
    const p = parentRec();
    const fam = people().list();
    const c = await compute();
    return {
      configured: !!p?.k,
      families: fam.filter(x => x.status !== 'revoked' && x.role !== 'staff').length,
      staff: fam.filter(x => x.status !== 'revoked' && x.role === 'staff').length,
      tokenWarn: p?.tokenWarn || null,
      revoked: fam.filter(x => x.status === 'revoked').length,
      dirty: !p?.k || c.hash !== p.publishedHash || c.staffHash !== p.staffHash || c.keyringHash !== p.keyringHash || c.publicHash !== p.publicHash || Object.entries(c.albumHashes).some(([id, h]) => p.albumHashes?.[id] !== h),
      publishedAt: p?.publishedAt || '', publishedBy: p?.publishedBy || '', rotatedAt: p?.rotatedAt || '',
    };
  }

  // 반영은 한 번에 하나씩 차례로 (열쇠를 바꾼 반영이 다른 반영과 섞이지 않게)
  let chain = Promise.resolve();
  function publish({ all = false, rewrap = null } = {}) {
    const p = chain.catch(() => {}).then(() => doPublish(all, rewrap));
    chain = p;
    return p;
  }

  async function doPublish(all, rewrap) {
    await core.sync();
    const key = await ensureKey();
    // 사진 저장소가 아직 없으면 1번을 만든다 (스탭 첨부도 여기에 올라감)
    const storage = settings().get('storage');
    if (!storage?.repos?.length) {
      await core.account().createRepo('choir-photos-1', { description: '자양교회 어린이 합창단 사진·악보 (암호화되어 있음)', private: false });
      await settings().put({ ...(storage || {}), id: 'storage', repos: [1] });
    }
    const { data, bundle, albums, albumHashes, hash, keyringHash, pub, publicHash, staff, staffHash } = await compute();
    // 올리기 전 마지막 확인: 연락처·부모님 이름·예금주가 학부모 묶음에도, 공개 페이지에도 없어야 한다
    assertNoContacts([bundle, ...albums.values()], data);
    assertNoContacts([pub], data);
    const files = [];
    if (all || publicHash !== key.publicHash) files.push({ path: PUBLIC_PATH, text: JSON.stringify(pub) });
    if (all || keyringHash !== key.keyringHash) files.push({ path: KEYRING_PATH, text: JSON.stringify(await keyring(key)) });
    const prev = all ? {} : key.albumHashes || {};
    for (const [id, a] of albums) if (prev[id] !== albumHashes[id]) files.push({ path: albumPath(id), text: JSON.stringify(await sealItem(key.k, a, albumPath(id))) });
    if (all || hash !== key.publishedHash) files.push({ path: CONTENT_PATH, text: JSON.stringify({ ...(await sealItem(key.k, bundle, CONTENT_PATH)), rev: hash, at: new Date().toISOString() }) });
    if (all || staffHash !== key.staffHash) files.push({ path: STAFF_PATH, text: JSON.stringify(await sealItem(key.ks, staff, STAFF_PATH, 'staff')) });
    // 스탭 열쇠를 바꿨으면 스탭이 쓴 기록(p/s/…)의 항목 키를 새 열쇠로 다시 감싼다 (내용은 그대로)
    if (rewrap) {
      const be = core.backend(site);
      for (const f of await be.tree()) {
        if (!/^p\/s\/.+\.json$/.test(f.path)) continue;
        const got = await be.get(f.path);
        const env = JSON.parse(new TextDecoder().decode(got.bytes));
        try { files.push({ path: f.path, text: JSON.stringify(await rewrapItem(rewrap.old, rewrap.next, env, f.path)) }); } catch (e) { console.warn('[rewrap]', f.path, e); }
      }
    }
    if (!files.length) return { changed: 0 };
    await core.backend(site).commitFiles(files, `학부모 화면 반영 (${files.length}개)`);
    await settings().put({ ...settings().get('parent'), publishedHash: hash, albumHashes, keyringHash, publicHash, staffHash, publishedAt: new Date().toISOString(), publishedBy: who() });
    core.sync();
    return { changed: files.length, files: files.map(f => f.path) };
  }

  // 공개 keyring: 활성 가족마다 칸 하나. 칸 안의 묶음 = 학부모 역할 키(물려받는 public 은 평문이라 키 없음) + 가족 이름
  async function keyring(key) {
    const slots = {};
    for (const p of active()) {
      const staff = p.role === 'staff';
      const bundle = staff
        ? { v: 1, role: 'staff', keys: { parent: key.k, staff: key.ks }, kid: key.kid, kidS: key.kidS, token: key.staffToken || core.writeToken(), repo: site, person: { id: p.id, name: p.name, labels: p.labels || [] } }
        : { v: 1, role: 'parent', keys: { parent: key.k }, kid: key.kid, person: { id: p.id, name: p.name } };
      slots[await lookupId(key.siteSalt, p.login)] = await sealSlot(p.head, p.pk, bundle, p.role);
    }
    return { v: 1, app: 'jayangchoir', roles: ROLES.map(r => r.id), siteSalt: key.siteSalt, kid: key.kid, slots, at: new Date().toISOString() };
  }

  // ---------- 가족 접속 코드 ----------
  function checkLogin(login, exceptId) {
    const n = normIdentifier(login);
    if (!n) throw Object.assign(new Error('로그인 이름(아이 이름)을 넣어 주세요.'), { code: 'no-login' });
    const dup = people().list().find(p => p.id !== exceptId && p.status !== 'revoked' && normIdentifier(p.login) === n);
    if (dup) throw Object.assign(new Error(`"${login}" 은(는) 이미 "${dup.name}" 이 쓰고 있어요. 학년을 붙이는 등 다르게 정해 주세요 (예: ${login}${'2'}).`), { code: 'dup-login' });
  }

  // 새 가족 (또는 코드 새로). → 가족 기록 (code 포함 — 초대 메시지에 씀)
  async function issue({ id, name, login, memberIds = [], labels = [], role = 'parent' }) {
    await ensureKey();
    checkLogin(login, id);
    const code = newAccessCode();
    const pk = newKey();
    const head = await makeSlotHead(code, pk);
    const prev = id ? people().get(id) : null;
    return people().put({ ...(prev || {}), ...(id ? { id } : {}), name, role, labels, status: 'active', login: String(login).trim(), code, pk, head, memberIds, issuedAt: new Date().toISOString(), issuedBy: who(), revokedAt: null });
  }

  // 코드를 새로 만들기 (잃어버렸거나 남에게 보였을 때): 예전 코드는 바로 못 쓰고, 학부모 열쇠도 바꾼다
  async function reissue(id) {
    const p = people().get(id);
    const next = await issue({ id, name: p.name, login: p.login, memberIds: p.memberIds, labels: p.labels, role: p.role });
    await rotate(`코드 새로: ${p.name}`, p.role === 'staff' ? ['parent', 'staff'] : ['parent'], p.role === 'staff' ? p.name : '');
    return next;
  }

  // 탈퇴: 칸을 빼고(코드·사람 키를 지움) 학부모 열쇠를 바꾼 뒤 다시 반영. 기록 자체는 남긴다(지우지 않음)
  async function revoke(id, why = '탈퇴') {
    const p = people().get(id);
    if (!p) throw new Error('가족을 찾지 못했어요.');
    await people().put({ ...p, status: 'revoked', revokedAt: new Date().toISOString(), revokedBy: who(), revokeNote: why, code: '', pk: '', head: null });
    // 스탭이었으면 스탭 열쇠도(스탭은 학부모 열쇠도 가졌음). 묶음에 있던 GitHub 토큰도 바꿔야 해서 관리자에게 알린다
    return p.role === 'staff' ? rotate(`${why}: ${p.name}`, ['parent', 'staff'], p.name) : rotate(`${why}: ${p.name}`, ['parent']);
  }

  // 되돌리기(다시 가입): 새 코드를 발급
  const reinstate = id => { const p = people().get(id); return issue({ id, name: p.name, login: p.login, memberIds: p.memberIds, labels: p.labels, role: p.role }); };

  // 역할 바꾸기 (가족 ↔ 스탭). 스탭에서 내려가면 스탭 열쇠를 바꾸고 토큰도 바꾸라고 알린다
  async function setRole(id, role, labels) {
    const p = people().get(id);
    await people().put({ ...p, role, ...(labels ? { labels } : {}) });
    if (p.role === 'staff' && role !== 'staff') return rotate(`스탭에서 빠짐: ${p.name}`, ['staff'], p.name);
    return publish();
  }

  // 학부모 열쇠 바꾸기: 새 K → 모든 학부모 파일을 새 열쇠로 다시 올리고, 남은 가족 칸도 새 열쇠로
  async function rotate(why = '열쇠 바꾸기', roles = ['parent'], staffGone = '') {
    const p = await ensureKey();
    const next = { ...p, rotatedAt: new Date().toISOString(), rotations: [...(p.rotations || []), { at: new Date().toISOString(), by: who(), why, roles }].slice(-50), albumHashes: {} };
    if (roles.includes('parent')) { next.k = newKey(); next.kid = await keyId(next.k); }
    let rewrap = null;
    if (roles.includes('staff')) { next.ks = newKey(); next.kidS = await keyId(next.ks); rewrap = { old: p.ks, next: next.ks }; }
    if (staffGone) next.tokenWarn = { at: new Date().toISOString(), name: staffGone };
    await settings().put(next);
    return publish({ all: true, rewrap });
  }

  // 관리자가 GitHub 토큰을 바꾼 뒤: 스탭 묶음에 새 토큰을 넣어 다시 올리고 알림을 지운다
  async function tokenRotated() {
    const p = parentRec();
    if (p) await settings().put({ ...p, tokenWarn: null, keyringHash: '' });
    return publish();
  }

  // 명단의 부모님 연락처(또는 이름)로 형제·자매를 한 가족으로 묶어 아직 가족이 없는 아이들의 가족을 만든다
  function suggestFamilies() {
    const members = core.collection('members').list();
    const taken = new Set(people().list().filter(p => p.status !== 'revoked' && p.role !== 'staff').flatMap(p => p.memberIds || []));
    const groups = new Map();
    for (const m of members) {
      if (taken.has(m.id)) continue;
      const key = String(m.phone || '').replace(/\D/g, '') || `n:${m.parentName || m.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    return [...groups.values()].map(list => ({ name: `${list.map(m => m.name).join('·')} 가족`, login: list[0].name, memberIds: list.map(m => m.id), members: list }));
  }

  return { gather, compute, state, publish, parentRec, ensureKey, issue, reissue, revoke, reinstate, setRole, rotate, tokenRotated, suggestFamilies, keyring, buildStaff };
}

// 초대 메시지 (복사해서 문자·카톡으로 보냄)
export function inviteMessage(p, siteUrl = 'https://jayangchoir.github.io/') {
  if (p.role === 'staff') {
    return `[자양교회 어린이 합창단] ${p.name} 님 스탭 접속 안내

스탭 화면(연락처 명단·회의자료·간식 당번)과 학부모 화면을 보실 수 있어요.

주소: ${siteUrl}#/login/${encodeURIComponent(p.login)}
이름: ${p.login}
개인 코드: ${p.code}

· 이 코드는 ${p.name} 님만 쓰는 것이에요. 가족에게도 보내지 말아 주세요 (가족은 가족 코드로).
· 연락처가 보이는 화면이니 휴대폰 잠금을 꼭 켜 두세요.`;
  }
  return `[자양교회 어린이 합창단] ${p.name} 접속 안내

학부모 화면(일정·연주곡·악보·영상·사진·공지)을 보시려면 아래 주소를 누르고 접속 코드를 넣어 주세요.

주소: ${siteUrl}#/login/${encodeURIComponent(p.login)}
이름: ${p.login}
접속 코드: ${p.code}

· 이 코드는 우리 가족만 쓰는 것이에요. 다른 분께 보내지 말아 주세요.
· 한 번 넣으면 그 휴대폰에서는 다시 묻지 않아요. 휴대폰을 바꾸면 같은 코드로 다시 들어오시면 돼요.
· 아이들 연락처는 학부모 화면에 나오지 않아요.`;
}
