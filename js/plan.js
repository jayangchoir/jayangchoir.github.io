// 가져오기 계획 → 관리자 데이터에 넣기 (준비된 자료 JSON · 노션 내보내기 zip 이 같은 모양을 쓴다)
//
// 계획 모양:
//   { site: {…}, notices: [{ title, body, date, pinned }], events: [{ date, time, place, title, note }],
//     songs: [{ group(공연·묶음), title(곡), date, order, note, audio: [{label,url}], videos: [{label,url}], scoreFiles: [노션 PDF 이름], files: [{ name, blob }] }],
//     videos: [{ kind: 'perf'|'practice', date, title, urls }],
//     members: [{ name, grade, gender, parentName, phone, note, joined, order }],
//     albums: [{ title, date, note, photos: [{ name, blob }] }] }
//
// 규칙 (여러 번 가져와도 안전하게):
//   - id 는 내용으로 정한다(같은 곡 묶음·같은 날 같은 일정은 같은 id). 그래서 두 번 가져와도 두 개가 되지 않는다.
//   - 이미 있는 기록은 비어 있는 칸만 채우고, 링크 목록은 합친다. 관리자가 고친 내용을 덮어쓰지 않는다. 지우지도 않는다.
//   - 파일(사진·PDF)은 같은 곳에 같은 이름·크기가 이미 있으면 다시 올리지 않는다.

function h32(s, seed = 0x811c9dc5) {
  let h = seed;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const h = s => h32(s).toString(36) + h32(s, 0x2545f491).toString(36);
export const norm = s => String(s || '').normalize('NFC').toLowerCase().replace(/[\s*_~`'"‘’“”\[\]()■□●○·.,:;!?/\\-]+/g, '');

export const ytId = url => {
  const m = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|shorts\/|embed\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
};

export const ids = {
  song: s => `song-${h(`${norm(s.group)}|${norm(s.title)}`)}`,
  event: e => `ev-${h(`${e.date}|${norm(e.title)}|${norm(e.time)}`)}`,
  video: v => `vid-${v.kind === 'practice' ? 'p' : 'f'}-${h(`${v.date}|${(v.urls || []).map(ytId).join(',') || norm(v.title)}`)}`,
  member: m => `mem-${h(norm(m.name))}`,
  album: a => `alb-${h(`${a.date}|${norm(a.title)}`)}`,
  notice: n => `ntc-${h(`${n.date}|${norm(n.title)}`)}`,
};

const empty = v => v == null || v === '' || (Array.isArray(v) && !v.length);
function mergeLinks(a = [], b = []) {
  const out = [...a];
  const seen = new Set(a.map(x => (typeof x === 'string' ? x : x.url)));
  for (const x of b) { const k = typeof x === 'string' ? x : x.url; if (k && !seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

// 있는 기록과 합치기 → 바뀐 것이 있으면 새 기록, 없으면 null
function fill(prev, next, listKeys = []) {
  if (!prev) return next;
  const out = { ...prev };
  let changed = false;
  for (const [k, v] of Object.entries(next)) {
    if (k === 'id' || empty(v)) continue;
    if (listKeys.includes(k)) {
      const m = mergeLinks(prev[k] || [], v);
      if (m.length !== (prev[k] || []).length) { out[k] = m; changed = true; }
    } else if (empty(prev[k])) { out[k] = v; changed = true; }
  }
  return changed ? out : null;
}

// → { counts, queued } . uploads 가 없으면 파일은 건너뛴다(준비된 자료에는 파일이 없다)
export async function applyPlan(plan, { core, uploads = null, media = null, onStep = () => {} }) {
  const counts = {};
  const col = n => core.collection(n);
  const bump = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };

  async function upsert(name, list, idOf, listKeys = []) {
    const out = [];
    const recs = [];
    for (const raw of list || []) {
      const { files, photos, ...body } = raw;
      const id = raw.id || idOf(raw);
      const prev = col(name).get(id);
      const next = fill(prev, { ...body, id }, listKeys);
      if (next) recs.push(next);
      out.push({ id, raw, isNew: !prev });
    }
    if (recs.length) { await col(name).putMany(recs); bump(name, recs.length); }
    return out;
  }

  if (plan.site && Object.keys(plan.site).length) {
    onStep('사이트 안내');
    const prev = col('settings').get('site');
    const next = fill(prev, { ...plan.site, id: 'site' });
    if (next) { await col('settings').put(next); bump('site'); }
  }
  if (plan.public && Object.keys(plan.public).length) {
    const prev = col('settings').get('public');
    const next = fill(prev, { ...plan.public, id: 'public' });
    if (next) { await col('settings').put(next); bump('public'); }
  }
  onStep('공지');
  await upsert('notices', plan.notices, ids.notice);
  onStep('일정');
  await upsert('events', plan.events, ids.event);
  onStep('연주곡');
  // 악보 PDF 는 준비된 자료의 scoreFiles(노션에 있던 PDF 이름)로 알맞은 곡을 찾아 붙인다
  const known = [...col('songs').list(), ...(plan.songs || []).filter(s => s.scoreFiles?.length)];
  const scoreOwner = (name, group) => {
    const k = norm(String(name).replace(/\.pdf$/i, ''));
    const has = x => (x.scoreFiles || []).some(f => norm(String(f).replace(/\.pdf$/i, '')) === k);
    // 같은 PDF 가 여러 공연에 있으면(예: 꽃들도) 같은 묶음의 곡을 먼저
    const s = known.find(x => has(x) && norm(x.group) === norm(group)) || known.find(has);
    return s ? s.id || ids.song(s) : '';
  };
  const songList = [];
  for (const s of plan.songs || []) {
    const files = s.files || [];
    const owner = files.map(f => scoreOwner(f.name, s.group)).find(Boolean);
    songList.push(owner && files.every(f => scoreOwner(f.name, s.group) === owner) ? { ...s, id: owner } : s);
  }
  const songs = await upsert('songs', songList, ids.song, ['audio', 'videos', 'scoreFiles']);
  onStep('영상');
  await upsert('videos', plan.videos, ids.video, ['urls']);
  onStep('명단');
  await upsert('members', plan.members, ids.member);
  onStep('사진첩');
  const albums = await upsert('albums', plan.albums, ids.album);

  // 파일: 같은 곳에 같은 이름·크기가 있으면 건너뛴다
  let queued = 0;
  if (uploads) {
    const have = owner => (media ? media.forOwner(owner) : col('media').list().filter(m => m.owner === owner));
    const pendingNames = new Set((uploads._items ? [...uploads._items.values()] : []).filter(x => x.site !== 'error').map(x => `${x.owner}|${x.name}|${x.size}`));
    const fresh = (owner, f) => !have(owner).some(m => (m.origName || m.name) === f.name || (m.origSize === f.blob.size && m.name.replace(/\.\w+$/, '') === f.name.replace(/\.\w+$/, ''))) && !pendingNames.has(`${owner}|${f.name}|${f.blob.size}`);
    for (const s of songs) {
      const files = (s.raw.files || []).filter(f => fresh(`songs:${s.id}`, f));
      if (files.length) {
        await uploads.add(files.map(f => new File([f.blob], f.name, { type: f.blob.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : '') })), { owner: `songs:${s.id}` });
        queued += files.length;
      }
    }
    for (const a of albums) {
      const photos = (a.raw.photos || []).filter(f => fresh(`albums:${a.id}`, f));
      if (photos.length) {
        const rec = col('albums').get(a.id);
        await uploads.add(photos.map(f => new File([f.blob], f.name, { type: f.blob.type || guessType(f.name) })), { owner: `albums:${a.id}`, album: { id: a.id, title: rec.title, date: rec.date }, original: !!plan.original });
        queued += photos.length;
      }
    }
  }
  return { counts, queued };
}

export function guessType(name) {
  const ext = String(name).toLowerCase().split('.').pop();
  return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf' }[ext] || '';
}
