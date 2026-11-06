// "학부모 화면에 반영" — 관리자 데이터(비공개 core) → 공유 모듈 access.js 의 등급 항목(공개 사이트 저장소)
//
//   공개   'site'          소개·입단 안내·공개 영상 (평문)              ← bundle.js buildPublic
//   학부모 'content'       공지·일정·연주곡·영상·앨범 요약·명단(이름·학년)·파일 키  ← buildBundle
//          'album-<id>'    앨범마다 사진 목록(+ 사진 키)
//   스탭   'staff-info'    연락처가 든 명단·예금주·문의 담당·가족·스탭 목록        ← buildStaff
// (스탭이 쓰는 회의자료·간식은 staff.js 가 스탭 등급 항목으로 직접 올린다)
//
// 올리기 전에 assertNoContacts 로 학부모·공개 항목을 한 번 더 훑는다 — 연락처가 보이면 올리지 않는다.
// 바뀐 항목만 올린다. 무엇을 올렸는지는 settings/publish 에 지문(hash)으로 남긴다(관리자 기기끼리 같이 봄).
// 가족 탈퇴·코드 회수·역할 바꾸기·열쇠 바꾸기는 access.js 의 admin(revoke 등)이 커밋 하나로 한다.
// 반영은 바뀐 항목을 모두 모아 access.publishMany 로 커밋 하나, 가족 여러 개는 addFamilies(admin.addPeople)로 커밋 하나.

import { buildBundle, buildPublic, assertNoContacts, sortMembers, SITE_PRIVATE, SITE_PUBLIC } from './bundle.js';
import { ITEM } from './access-config.js';
import { canon } from './core/merge.js';

const COLS = ['settings', 'notices', 'events', 'songs', 'videos', 'albums', 'members', 'media'];

async function sha(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

export function createPublisher({ core, access, getAdmin = async () => null }) {
  const settings = () => core.collection('settings');
  const rec = () => settings().get('publish') || { id: 'publish', hashes: {} };

  function gather() {
    const data = {};
    for (const c of COLS) data[c] = core.collection(c).list();
    return data;
  }

  // 스탭 등급: 연락처가 든 명단 전체, 비공개 안내, 가족·스탭 목록(코드 없이)
  async function buildStaff(data) {
    const site = (data.settings || []).find(x => x.id === 'site') || {};
    const admin = await getAdmin();
    const people = admin ? await admin.people() : [];
    const fams = new Map(core.collection('families').list().map(f => [f.id, f]));
    return {
      v: 1,
      members: sortMembers(data.members || []).map(m => ({ id: m.id, name: m.name, grade: m.grade, gender: m.gender || '', parentName: m.parentName || '', phone: m.phone || '', note: m.note || '', joined: m.joined || '' })),
      site: Object.fromEntries([...SITE_PUBLIC, ...SITE_PRIVATE].filter(k => site[k]).map(k => [k, site[k]])),
      families: people.filter(p => p.role === 'parent' && p.status === 'active').map(p => ({ id: p.id, name: p.name, memberIds: fams.get(p.id)?.memberIds || [] })),
      staff: people.filter(p => p.role === 'staff' && p.status === 'active').map(p => ({ id: p.id, name: p.name, labels: p.labels || [] })),
    };
  }

  // 올릴 항목들 → [{ key, id, tier, data, hash }]
  async function compute() {
    const data = gather();
    const { bundle, albums } = buildBundle(data);
    const items = [];
    const add = async (tier, id, obj) => items.push({ key: `${tier}/${id}`, tier, id, data: obj, hash: await sha(canon(obj)) });
    for (const [id, a] of albums) await add('parent', ITEM.album(id), a);
    for (const a of bundle.albums) a.rev = items.find(x => x.id === ITEM.album(a.id))?.hash || '';
    await add('parent', ITEM.content, bundle);
    await add('public', ITEM.public, buildPublic(data));
    await add('staff', ITEM.staff, await buildStaff(data));
    return { data, bundle, albums, items };
  }

  async function state() {
    const r = rec();
    const { items } = await compute();
    const gone = Object.keys(r.hashes || {}).filter(k => k.startsWith('parent/album-') && !items.some(x => x.key === k));
    return {
      dirty: items.some(x => r.hashes?.[x.key] !== x.hash) || gone.length > 0,
      publishedAt: r.publishedAt || '', publishedBy: r.publishedBy || '', tokenWarn: r.tokenWarn || null,
    };
  }

  // 반영은 한 번에 하나씩 차례로
  let chain = Promise.resolve();
  function publish({ all = false } = {}) {
    const p = chain.catch(() => {}).then(() => doPublish(all));
    chain = p;
    return p;
  }

  async function doPublish(all) {
    const me = access.me();
    if (!me?.canWrite || !me.isAdmin) throw Object.assign(new Error('관리자로 로그인해야 반영할 수 있어요.'), { code: 'not-admin' });
    await core.sync();
    const { data, bundle, albums, items } = await compute();
    // 올리기 전 마지막 확인: 연락처·부모님 이름·예금주가 학부모 항목·공개 항목에 없어야 한다
    assertNoContacts([bundle, ...albums.values()], data);
    assertNoContacts([items.find(x => x.tier === 'public').data], data);
    const r = rec();
    const hashes = { ...(r.hashes || {}) };
    const done = [];
    // 바뀐 항목 + 지운·숨긴 앨범(휴지통, 암호문은 지우지 않음)을 모아 공개 저장소 커밋 하나로 (access.publishMany).
    // 한 커밋이라 내용(content)이 가리키는 앨범이 아직 없는 순간이 생기지 않는다
    const todo = items.filter(it => all || hashes[it.key] !== it.hash);
    const gone = Object.keys(hashes).filter(k => k.startsWith('parent/album-') && !items.some(x => x.key === k));
    const batch = [...todo.map(it => ({ id: it.id, tier: it.tier, data: it.data })), ...gone.map(k => ({ id: k.slice('parent/'.length), tier: 'parent', trash: true }))];
    if (!batch.length) return { changed: 0, items: [] };
    await access.publishMany(batch, { message: `반영 ${batch.length}개` });
    for (const it of todo) { hashes[it.key] = it.hash; done.push(it.key); }
    for (const k of gone) { delete hashes[k]; done.push(`-${k}`); }
    await settings().put({ ...rec(), id: 'publish', hashes, publishedAt: new Date().toISOString(), publishedBy: me.name || core.status().user || '' });
    core.sync();
    return { changed: done.length, items: done };
  }

  // 쓰기 역할(스탭)을 막거나 낮춘 뒤: 토큰을 바꾸라는 알림 (그 사람이 쓰기 토큰을 받아 갔을 수 있음)
  const warnToken = async name => settings().put({ ...rec(), id: 'publish', tokenWarn: { at: new Date().toISOString(), name } });
  const clearTokenWarn = async () => settings().put({ ...rec(), id: 'publish', tokenWarn: null });

  // 명단의 부모님 연락처(또는 이름)로 형제·자매를 한 가족으로 묶어, 아직 가족 코드가 없는 아이들의 가족을 제안한다
  async function suggestFamilies() {
    const admin = await getAdmin();
    const people = admin ? await admin.people() : [];
    const activeFam = new Set(people.filter(p => p.role === 'parent' && p.status === 'active').map(p => p.id));
    const taken = new Set(core.collection('families').list().filter(f => activeFam.has(f.id)).flatMap(f => f.memberIds || []));
    const groups = new Map();
    for (const m of core.collection('members').list()) {
      if (taken.has(m.id)) continue;
      const key = String(m.phone || '').replace(/\D/g, '') || `n:${m.parentName || m.id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    return [...groups.values()].map(list => ({ name: `${list.map(m => m.name).join('·')} 가족`, identifier: list[0].name, memberIds: list.map(m => m.id), members: list }));
  }

  // 가족 하나 추가 → { person, code, invitation }  (코드는 이때 한 번만 보인다)
  async function addFamily({ name, identifier, memberIds }) {
    const admin = await getAdmin();
    const r = await admin.addPerson({ name, identifier, role: 'parent' });
    await core.collection('families').put({ id: r.person.id, memberIds: memberIds || [] });
    return r;
  }

  // 가족 여러 개를 한 번에 (명단으로 가족 만들기) → 넣은 순서대로 [{ person, code, invitation } | { error, input }]
  // admin.addPeople 로 공개 저장소 커밋 하나 (가족 수와 상관없음). 가족 목록(families)도 한 번에 저장
  async function addFamilies(list, { onProgress } = {}) {
    const admin = await getAdmin();
    const res = await admin.addPeople(list.map(({ name, identifier }) => ({ name, identifier, role: 'parent' })), { onProgress });
    const fams = res.map((r, i) => (r.person ? { id: r.person.id, memberIds: list[i].memberIds || [] } : null)).filter(Boolean);
    if (fams.length) await core.collection('families').putMany(fams);
    return res;
  }

  return { gather, compute, state, publish, buildStaff, suggestFamilies, addFamily, addFamilies, warnToken, clearTokenWarn };
}
