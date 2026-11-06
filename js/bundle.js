// 관리자 데이터 → 학부모용 묶음 (공개 저장소에 암호문으로 올라가는 것)
//
// ★ 허용 목록 방식: 아래에 적은 칸만 옮긴다. 새 칸을 관리자 데이터에 더해도 여기에 적지 않으면 학부모 쪽에 가지 않는다.
// ★ 학부모 쪽에 절대 가면 안 되는 것 (관리자 화면에서만):
//    명단의 부모님 이름·연락처·비고·성별·입단일, 회비 계좌의 예금주, 문의 연락처(이름·전화)
// 그리고 올리기 전에 assertNoContacts() 가 묶음 전체를 한 번 더 훑어서, 위 값이나 휴대폰 번호 모양이 보이면 올리지 않는다.

export const SITE_PUBLIC = ['title', 'welcome', 'intro', 'practice', 'activity', 'fees', 'bankName', 'bankAccount', 'contactNote', 'youtube', 'videoNote', 'practiceTime', 'practicePlace'];
export const SITE_PRIVATE = ['accountHolder', 'contactName', 'contactPhone'];
export const MEMBER_PUBLIC = ['name', 'grade'];
export const MEMBER_PRIVATE = ['parentName', 'phone', 'note', 'gender', 'joined'];

const GRADE_ORDER = g => {
  const s = String(g ?? '').trim();
  const m = s.match(/^(중|고)?\s*(\d+)/);
  if (!m) return 99;
  return (m[1] === '중' ? 6 : m[1] === '고' ? 9 : 0) + Number(m[2]);
};
export const sortMembers = list => list.slice().sort((a, b) => GRADE_ORDER(a.grade) - GRADE_ORDER(b.grade) || (a.order ?? 999) - (b.order ?? 999) || String(a.name).localeCompare(String(b.name), 'ko'));

const pick = (o, keys) => {
  const out = {};
  for (const k of keys) if (o?.[k] !== undefined && o[k] !== null && o[k] !== '') out[k] = o[k];
  return out;
};
const links = list => (Array.isArray(list) ? list : []).filter(x => x?.url).map(x => ({ label: String(x.label || ''), url: String(x.url) }));
const byDate = (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (a.order ?? 0) - (b.order ?? 0);
const entry = m => ({ n: m.name, t: m.type, s: m.size, r: m.repo, p: m.path, c: m.parts, k: m.key, ...(m.thumb ? { th: 1 } : {}), ...(m.w ? { w: m.w, h: m.h } : {}) });

// data: { settings: [..], notices, events, songs, videos, albums, members, media } — 휴지통 뺀 목록들
// → { bundle, albums: Map(albumId → 앨범 사진 목록) }
export function buildBundle(data) {
  const site = (data.settings || []).find(s => s.id === 'site') || {};
  const media = (data.media || []).filter(m => !m.deletedAt && m.repo && m.key);
  const byOwner = new Map();
  for (const m of media) {
    if (!byOwner.has(m.owner)) byOwner.set(m.owner, []);
    byOwner.get(m.owner).push(m);
  }
  for (const l of byOwner.values()) l.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id)));
  const files = {};
  const attach = owner => (byOwner.get(owner) || []).filter(m => m.kind !== 'photo' || !owner.startsWith('albums:')).map(m => { files[m.id] = entry(m); return m.id; });

  const bundle = {
    v: 1,
    site: { ...pick(site, SITE_PUBLIC), files: attach('site:info'), cover: (byOwner.get('site:cover') || []).filter(m => m.kind === 'photo').map(m => { files[m.id] = entry(m); return m.id; }).pop() || '' },
    notices: (data.notices || []).map(n => ({ id: n.id, title: String(n.title || ''), body: String(n.body || ''), date: n.date || '', pinned: !!n.pinned, at: n.createdAt || '', files: attach(`notices:${n.id}`) }))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || byDate(a, b)),
    events: (data.events || []).map(e => ({ id: e.id, date: e.date || '', end: e.end || '', time: String(e.time || ''), place: String(e.place || ''), title: String(e.title || ''), note: String(e.note || ''), kind: e.kind || '', files: attach(`events:${e.id}`) }))
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.time.localeCompare(b.time)),
    songs: (data.songs || []).map(s => ({ id: s.id, group: String(s.group || ''), title: String(s.title || ''), date: s.date || '', order: s.order ?? 0, note: String(s.note || ''), audio: links(s.audio), videos: links(s.videos), files: attach(`songs:${s.id}`) }))
      .sort((a, b) => byDate(a, b)),
    videos: (data.videos || []).map(v => ({ id: v.id, kind: v.kind === 'practice' ? 'practice' : 'perf', date: v.date || '', title: String(v.title || ''), note: String(v.note || ''), urls: (v.urls || []).map(String).filter(Boolean) }))
      .sort(byDate),
    albums: [],
    roster: sortMembers(data.members || []).map(m => ({ id: m.id, ...pick(m, MEMBER_PUBLIC) })),
    files,
  };
  const albums = new Map();
  for (const a of (data.albums || []).filter(a => !a.hidden).slice().sort(byDate)) {
    const photos = (byOwner.get(`albums:${a.id}`) || []).filter(m => m.kind === 'photo');
    const extra = (byOwner.get(`albums:${a.id}`) || []).filter(m => m.kind !== 'photo');
    for (const m of extra) files[m.id] = entry(m);
    const coverM = photos.find(p => p.id === a.cover) || photos[0];
    if (coverM) files[coverM.id] = entry(coverM);
    bundle.albums.push({ id: a.id, title: String(a.title || ''), date: a.date || '', note: String(a.note || ''), count: photos.length, cover: coverM?.id || '', files: extra.map(m => m.id) });
    albums.set(a.id, { id: a.id, photos: photos.map(p => ({ id: p.id, ...entry(p) })) });
  }
  return { bundle, albums };
}

// ---------- 연락처가 섞여 들어가지 않았는지 ----------
const digits = s => String(s || '').replace(/\D/g, '');
export const PHONE_RE = /01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}/;

// 학부모 쪽에 가면 안 되는 값 모으기
export function secretValues(data) {
  const vals = new Set();
  const phones = new Set();
  const add = v => { const s = String(v || '').trim(); if ([...s].length >= 3) vals.add(s); };
  const addPhone = v => { const d = digits(v); if (d.length >= 7) phones.add(d); };
  for (const m of data.members || []) {
    add(m.parentName);
    addPhone(m.phone);
    for (const ph of String(m.note || '').match(new RegExp(PHONE_RE.source, 'g')) || []) addPhone(ph);
    for (const ph of String(m.note || '').match(/\d{9,11}/g) || []) addPhone(ph);
  }
  const site = (data.settings || []).find(s => s.id === 'site') || {};
  add(site.accountHolder);
  add(site.contactName);
  addPhone(site.contactPhone);
  return { vals, phones };
}

// 묶음 글자 안에 비밀 값이 있으면 CoreError 처럼 { code, message } 를 던진다
export function assertNoContacts(objs, data) {
  const { vals, phones } = secretValues(data);
  const text = objs.map(o => (typeof o === 'string' ? o : JSON.stringify(o))).join('\n');
  // 파일 키(base64) 안에 우연히 숫자가 이어질 수 있으므로 숫자 비교는 키 칸을 뺀 글자로
  const plain = text.replace(/"k":"[A-Za-z0-9+/=]+"/g, '');
  const found = [];
  for (const v of vals) if (plain.includes(v)) found.push(`“${v}”`);
  // 띄어쓰기·하이픈·점·괄호를 뺀 글자에서 번호를 찾는다 (JSON 의 다른 숫자끼리는 쉼표·따옴표로 떨어져 있어 붙지 않는다)
  const squeezed = plain.replace(/[\s.\-()]/g, '');
  for (const p of phones) if (squeezed.includes(p)) found.push(`전화번호 …${p.slice(-4)}`);
  const m = plain.match(PHONE_RE);
  if (m) found.push(`휴대폰 번호 모양 …${digits(m[0]).slice(-4)}`);
  if (found.length) {
    const e = new Error(`학부모 화면에 보이면 안 되는 연락처가 내용에 들어 있어서 반영하지 않았어요: ${[...new Set(found)].slice(0, 5).join(', ')}. 공지·일정·안내 글을 확인해 주세요.`);
    e.code = 'contact-leak';
    throw e;
  }
}
