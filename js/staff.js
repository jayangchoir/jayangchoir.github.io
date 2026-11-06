// 스탭 기록 — 회의자료(첨부 포함)·간식 당번. 스탭과 관리자가 쓴다 (공유 모듈 access.js 의 스탭 등급 항목).
//
//   회의자료 'mtg-<id>'   { kind: 'meeting', title, date, body, attachments: [{ id, name, type, size }], by… }
//   간식     'snk-<id>'   { kind: 'snack', date, who, items, note, by… }
//   첨부     access.publishFile(…, { tier: 'staff' }) → 파일 저장소 choir-files-N (암호화), 회의자료에는 그 항목 id 만
// 같은 기록을 두 사람이 같은 때 고치면 merge.js 로 칸마다 합친다 (같은 칸이면 나중 것 + 진 값은 _conflicts).
// 지우기는 휴지통(access.unpublish)뿐 — 되살릴 수 있다.

import { mergeRecord, sameContent } from './core/merge.js';
import { uid } from './core/core.js';

export const PREFIX = { meetings: 'mtg-', snacks: 'snk-' };
const KIND = { meetings: 'meeting', snacks: 'snack' };

export function createStaffStore({ access }) {
  const guard = () => { if (!access.me()?.canWrite || !access.canSee('staff')) throw Object.assign(new Error('스탭만 쓸 수 있어요.'), { code: 'forbidden' }); };
  const seen = new Map(); // id → 마지막으로 읽은 내용 (합칠 때 기준)
  const who = () => access.me()?.name || '스탭';
  const now = () => new Date().toISOString();

  // → 기록들 (deleted: false | true | 'all')
  async function list(col, { deleted = false } = {}) {
    if (!access.canSee('staff')) throw Object.assign(new Error('스탭만 볼 수 있어요.'), { code: 'forbidden' });
    const out = [];
    for (const it of await access.list('staff', { deleted })) {
      if (!it.id.startsWith(PREFIX[col]) || !it.data) continue;
      const rec = { ...it.data, id: it.id, deletedAt: it.deletedAt || null };
      seen.set(it.id, rec);
      out.push(rec);
    }
    return out;
  }

  async function put(col, rec) {
    guard();
    const id = rec.id || `${PREFIX[col]}${uid()}`;
    const base = seen.get(id);
    if (base && sameContent(base, rec)) return base;
    const body = { ...rec };
    delete body.deletedAt;
    delete body.deletedBy;
    let next = { ...body, id, kind: KIND[col], createdAt: base?.createdAt || rec.createdAt || now(), createdBy: base?.createdBy || rec.createdBy || who(), updatedAt: now(), updatedBy: who() };
    // 그사이 다른 분이 고쳤으면 칸마다 합친다
    if (base) {
      const cur = (await access.list('staff', { deleted: 'all' })).find(i => i.id === id)?.data;
      if (cur && cur.updatedAt !== base.updatedAt) next = mergeRecord(rec.updatedAt === cur.updatedAt ? cur : base, next, { ...cur, id });
    }
    delete next.deletedAt;
    delete next.deletedBy;
    await access.publish({ id, tier: 'staff', data: next });
    seen.set(id, next);
    return next;
  }

  const softDelete = async (col, rec) => { guard(); await access.unpublish(rec.id, 'staff'); };
  const restore = async (col, rec) => { guard(); await access.restore(rec.id, 'staff'); };

  // 첨부 올리기 → [{ id, name, type, size }]
  async function attach(files, onProgress) {
    guard();
    const out = [];
    let i = 0;
    for (const f of files) {
      const r = await access.publishFile(f, { tier: 'staff', name: f.name, type: f.type, data: { kind: 'attachment' } });
      out.push({ id: r.id, name: f.name, type: f.type || '', size: f.size });
      onProgress?.(++i / files.length);
    }
    return out;
  }
  const file = a => access.file(a.id, 'staff');

  return { list, put, softDelete, restore, attach, file };
}
