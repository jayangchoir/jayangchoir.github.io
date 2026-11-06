// 학부모 화면 — 홈 · 일정 · 연주곡 · 영상 · 사진 · 명단 · 공지
// 공개 페이지는 평문(p/public.json), 학부모 화면은 학부모 열쇠로 푼 묶음(session.bundle)에서 온다. 연락처는 묶음에 없다.
import { esc, textHtml, icon, dateKo, dateDot, dDay, parseYmd, ymd, download, toast, toastErr, modal, closeModal, copyText, busy, inlinePdfOk, isIOS, size } from './ui.js';
import { ytId } from './plan.js';
import { eventIcs } from './ics.js';

const NOTE_SVG = '<svg class="notes" viewBox="0 0 120 120" fill="currentColor" aria-hidden="true"><path d="M44 18v58a14 14 0 1 1-8-12.6V30l52-12v46a14 14 0 1 1-8-12.6V30z"/></svg>';
const SEEN = 'jc.noticesSeen';
const isPerf = e => e.kind === 'perf' || (e.kind !== 'practice' && /공연|음악회|찬양|연주|예배|특송|발표/.test(e.title) && !/^연습$/.test(e.title));
const today = () => ymd();
const ytThumb = id => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export function seenAt() {
  try {
    const v = localStorage.getItem(SEEN);
    if (v) return v;
    const first = new Date(Date.now() - 14 * 864e5).toISOString(); // 처음 온 기기: 2주 안의 공지만 새 글
    localStorage.setItem(SEEN, first);
    return first;
  } catch { return ''; }
}
const markSeen = () => { try { localStorage.setItem(SEEN, new Date().toISOString()); } catch {} };
export const newNotices = b => { const s = seenAt(); return (b?.notices || []).filter(n => n.at && n.at > s); };

// ---------- 공개 페이지 (누구나) ----------
const DEFAULT_PUB = { title: '자양교회 어린이 합창단', tagline: '함께 노래하는 어린이 합창단', intro: '', activity: '', join: '' };
// 관리자가 공개 페이지를 아직 게시하지 않았을 때(처음 설정 전 포함)만 쓰는 기본 글. 사실(시간·장소·대상)은 넣지 않는다 —
// 그건 관리자 → 공개 페이지에서 쓴다
const PLACEHOLDER_PUB = {
  intro: '자양교회 어린이 합창단 소개 페이지예요.\n합창단 소개와 입단 안내, 공연 소식은 준비되는 대로 이곳에 올려 드릴게요.',
  join: '입단 안내를 준비하고 있어요. 준비되는 대로 이곳에 올려 드릴게요.',
};
export function publicView(ctx, r) {
  const p = { ...DEFAULT_PUB, ...(ctx.session.pub || PLACEHOLDER_PUB) };
  const setup = ctx.session.role === 'public' && ctx.session.preSetup
    ? '<p class="small muted setup-hint">관리자이신가요? 사이트를 아직 처음 설정하지 않았어요. <a class="btn small ghost" href="#/admin">처음 설정</a></p>' : '';
  const logged = ctx.session.role !== 'public';
  const loginBtn = logged ? `<a class="btn primary" href="#/home">${icon('home')} 내 화면으로</a>` : `<a class="btn primary" href="#/login">${icon('lock')} 로그인</a>`;
  if (r[0] === 'join') {
    return `<a class="btn small ghost" href="#/">${icon('left')} 소개</a>
      <h1 style="margin-top:8px">입단 안내</h1>
      <div class="card"><div class="txt">${textHtml(p.join || '입단 안내를 준비하고 있어요.')}</div></div>
      ${p.contactNote ? `<div class="card info-card"><h3>${icon('phone')} 문의</h3><div class="txt">${textHtml(p.contactNote)}</div></div>` : ''}
      <div class="row">${loginBtn}</div>${setup}`;
  }
  return `<section class="hero pub-hero">${NOTE_SVG}<h1>${esc(p.title)}</h1><p>${esc(p.tagline || '')}</p>
      <div class="row" style="margin-top:16px">${logged ? `<a class="btn" href="#/home">${icon('home')} 내 화면으로</a>` : `<a class="btn" href="#/login">${icon('lock')} 로그인</a>`}<a class="btn ghost-light" href="#/join">입단 안내</a></div></section>
    ${ctx.session.notice ? `<div class="warn">${esc(ctx.session.notice)}</div>` : ''}
    ${p.intro ? `<div class="card"><h2>소개</h2><div class="txt">${textHtml(p.intro)}</div></div>` : ''}
    ${p.activity ? `<div class="card info-card"><h3>${icon('music')} 이렇게 활동해요</h3><div class="txt">${textHtml(p.activity)}</div></div>` : ''}
    ${(p.videos || []).length ? `<div class="sec-title"><h2>공연 영상</h2></div>${p.videos.map(v => `<div class="card vid-card home-vid"><span class="small muted">${esc(dateDot(v.date))}</span><h3>${esc(v.title)}</h3><div class="yt-grid">${v.urls.map(u => ytBox(u, v.title)).join('')}</div></div>`).join('')}` : ''}
    ${p.youtube ? `<a class="btn soft block" href="${esc(p.youtube)}" target="_blank" rel="noopener noreferrer">${icon('yt')} 유튜브 채널</a>` : ''}
    <p class="small muted" style="text-align:center;margin-top:24px">일정·연주곡·악보·사진은 합창단 가족만 볼 수 있어요. 초대 메시지의 이름과 코드로 로그인해 주세요.</p>${setup}`;
}

// ---------- 로그인 (모든 역할이 한 곳에서) ----------
export function loginView(ctx, prefill = '') {
  return `<div class="login">
    <img class="logo" src="assets/icon.svg" alt="">
    <h1>로그인</h1>
    <p class="muted">안내문(초대 메시지)에 있는 이름과 접속 코드를 넣어 주세요. 학부모·스탭·관리자 모두 여기서 들어와요.</p>
    ${ctx.session.notice ? `<div class="warn" style="text-align:left">${esc(ctx.session.notice)}</div>` : ''}
    <form id="login-form" class="card" autocomplete="on">
      <label class="f"><span>이름</span><input id="lid" autocomplete="username" value="${esc(prefill)}" required placeholder="예: 아이 이름" enterkeyhint="next"></label>
      <label class="f"><span>접속 코드</span>
        <div class="pw-wrap"><input id="lpw" type="password" autocomplete="current-password" required enterkeyhint="go" placeholder="예: K7QX-M2PA-9TRD" autocapitalize="characters" spellcheck="false">
        <button type="button" class="icon-btn" data-act="toggle-pw" aria-label="코드 보기">${icon('eye')}</button></div></label>
      <label class="check"><input id="lrem" type="checkbox" checked> 이 휴대폰에서 계속 열어 두기</label>
      <button class="btn primary block" id="login-btn">들어가기</button>
      <div id="login-msg"></div>
      <p class="help" style="margin:14px 0 0">코드를 잃어버렸으면 총무님께 새 코드를 받으세요. 새 코드를 받으면 예전 코드는 못 써요.${ctx.session.offline ? '<br>지금은 인터넷이 없어서 마지막으로 받은 내용으로 열어요.' : ''}</p>
    </form>
    <p class="tiny muted"><a href="#/">← 소개 페이지</a> · <a href="#/admin">처음 설정·관리자 코드 분실</a></p>
  </div>`;
}

export function bindLogin(ctx) {
  const f = document.getElementById('login-form');
  if (!f) return;
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = document.getElementById('login-msg');
    msg.innerHTML = '';
    await busy(document.getElementById('login-btn'), '여는 중…', async () => {
      try {
        const role = await ctx.session.login(document.getElementById('lid').value, document.getElementById('lpw').value, { remember: document.getElementById('lrem').checked });
        if (role === 'admin') ctx.uploads.resume();
        ctx.go(role === 'admin' ? '#/admin' : '#/home');
      } catch (err) {
        msg.innerHTML = `<div class="err">${esc(err.message)}</div>`;
        document.getElementById('lpw').select();
      }
    });
  });
  f.querySelector('[data-act=toggle-pw]').onclick = () => { const i = document.getElementById('lpw'); i.type = i.type === 'password' ? 'text' : 'password'; };
  setTimeout(() => { const lid = document.getElementById('lid'); if (lid) (lid.value ? document.getElementById('lpw') : lid).focus(); }, 50);
}

// ---------- 공통 조각 ----------
const evWhen = e => { const d = parseYmd(e.date); return d ? `<div class="when"><div class="m">${d.getMonth() + 1}월</div><div class="d">${d.getDate()}</div><div class="w">${'일월화수목금토'[d.getDay()]}요일</div></div>` : ''; };
const evMeta = e => `<div class="meta">${e.time ? `<span>${icon('clock')}${esc(e.time)}</span>` : ''}${e.place ? `<span>${icon('map')}${esc(e.place)}</span>` : ''}</div>`;

function nextCard(e, label) {
  const dd = dDay(e.date);
  return `<div class="next${isPerf(e) ? ' perf' : ''}">
    ${evWhen(e)}
    <div><div class="k">${esc(label)}${dd ? `<span class="dday">${esc(dd)}</span>` : ''}</div>
      <h3>${esc(e.title)}</h3>${evMeta(e)}${e.note ? `<div class="small muted" style="margin-top:3px">${esc(e.note)}</div>` : ''}</div>
    <div class="actions"><button class="btn small soft" data-ics="${esc(e.id)}">${icon('cal')}내 달력에 추가</button>
      <a class="btn small ghost" href="#/schedule">전체 일정</a></div>
  </div>`;
}

const fileBtns = (ctx, ids) => (ids || []).map(id => {
  const f = ctx.session.bundle.files[id];
  if (!f) return '';
  const pdf = /pdf/.test(f.t || '') || /\.pdf$/i.test(f.n || '');
  return `<div class="part"><span>${icon(pdf ? 'pdf' : 'photo')}</span><span class="lbl">${esc(f.n)}<small>${pdf ? 'PDF' : '파일'} · ${size(f.s)}</small></span>
    <button class="btn small soft" data-open="${esc(id)}">보기</button><button class="icon-btn" data-save="${esc(id)}" aria-label="내려받기">${icon('down')}</button></div>`;
}).join('');

function ytBox(url, title = '') {
  const id = ytId(url);
  if (!id) return `<a class="btn small soft" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${icon('ext')}영상 열기</a>`;
  return `<button class="yt" data-yt="${esc(id)}" aria-label="${esc(title || '영상')} 재생"><img loading="lazy" src="${ytThumb(id)}" alt=""><span class="play">${icon('play')}</span></button>`;
}

// ---------- 홈 ----------
function home(ctx) {
  const b = ctx.session.bundle;
  if (!b) return `<h1>안녕하세요</h1><div class="card empty">학부모 화면이 아직 반영되지 않았어요.${ctx.session.role === 'admin' ? ' 관리자 화면의 대시보드에서 "학부모 화면에 반영"을 눌러 주세요.' : ' 조금 뒤에 다시 와 주세요.'}</div>`;
  const s = b.site || {};
  const t = today();
  const upcoming = b.events.filter(e => (e.end || e.date) >= t);
  const nextPerf = upcoming.find(isPerf);
  const nextAny = upcoming[0];
  const news = newNotices(b);
  const latestNotice = b.notices[0];
  const latestAlbum = b.albums[0];
  const latestVideo = b.videos.slice().sort((a, c) => String(c.date).localeCompare(String(a.date)))[0];
  const cover = s.cover && b.files[s.cover];
  return `
  <section class="hero${cover ? ' has-cover' : ''}">
    ${cover ? `<img class="cover" data-full="${esc(s.cover)}" alt="">` : NOTE_SVG}
    <h1>${esc(s.title || '자양교회 어린이 합창단')}</h1>
    <p>${esc(s.welcome || '함께 노래해요')}</p>
  </section>

  ${nextAny ? nextCard(nextAny, nextAny === nextPerf ? '다음 공연' : '다음 일정') : `<div class="card empty">다가오는 일정이 아직 없어요.${s.practiceTime ? `<br>정기 연습: ${esc(s.practiceTime)}` : ''}</div>`}
  ${nextPerf && nextPerf !== nextAny ? nextCard(nextPerf, '다음 공연') : ''}

  <div class="quick">
    <a href="#/schedule">${icon('cal')}일정</a><a href="#/songs">${icon('music')}연주곡</a><a href="#/videos">${icon('video')}영상</a>
    <a href="#/photos">${icon('photo')}사진</a><a href="#/notices">${icon('bell')}공지${news.length ? ` <span class="badge-new">${news.length}</span>` : ''}</a><a href="#/roster">${icon('people')}명단</a>
  </div>

  <div class="sec-title"><h2>공지</h2><a href="#/notices">전체 보기</a></div>
  ${latestNotice ? `<div class="card list-card"><a class="notice-item" href="#/notices/${esc(latestNotice.id)}">
      <h3>${latestNotice.pinned ? `${icon('pin')} ` : ''}${esc(latestNotice.title)} ${news.some(n => n.id === latestNotice.id) ? '<span class="badge-new">NEW</span>' : ''}</h3>
      <div class="body clip">${esc(latestNotice.body)}</div><div class="tiny muted" style="margin-top:4px">${esc(dateKo(latestNotice.date, { dow: false }))}</div></a></div>`
    : '<div class="card empty">새 공지가 없어요.</div>'}

  ${latestAlbum ? `<div class="sec-title"><h2>새 사진</h2><a href="#/photos/${esc(latestAlbum.id)}">${esc(latestAlbum.title)} · ${latestAlbum.count}장</a></div>
    <div class="strip" id="home-strip" data-album="${esc(latestAlbum.id)}">${Array.from({ length: Math.min(6, latestAlbum.count) }, () => '<span class="ph"></span>').join('')}</div>` : ''}

  ${latestVideo ? `<div class="sec-title"><h2>새 영상</h2><a href="#/videos">영상 모두 보기</a></div>
    <div class="card vid-card home-vid"><span class="chip ${latestVideo.kind === 'practice' ? 'mint' : 'sun'}">${latestVideo.kind === 'practice' ? '연습' : '공연'}</span> <span class="small muted">${esc(dateDot(latestVideo.date))}</span>
      <h3>${esc(latestVideo.title)}</h3>${ytBox(latestVideo.urls[0], latestVideo.title)}</div>` : ''}

  <div class="sec-title"><h2>안내</h2></div>
  <div class="grid2">
    ${s.activity ? `<div class="card info-card"><h3>${icon('music')} 활동 안내</h3><div class="txt">${textHtml(s.activity)}</div></div>` : ''}
    ${s.fees || s.bankAccount ? `<div class="card info-card"><h3>${icon('won')} 회비</h3><div class="txt">${textHtml(s.fees || '')}</div>
      ${s.bankAccount ? `<div class="acct"><div class="grow"><div class="tiny muted">${esc(s.bankName || '')} 합창단 계좌</div><b>${esc(s.bankAccount)}</b></div><button class="btn small soft" data-copy="${esc(s.bankAccount)}">${icon('copy')}복사</button></div>` : ''}</div>` : ''}
    ${s.contactNote ? `<div class="card info-card"><h3>${icon('phone')} 문의</h3><div class="txt">${textHtml(s.contactNote)}</div></div>` : ''}
    ${s.youtube ? `<div class="card info-card"><h3>${icon('yt')} 유튜브 채널</h3><div class="txt small">공연·연습 영상을 모아 둔 곳이에요.</div><a class="btn small soft" style="margin-top:10px" href="${esc(s.youtube)}" target="_blank" rel="noopener noreferrer">${icon('ext')}채널 열기</a></div>` : ''}
  </div>
  ${(s.files || []).length ? `<div class="card"><h3>안내 자료</h3><div class="parts">${fileBtns(ctx, s.files)}</div></div>` : ''}
  <p class="small muted" style="text-align:center;margin-top:24px">${esc(ctx.session.person?.name || '')} · <a href="#/">소개 페이지</a> · <button class="btn small ghost" data-chsecret>내 코드를 비밀문장으로</button> · <a href="#/logout">로그아웃</a></p>`;
}

// ---------- 공지 ----------
function notices(ctx, openId) {
  const b = ctx.session.bundle;
  const news = new Set(newNotices(b).map(n => n.id));
  setTimeout(markSeen, 1500);
  if (!b.notices.length) return '<h1>공지</h1><div class="card empty">아직 공지가 없어요.</div>';
  return `<h1>공지</h1><div class="card list-card">${b.notices.map(n => `<div class="notice-item" id="n-${esc(n.id)}">
    <h3>${n.pinned ? `${icon('pin')} ` : ''}${esc(n.title)} ${news.has(n.id) ? '<span class="badge-new">NEW</span>' : ''}</h3>
    <div class="tiny muted" style="margin-bottom:6px">${esc(dateKo(n.date, { year: true }))}</div>
    <div class="body">${textHtml(n.body)}</div>${(n.files || []).length ? `<div class="parts" style="display:grid;gap:8px;margin-top:10px">${fileBtns(ctx, n.files)}</div>` : ''}
  </div>`).join('')}</div>${openId ? `<span hidden data-scroll="n-${esc(openId)}"></span>` : ''}`;
}

// ---------- 일정 ----------
function evRow(e, past) {
  const d = parseYmd(e.date);
  return `<div class="ev${isPerf(e) ? ' perf' : ''}${past ? ' past' : ''}">
    <div class="when"><div class="d">${d ? d.getDate() : ''}</div><div class="w">${d ? '일월화수목금토'[d.getDay()] : ''}</div></div>
    <div><h3>${esc(e.title)}${!past && dDay(e.date) ? `<span class="dday">${esc(dDay(e.date))}</span>` : ''}</h3>${evMeta(e)}${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}</div>
    <button class="icon-btn" data-ics="${esc(e.id)}" aria-label="내 달력에 추가" title="내 달력에 추가">${icon('cal')}</button>
  </div>`;
}
function byMonth(list, past) {
  let out = '';
  let cur = '';
  for (const e of list) {
    const m = e.date.slice(0, 7);
    if (m !== cur) { cur = m; out += `<div class="month-h">${+m.slice(0, 4)}년 ${+m.slice(5)}월</div>`; }
    out += evRow(e, past);
  }
  return out;
}

function schedule(ctx) {
  const b = ctx.session.bundle;
  const t = today();
  const mode = ctx.ui.schedMode || 'list';
  const up = b.events.filter(e => (e.end || e.date) >= t);
  const past = b.events.filter(e => (e.end || e.date) < t).reverse();
  const nextPerf = up.find(isPerf);
  const head = `<div class="row between" style="margin-bottom:12px"><h1 style="margin:0">일정</h1>
    <div class="seg"><button data-mode="list" class="${mode === 'list' ? 'on' : ''}">${icon('list')} 목록</button><button data-mode="cal" class="${mode === 'cal' ? 'on' : ''}">${icon('grid')} 달력</button></div></div>
    ${nextPerf ? `<div class="card row nowrap" style="background:var(--sun-soft);border-color:transparent"><span class="jua" style="font-size:28px;color:#c76f00">${esc(dDay(nextPerf.date) || '')}</span><div class="grow"><b>${esc(nextPerf.title)}</b><div class="small muted">${esc(dateKo(nextPerf.date))}${nextPerf.time ? ` · ${esc(nextPerf.time)}` : ''}</div></div></div>` : ''}`;
  if (mode === 'cal') return head + calendar(ctx, b.events);
  return `${head}
    ${up.length ? `<div class="card list-card">${byMonth(up, false)}</div>
      <div class="row end"><button class="btn small ghost" data-ics-all>${icon('cal')} 다가오는 일정 모두 내 달력에</button></div>` : '<div class="card empty">다가오는 일정이 아직 없어요.</div>'}
    ${past.length ? `<details class="card" style="padding:0;overflow:hidden" ${up.length ? '' : 'open'}><summary style="padding:14px 16px;cursor:pointer;font-weight:700">지난 일정 ${past.length}개</summary>${byMonth(past, true)}</details>` : ''}
    ${b.site?.activity ? `<p class="small muted">정기 연습: ${esc(b.site.practiceTime || '')}${b.site.practicePlace ? ` · ${esc(b.site.practicePlace)}` : ''}</p>` : ''}`;
}

function calendar(ctx, events) {
  const now = parseYmd(today());
  const ym = ctx.ui.calYm || (events.find(e => e.date >= today())?.date || today()).slice(0, 7);
  ctx.ui.calYm = ym;
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(y, m - 1, 1 - first.getDay());
  const byDay = new Map();
  for (const e of events) {
    const s = parseYmd(e.date);
    const end = parseYmd(e.end) || s;
    if (!s) continue;
    for (let d = new Date(s); d <= end; d.setDate(d.getDate() + 1)) {
      const k = ymd(d);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(e);
    }
  }
  const sel = ctx.ui.calSel || '';
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    if (i >= 35 && d.getMonth() !== m - 1) break;
    const k = ymd(d);
    const list = byDay.get(k) || [];
    cells += `<button class="cal-day${d.getMonth() !== m - 1 ? ' other' : ''}${k === ymd(now) ? ' today' : ''}${k === sel ? ' sel' : ''}${d.getDay() === 0 ? ' sun' : ''}" data-day="${k}" aria-label="${d.getMonth() + 1}월 ${d.getDate()}일 일정 ${list.length}개">
      <span class="n">${d.getDate()}</span><span class="dots">${list.map(e => `<i class="${isPerf(e) ? 'perf' : ''}"></i>`).join('')}</span>
      <span class="lbl">${list.map(e => esc(e.title)).join('<br>')}</span></button>`;
  }
  const selList = sel ? byDay.get(sel) || [] : events.filter(e => e.date.startsWith(ym));
  return `<div class="card cal">
    <div class="cal-head"><button class="icon-btn" data-cal="-1" aria-label="이전 달">${icon('left')}</button><h2 style="margin:0">${y}년 ${m}월</h2><button class="icon-btn" data-cal="1" aria-label="다음 달">${icon('right')}</button></div>
    <div class="cal-grid">${'일월화수목금토'.split('').map(x => `<div class="dow">${x}</div>`).join('')}${cells}</div>
    <div class="row small muted" style="margin-top:10px;gap:14px"><span><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--brand)"></i> 연습·일정</span><span><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--sun)"></i> 공연·찬양</span></div>
  </div>
  <div class="card list-card">${selList.length ? selList.map(e => evRow(e, (e.end || e.date) < today())).join('') : `<div class="empty">${sel ? `${esc(dateKo(sel))}에는 일정이 없어요.` : '이 달에는 일정이 없어요.'}</div>`}</div>`;
}

// ---------- 연주곡 ----------
function songs(ctx) {
  const b = ctx.session.bundle;
  if (!b.songs.length) return '<h1>연주곡</h1><div class="card empty">아직 연주곡이 없어요.</div>';
  const groups = [];
  for (const s of b.songs) {
    let g = groups.find(x => x.title === s.group);
    if (!g) { g = { title: s.group || '연주곡', date: s.date, list: [] }; groups.push(g); }
    g.list.push(s);
    if (s.date && (!g.date || s.date > g.date)) g.date = s.date;
  }
  groups.sort((a, c) => (c.date || '').localeCompare(a.date || ''));
  return `<h1>연주곡</h1><p class="muted small">공연마다 악보(PDF)·연습 음원·참고 영상을 곡별로 모았어요.</p>
  ${groups.map(g => `<div class="group-h"><h2>${esc(g.title)}</h2>${g.date ? `<span class="chip">${esc(dateDot(g.date))}</span>` : ''}</div>
    ${g.list.sort((a, c) => (a.order ?? 0) - (c.order ?? 0)).map(s => `<div class="card song">
      <h3>${esc(s.title)}</h3>
      <div class="parts">
        ${fileBtns(ctx, s.files)}
        ${s.audio.map(a => `<div class="part audio">${icon('audio')}<a class="lbl" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.label || '연습 음원')}<small>연습 음원 · 구글 드라이브</small></a>${icon('ext')}</div>`).join('')}
        ${s.videos.map(v => `<div class="part ytl">${icon('yt')}<span class="lbl">${esc(v.label || '참고 영상')}<small>참고 영상</small></span><button class="btn small soft" data-ytp="${esc(v.url)}">재생</button></div>`).join('')}
      </div>
      ${s.note ? `<div class="note">${esc(s.note)}</div>` : ''}
    </div>`).join('')}`).join('')}`;
}

// ---------- 영상 ----------
function videos(ctx) {
  const b = ctx.session.bundle;
  const kind = ctx.ui.vidKind || 'perf';
  const list = b.videos.filter(v => v.kind === kind).sort((a, c) => String(c.date).localeCompare(String(a.date)));
  return `<div class="row between" style="margin-bottom:12px"><h1 style="margin:0">영상</h1>
    <div class="seg"><button data-vk="perf" class="${kind === 'perf' ? 'on' : ''}">공연</button><button data-vk="practice" class="${kind === 'practice' ? 'on' : ''}">연습</button></div></div>
    ${kind === 'practice' && b.site?.videoNote ? `<div class="warn">${esc(b.site.videoNote)}</div>` : ''}
    ${list.length ? list.map(v => `<div class="card vid-card"><span class="small muted">${esc(dateDot(v.date))}</span><h3>${esc(v.title)}</h3>
      <div class="yt-grid">${v.urls.map(u => ytBox(u, v.title)).join('')}</div>${v.note ? `<p class="small muted">${esc(v.note)}</p>` : ''}</div>`).join('') : '<div class="card empty">영상이 아직 없어요.</div>'}
    ${b.site?.youtube ? `<a class="btn soft block" href="${esc(b.site.youtube)}" target="_blank" rel="noopener noreferrer">${icon('yt')} 유튜브 채널에서 더 보기</a>` : ''}`;
}

// ---------- 사진 ----------
function albums(ctx) {
  const b = ctx.session.bundle;
  if (!b.albums.length) return '<h1>사진</h1><div class="card empty">아직 사진이 없어요.</div>';
  return `<h1>사진</h1><div class="albums">${b.albums.map(a => `<a class="album" href="#/photos/${esc(a.id)}">
    <span class="ph">${a.cover ? `<img data-fid="${esc(a.cover)}" alt="">` : ''}</span>
    <div class="cap"><b>${esc(a.title)}</b><span class="tiny muted">${esc(dateDot(a.date))} · ${a.count}장</span></div></a>`).join('')}</div>`;
}

function album(ctx, id) {
  const a = ctx.session.bundle.albums.find(x => x.id === id);
  if (!a) return '<div class="card empty">앨범을 찾지 못했어요.</div>';
  return `<a class="btn small ghost" href="#/photos">${icon('left')} 사진첩</a>
    <h1 style="margin-top:8px">${esc(a.title)}</h1><p class="muted small">${esc(dateKo(a.date, { year: true }))} · ${a.count}장 · 사진을 누르면 크게 보여요.</p>
    ${a.note ? `<p>${textHtml(a.note)}</p>` : ''}${(a.files || []).length ? `<div class="parts" style="display:grid;gap:8px;margin-bottom:12px">${fileBtns(ctx, a.files)}</div>` : ''}
    <div class="photos" id="album-grid" data-album="${esc(a.id)}">${Array.from({ length: a.count }, () => '<span class="ph"></span>').join('')}</div>`;
}

// ---------- 명단 ----------
function roster(ctx) {
  const b = ctx.session.bundle;
  const groups = [];
  for (const m of b.roster) {
    let g = groups.find(x => x.grade === m.grade);
    if (!g) { g = { grade: m.grade, list: [] }; groups.push(g); }
    g.list.push(m);
  }
  const label = g => (/^\d+$/.test(g) ? `${g}학년` : g || '학년 없음');
  const cls = g => { const n = /^\d+$/.test(g) ? +g : /^중/.test(g) ? 7 : 7; return `g${Math.min(7, n)}`; };
  return `<h1>명단</h1>
    ${b.site?.intro ? `<p class="muted">${esc(b.site.intro)}</p>` : ''}
    <p class="small"><span class="chip brand">${b.roster.length}명</span></p>
    ${groups.map(g => `<div class="card grade ${cls(g.grade)}"><div class="grade-h"><span class="n">${esc(label(g.grade))}</span><span class="chip">${g.list.length}명</span></div>
      <div class="names">${g.list.map(m => `<span class="name">${esc(m.name)}</span>`).join('')}</div></div>`).join('')}
    <p class="tiny muted">연락처는 개인정보라 이 화면에 보이지 않아요. 필요하면 총무님께 문의해 주세요.</p>`;
}

// ---------- 그리기 + 손잡이 ----------
export function parentView(ctx, r) {
  switch (r[0] || '') {
    case 'home': return home(ctx);
    case 'notices': return notices(ctx, r[1]);
    case 'schedule': return schedule(ctx);
    case 'songs': return songs(ctx);
    case 'videos': return videos(ctx);
    case 'photos': return r[1] ? album(ctx, r[1]) : albums(ctx);
    case 'roster': return roster(ctx);
    default: return '<div class="card empty">없는 화면이에요. <a href="#/home">홈으로</a></div>';
  }
}

export async function bindParent(ctx, root, r) {
  const b = ctx.session.bundle || { files: {}, events: [], albums: [], notices: [] };
  for (const [id, e] of Object.entries(b.files || {})) ctx.reg(id, e);
  root.querySelector('[data-scroll]') && document.getElementById(root.querySelector('[data-scroll]').dataset.scroll)?.scrollIntoView({ block: 'start' });
  root.onclick = async ev => {
    const t = ev.target.closest('button, a');
    if (!t) return;
    const d = t.dataset;
    if (d.ics) { const e = b.events.find(x => x.id === d.ics); if (e) download(new Blob([eventIcs([e])], { type: 'text/calendar;charset=utf-8' }), `${e.date} ${e.title}.ics`.replace(/[\\/:*?"<>|]/g, '')); toast('달력 파일을 받았어요. 열면 내 달력에 추가돼요.'); }
    else if ('icsAll' in d) { download(new Blob([eventIcs(b.events.filter(e => (e.end || e.date) >= today()))], { type: 'text/calendar;charset=utf-8' }), '합창단 일정.ics'); }
    else if (d.copy) copyText(d.copy);
    else if (d.mode) { ctx.ui.schedMode = d.mode; ctx.render(); }
    else if (d.cal) { const [y, m] = ctx.ui.calYm.split('-').map(Number); const n = new Date(y, m - 1 + Number(d.cal), 1); ctx.ui.calYm = ymd(n).slice(0, 7); ctx.ui.calSel = ''; ctx.render(); }
    else if (d.day) { ctx.ui.calSel = ctx.ui.calSel === d.day ? '' : d.day; ctx.render(); }
    else if (d.vk) { ctx.ui.vidKind = d.vk; ctx.render(); }
    else if (d.yt) playYt(t, d.yt);
    else if (d.ytp) { const id = ytId(d.ytp); if (id) modal(`<div><div class="dlg-h"><h2>참고 영상</h2><button class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div><div class="yt"><iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="영상"></iframe></div></div>`, { wide: true }); else window.open(d.ytp, '_blank', 'noopener'); }
    else if (d.open) openFile(ctx, d.open);
    else if (d.save) saveFile(ctx, d.save, t);
    else if ('chsecret' in d) changeSecretDialog(ctx);
  };
  // 홈의 새 사진 · 앨범 사진
  const strip = root.querySelector('#home-strip, #album-grid');
  if (strip) {
    const meta = b.albums.find(a => a.id === strip.dataset.album);
    try {
      const list = await ctx.session.album(meta);
      const photos = strip.id === 'home-strip' ? list.photos.slice(-6).reverse() : list.photos;
      for (const p of list.photos) ctx.reg(p.id, p);
      strip.innerHTML = photos.map((p, i) => `<button class="ph" data-lb="${i}" aria-label="사진 ${i + 1}"><img data-fid="${esc(p.id)}" alt=""></button>`).join('');
      strip.onclick = e => { const btn = e.target.closest('[data-lb]'); if (btn) lightbox(ctx, photos, Number(btn.dataset.lb), meta.title); };
    } catch (e) { strip.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  }
  ctx.hydrate(root);
  const cover = root.querySelector('img.cover[data-full]');
  if (cover) ctx.fullUrl(cover.dataset.full).then(u => { cover.src = u; }).catch(() => {});
}

function playYt(btn, id) {
  btn.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen title="영상"></iframe>`;
  btn.removeAttribute('data-yt');
}

// ---------- PDF·파일 열기 ----------
// 데스크톱: 페이지 안 보기(iframe). 휴대폰(iOS·안드로이드): 새 탭 링크 + 내려받기 (blob PDF 를 페이지 안에서 못 보여 주는 브라우저가 많다)
async function openFile(ctx, id) {
  const e = ctx.session.bundle.files[id];
  const pdf = /pdf/.test(e.t || '') || /\.pdf$/i.test(e.n);
  modal(`<div><div class="dlg-h"><h2 style="font-size:18px">${esc(e.n)}</h2><button class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div>
    <div id="pdf-body"><p class="muted"><span class="spin"></span> 여는 중… <span id="pdf-pct"></span></p></div></div>`, { wide: true });
  try {
    const blob = await ctx.session.file(id, e, x => { const p = document.getElementById('pdf-pct'); if (p) p.textContent = `${Math.round(x * 100)}%`; });
    const typed = new Blob([blob], { type: pdf ? 'application/pdf' : e.t || 'application/octet-stream' });
    const url = URL.createObjectURL(typed);
    ctx.blobUrls.push(url);
    const body = document.getElementById('pdf-body');
    if (!body) return;
    const inline = pdf && inlinePdfOk();
    body.innerHTML = `${inline ? `<iframe class="pdf-frame" src="${url}" title="${esc(e.n)}"></iframe>` : pdf ? '' : /^image\//.test(e.t) ? `<img src="${url}" alt="" style="width:100%;border-radius:10px">` : ''}
      <div class="row" style="margin-top:12px">
        <a class="btn primary" href="${url}" target="_blank" rel="noopener">${icon('ext')} 새 탭에서 열기</a>
        <a class="btn soft" href="${url}" download="${esc(e.n)}">${icon('down')} 내려받기</a>
      </div>
      ${!inline && pdf ? `<p class="help" style="margin-top:12px">${isIOS() ? '아이폰은 "새 탭에서 열기"를 누르면 보여요. 안 열리면 "내려받기" 뒤 "파일" 앱에서 여세요.' : '휴대폰은 "새 탭에서 열기"나 "내려받기"를 눌러 PDF 보기 앱으로 여세요.'}</p>` : ''}`;
  } catch (err) {
    const body = document.getElementById('pdf-body');
    if (body) body.innerHTML = `<div class="err">${esc(err.message)}</div>`;
  }
}

async function saveFile(ctx, id, btn) {
  const e = ctx.session.bundle.files[id];
  await busy(btn, '', async () => {
    try { download(await ctx.session.file(id, e), e.n); } catch (err) { toastErr(err); }
  });
}

// ---------- 사진 크게 보기 (넘기기) ----------
export function lightbox(ctx, photos, start, title = '') {
  let i = start;
  const el = document.createElement('div');
  el.className = 'lightbox';
  el.setAttribute('role', 'dialog');
  el.innerHTML = `<div class="lb-top"><button class="icon-btn" data-x aria-label="닫기">${icon('x')}</button><div class="grow small" id="lb-cap"></div>
    <button class="icon-btn" data-dl aria-label="내려받기">${icon('down')}</button></div>
    <div class="lb-stage"><img alt=""><button class="lb-nav l" data-p aria-label="이전">${icon('left')}</button><button class="lb-nav r" data-n aria-label="다음">${icon('right')}</button></div>`;
  document.body.append(el);
  document.body.style.overflow = 'hidden';
  const img = el.querySelector('img');
  const show = async () => {
    const p = photos[i];
    el.querySelector('#lb-cap').textContent = `${title ? `${title} · ` : ''}${i + 1} / ${photos.length}`;
    img.style.transform = '';
    img.src = await ctx.thumbUrl(p.id).catch(() => '');
    const want = i;
    ctx.fullUrl(p.id).then(u => { if (want === i) img.src = u; }).catch(() => {});
    for (const k of [i - 1, i + 1]) if (photos[k]) ctx.fullUrl(photos[k].id).catch(() => {}); // 옆 사진 미리
  };
  const go = d => { const n = i + d; if (n < 0 || n >= photos.length) return; i = n; show(); };
  const close = () => { el.remove(); document.body.style.overflow = ''; removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); };
  addEventListener('keydown', key);
  el.onclick = async e => {
    if (e.target.closest('[data-x]')) close();
    else if (e.target.closest('[data-p]')) go(-1);
    else if (e.target.closest('[data-n]')) go(1);
    else if (e.target.closest('[data-dl]')) { const p = photos[i]; try { download(await ctx.fullBlob(p.id), p.n || `photo-${i + 1}.jpg`); } catch (err) { toastErr(err); } }
  };
  // 손가락으로 넘기기
  let x0 = null;
  let y0 = 0;
  el.addEventListener('touchstart', e => { if (e.touches.length === 1) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; } }, { passive: true });
  el.addEventListener('touchmove', e => { if (x0 != null) img.style.transform = `translateX(${e.touches[0].clientX - x0}px)`; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    else if (dy > 120) close();
    else img.style.transform = '';
  });
  show();
  return close;
}

// ---------- 내 코드를 내가 정한 비밀문장으로 (공유 모듈 access.changeSecret) ----------
// 쓰기 역할(스탭)은 바로 바뀐다. 학부모는 올릴 수 없어서 "요청 글자"를 관리자에게 보내면 관리자가 적용한다(비밀문장은 들어 있지 않음).
async function changeSecretDialog(ctx) {
  await modal(`<form id="csf"><div class="dlg-h"><h2>비밀문장으로 바꾸기</h2><button type="button" class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div>
    <p class="small">받은 접속 코드 대신 나만 아는 문장(10자 이상)으로 들어올 수 있어요. 생일·전화번호·숫자만은 안 돼요.</p>
    <label class="f"><span>지금 쓰는 코드</span><input id="cs-old" type="password" autocomplete="current-password" required></label>
    <label class="f"><span>새 비밀문장</span><input id="cs-new" type="password" autocomplete="new-password" required minlength="10" placeholder="예: 우리 아이 웃음소리 2026"></label>
    <div id="cs-out"></div>
    <div class="row end"><button type="button" class="btn ghost" data-close>닫기</button><button class="btn primary" id="cs-ok">바꾸기</button></div></form>`, {
    onOpen: b => {
      b.querySelector('#csf').onsubmit = async e => {
        e.preventDefault();
        const out = b.querySelector('#cs-out');
        await busy(b.querySelector('#cs-ok'), '바꾸는 중…', async () => {
          try {
            const r = await ctx.session.access.changeSecret(b.querySelector('#cs-old').value, b.querySelector('#cs-new').value);
            if (r.done) out.innerHTML = '<div class="ok-box">바꿨어요. 다음부터 새 비밀문장으로 들어오세요.</div>';
            else out.innerHTML = `<div class="warn">학부모 화면은 직접 올릴 수 없어서, 아래 글자를 총무님(관리자)께 보내 주세요. 관리자가 적용하면 새 비밀문장으로 들어올 수 있어요. (이 글자에는 비밀문장이 들어 있지 않아요)</div>
              <textarea readonly rows="4" id="cs-req">${esc(r.request)}</textarea><button type="button" class="btn small soft" id="cs-copy" style="margin-top:6px">${icon('copy')} 복사</button>`;
            b.querySelector('#cs-copy')?.addEventListener('click', () => copyText(r.request));
          } catch (err) { out.innerHTML = `<div class="err">${esc(err.message)}</div>`; }
        });
      };
    },
  });
}
