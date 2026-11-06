// 스탭 기록 — 회의자료(첨부 포함)·간식 당번. 스탭과 관리자가 쓴다.
//
// 기록마다 파일 하나: 공개 사이트 저장소 p/s/<목록>/<id>.json = 항목 키로 암호화, 항목 키는 스탭 키 K_staff 로 감쌈 (tier.js sealItem).
// 쓰기는 스탭 묶음에 든 GitHub 토큰으로 (관리자는 core 의 토큰). 같은 기록을 두 사람이 동시에 고치면 merge.js 로 합친다
// (같은 칸이면 나중 것 + 진 값은 _conflicts). 지우기는 휴지통(deletedAt)뿐.
// 첨부 파일은 사진 저장소(choir-photos-N)에 파일마다 다른 키로 암호화해 두고, 그 키는 기록 안(스탭만 열 수 있음)에만 있다.

import { GitHubBackend, isConflict } from './core/github.js';
import { mergeRecord, sameContent } from './core/merge.js';
import { uid } from './core/core.js';
import { sealItem, openItem, staffRecPath, newFileKey, fileKey, encPart } from './tier.js';
import { CHUNK, OWNER, repoName, readEntry } from './media.js';
import { SITE_REPO } from './publish.js';

export const STAFF_COLS = ['meetings', 'snacks'];

export function createStaffStore({ session, backendFor = (token, dev) => new GitHubBackend({ token, ...dev }), site = SITE_REPO }) {
  const guard = () => { if (!session.token || !session.keys.staff) throw Object.assign(new Error('스탭만 쓸 수 있어요.'), { code: 'forbidden' }); };
  const be = () => {
    guard();
    return backendFor(session.token, { ...site, branch: 'main' });
  };
  const cache = new Map(); // 경로 → { sha, rec }
  const who = () => session.person?.name || '스탭';
  const now = () => new Date().toISOString();

  async function read(path, sha) {
    const c = cache.get(path);
    if (c && c.sha === sha) return c.rec;
    const got = await be().get(path);
    if (!got) return null;
    const rec = await openItem(session.keys.staff, JSON.parse(new TextDecoder().decode(got.bytes)), path);
    cache.set(path, { sha: got.sha, rec });
    return rec;
  }

  // → 기록들 (deleted: false 기본, true 면 휴지통만, 'all')
  async function list(col, { deleted = false } = {}) {
    guard();
    const pre = `p/s/${col}/`;
    const out = [];
    for (const f of await be().tree()) {
      if (!f.path.startsWith(pre) || !f.path.endsWith('.json')) continue;
      try { const r = await read(f.path, f.sha); if (r) out.push(r); } catch (e) { console.warn('[staff] 못 연 기록', f.path, e); }
    }
    return out.filter(r => (deleted === 'all' ? true : deleted ? !!r.deletedAt : !r.deletedAt));
  }

  async function put(col, rec) {
    guard();
    const id = rec.id || uid();
    const path = staffRecPath(col, id);
    const prev = cache.get(path);
    const base = prev?.rec;
    if (base && sameContent(base, rec)) return base;
    let next = { ...rec, id, createdAt: base?.createdAt || now(), createdBy: base?.createdBy || who(), updatedAt: now(), updatedBy: who(), deletedAt: rec.deletedAt ?? base?.deletedAt ?? null, deletedBy: rec.deletedBy ?? base?.deletedBy ?? null };
    let sha = prev?.sha || null;
    for (let i = 0; i < 5; i++) {
      const env = await sealItem(session.keys.staff, next, path, 'staff');
      try {
        const nsha = await be().put(path, new TextEncoder().encode(JSON.stringify(env)), sha, `스탭 ${col}`);
        cache.set(path, { sha: nsha, rec: next });
        return next;
      } catch (e) {
        if (!isConflict(e)) throw e;
        // 다른 분이 먼저 고쳤음 → 받아서 합친 뒤 다시
        const got = await be().get(path);
        if (!got) { sha = null; continue; }
        const remote = await openItem(session.keys.staff, JSON.parse(new TextDecoder().decode(got.bytes)), path);
        // 부른 쪽이 고친 것이 바로 이 최신본이면 그것이 기준(덮어써도 됨), 아니면 이 기기가 마지막으로 본 것이 기준
        next = mergeRecord(rec.updatedAt && rec.updatedAt === remote.updatedAt ? remote : base, next, remote);
        sha = got.sha;
      }
    }
    throw new Error('다른 분과 동시에 고치느라 저장하지 못했어요. 다시 해 주세요.');
  }

  const softDelete = async (col, rec) => put(col, { ...rec, deletedAt: now(), deletedBy: who() });
  const restore = async (col, rec) => put(col, { ...rec, deletedAt: null, deletedBy: null });

  // 첨부 올리기 → [{ id, n, t, s, r, p, c, k }]
  async function attach(files, onProgress) {
    guard();
    const n = session.staff?.repo || 1;
    const out = [];
    let i = 0;
    for (const f of files) {
      if (f.size > 95e6) throw new Error(`${f.name}: 95MB 보다 큰 파일은 올릴 수 없어요.`);
      const id = uid();
      const k = newFileKey();
      const key = await fileKey(k);
      const bytes = new Uint8Array(await f.arrayBuffer());
      const parts = Math.max(1, Math.ceil(bytes.length / CHUNK));
      const d = new Date();
      const p = `m/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}/${id}`;
      const pbe = backendFor(session.token, { owner: OWNER, repo: repoName(n), branch: 'main' });
      for (let j = 0; j < parts; j++) {
        await pbe.put(`${p}/${j}`, await encPart(key, id, j, bytes.subarray(j * CHUNK, (j + 1) * CHUNK)), null, 'file');
        onProgress?.((i + (j + 1) / parts) / files.length);
      }
      out.push({ id, n: f.name, t: f.type || '', s: bytes.length, r: n, p, c: parts, k });
      i++;
    }
    return out;
  }
  const file = (e, onProgress) => readEntry(e.id, e, session.read, onProgress);

  return { list, put, softDelete, restore, attach, file };
}
