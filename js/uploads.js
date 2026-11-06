// 올리기 대기열 — 사진·PDF 를 여러 개 한꺼번에, 끊겨도 이어서
//
// 고른 파일(원본)을 먼저 이 기기 IndexedDB 에 넣어 두고, 두 일꾼이 따로 처리한다:
//   사이트 일꾼  원본 → (사진이면 1600px·400KB 이하로 줄이고 EXIF 지움 + 400px 작은 그림) → 암호화 → 사진 저장소 → media 기록
//   원본 일꾼    사진 원본을 그대로 Google 포토(또는 Drive)에 (google.js). 사이트 쪽을 기다리지도, 막지도 않는다
// 둘 다 끝난 항목만 대기열에서 빠진다. 새로고침·인터넷 끊김·탭 닫기 뒤에도 다음에 관리자 화면을 열면 이어서 한다.
//
// 항목: { qid, kind: 'photo'|'pdf'|'file', owner, album?: { id, title, date }, file: Blob, name, type, size,
//         id, key, repo?, path?, site: 'pending'|'done'|'error', siteErr, orig: 'pending'|'done'|'error'|'off', origErr, gTok?, gTokAt?, at }

import { KV } from './core/kv.js';
import { prepareImage, isRaster } from './core/image.js';
import { newFileKey } from './tier.js';
import { PDF_MAX } from './media.js';

export const PHOTO = { maxDim: 1600, quality: 0.82, maxBytes: 400e3 };
export const THUMB = { maxDim: 400, quality: 0.72, maxBytes: 60e3 };

export function kindOf(file) {
  const t = file.type || '';
  if (/^image\//.test(t) && t !== 'image/svg+xml') return 'photo';
  if (t === 'application/pdf' || /\.pdf$/i.test(file.name || '')) return 'pdf';
  return 'file';
}

export function createUploads({ media, dbName = 'jayangchoir-uploads', google = null, onChange = () => {} } = {}) {
  const kv = new KV(dbName);
  const items = new Map(); // qid → 항목 (화면 표시용으로 끝난 것도 잠시 남긴다)
  const progress = new Map(); // qid → 0..1
  let loaded = null;
  let siteRun = null;
  let origRun = null;
  let stopped = false;

  const emit = () => { try { onChange(snapshot()); } catch (e) { console.error(e); } };
  const save = async it => { if (it.site !== 'done' || (it.orig !== 'done' && it.orig !== 'off')) await kv.set(`q:${it.qid}`, it); else await kv.del(`q:${it.qid}`); };

  async function load() {
    if (!loaded) {
      loaded = (async () => {
        for (const k of await kv.keys()) {
          if (typeof k !== 'string' || !k.startsWith('q:')) continue;
          const it = await kv.get(k);
          if (it) items.set(it.qid, it);
        }
      })();
    }
    return loaded;
  }

  // 파일 여러 개 넣기 → 바로 돌려주고 뒤에서 올린다
  async function add(files, { owner, album = null, original = false } = {}) {
    await load();
    const out = [];
    let order = Date.now();
    for (const f of files) {
      const kind = kindOf(f);
      const it = {
        qid: media.newId(), kind, owner, album, file: f, name: f.name || (kind === 'photo' ? 'photo.jpg' : 'file'), type: f.type || '',
        size: f.size, id: media.newId(), key: newFileKey(), site: 'pending', siteErr: '', order: order++,
        orig: original && kind === 'photo' ? 'pending' : 'off', origErr: '', at: Date.now(), lastModified: f.lastModified || 0,
      };
      if (kind === 'pdf' && f.size > PDF_MAX) { it.site = 'error'; it.siteErr = `${Math.round(f.size / 1e6)}MB — 95MB 보다 큰 파일은 올릴 수 없어요.`; it.orig = 'off'; }
      items.set(it.qid, it);
      await save(it);
      out.push(it);
    }
    emit();
    kick();
    return out;
  }

  async function prepare(it) {
    const raw = it.file;
    if (it.kind === 'photo' && isRaster(it.type)) {
      let full;
      let th;
      try {
        full = await prepareImage(raw, PHOTO);
        th = await prepareImage(raw, THUMB);
      } catch {
        throw new Error('이 사진은 열 수 없는 형식이에요 (HEIC 라면 휴대폰 설정에서 "호환성 우선"으로 찍거나 JPG 로 바꿔 주세요).');
      }
      const name = it.name.replace(/\.(heic|heif|webp|png|bmp|avif|jpe?g)$/i, '') + (full.type === 'image/png' ? '.png' : '.jpg');
      return { data: new Uint8Array(await full.blob.arrayBuffer()), thumb: new Uint8Array(await th.blob.arrayBuffer()), w: full.w, h: full.h, type: full.type, name };
    }
    return { data: new Uint8Array(await raw.arrayBuffer()), type: it.type || (it.kind === 'pdf' ? 'application/pdf' : ''), name: it.name };
  }

  async function siteOne(it) {
    const p = await prepare(it);
    const job = {
      id: it.id, key: it.key, kind: it.kind, name: p.name, type: p.type, owner: it.owner, data: p.data, thumb: p.thumb,
      w: p.w, h: p.h, origSize: it.size, origName: it.name, repo: it.repo, path: it.path, order: it.order,
      takenAt: it.lastModified ? new Date(it.lastModified).toISOString() : undefined,
    };
    await media.upload(job, {
      onProgress: x => { progress.set(it.qid, x); emit(); },
      save: async j => { it.repo = j.repo; it.path = j.path; await save(it); },
    });
  }

  // 사이트 일꾼: 하나씩 차례로. 인터넷이 끊기면 멈췄다가 다음 kick 때 이어서
  function kick() {
    if (stopped) return;
    if (!siteRun) {
      siteRun = (async () => {
        await load();
        for (;;) {
          const it = [...items.values()].find(x => x.site === 'pending');
          if (!it || stopped) break;
          try {
            await siteOne(it);
            it.site = 'done';
            it.siteErr = '';
          } catch (e) {
            it.siteErr = e.message || String(e);
            if (e.status === 0 || e.code === 'locked') { await save(it); emit(); break; } // 끊김: pending 그대로 두고 나중에
            it.site = 'error';
          }
          progress.delete(it.qid);
          await save(it);
          emit();
        }
      })().finally(() => { siteRun = null; });
    }
    if (google && !origRun) {
      origRun = (async () => {
        await load();
        await google.drain([...items.values()].filter(x => x.orig === 'pending'), async it => { await save(it); emit(); });
      })().catch(e => console.warn('[uploads] google', e)).finally(() => { origRun = null; });
    }
    return Promise.all([siteRun, origRun]);
  }

  // 실패한 것 다시 (which: 'site' | 'orig' | 'all')
  async function retry(which = 'all') {
    await load();
    for (const it of items.values()) {
      if ((which === 'site' || which === 'all') && it.site === 'error' && !(it.kind === 'pdf' && it.size > PDF_MAX)) { it.site = 'pending'; it.siteErr = ''; await save(it); }
      if ((which === 'orig' || which === 'all') && it.orig === 'error') { it.orig = 'pending'; it.origErr = ''; await save(it); }
    }
    emit();
    return kick();
  }

  // 실패한 항목을 포기하고 대기열에서 뺀다 (사용자가 고른 경우만)
  async function dismiss(qid) {
    const it = items.get(qid);
    if (!it) return;
    items.delete(qid);
    await kv.del(`q:${qid}`);
    emit();
  }

  // 끝난 것은 화면 목록에서도 치운다
  function clearDone() {
    for (const [q, it] of items) if (it.site === 'done' && (it.orig === 'done' || it.orig === 'off')) items.delete(q);
    emit();
  }

  function snapshot() {
    const list = [...items.values()].sort((a, b) => a.order - b.order);
    const siteDone = list.filter(x => x.site === 'done').length;
    const cur = list.find(x => x.site === 'pending' && progress.has(x.qid));
    const frac = list.length ? (siteDone + (cur ? progress.get(cur.qid) : 0)) / list.length : 1;
    return {
      list: list.map(x => ({ qid: x.qid, name: x.name, kind: x.kind, owner: x.owner, size: x.size, site: x.site, siteErr: x.siteErr, orig: x.orig, origErr: x.origErr, progress: progress.get(x.qid) ?? (x.site === 'done' ? 1 : 0) })),
      total: list.length,
      siteDone,
      siteErr: list.filter(x => x.site === 'error').length,
      origDone: list.filter(x => x.orig === 'done').length,
      origPending: list.filter(x => x.orig === 'pending').length,
      origErr: list.filter(x => x.orig === 'error').length,
      busy: !!siteRun,
      frac,
    };
  }

  return {
    add, kick, retry, dismiss, clearDone, snapshot, load,
    stop() { stopped = true; },
    resume() { stopped = false; return kick(); },
    pending: async () => { await load(); return [...items.values()].filter(x => x.site === 'pending' || x.orig === 'pending').length; },
    _items: items,
  };
}
