// 사진·PDF 저장 — 공개 사진 저장소 jayangchoir/choir-photos-1, -2, … (personal-hub 의 my-files-N 과 같은 방식)
//
// - 파일마다 무작위 키로 암호화해서 올린다(tier.js). 키는 관리자 데이터(media 목록, 비공개·암호화)와
//   학부모용 묶음(학부모 비밀번호로 암호화)에만 있다. 저장소는 공개라 토큰 없이 raw.githubusercontent.com 으로 읽는다.
// - 저장소 하나가 약 900MB 가 되면 다음 저장소를 토큰으로 자동으로 만든다 (GitHub 권장: 저장소 1GB 이하).
// - 파일은 8MB 씩 나눠 조각마다 따로 암호화한다 (GitHub 파일 하나 100MB 제한, contents API 도 작은 조각이 안전).
//   경로: m/<yyyy-mm>/<파일id>/<조각 번호>, 작은 그림(사진 목록용)은 m/<yyyy-mm>/<파일id>/t
// - 지우는 함수는 없다. 휴지통에 넣으면 학부모용 묶음에서 빠질 뿐 파일은 그대로다.
//
// media 기록(관리자 데이터, core 의 'media' 목록):
//   { id, kind: 'photo'|'pdf'|'file', name, type, size, stored, parts, thumb, repo, path, key, w, h, owner, order, takenAt }
//   owner = 붙어 있는 곳: 'albums:<id>' · 'songs:<id>' · 'notices:<id>' · 'events:<id>' · 'site:info'

import { encPart, decPart, fileKey } from './tier.js';
import { isConflict } from './core/github.js';
import { uid } from './core/core.js';

export const OWNER = 'jayangchoir';
export const PREFIX = 'choir-photos-';
export const REPO_LIMIT = 900e6;
export const CHUNK = 8 * 1024 * 1024;
export const PDF_WARN = 20e6;
export const PDF_MAX = 95e6;
const OVERHEAD = 28; // 조각마다 iv 12 + 태그 16

export const repoName = n => `${PREFIX}${n}`;
export const rawUrl = (n, path) => `https://raw.githubusercontent.com/${OWNER}/${repoName(n)}/main/${path}`;

// 공개 저장소 파일 읽기 (토큰 없음). raw 가 아직 모르면(막 올린 파일) API 로 한 번 더
export async function fetchPublic(n, path) {
  let r;
  try {
    r = await fetch(rawUrl(n, path), { cache: 'force-cache' });
  } catch {
    throw Object.assign(new Error('인터넷에 연결되어 있지 않아요.'), { status: 0 });
  }
  if (r.status === 404) {
    try {
      r = await fetch(`https://api.github.com/repos/${OWNER}/${repoName(n)}/contents/${path}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
    } catch {
      throw Object.assign(new Error('인터넷에 연결되어 있지 않아요.'), { status: 0 });
    }
  }
  if (!r.ok) throw Object.assign(new Error(r.status === 404 ? '아직 올라가지 않은 파일이에요. 잠시 뒤 다시 열어 주세요.' : `파일을 받지 못했어요 (${r.status})`), { status: r.status });
  return new Uint8Array(await r.arrayBuffer());
}

// 파일 정보(관리자 media 기록이든 학부모 묶음의 칸이든) → 같은 모양
// 학부모 묶음의 칸: { n: 이름, t: 형식, s: 크기, r: 저장소 번호, p: 경로, c: 조각 수, k: 키, th: 작은 그림 있음, w, h }
export const toEntry = m => ({ n: m.name, t: m.type, s: m.size, r: m.repo, p: m.path, c: m.parts, k: m.key, ...(m.thumb ? { th: 1 } : {}), ...(m.w ? { w: m.w, h: m.h } : {}) });

// 내용 전체 → Blob. read(n, path) 는 공개 저장소 읽기 (시험에서는 가짜)
export async function readEntry(id, e, read = fetchPublic, onProgress) {
  const key = await fileKey(e.k);
  const parts = [];
  for (let i = 0; i < (e.c || 1); i++) {
    parts.push(await decPart(key, id, i, await read(e.r, `${e.p}/${i}`)));
    onProgress?.((i + 1) / (e.c || 1));
  }
  return new Blob(parts, { type: e.t || 'application/octet-stream' });
}

export async function readThumb(id, e, read = fetchPublic) {
  if (!e.th) return readEntry(id, e, read);
  const key = await fileKey(e.k);
  return new Blob([await decPart(key, id, 't', await read(e.r, `${e.p}/t`))], { type: e.t?.startsWith('image/') ? 'image/jpeg' : '' });
}

export function createMedia({ core, limit = REPO_LIMIT, read = fetchPublic } = {}) {
  const col = () => core.collection('media');
  const settings = () => core.collection('settings');

  // 저장소마다 쓴 양 (휴지통에 있는 것도 저장소에는 그대로 있으므로 센다)
  function usage() {
    const known = settings().get('storage')?.repos || [];
    const map = new Map(known.map(n => [n, { n, name: repoName(n), bytes: 0, count: 0 }]));
    for (const m of col().list({ deleted: 'all' })) {
      if (!m.repo) continue;
      if (!map.has(m.repo)) map.set(m.repo, { n: m.repo, name: repoName(m.repo), bytes: 0, count: 0 });
      const u = map.get(m.repo);
      u.bytes += m.stored || m.size || 0;
      u.count++;
    }
    return [...map.values()].sort((a, b) => a.n - b.n).map(u => ({ ...u, limit, pct: Math.min(100, Math.round((u.bytes / limit) * 1000) / 10) }));
  }

  // 이 크기를 넣을 저장소 번호. 지금 것이 차면 다음 것을 만든다
  async function pickRepo(size) {
    const u = usage();
    let cur = u[u.length - 1];
    if (cur && cur.bytes + size <= limit) return cur.n;
    if (cur && cur.bytes === 0) return cur.n; // 빈 저장소에는 큰 파일 하나라도 넣는다
    const n = cur ? cur.n + 1 : 1;
    await core.account().createRepo(repoName(n), { description: '자양교회 어린이 합창단 사진·악보 (암호화되어 있음)', private: false });
    const st = settings().get('storage') || { id: 'storage', repos: [] };
    await settings().put({ ...st, id: 'storage', repos: [...new Set([...(st.repos || []), n])].sort((a, b) => a - b) });
    return n;
  }

  // 조각 하나 올리기. 이미 있으면(지난번에 올리고 끊김) 그대로 둔다 — 같은 키로 암호화한 것이라 열린다
  async function putPart(be, path, bytes) {
    try {
      await be.put(path, bytes, null, 'file');
    } catch (e) {
      if (!isConflict(e)) throw e;
      if (!(await be.get(path))) throw e;
    }
  }

  // 준비된 파일 올리기. job 은 다시 시도해도 같은 결과가 되도록 id·key·repo·path 를 들고 다닌다(올리기 대기열이 저장)
  //   job: { id, key, kind, name, type, owner, data: Uint8Array, thumb?: Uint8Array, w, h, origSize, repo?, path? }
  //   save(job) 은 repo·path 가 정해졌을 때 불린다 (대기열에 적어 두기)
  async function upload(job, { onProgress, save } = {}) {
    const n = Math.max(1, Math.ceil(job.data.length / CHUNK));
    const stored = job.data.length + n * OVERHEAD + (job.thumb ? job.thumb.length + OVERHEAD : 0);
    if (!job.repo) {
      job.repo = await pickRepo(stored);
      const d = new Date();
      job.path = `m/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}/${job.id}`;
      await save?.(job);
    }
    const be = core.backend({ owner: OWNER, repo: repoName(job.repo) });
    const key = await fileKey(job.key);
    const total = n + (job.thumb ? 1 : 0);
    let done = 0;
    if (job.thumb) {
      await putPart(be, `${job.path}/t`, await encPart(key, job.id, 't', job.thumb));
      onProgress?.(++done / total);
    }
    for (let i = 0; i < n; i++) {
      await putPart(be, `${job.path}/${i}`, await encPart(key, job.id, i, job.data.subarray(i * CHUNK, (i + 1) * CHUNK)));
      onProgress?.(++done / total);
    }
    const rec = {
      id: job.id, kind: job.kind, name: job.name, type: job.type, size: job.data.length, stored, parts: n,
      thumb: !!job.thumb, repo: job.repo, path: job.path, key: job.key, owner: job.owner,
      ...(job.w ? { w: job.w, h: job.h } : {}), ...(job.origSize ? { origSize: job.origSize } : {}), ...(job.origName && job.origName !== job.name ? { origName: job.origName } : {}),
      ...(job.takenAt ? { takenAt: job.takenAt } : {}), order: job.order ?? Date.now(),
    };
    return col().put(rec);
  }

  const forOwner = owner => col().list().filter(m => m.owner === owner).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt < b.createdAt ? -1 : 1));
  const blob = (m, onProgress) => readEntry(m.id, toEntry(m), read, onProgress);
  const thumb = m => readThumb(m.id, toEntry(m), read);

  return { usage, pickRepo, upload, forOwner, blob, thumb, newId: uid, limit };
}
