// 두 사람이 같은 때 고친 기록을 합치기 (3-way merge, 기록 하나 단위)
//
// base   = 두 쪽이 마지막으로 함께 본 내용 (이 기기가 마지막으로 GitHub와 맞춘 것)
// local  = 이 기기의 지금 내용
// remote = GitHub에 있는 지금 내용 (다른 기기가 올린 것)
//
// 규칙 — 누구의 고친 것도 소리 없이 사라지지 않게:
//   1. 한쪽만 바꿨으면 그쪽 것.
//   2. 둘 다 바꿨으면 항목(필드)마다 다시 본다. 한쪽만 바꾼 항목은 그쪽 것.
//   3. 같은 항목을 둘 다 다르게 바꿨으면 나중에 고친 쪽(updatedAt, 같으면 updatedBy 순)으로 하고,
//      진 쪽 값은 _conflicts 에 { field, value, by, at } 로 남긴다. 화면에서 보여 주고 되돌릴 수 있다.
//   4. 한쪽은 지우고(휴지통) 다른 쪽은 내용을 고쳤으면 → 지우지 않고 남긴다 (_conflicts 에 '지움' 기록).
//   5. 한쪽에만 있는 기록은 남긴다. 기록은 합치기로 사라지지 않는다.

export const META = new Set(['id', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'deletedAt', 'deletedBy', '_conflicts']);
const MAX_CONFLICTS = 30;

// 키 순서와 상관없이 같은 값이면 같은 글자
export function canon(v) {
  if (v === undefined) return 'u';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
}
export const same = (a, b) => canon(a) === canon(b);

// 내용 항목(메타 정보 빼고)만 비교
export function contentOf(r) {
  const o = {};
  if (r) for (const k of Object.keys(r)) if (!META.has(k)) o[k] = r[k];
  return o;
}
export const sameContent = (a, b) => same(contentOf(a), contentOf(b));

// a가 b보다 나중에 고친 것이면 true
function newer(a, b) {
  const ta = a.updatedAt || '';
  const tb = b.updatedAt || '';
  if (ta !== tb) return ta > tb;
  return String(a.updatedBy || '') >= String(b.updatedBy || '');
}

function addConflicts(list, add) {
  const seen = new Set(list.map(canon));
  for (const c of add) {
    const k = canon(c);
    if (!seen.has(k)) { seen.add(k); list.push(c); }
  }
  return list.slice(-MAX_CONFLICTS);
}

export function mergeRecord(base, local, remote) {
  if (local === undefined) return remote;
  if (remote === undefined) return local;
  if (same(local, remote)) return local;
  if (base !== undefined && same(base, local)) return remote;
  if (base !== undefined && same(base, remote)) return local;

  // 둘 다 바꿈
  const lw = newer(local, remote);
  const win = lw ? local : remote;
  const lose = lw ? remote : local;
  const b = base || {};
  const out = { id: local.id };
  let conflicts = addConflicts([...(remote._conflicts || [])], local._conflicts || []);
  const lost = [];

  const fields = new Set([...Object.keys(local), ...Object.keys(remote)].filter(k => !META.has(k)));
  let localEdited = false;
  let remoteEdited = false;
  for (const f of fields) {
    const l = local[f];
    const r = remote[f];
    const bv = base ? b[f] : undefined;
    if (base && !same(bv, l)) localEdited = true;
    if (base && !same(bv, r)) remoteEdited = true;
    let v;
    if (same(l, r)) v = l;
    else if (base && same(bv, l)) v = r;
    else if (base && same(bv, r)) v = l;
    else {
      v = win[f];
      lost.push({ field: f, value: lose[f] === undefined ? null : lose[f], by: lose.updatedBy || '', at: lose.updatedAt || '' });
    }
    if (v !== undefined) out[f] = v;
  }
  if (!base) { localEdited = true; remoteEdited = true; }

  // 휴지통 표시
  const ld = local.deletedAt || null;
  const rd = remote.deletedAt || null;
  const bd = base ? base.deletedAt || null : null;
  let del;
  if (ld === rd) del = local;
  else if (base && ld === bd) del = remote;
  else if (base && rd === bd) del = local;
  else del = win;
  out.deletedAt = del.deletedAt || null;
  out.deletedBy = del.deletedBy || null;
  // 한쪽이 지웠는데 다른 쪽이 같은 때 내용을 고쳤다 → 남긴다
  if (out.deletedAt && base && !bd) {
    const deleter = ld && !rd ? local : rd && !ld ? remote : null;
    const otherEdited = deleter === local ? remoteEdited : deleter === remote ? localEdited : false;
    if (deleter && otherEdited) {
      lost.push({ field: 'deletedAt', value: out.deletedAt, by: deleter.deletedBy || deleter.updatedBy || '', at: deleter.deletedAt, note: 'kept' });
      out.deletedAt = null;
      out.deletedBy = null;
    }
  }

  // 만든 때는 이른 쪽, 고친 때는 늦은 쪽
  const early = (local.createdAt || '~') <= (remote.createdAt || '~') ? local : remote;
  out.createdAt = early.createdAt;
  out.createdBy = early.createdBy;
  out.updatedAt = win.updatedAt;
  out.updatedBy = win.updatedBy;
  conflicts = addConflicts(conflicts, lost);
  if (conflicts.length) out._conflicts = conflicts;
  return out;
}
