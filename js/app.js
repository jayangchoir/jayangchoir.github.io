// 화면 틀 — 주소(#/…)에 따라 그린다. main.js(실제)와 tools/demo.js(가짜 GitHub)가 start() 를 부른다.
//   #/ · #/join          공개 (누구나, 첫 화면)            #/login[/이름]   로그인 (모든 역할 한 곳)
//   #/home · #/schedule · #/songs · #/videos · #/photos[/id] · #/roster · #/notices   학부모 이상
//   #/staff[/meetings|snacks]   스탭 이상                   #/admin[/…]       관리자 (연결·처음 설정 포함)
//   #/logout
import { $, esc, icon, toast, toastErr, initModal, size } from './ui.js';
import { createMedia, readThumb, readEntry } from './media.js';
import { createPublisher } from './publish.js';
import { createUploads } from './uploads.js';
import { createGoogleAuth, createOriginals, photosBackend, driveBackend, SCOPES } from './google.js';
import { loginView, bindLogin, parentView, bindParent, newNotices, publicView } from './views-parent.js';
import { adminView } from './views-admin.js';
import { staffView } from './views-staff.js';

const PARENT_NAV = [['home', '홈', 'home'], ['schedule', '일정', 'cal'], ['songs', '연주곡', 'music'], ['videos', '영상', 'video'], ['photos', '사진', 'photo'], ['roster', '명단', 'people']];
const PARENT_ROUTES = new Set(['home', 'schedule', 'songs', 'videos', 'photos', 'roster', 'notices']);

export async function start({ core, session, read, limit, demo = false, uploadsDb, staffBackend }) {
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
    core, session, parent: session, media, read, demo, gAuth, originals, staffBackend,
    pub: createPublisher({ core }),
    uploads: null,
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
  try { await session.load(); } catch (e) { console.warn(e); }
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
    // 관리자가 잠겼으면(다른 기기에서 비밀번호가 바뀌는 등) 역할도 맞춘다
    if (session.role === 'admin' && !core.status().open) { await session.load(); }
    if (r[0] === 'logout') {
      await gAuth.revoke();
      ctx.uploads.stop();
      await session.logout();
      await session.load().catch(() => {}); // 공개 페이지 다시 받기
      toast('로그아웃했어요. 이 휴대폰에 기억한 코드도 지웠어요.');
      location.hash = '#/';
      return;
    }
    paintNav(ctx, r);
    paintTop(ctx);
    renderUploads(ctx, ctx.uploads.snapshot());
    document.title = '자양교회 어린이 합창단';
    if (r[0] === 'admin') {
      // 관리자 기기가 연결되어 있는데 잠겨 있으면 → 하나뿐인 로그인 화면으로
      if (core.status().connected && !core.status().open) { location.hash = '#/login'; return; }
      if (core.status().open && session.role !== 'admin') await session.refreshAdmin();
      try { await adminView(ctx, view, r.slice(1)); } catch (e) { console.error(e); view.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      return;
    }
    if (!r[0] || r[0] === 'join') { view.innerHTML = publicView(ctx, r); await bindParent(ctx, view, r, { publicOnly: true }); return; }
    if (r[0] === 'login') {
      if (session.role !== 'public' && !r[1]) { location.hash = '#/home'; return; }
      view.innerHTML = loginView(ctx, r[1] || '');
      bindLogin(ctx);
      return;
    }
    if (r[0] === 'staff') {
      if (!session.has('staff')) { location.hash = '#/login'; return; }
      document.title = '스탭 · 자양교회 어린이 합창단';
      await staffView(ctx, view, r.slice(1));
      return;
    }
    if (!PARENT_ROUTES.has(r[0])) { view.innerHTML = '<div class="card empty">없는 화면이에요. <a href="#/">첫 화면으로</a></div>'; return; }
    if (!session.has('parent')) { location.hash = '#/login'; return; }
    view.innerHTML = parentView(ctx, session.bundle ? r : ['home']);
    document.title = `${({ schedule: '일정', songs: '연주곡', videos: '영상', photos: '사진', roster: '명단', notices: '공지' })[r[0]] || '홈'} · 자양교회 어린이 합창단`;
    if (session.bundle) await bindParent(ctx, view, r);
  }
  render();
  return ctx;
}

function paintNav(ctx, r) {
  const s = ctx.session;
  const nav = $('#nav');
  const tab = $('#tabbar');
  const cur = r[0] || '';
  const logged = s.role !== 'public';
  if (!logged) {
    nav.innerHTML = `<a href="#/" class="${cur === '' ? 'on' : ''}">소개</a><a href="#/join" class="${cur === 'join' ? 'on' : ''}">입단 안내</a>`;
    tab.hidden = true;
    return;
  }
  const news = s.bundle ? newNotices(s.bundle).length : 0;
  const items = [['', '소개'], ...PARENT_NAV.slice(0, 1), ['notices', '공지'], ...PARENT_NAV.slice(1)];
  if (s.has('staff')) items.push(['staff', '스탭']);
  if (s.role === 'admin') items.push(['admin', '관리']);
  nav.innerHTML = items.map(([h, l]) => `<a href="#/${h}" class="${cur === h ? 'on' : ''}">${l}${h === 'notices' && news ? ' <span class="badge-new">N</span>' : ''}</a>`).join('');
  // 휴대폰 아래 메뉴 6칸: 학부모는 명단, 스탭은 명단 대신 스탭(연락처 명단 포함), 관리자는 영상 대신 관리
  let tabs = PARENT_NAV.slice();
  if (s.has('staff')) tabs = tabs.map(t => (t[0] === 'roster' ? ['staff', '스탭', 'people'] : t));
  if (s.role === 'admin') tabs = tabs.map(t => (t[0] === 'videos' ? ['admin', '관리', 'gear'] : t));
  tab.hidden = false;
  tab.className = 'tabbar';
  tab.innerHTML = tabs.map(([h, l, ic]) => `<a href="#/${h}" class="${cur === h ? 'on' : ''}">${icon(ic)}<span>${l}</span></a>`).join('');
}

function paintTop(ctx) {
  const r = location.hash.replace(/^#\/?/, '').split('/');
  const el = $('#top-right');
  const s = ctx.session;
  const st = ctx.core.status();
  const state = s.role === 'admin' && st.open
    ? `<span class="state ${st.state}" title="${esc(st.error || '')}">${{ saved: '✓ 저장됨', pending: '이 기기에만', syncing: '올리는 중…', offline: '인터넷 없음', error: '저장 오류', locked: '잠김' }[st.state] || st.state}</span>` : '';
  if (s.role === 'public') {
    el.innerHTML = r[0] === 'login' ? '' : '<a class="btn small primary" href="#/login">로그인</a>';
    return;
  }
  const news = s.bundle ? newNotices(s.bundle).length : 0;
  el.innerHTML = `${r[0] === 'admin' ? state : `<a class="icon-btn" href="#/notices" aria-label="공지${news ? ` 새 글 ${news}개` : ''}">${icon('bell')}${news ? '<span class="dot"></span>' : ''}</a>`}
    <a class="icon-btn" href="#/logout" aria-label="로그아웃" title="로그아웃 (${esc(s.person?.name || '')})">${icon('lock')}</a>`;
}

// 관리자가 고친 뒤 20초 동안 더 고치지 않으면 학부모 화면에 저절로 반영
let pubT = null;
function schedulePublish(ctx) {
  clearTimeout(pubT);
  pubT = setTimeout(async () => {
    try {
      const p = ctx.pub.parentRec();
      if (!p?.k || !navigator.onLine || !ctx.core.status().open) return;
      const r = await ctx.pub.publish();
      if (r.changed) { toast('학부모 화면에 반영했어요.'); await ctx.session.refreshAdmin(); }
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
