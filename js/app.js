// 화면 틀 — 주소(#/…)에 따라 학부모 화면·관리자 화면을 그린다. main.js(실제)와 tools/demo.js(가짜 GitHub)가 start() 를 부른다.
import { $, esc, icon, toast, toastErr, initModal, size } from './ui.js';
import { createMedia, readThumb, readEntry } from './media.js';
import { createPublisher } from './publish.js';
import { createUploads } from './uploads.js';
import { createGoogleAuth, createOriginals, photosBackend, driveBackend, SCOPES } from './google.js';
import { loginView, bindLogin, parentView, bindParent, newNotices } from './views-parent.js';
import { adminView } from './views-admin.js';

const PARENT_NAV = [['', '홈', 'home'], ['schedule', '일정', 'cal'], ['songs', '연주곡', 'music'], ['videos', '영상', 'video'], ['photos', '사진', 'photo'], ['roster', '명단', 'people']];

export async function start({ core, parent, read, limit, demo = false, uploadsDb }) {
  initModal();
  const settings = () => core.collection('settings');
  const gcfg = () => (core.status().open ? settings().get('google') || {} : {});
  const gAuth = createGoogleAuth({ getClientId: () => gcfg().clientId || '', scope: () => SCOPES[gcfg().backend === 'drive' ? 'drive' : 'photos'] });
  const media = createMedia({ core, read, ...(limit ? { limit } : {}) });
  const originals = createOriginals({
    cfg: () => ({ enabled: !!gcfg().clientId && gcfg().enabled !== false, backend: gcfg().backend === 'drive' ? 'drive' : 'photos' }),
    backendFor: k => (k === 'drive' ? driveBackend(() => gAuth.token()) : photosBackend(() => gAuth.token())),
    ready: () => gAuth.signedIn(),
    albumId: k => gcfg().albums?.[k],
    setAlbumId: async (k, v) => { const g = gcfg(); await settings().put({ ...g, id: 'google', albums: { ...(g.albums || {}), [k]: v } }); },
  });
  const ctx = {
    core, parent, media, read, demo, gAuth, originals,
    pub: createPublisher({ core }),
    uploads: null,
    parentState: 'locked',
    ui: {},
    blobUrls: [],
    render: () => render(),
    go: h => { if (location.hash === h) render(); else location.hash = h; },
  };
  ctx.uploads = createUploads({ media, google: originals, onChange: s => renderUploads(ctx, s), ...(uploadsDb ? { dbName: uploadsDb } : {}) });

  // ----- 그림 불러오기 (암호문 → 이 기기에서 풀기 → blob: 주소). 화면에 보일 때만 -----
  const entries = new Map();
  const thumbs = new Map();
  const fulls = new Map();
  ctx.reg = (id, e) => entries.set(id, e);
  const get = (map, id, fn) => { if (!map.has(id)) map.set(id, fn().then(b => URL.createObjectURL(b)).catch(e => { map.delete(id); throw e; })); return map.get(id); };
  ctx.thumbUrl = id => get(thumbs, id, () => readThumb(id, entries.get(id), read));
  ctx.fullUrl = id => get(fulls, id, () => readEntry(id, entries.get(id), read));
  ctx.fullBlob = id => readEntry(id, entries.get(id), read);
  let io = null;
  let q = [];
  let running = 0;
  const pump = () => {
    while (running < 6 && q.length) {
      const img = q.shift();
      if (!img.isConnected || !entries.has(img.dataset.fid)) continue;
      running++;
      ctx.thumbUrl(img.dataset.fid).then(u => { img.src = u; img.onload = () => img.classList.add('ld'); }).catch(() => { img.alt = '!'; }).finally(() => { running--; pump(); });
    }
  };
  ctx.hydrate = root => {
    io?.disconnect();
    q = [];
    io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { io.unobserve(e.target); q.push(e.target); } pump(); }, { rootMargin: '300px' });
    for (const img of root.querySelectorAll('img[data-fid]')) io.observe(img);
  };

  // ----- 상태 -----
  await core.ready;
  if (core.hasJoinLink(location.hash)) {
    try {
      await core.joinFromQR(location.hash);
      toast('이 기기를 연결했어요. 관리자 비밀번호를 넣어 주세요.');
    } catch (e) { toastErr(e); }
    history.replaceState(null, '', `${location.pathname}#/admin`);
  }
  if (core.status().connected) { try { await core.resume(); } catch (e) { console.warn(e); } }
  try { ctx.parentState = await parent.load(); } catch (e) { console.warn(e); ctx.parentState = 'none'; }
  if (core.status().open) ctx.uploads.kick();

  core.onStatus(() => paintTop(ctx));
  let changeT = null;
  core.onChange(ev => {
    if (route()[0] === 'admin' && ev.source === 'remote') { clearTimeout(changeT); changeT = setTimeout(() => { if (!document.querySelector('#modal[open]')) render(); }, 400); }
    if (ev.source === 'local' && !ev.collections.every(c => c === 'settings')) schedulePublish(ctx);
    paintTop(ctx);
  });
  addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
  addEventListener('online', () => { if (core.status().open) ctx.uploads.kick(); });

  function route() { return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent); }

  async function render() {
    const r = route();
    const view = $('#view');
    for (const u of ctx.blobUrls.splice(0)) URL.revokeObjectURL(u);
    const isAdmin = r[0] === 'admin';
    paintNav(ctx, r);
    paintTop(ctx);
    renderUploads(ctx, ctx.uploads.snapshot());
    if (isAdmin) {
      try { await adminView(ctx, view, r.slice(1)); } catch (e) { console.error(e); view.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      return;
    }
    if (ctx.parentState !== 'open') {
      view.innerHTML = loginView(ctx, ctx.parentState);
      bindLogin(ctx);
      return;
    }
    view.innerHTML = parentView(ctx, r);
    document.title = `${({ schedule: '일정', songs: '연주곡', videos: '영상', photos: '사진', roster: '명단', notices: '공지' })[r[0]] || '홈'} · 자양교회 어린이 합창단`;
    await bindParent(ctx, view, r);
  }
  ctx.logoutParent = async () => { await parent.logout(); ctx.parentState = 'locked'; render(); };
  render();
  return ctx;
}

function paintNav(ctx, r) {
  const admin = r[0] === 'admin';
  const open = ctx.parentState === 'open';
  const nav = $('#nav');
  const tab = $('#tabbar');
  if (admin) {
    nav.innerHTML = `<a href="#/">${icon('home')} 학부모 화면</a>`;
    tab.hidden = true;
    return;
  }
  const cur = r[0] || '';
  const news = open ? newNotices(ctx.parent.bundle).length : 0;
  const items = open ? [...PARENT_NAV.slice(0, 1), ['notices', '공지', 'bell'], ...PARENT_NAV.slice(1)] : [];
  nav.innerHTML = items.map(([h, l]) => `<a href="#/${h}" class="${cur === h ? 'on' : ''}">${l}${h === 'notices' && news ? ' <span class="badge-new">N</span>' : ''}</a>`).join('');
  tab.hidden = !open;
  tab.className = 'tabbar';
  tab.innerHTML = PARENT_NAV.map(([h, l, ic]) => `<a href="#/${h}" class="${cur === h ? 'on' : ''}">${icon(ic)}<span>${l}</span></a>`).join('');
}

function paintTop(ctx) {
  const r = location.hash.replace(/^#\/?/, '').split('/');
  const el = $('#top-right');
  if (r[0] === 'admin') {
    const s = ctx.core.status();
    if (!s.open) { el.innerHTML = ''; return; }
    const label = { saved: '✓ 저장됨', pending: '이 기기에만 저장', syncing: '올리는 중…', offline: '인터넷 없음', error: '저장 오류', locked: '잠김' }[s.state] || s.state;
    el.innerHTML = `<span class="state ${s.state}" title="${esc(s.error || '')}">${label}</span>`;
    return;
  }
  if (ctx.parentState !== 'open') { el.innerHTML = ''; return; }
  const news = newNotices(ctx.parent.bundle).length;
  el.innerHTML = `<a class="icon-btn" href="#/notices" aria-label="공지${news ? ` 새 글 ${news}개` : ''}">${icon('bell')}${news ? '<span class="dot"></span>' : ''}</a>
    <a class="icon-btn" href="#/admin" aria-label="관리자" title="관리자">${icon('gear')}</a>`;
}

// 관리자가 고친 뒤 20초 동안 더 고치지 않으면 학부모 화면에 저절로 반영
let pubT = null;
function schedulePublish(ctx) {
  clearTimeout(pubT);
  pubT = setTimeout(async () => {
    try {
      const p = ctx.pub.parentRec();
      if (!p?.ck || !navigator.onLine || !ctx.core.status().open) return;
      const r = await ctx.pub.publish();
      if (r.changed) toast('학부모 화면에 반영했어요.');
      if (location.hash.startsWith('#/admin')) document.dispatchEvent(new CustomEvent('jc:published'));
    } catch (e) {
      if (e.code === 'contact-leak') toastErr(e);
      else console.warn('[publish]', e);
      document.dispatchEvent(new CustomEvent('jc:published'));
    }
  }, 20000);
}

// 올리기 상황판 (화면 아래). 다 끝나면 8초 뒤 저절로 닫힌다
let ulT = null;
function renderUploads(ctx, s) {
  const el = $('#uploads');
  if (!s.total || !location.hash.startsWith('#/admin')) { el.hidden = true; return; }
  el.hidden = false;
  const done = s.siteDone === s.total && !s.origPending;
  clearTimeout(ulT);
  if (done && !s.siteErr && !s.origErr) ulT = setTimeout(() => ctx.uploads.clearDone(), 8000);
  const pct = Math.round(s.frac * 100);
  const g = ctx.gAuth;
  const needSign = s.origPending && !g.signedIn();
  el.innerHTML = `<div class="row nowrap"><div class="grow"><b>${done ? '올리기 끝' : s.busy ? '올리는 중…' : s.siteErr ? '일부 실패' : '대기 중'}</b>
      <span class="small muted"> 사이트 ${s.siteDone}/${s.total}${s.origDone || s.origPending || s.origErr ? ` · 원본 ${s.origDone}/${s.origDone + s.origPending + s.origErr}` : ''}</span></div>
      <button class="btn small ghost" data-ul="toggle">${el.classList.contains('open') ? '접기' : '자세히'}</button>
      ${done ? '<button class="btn small ghost" data-ul="clear">닫기</button>' : ''}</div>
    <div class="bar big" style="margin-top:8px"><i style="width:${pct}%"></i></div>
    ${s.siteErr ? `<div class="row" style="margin-top:8px"><span class="small" style="color:var(--danger)">사이트 실패 ${s.siteErr}개</span><button class="btn small soft" data-ul="retry-site">다시</button></div>` : ''}
    ${s.origErr ? `<div class="row" style="margin-top:8px"><span class="small" style="color:var(--danger)">원본 실패 ${s.origErr}개</span><button class="btn small soft" data-ul="retry-orig">원본 다시</button></div>` : ''}
    ${needSign ? `<div class="row" style="margin-top:8px"><span class="small grow">원본 ${s.origPending}장이 Google 로그인을 기다려요</span><button class="btn small soft" data-ul="gsign">Google 로그인</button></div>` : ''}
    <div class="ul-list">${s.list.map(x => `<div class="ul-item"><span class="grow">${esc(x.name)} <span class="tiny muted">${size(x.size)}</span></span>
      <span class="st ${x.site}" title="${esc(x.siteErr)}">사이트 ${x.site === 'done' ? '✓' : x.site === 'error' ? '✕' : x.progress ? `${Math.round(x.progress * 100)}%` : '…'}</span>
      ${x.orig !== 'off' ? `<span class="st ${x.orig}" title="${esc(x.origErr)}">원본 ${x.orig === 'done' ? '✓' : x.orig === 'error' ? '✕' : '…'}</span>` : ''}
      ${x.site === 'error' ? `<button class="icon-btn" data-ul-dismiss="${esc(x.qid)}" title="빼기">${icon('x')}</button>` : ''}</div>`).join('')}</div>`;
  el.onclick = async e => {
    const b = e.target.closest('[data-ul], [data-ul-dismiss]');
    if (!b) return;
    const a = b.dataset.ul;
    if (a === 'toggle') { el.classList.toggle('open'); renderUploads(ctx, ctx.uploads.snapshot()); }
    else if (a === 'clear') ctx.uploads.clearDone();
    else if (a === 'retry-site') ctx.uploads.retry('site');
    else if (a === 'retry-orig') ctx.uploads.retry('orig');
    else if (a === 'gsign') { try { await ctx.gAuth.signIn(); ctx.uploads.kick(); } catch (err) { toastErr(err); } }
    else if (b.dataset.ulDismiss) ctx.uploads.dismiss(b.dataset.ulDismiss);
  };
}
