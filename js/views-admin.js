// 관리자 화면 — 임원(관리자)만. 관리자 비밀번호로 연 core(비공개 저장소)의 모든 내용을 고친다.
// 연락처(부모님 이름·전화·비고·예금주·문의 연락처)는 여기서만 보인다.
import { esc, textHtml, icon, toast, toastErr, modal, closeModal, confirmBox, busy, dateKo, dateDot, size, timeAgo, download, ymd, copyText } from './ui.js';
import { ACCESS_CONFIG } from './access-config.js';
import { printCard } from './core/access-ui.js';
import { applyPlan, ids } from './plan.js';
import { sortMembers, SITE_PRIVATE } from './bundle.js';
import { PDF_WARN, PDF_MAX, repoName, toEntry } from './media.js';
import { kindOf } from './uploads.js';
import { ACCOUNT_HINT } from './google.js';

const TABS = [['', '대시보드'], ['access', '권한·코드'], ['notices', '공지'], ['events', '일정'], ['songs', '연주곡'], ['videos', '영상'], ['albums', '사진'], ['members', '명단'], ['site', '안내'], ['public', '공개 페이지'], ['import', '가져오기'], ['settings', '설정']];
const GRADES = ['1', '2', '3', '4', '5', '6', '중1', '중2', '중3'];
const PRIV = '<span class="chip rose">관리자만</span>';

// ---------- 목록마다 칸 ----------
const SCHEMA = {
  notices: {
    name: '공지', attach: true,
    fields: [
      { k: 'title', l: '제목', req: true },
      { k: 'date', l: '날짜', t: 'date', def: () => ymd() },
      { k: 'body', l: '내용', t: 'textarea', rows: 7 },
      { k: 'pinned', l: '맨 위에 고정', t: 'check' },
    ],
    sort: (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || String(b.date).localeCompare(String(a.date)),
    row: r => `<b>${r.pinned ? `${icon('pin')} ` : ''}${esc(r.title)}</b><small>${esc(dateKo(r.date, { dow: false }))} · ${esc(String(r.body || '').slice(0, 60))}</small>`,
  },
  events: {
    name: '일정', attach: true,
    fields: [
      { k: 'date', l: '날짜', t: 'date', req: true, def: () => ymd() },
      { k: 'title', l: '무엇', req: true, ph: '예: 연습, 오후예배 찬양, 이웃 초청 음악회' },
      { k: 'kind', l: '종류', t: 'select', opts: [['practice', '연습'], ['perf', '공연·찬양'], ['etc', '그 밖의 일정']] },
      { k: 'time', l: '시간', ph: '예: 11:30~12:30 (모르면 미정)' },
      { k: 'place', l: '장소', ph: '예: 초등부실, 본당' },
      { k: 'note', l: '비고', t: 'textarea', rows: 2, ph: '예: ‘주품에’ 외 1곡' },
      { k: 'end', l: '끝나는 날 (여러 날일 때만)', t: 'date' },
    ],
    sort: (a, b) => String(b.date).localeCompare(String(a.date)),
    row: r => `<b>${esc(r.title)} ${r.kind === 'perf' ? '<span class="chip sun">공연</span>' : ''}</b><small>${esc(dateKo(r.date, { year: true }))}${r.time ? ` · ${esc(r.time)}` : ''}${r.place ? ` · ${esc(r.place)}` : ''}</small>`,
  },
  songs: {
    name: '연주곡', attach: true, accept: 'application/pdf,image/*',
    fields: [
      { k: 'group', l: '공연·묶음', req: true, ph: '예: 26’ 11/11 이웃 초청 음악회', list: 'groups' },
      { k: 'title', l: '곡 이름', req: true },
      { k: 'date', l: '공연 날짜', t: 'date' },
      { k: 'order', l: '순서 (묶음 안에서)', t: 'number' },
      { k: 'audio', l: '연습 음원 (구글 드라이브 링크 등)', t: 'links' },
      { k: 'videos', l: '참고 영상 (유튜브 링크)', t: 'links' },
      { k: 'note', l: '메모 (파트·가사 등)', t: 'textarea', rows: 4 },
    ],
    sort: (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.group).localeCompare(String(b.group)) || (a.order ?? 0) - (b.order ?? 0),
    row: (r, ctx) => {
      const n = ctx.media.forOwner(`songs:${r.id}`).length;
      const waiting = (r.scoreFiles || []).length && !n;
      return `<b>${esc(r.title)}</b><small>${esc(r.group || '')}${r.date ? ` · ${esc(dateDot(r.date))}` : ''} · 악보 ${n} · 음원 ${(r.audio || []).length} · 영상 ${(r.videos || []).length}${waiting ? ' · <span style="color:#a86400">노션 악보 가져오기 전</span>' : ''}</small>`;
    },
  },
  videos: {
    name: '영상',
    fields: [
      { k: 'kind', l: '종류', t: 'select', opts: [['perf', '공연 영상'], ['practice', '연습 영상']] },
      { k: 'date', l: '날짜', t: 'date', req: true, def: () => ymd() },
      { k: 'title', l: '제목', req: true },
      { k: 'urls', l: '유튜브 주소 (한 줄에 하나)', t: 'lines', req: true },
      { k: 'note', l: '메모', t: 'textarea', rows: 2 },
      { k: 'public', l: '공개 페이지(누구나)에도 보이기', t: 'check' },
    ],
    sort: (a, b) => String(b.date).localeCompare(String(a.date)),
    row: r => `<b>${esc(r.title)}${r.public ? ' <span class="chip mint">공개</span>' : ''}</b><small>${r.kind === 'practice' ? '연습' : '공연'} · ${esc(dateDot(r.date))} · 영상 ${(r.urls || []).length}개</small>`,
  },
  albums: {
    name: '사진첩',
    fields: [
      { k: 'title', l: '행사 이름', req: true, ph: '예: 이웃 초청 음악회' },
      { k: 'date', l: '날짜', t: 'date', req: true, def: () => ymd() },
      { k: 'note', l: '설명', t: 'textarea', rows: 2 },
      { k: 'hidden', l: '학부모 화면에 숨기기', t: 'check' },
    ],
    sort: (a, b) => String(b.date).localeCompare(String(a.date)),
  },
  members: {
    name: '단원',
    fields: [
      { k: 'name', l: '이름', req: true },
      { k: 'grade', l: '학년', t: 'select', opts: GRADES.map(g => [g, /^\d/.test(g) ? `${g}학년` : g]) },
      { k: 'gender', l: '성별', t: 'select', opts: [['', '-'], ['남', '남'], ['여', '여']], priv: true },
      { k: 'parentName', l: '부모님', priv: true },
      { k: 'phone', l: '연락처', t: 'tel', priv: true },
      { k: 'note', l: '비고', priv: true },
      { k: 'joined', l: '입단', priv: true, ph: "예: 26' 2/1" },
      { k: 'order', l: '순서', t: 'number' },
    ],
    sort: (a, b) => 0,
  },
};
const SITE_FIELDS = [
  { k: 'title', l: '합창단 이름' },
  { k: 'welcome', l: '환영 글 (첫 화면 위)', t: 'textarea', rows: 2 },
  { k: 'intro', l: '소개 (명단 위: 지도·반주·단원 수)' },
  { k: 'practiceTime', l: '정기 연습 시간', ph: '예: 주일 11:30~12:30' },
  { k: 'practicePlace', l: '정기 연습 장소' },
  { k: 'activity', l: '활동 안내', t: 'textarea', rows: 5 },
  { k: 'fees', l: '회비 안내', t: 'textarea', rows: 4 },
  { k: 'bankName', l: '은행' },
  { k: 'bankAccount', l: '계좌번호 (학부모에게 보임)' },
  { k: 'accountHolder', l: '예금주', priv: true },
  { k: 'contactNote', l: '문의 안내 (학부모에게 보임, 전화번호는 넣지 마세요)' },
  { k: 'contactName', l: '문의 담당자 이름', priv: true },
  { k: 'contactPhone', l: '문의 전화', t: 'tel', priv: true },
  { k: 'youtube', l: '유튜브 채널 주소' },
  { k: 'videoNote', l: '연습 영상 안내 문구', t: 'textarea', rows: 2 },
];

// ---------- 입력 칸 ----------
function fieldHtml(f, v, ctx) {
  const id = `f-${f.k}`;
  const lab = `<span>${esc(f.l)}${f.req ? ' *' : ''}${f.priv ? ` ${PRIV}` : ''}</span>`;
  const val = v ?? (f.def ? f.def() : '');
  switch (f.t) {
    case 'textarea': return `<label class="f">${lab}<textarea id="${id}" rows="${f.rows || 4}" placeholder="${esc(f.ph || '')}">${esc(val)}</textarea></label>`;
    case 'check': return `<label class="check"><input id="${id}" type="checkbox"${val ? ' checked' : ''}> ${esc(f.l)}</label>`;
    case 'select': return `<label class="f">${lab}<select id="${id}">${f.opts.map(([k, l]) => `<option value="${esc(k)}"${String(val) === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
    case 'lines': return `<label class="f">${lab}<textarea id="${id}" rows="3" placeholder="https://youtu.be/...">${esc((val || []).join('\n'))}</textarea></label>`;
    case 'links': return `<div class="f links-edit" data-links="${f.k}">${lab}${(val || []).concat([{}]).map(x => linkRow(x)).join('')}<button type="button" class="btn small ghost" data-addlink>${icon('plus')} 줄 더하기</button></div>`;
    default: {
      const dl = f.list === 'groups' ? ` list="dl-groups"` : '';
      const extra = f.list === 'groups' ? `<datalist id="dl-groups">${[...new Set(ctx.core.collection('songs').list().map(s => s.group).filter(Boolean))].map(g => `<option value="${esc(g)}">`).join('')}</datalist>` : '';
      return `<label class="f">${lab}<input id="${id}" type="${f.t === 'date' ? 'date' : f.t === 'number' ? 'number' : f.t === 'tel' ? 'tel' : 'text'}" value="${esc(val)}" placeholder="${esc(f.ph || '')}"${dl}>${extra}</label>`;
    }
  }
}
const linkRow = x => `<div class="lrow"><input placeholder="이름 (예: 알토)" value="${esc(x.label || '')}" data-l="label"><input placeholder="https://..." value="${esc(x.url || '')}" data-l="url"><button type="button" class="icon-btn" data-dellink aria-label="이 줄 지우기">${icon('x')}</button></div>`;

function readFields(root, fields) {
  const out = {};
  for (const f of fields) {
    const el = root.querySelector(`#f-${f.k}`);
    if (f.t === 'check') out[f.k] = !!el?.checked;
    else if (f.t === 'number') out[f.k] = el?.value === '' ? undefined : Number(el.value);
    else if (f.t === 'lines') out[f.k] = String(el?.value || '').split(/\s*\n\s*/).map(s => s.trim()).filter(Boolean);
    else if (f.t === 'links') out[f.k] = [...root.querySelectorAll(`[data-links="${f.k}"] .lrow`)].map(r => ({ label: r.querySelector('[data-l=label]').value.trim(), url: r.querySelector('[data-l=url]').value.trim() })).filter(x => x.url);
    else out[f.k] = String(el?.value ?? '').trim();
  }
  for (const f of fields) if (f.req && (out[f.k] == null || out[f.k] === '' || (Array.isArray(out[f.k]) && !out[f.k].length))) throw new Error(`"${f.l}" 칸을 채워 주세요.`);
  return out;
}
function bindLinks(root) {
  root.addEventListener('click', e => {
    if (e.target.closest('[data-addlink]')) e.target.closest('[data-addlink]').insertAdjacentHTML('beforebegin', linkRow({}));
    if (e.target.closest('[data-dellink]')) e.target.closest('.lrow').remove();
  });
}

// ---------- 처음 설정 · 관리자 코드 복구 (로그인은 로그인 화면 하나에서) ----------
function setupScreen() {
  return `<div class="login" style="max-width:560px">
    <img class="logo" src="assets/icon.svg" alt=""><h1>처음 설정</h1>
    <p class="muted">합창단에서 딱 한 번. 비어 있는 비공개 저장소 <b>jayangchoir/jayangchoir-data</b> 와 공개 사이트 저장소를 준비해요. 자세한 순서는 README 의 "처음 한 번".</p>
    <form id="f-setup" class="card" style="text-align:left">
      <label class="f"><span>GitHub 토큰</span><input id="s-token" type="password" autocomplete="off" required></label>
      <label class="f"><span>관리자 데이터 비밀번호 (8자 이상, 비상용 — 관리자 코드를 모두 잃었을 때만 씀)</span><input id="s-pw" type="password" autocomplete="new-password" required minlength="8"></label>
      <label class="f"><span>한 번 더</span><input id="s-pw2" type="password" autocomplete="new-password" required></label>
      <label class="f"><span>내 이름</span><input id="s-name" required placeholder="예: 김총무"></label>
      <label class="f"><span>관리자 로그인 이름</span><input id="s-id" required value="choir-admin"></label>
      <button class="btn primary block">처음 설정</button><div class="msg"></div></form>
    <p><a href="#/">← 첫 화면</a></p></div>`;
}

function lostScreen() {
  return `<div class="login" style="max-width:560px">
    <img class="logo" src="assets/icon.svg" alt=""><h1>관리자</h1>
    <div class="card" style="text-align:left"><p>관리자도 <b>로그인 화면</b>에서 관리자 이름과 관리자 코드로 들어와요.</p><a class="btn primary" href="#/login">${icon('lock')} 로그인</a></div>
    <details class="card" style="text-align:left"><summary><b>관리자 코드를 잃었어요</b></summary>
      <form id="f-lost" style="margin-top:12px">
        <p class="small">관리자 데이터 비밀번호와 <b>명단 복구 코드</b>(처음 설정 때 받은 종이)가 있으면 새 관리자 코드를 만들 수 있어요.</p>
        <label class="f"><span>관리자 데이터 비밀번호</span><input id="l-pw" type="password" required></label>
        <label class="f"><span>명단 복구 코드</span><input id="l-rc" autocomplete="off" required placeholder="ABCD-EFGH-…"></label>
        <label class="f"><span>GitHub 토큰 (이 기기를 처음 쓰면)</span><input id="l-token" type="password" autocomplete="off"></label>
        <button class="btn primary block">새 관리자 코드 만들기</button><div class="msg"></div></form></details>
    <details class="card" style="text-align:left"><summary>관리자 데이터 비밀번호도 잊었어요</summary>
      <form id="f-rec0" style="margin-top:12px">
        <p class="small">데이터 복구 코드(처음 설정 때 받은 다른 종이)로 새 비밀번호를 정해요.</p>
        <label class="f"><span>데이터 복구 코드</span><input id="r0-code" autocomplete="off" required></label>
        <label class="f"><span>새 관리자 데이터 비밀번호</span><input id="r0-pw" type="password" autocomplete="new-password" required minlength="8"></label>
        <label class="f"><span>GitHub 토큰</span><input id="r0-token" type="password" autocomplete="off" required></label>
        <button class="btn primary block">새 비밀번호로</button><div class="msg"></div></form></details>
    <p><a href="#/">← 첫 화면</a></p></div>`;
}

async function showCodes(list) {
  await modal(`<div><h2>꼭 적어 두세요</h2>
    <p class="small">아래는 <b>지금 한 번만</b> 보여요. 종이에 적어 인수인계 봉투에 넣어 두세요.</p>
    ${list.map(([label, code, note]) => `<p style="margin:12px 0 4px"><b>${esc(label)}</b> <span class="tiny muted">${esc(note || '')}</span></p><div class="code-box">${esc(code)}</div>`).join('')}
    <label class="check" style="margin-top:14px"><input type="checkbox" id="rc-ok"> 모두 적어 두었어요</label>
    <div class="row end"><button class="btn primary" id="rc-close" disabled>닫기</button></div></div>`, {
    onOpen: (b, close) => {
      b.querySelector('#rc-ok').onchange = e => { b.querySelector('#rc-close').disabled = !e.target.checked; };
      b.querySelector('#rc-close').onclick = () => close();
    },
  });
}

function bindGate(ctx, view) {
  const form = (id, fn) => {
    const f = view.querySelector(id);
    if (!f) return;
    f.onsubmit = async e => {
      e.preventDefault();
      const msg = f.querySelector('.msg');
      msg.innerHTML = '';
      await busy(f.querySelector('button.primary'), '잠시만요…', async () => {
        try { await fn(f); } catch (err) { msg.innerHTML = `<div class="err">${esc(err.message)}</div>`; }
      });
    };
  };
  const v = id => view.querySelector(id).value;
  form('#f-setup', async () => {
    if (v('#s-pw') !== v('#s-pw2')) throw new Error('두 비밀번호가 달라요.');
    const token = v('#s-token').trim();
    const dataCode = await ctx.core.setup(token, v('#s-pw'), { user: v('#s-name') });
    const r = await ctx.access.setup(ctx.core, { token, name: v('#s-name'), identifier: v('#s-id').trim() });
    await showCodes([
      ['관리자 로그인', `${v('#s-id').trim()} / ${r.code}`, '로그인 화면에 넣는 이름과 코드'],
      ['명단 복구 코드', r.recoveryCode, '관리자 코드를 잃었을 때'],
      ['데이터 복구 코드', dataCode, '관리자 데이터 비밀번호를 잊었을 때'],
    ]);
    await ctx.session.openAdminIfNeeded();
    ctx.uploads.resume();
    ctx.go('#/admin');
  });
  form('#f-lost', async () => {
    const token = v('#l-token').trim();
    if (!ctx.core.status().connected) {
      if (!token) throw new Error('이 기기는 처음이라 GitHub 토큰이 필요해요.');
      await ctx.core.connectWithToken(token, v('#l-pw'));
    } else if (!ctx.core.status().open) await ctx.core.open(v('#l-pw'));
    const adm = await ctx.access.recoverAdmin(ctx.core, v('#l-rc'));
    const me = (await adm.people()).find(p => p.role === 'admin' && p.status === 'active') || (await adm.people()).find(p => p.role === 'admin');
    if (!me) throw new Error('명단에 관리자가 없어요.');
    const r = await adm.resetCode(me.id);
    await showCodes([['새 관리자 코드', `${me.identifier} / ${r.code}`, '예전 관리자 코드는 이제 못 써요']]);
    await ctx.session.login(me.identifier, r.code, { remember: true });
    ctx.uploads.resume();
    ctx.go('#/admin');
  });
  form('#f-rec0', async () => {
    await ctx.core.recover(v('#r0-code'), v('#r0-pw'), v('#r0-token').trim());
    toast('새 관리자 데이터 비밀번호로 열었어요. 이제 "관리자 코드를 잃었어요"로 새 관리자 코드를 만드세요.');
    await ctx.core.lock();
    ctx.render();
  });
}

// ---------- 본체 ----------
export async function adminView(ctx, view, r) {
  const s = ctx.core.status();
  document.title = '관리자 · 자양교회 어린이 합창단';
  void s;
  if (ctx.session.role !== 'admin' || !s.open || !ctx.session.admin) {
    let setUp = true;
    try { setUp = !!(await ctx.access.keyring()); } catch {}
    view.innerHTML = setUp ? lostScreen() : setupScreen();
    bindGate(ctx, view);
    return;
  }
  const tab = r[0] || '';
  const tabs = `<nav class="admin-tabs" aria-label="관리자 메뉴">${TABS.map(([k, l]) => `<a href="#/admin${k ? `/${k}` : ''}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</nav>`;
  view.innerHTML = `${tabs}<div id="pub-bar"></div><div id="adm"></div>
    <button class="fab" id="fab" aria-label="빠른 추가" title="빠른 추가">${icon('plus')}</button>`;
  const body = view.querySelector('#adm');
  paintPublishBar(ctx, view.querySelector('#pub-bar'));
  view.querySelector('#fab').onclick = () => quickAdd(ctx);
  view.querySelector('.admin-tabs a.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  ctx.uploads.kick();
  switch (tab) {
    case '': return dashboard(ctx, body);
    case 'access': return accessView(ctx, body);
    case 'public': return publicEdit(ctx, body);
    case 'albums': return r[1] ? albumDetail(ctx, body, r[1]) : albumList(ctx, body);
    case 'members': return membersView(ctx, body);
    case 'site': return siteView(ctx, body);
    case 'import': return importView(ctx, body);
    case 'settings': return settingsView(ctx, body);
    case 'trash': return trashView(ctx, body);
    default:
      if (SCHEMA[tab]) return listView(ctx, body, tab);
      body.innerHTML = '<div class="card empty">없는 화면이에요.</div>';
  }
}

async function paintPublishBar(ctx, el) {
  if (!el?.isConnected) return;
  let st;
  try { st = await ctx.pub.state(); } catch (e) { el.innerHTML = ''; return; }
  if (!st.publishedAt) {
    el.innerHTML = `<div class="publish-bar"><span class="grow">아직 학부모 화면을 반영하지 않았어요. 가족 코드를 만들고 반영하면 열려요.</span><a class="btn small primary" href="#/admin/access">가족 코드</a></div>`;
    return;
  }
  el.innerHTML = st.dirty
    ? `<div class="publish-bar"><span class="grow">${icon('refresh')} 학부모 화면에 아직 반영 안 된 변경이 있어요 <span class="tiny muted">(20초 뒤 저절로)</span></span><button class="btn small primary" data-publish>지금 반영</button></div>`
    : `<div class="publish-bar ok"><span class="grow">${icon('check')} 학부모 화면과 같아요 <span class="tiny muted">${st.publishedAt ? `· ${esc(timeAgo(st.publishedAt))} ${esc(st.publishedBy)}` : ''}</span></span></div>`;
  el.querySelector('[data-publish]')?.addEventListener('click', e => doPublish(ctx, e.currentTarget));
  const again = () => { document.removeEventListener('jc:published', again); paintPublishBar(ctx, el); };
  document.addEventListener('jc:published', again);
}

async function doPublish(ctx, btn) {
  await busy(btn, '반영 중…', async () => {
    try {
      const r = await ctx.pub.publish();
      toast(r.changed ? '학부모 화면에 반영했어요. 1~2분 뒤 보여요.' : '이미 같아요.');
      ctx.render();
    } catch (e) { toastErr(e); }
  });
}

// ---------- 대시보드 ----------
async function dashboard(ctx, body) {
  const st = await ctx.pub.state();
  const people = await ctx.session.admin.people();
  const act = people.filter(p => p.status === 'active');
  const usage = ctx.media.usage();
  const total = usage.reduce((n, u) => n + u.bytes, 0);
  const counts = ['notices', 'events', 'songs', 'videos', 'albums', 'members'].map(c => [c, ctx.core.collection(c).list().length]);
  body.innerHTML = `
    <h1>관리자</h1><p class="muted small">${esc(ctx.session.person?.name || '')}님 · ${esc(ctx.core.status().repo)}</p>
    ${tokenWarnHtml(st)}
    <div class="card">
      <h2>학부모·스탭 화면</h2>
      <p class="small">가족 코드 <b>${act.filter(p => p.role === 'parent').length}</b>개 · 스탭 <b>${act.filter(p => p.role === 'staff').length}</b>명 · 관리자 ${act.filter(p => p.role === 'admin').length}명${people.length > act.length ? ` · 회수 ${people.length - act.length}` : ''} · 마지막 반영 ${st.publishedAt ? `${esc(timeAgo(st.publishedAt))} (${esc(st.publishedBy)})` : '아직'}</p>
      <div class="row"><button class="btn primary" data-publish>${icon('refresh')} 학부모 화면에 반영</button><a class="btn soft" href="#/home">학부모 화면 보기</a><a class="btn soft" href="#/staff">스탭 화면 보기</a><a class="btn ghost" href="#/admin/access">권한·코드 관리</a></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>내용</h3><div class="row">${counts.map(([c, n]) => `<a class="chip brand" href="#/admin/${c}">${esc(SCHEMA[c].name)} ${n}</a>`).join('')}</div>
        <p class="help" style="margin-top:12px"><a href="#/admin/trash">휴지통</a> · <a href="#/admin/import">노션에서 가져오기</a> · <a href="#/admin/public">공개 페이지</a></p></div>
      <div class="card"><h3>사진·악보 저장 공간</h3>
        ${usage.length ? usage.map(u => `<div style="margin-bottom:10px"><div class="row between small"><b>${esc(u.name)}</b><span>${size(u.bytes)} / ${size(u.limit)} · ${u.count}개</span></div><div class="bar"><i style="width:${Math.max(1, u.pct)}%"></i></div></div>`).join('')
        + `<p class="help">모두 ${size(total)}. 저장소 하나가 ${size(ctx.media.limit)} 가 되면 다음 저장소(${esc(repoName(usage.length + 1))})를 저절로 만들어요. 스탭 회의자료 첨부는 따로 choir-files-N 에 있어요.</p>`
    : '<p class="small muted">아직 올린 사진·악보가 없어요. 처음 올릴 때 choir-photos-1 저장소를 만들어요.</p>'}</div>
    </div>`;
  body.querySelector('[data-publish]')?.addEventListener('click', e => doPublish(ctx, e.currentTarget));
}

const tokenWarnHtml = st => (st.tokenWarn ? `<div class="err"><b>GitHub 토큰을 바꿔 주세요.</b> 스탭이었던 ${esc(st.tokenWarn.name)} 님이 쓰기용 토큰을 받아 갔을 수 있어요. 열쇠는 이미 바꿔서 새 내용은 못 보지만, 토큰이 있으면 저장소에 쓸 수는 있어요.
  <a href="#/admin/settings">설정 → GitHub 토큰 바꾸기</a> 를 하고 예전 토큰은 GitHub 에서 지우세요.</div>` : '');

// ---------- 권한·코드 (가족 · 스탭 · 관리자) ----------
async function accessView(ctx, body) {
  const adm = ctx.session.admin;
  const st = await ctx.pub.state();
  const all = await adm.people();
  const fams = new Map(ctx.core.collection('families').list().map(f => [f.id, f]));
  const members = new Map(ctx.core.collection('members').list().map(m => [m.id, m]));
  const act = all.filter(p => p.status === 'active');
  const fam = act.filter(p => p.role === 'parent').sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
  const staff = act.filter(p => p.role === 'staff');
  const admins = act.filter(p => p.role === 'admin');
  const gone = all.filter(p => p.status !== 'active');
  const unassigned = await ctx.pub.suggestFamilies();
  const kids = p => (fams.get(p.id)?.memberIds || []).map(id => members.get(id)).filter(Boolean).map(m => `<span class="chip">${esc(m.name)} ${esc(m.grade)}</span>`).join(' ');
  const row = p => `<div class="rowi"><div class="t"><b>${esc(p.name)} ${p.role !== 'parent' ? `<span class="chip sun">${esc(p.roleLabel || p.roleName)}</span>` : ''}</b>
      <small>로그인 이름: ${esc(p.identifier)} · 발급 ${esc(dateDot((p.issuedAt || '').slice(0, 10)))}${p.secret === 'passphrase' ? ' · 비밀문장으로 바꿈' : ''}</small><div style="margin-top:4px">${kids(p)}</div></div>
      <button class="btn small ghost" data-more="${esc(p.id)}">관리</button></div>`;
  body.innerHTML = `<h1>권한·코드</h1>
    ${tokenWarnHtml(st)}
    <div class="card small"><b>누가 무엇을 보나요</b><br>
      · <b>공개</b>: 누구나 — 소개·입단 안내<br>
      · <b>학부모</b> (가족마다 코드 하나): 공지·일정·연주곡·악보·영상·사진·명단(이름과 학년)<br>
      · <b>스탭</b> (사람마다 개인 코드): 학부모 화면 + 연락처 명단·예금주·회의자료·간식 당번 (회의자료·간식은 고칠 수 있음)<br>
      · <b>관리자</b> (관리자 코드): 모든 것 + 코드 발급·회수·역할 바꾸기<br>
      코드는 <b>만들 때 한 번만</b> 보여요(어디에도 저장하지 않음). 잃어버리면 "새 코드". 탈퇴·회수하면 그 자리를 지우고 열쇠를 바꿔서, <b>그 뒤에 올린 것은 볼 수 없어요</b>. 이미 휴대폰에 받아 둔 것은 지울 수 없어요. 서버가 없어서 "마지막 접속"은 알 수 없어요.</div>
    <div class="row between" style="margin-top:18px"><h2 style="margin:0">가족 <span class="chip brand">${fam.length}</span></h2>
      <div class="row">${unassigned.length ? `<button class="btn primary" id="auto-fam">${icon('people')} 명단으로 가족 ${unassigned.length}개 만들기</button>` : ''}<button class="btn soft" id="new-fam">${icon('plus')} 가족 추가</button></div></div>
    ${unassigned.length ? `<p class="help" style="margin-top:6px">아직 코드가 없는 아이: ${unassigned.flatMap(f => f.members.map(m => esc(m.name))).join(', ')} (연락처가 같으면 형제·자매로 한 가족)</p>` : ''}
    <div class="card rows" style="margin-top:10px">${fam.map(row).join('') || '<div class="empty">아직 가족 코드가 없어요.</div>'}</div>
    <div class="row between" style="margin-top:18px"><h2 style="margin:0">스탭 <span class="chip sun">${staff.length}</span></h2><button class="btn soft" id="new-staff">${icon('plus')} 스탭 추가</button></div>
    <div class="card rows" style="margin-top:10px">${staff.map(row).join('') || '<div class="empty">아직 스탭이 없어요.</div>'}</div>
    <h2 style="margin:18px 0 0">관리자 <span class="chip">${admins.length}</span></h2>
    <div class="card rows" style="margin-top:10px">${admins.map(row).join('')}</div>
    <details class="card"><summary><b>비밀문장 바꾸기 요청 적용</b> <span class="tiny muted">(학부모가 보낸 ACX1. 로 시작하는 글자)</span></summary>
      <textarea id="acx" rows="3" style="margin-top:10px" placeholder="ACX1.…"></textarea><div class="row end" style="margin-top:6px"><button class="btn small soft" id="acx-ok">적용</button></div></details>
    ${gone.length ? `<details class="card" style="padding:0;overflow:hidden"><summary style="padding:14px 16px;cursor:pointer;font-weight:700">탈퇴·회수 ${gone.length}</summary><div class="rows">${gone.map(p => `<div class="rowi"><div class="t"><b>${esc(p.name)}</b><small>${esc(p.roleName)} · ${esc(timeAgo(p.revokedAt))}</small></div><button class="btn small ghost" data-back="${esc(p.id)}">다시 허용(새 코드)</button></div>`).join('')}</div></details>` : ''}`;

  const work = async (label, fn) => {
    await modal(`<div><p><span class="spin"></span> ${esc(label)}</p><p class="help">코드마다 암호를 단단히 걸고 공개 사이트에 올리느라 하나에 몇 초씩 걸려요. 화면을 닫지 마세요.</p><div class="bar" style="margin-top:10px"><i id="work-bar" style="width:3%"></i></div></div>`, {
      onOpen: async (b, close) => {
        const bar = x => { const el = b.querySelector('#work-bar'); if (el) el.style.width = `${Math.round(x * 100)}%`; };
        let out;
        try { out = await fn(bar); close(); } catch (e) { close(); toastErr(e); }
        if (out?.length) await invitesDialog(out);
        ctx.render();
      },
    });
  };
  body.querySelector('#auto-fam')?.addEventListener('click', async () => {
    if (!(await confirmBox(`가족 ${unassigned.length}개의 코드를 만들까요?\n${unassigned.map(f => f.name).join(', ')}\n\n코드는 다 만든 뒤 한 번에 보여 드려요(그때 복사·인쇄).`))) return;
    await work('가족 코드를 만드는 중…', async bar => {
      const res = await ctx.pub.addFamilies(unassigned, { onProgress: (d, n) => bar(n ? (d / n) * 0.9 : 0.9) }); // 공개 저장소 커밋 하나
      const bad = res.filter(r => r.error);
      if (bad.length) toast(`${bad.length}개는 만들지 못했어요: ${bad.map(r => `${r.input.name} (${r.error.message})`).join(', ')}`);
      await ctx.pub.publish();
      return res.filter(r => r.person);
    });
  });
  body.querySelector('#acx-ok').onclick = async e => {
    await busy(e.currentTarget, '적용 중…', async () => {
      try { const p = await adm.applySecretChange(body.querySelector('#acx').value); toast(`${p.name}: 비밀문장으로 바꿨어요.`); ctx.render(); } catch (err) { toastErr(err); }
    });
  };
  body.querySelector('#new-fam').onclick = () => personDialog(ctx, 'parent');
  body.querySelector('#new-staff').onclick = () => personDialog(ctx, 'staff');
  body.onclick = async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.back) { if (await confirmBox('다시 허용하고 새 코드를 만들까요?')) await work('새 코드를 만드는 중…', async () => [await adm.resetCode(t.dataset.back)]); return; }
    if (!t.dataset.more) return;
    const x = all.find(p => p.id === t.dataset.more);
    const isMe = x.id === ctx.session.person?.id;
    const v = await modal(`<div><div class="dlg-h"><h2>${esc(x.name)}</h2><button class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div>
      <p class="small muted">${esc(x.roleLabel || x.roleName)} · 로그인 이름 ${esc(x.identifier)}</p>
      <div class="quick-add">
        ${x.role === 'parent' ? `<button data-close="kids">${icon('people')} 아이 고치기</button>` : ''}
        <button data-close="reset">${icon('refresh')} 새 코드 <span class="tiny muted">(잃어버렸거나 남에게 보였을 때 — 예전 코드는 바로 못 씀)</span></button>
        ${x.role === 'parent' ? `<button data-close="to-staff">${icon('people')} 스탭으로 바꾸기</button>` : ''}
        ${x.role === 'staff' ? `<button data-close="to-parent">${icon('people')} 스탭에서 빼기 (학부모 권한만)</button>` : ''}
        ${isMe ? '' : `<button data-close="revoke" style="color:var(--danger)">${icon('trash')} ${x.role === 'parent' ? '탈퇴 처리' : '권한 회수'}</button>`}
      </div></div>`);
    if (v === 'kids') personDialog(ctx, 'parent', x);
    else if (v === 'reset' && (await confirmBox('새 코드를 만들까요? 예전 코드는 바로 못 써요. 새 안내문을 보내 주세요.'))) await work('새 코드를 만드는 중…', async () => [await adm.resetCode(x.id)]);
    else if (v === 'to-staff' && (await confirmBox(`${x.name} 을(를) 스탭으로 바꿀까요? 같은 코드로 연락처가 보이는 스탭 화면이 열려요. 가족이 같이 쓰는 코드라면 "스탭 추가"로 개인 코드를 따로 만드는 게 좋아요.`))) await work('바꾸는 중…', async () => { await adm.changeRole(x.id, 'staff', ['스탭']); return []; });
    else if (v === 'to-parent' && (await confirmBox(`${x.name} 님을 스탭에서 뺄까요? 스탭 열쇠를 바꾸고, GitHub 토큰도 바꾸라고 알려 드릴게요.`))) await work('바꾸는 중…', async () => { const r = await adm.changeRole(x.id, 'parent'); if (r.tokenExposed) await ctx.pub.warnToken(x.name); return []; });
    else if (v === 'revoke') {
      const ok = await confirmBox(`${x.name} ${x.role === 'parent' ? '탈퇴 처리' : '권한 회수'}할까요?\n\n· 이 코드는 바로 못 써요.\n· 열쇠를 바꿔서, 지금부터 올리는 내용은 볼 수 없어요.\n· 이미 휴대폰에 받아 둔 내용은 지울 수 없어요.\n· 명단에는 "탈퇴·회수"로 남아요(다시 허용 가능).${x.canWrite ? '\n· 쓰기용 GitHub 토큰을 가졌던 분이라, 끝난 뒤 토큰도 바꿔 주세요.' : ''}`, { ok: '회수하기', danger: true });
      if (ok) await work('자리를 지우고 열쇠를 바꾸는 중…', async () => { const r = await adm.revoke(x.id); if (r.tokenExposed) await ctx.pub.warnToken(x.name); if (r.recoveryCode) await showCodes([['새 명단 복구 코드', r.recoveryCode, '관리자를 막아서 새로 만들었어요']]); toast('회수했어요.'); return []; });
    }
  };
}

// 만든 코드들의 안내문 (지금 한 번만 보임)
async function invitesDialog(list) {
  const all = list.map(r => r.invitation).join('\n\n────────\n\n');
  await modal(`<div><div class="dlg-h"><h2>안내문 ${list.length > 1 ? `${list.length}개` : ''}</h2><button class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div>
    <div class="warn">코드는 <b>지금 한 번만</b> 보여요. 닫기 전에 각 가족·스탭에게 보내거나 카드로 인쇄하세요. 잃어버리면 "새 코드"로 다시 만들 수 있어요.</div>
    ${list.map((r, i) => `<div class="card flat" style="margin-bottom:8px"><div class="row between"><b>${esc(r.person.name)}</b><span class="row"><button class="btn small soft" data-copy="${i}">${icon('copy')} 복사</button><button class="btn small ghost" data-print="${i}">카드</button></span></div>
      <pre style="white-space:pre-wrap;font:inherit;font-size:13.5px;margin:8px 0 0">${esc(r.invitation)}</pre></div>`).join('')}
    <div class="row end"><button class="btn ghost" id="cp-all">${icon('copy')} 모두 복사</button><button class="btn ghost" id="pr-all">${icon('down')} 모두 카드 인쇄</button><button class="btn primary" data-close>다 보냈어요</button></div></div>`, {
    wide: true,
    onOpen: b => {
      b.addEventListener('click', e => {
        const c = e.target.closest('[data-copy]');
        if (c) copyText(list[+c.dataset.copy].invitation);
        const pr = e.target.closest('[data-print]');
        if (pr) printCards([list[+pr.dataset.print]]);
      });
      b.querySelector('#cp-all').onclick = () => copyText(all);
      b.querySelector('#pr-all').onclick = () => printCards(list);
    },
  });
}

function printCards(list) {
  const info = r => ({ title: ACCESS_CONFIG.title, siteUrl: ACCESS_CONFIG.siteUrl, name: r.person.name, identifier: r.person.identifier, code: r.code, roleLabel: r.person.roleLabel || r.person.roleName });
  if (list.length === 1) { printCard(info(list[0])); return; } // 공유 모듈의 카드 한 장 (바로 인쇄)
  const box = document.createElement('div');
  box.id = 'print-card';
  box.innerHTML = list.map(info).map(x => `<div class="pc"><div>${esc(x.title)} · ${esc(x.roleLabel)}</div><div><b>${esc(x.name)}</b></div><div>주소: ${esc(x.siteUrl)}</div>
    <div>이름: <b>${esc(x.identifier)}</b></div><div>접속 코드: <b style="font-size:15pt;letter-spacing:.06em">${esc(x.code)}</b></div><div class="tiny">본인(가족)만 쓰세요. 잃어버리면 새 코드를 받으세요.</div></div>`).join('');
  document.body.append(box);
  document.body.classList.add('printing');
  const done = () => { box.remove(); document.body.classList.remove('printing'); removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 3000);
}

async function personDialog(ctx, role, x = null) {
  const members = sortMembers(ctx.core.collection('members').list());
  const fam = x ? ctx.core.collection('families').get(x.id) : null;
  const labels = ACCESS_CONFIG.roles.find(r => r.id === 'staff').labels;
  await modal(`<form id="pf"><div class="dlg-h"><h2>${x ? '아이 고치기' : role === 'staff' ? '스탭 추가' : '가족 추가'}</h2><button type="button" class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div>
    ${role === 'staff' ? `<label class="f"><span>이름 *</span><input id="p-name" required placeholder="예: 김총무"></label>
      <div class="f"><span style="font-weight:700;color:var(--text-2);font-size:14px">맡은 일</span><div class="row" style="margin-top:6px">${labels.map(l => `<label class="check" style="margin:0 8px 0 0"><input type="checkbox" value="${esc(l)}" data-lab> ${esc(l)}</label>`).join('')}</div></div>`
    : `<div class="f"><span style="font-weight:700;color:var(--text-2);font-size:14px">아이 (형제·자매 모두)</span><div style="max-height:30vh;overflow:auto;margin-top:6px">${members.map(m => `<label class="check" style="margin:4px 0"><input type="checkbox" value="${esc(m.id)}" data-kid${(fam?.memberIds || []).includes(m.id) ? ' checked' : ''}> ${esc(m.name)} <span class="tiny muted">${esc(m.grade)}</span></label>`).join('')}</div></div>
      ${x ? '' : '<label class="f"><span>가족 이름 *</span><input id="p-name" required placeholder="예: 김하나·김두리 가족"></label>'}`}
    ${x ? '' : `<label class="f"><span>로그인 이름 * <span class="tiny muted">(로그인할 때 넣는 이름. 가족은 보통 아이 이름)</span></span><input id="p-login" required></label>`}
    <div class="row end"><button type="button" class="btn ghost" data-close>취소</button><button class="btn primary" id="p-ok">${x ? '저장' : '코드 만들기'}</button></div></form>`, {
    onOpen: (b, close) => {
      const kidsSel = () => [...b.querySelectorAll('[data-kid]:checked')].map(i => members.find(m => m.id === i.value));
      b.querySelectorAll('[data-kid]').forEach(i => i.addEventListener('change', () => {
        const ks = kidsSel();
        if (!x && ks.length) { b.querySelector('#p-name').value = `${ks.map(k => k.name).join('·')} 가족`; b.querySelector('#p-login').value = ks[0].name; }
      }));
      b.querySelector('#p-name')?.addEventListener('input', e => { if (role === 'staff') b.querySelector('#p-login').value = e.target.value.trim(); });
      b.querySelector('#pf').onsubmit = async e => {
        e.preventDefault();
        await busy(b.querySelector('#p-ok'), '만드는 중…', async () => {
          try {
            if (x) {
              await ctx.core.collection('families').put({ id: x.id, memberIds: kidsSel().map(k => k.id) });
              close();
              toast('저장했어요.');
              ctx.render();
              return;
            }
            const name = b.querySelector('#p-name').value.trim();
            const identifier = b.querySelector('#p-login').value.trim();
            const r = role === 'staff'
              ? await ctx.session.admin.addPerson({ name, identifier, role: 'staff', labels: [...b.querySelectorAll('[data-lab]:checked')].map(i => i.value) })
              : await ctx.pub.addFamily({ name, identifier, memberIds: kidsSel().map(k => k.id) });
            await ctx.pub.publish();
            close();
            await invitesDialog([r]);
            ctx.render();
          } catch (err) { toastErr(err); }
        });
      };
    },
  });
}

// ---------- 공개 페이지 ----------
const PUBLIC_FIELDS = [
  { k: 'title', l: '제목' },
  { k: 'tagline', l: '한 줄 소개' },
  { k: 'intro', l: '소개 글', t: 'textarea', rows: 5 },
  { k: 'activity', l: '활동', t: 'textarea', rows: 4 },
  { k: 'join', l: '입단 안내 (두 번째 쪽)', t: 'textarea', rows: 5 },
  { k: 'contactNote', l: '문의 안내 (전화번호는 넣지 마세요)' },
  { k: 'youtube', l: '유튜브 채널 주소' },
];
function publicEdit(ctx, body) {
  const c = ctx.core.collection('settings');
  const p = c.get('public') || {};
  const vids = ctx.core.collection('videos').list().filter(v => v.kind !== 'practice').sort(SCHEMA.videos.sort);
  body.innerHTML = `<h1>공개 페이지</h1>
    <div class="warn">누구나(로그인 없이) 보는 첫 화면과 입단 안내예요. <b>아이 이름·연락처·사진을 넣지 마세요.</b> 반영할 때 연락처가 보이면 막아요.</div>
    <form class="card" id="pubf">${PUBLIC_FIELDS.map(f => fieldHtml(f, p[f.k], ctx)).join('')}<div class="row end"><button class="btn primary">저장</button></div></form>
    <div class="card"><h3>공개 페이지에 보일 공연 영상</h3><p class="help">유튜브에 이미 공개된 영상만 고르세요.</p>
      ${vids.map(v => `<label class="check" style="margin:6px 0"><input type="checkbox" data-pv="${esc(v.id)}"${v.public ? ' checked' : ''}> ${esc(dateDot(v.date))} ${esc(v.title)}</label>`).join('') || '<p class="small muted">공연 영상이 없어요.</p>'}</div>
    <p><a class="btn soft" href="#/">${icon('ext')} 공개 페이지 보기</a> <span class="help">(반영한 뒤 보여요)</span></p>`;
  body.querySelector('#pubf').onsubmit = async e => {
    e.preventDefault();
    try { await c.put({ ...(c.get('public') || {}), ...readFields(body, PUBLIC_FIELDS), id: 'public' }); toast('저장했어요. 20초 뒤 반영돼요.'); } catch (err) { toastErr(err); }
  };
  body.onchange = async e => { const t = e.target.closest('[data-pv]'); if (t) { await ctx.core.collection('videos').patch(t.dataset.pv, { public: t.checked }); toast(t.checked ? '공개 페이지에 넣었어요.' : '공개 페이지에서 뺐어요.'); } };
}

// ---------- 목록 (공지·일정·연주곡·영상) ----------
function listView(ctx, body, col) {
  const sc = SCHEMA[col];
  const c = ctx.core.collection(col);
  const list = c.list().sort(sc.sort);
  body.innerHTML = `<div class="row between"><h1 style="margin:0">${esc(sc.name)}</h1><button class="btn primary" data-new>${icon('plus')} 새 ${esc(sc.name)}</button></div>
    <p class="help" style="margin-top:8px">${list.length}개 · 누르면 고쳐요. 지우면 휴지통으로 가요(되살릴 수 있어요).</p>
    <div class="card rows">${list.map(r => `<div class="rowi clickable" data-id="${esc(r.id)}"><div class="t">${sc.row(r, ctx)}</div>${r._conflicts?.length ? '<span class="chip sun" title="두 사람이 같은 때 고쳤어요">⚠ 확인</span>' : ''}${icon('right')}</div>`).join('') || '<div class="empty">아직 없어요.</div>'}</div>`;
  body.querySelector('[data-new]').onclick = () => editRecord(ctx, col, null);
  body.querySelector('.rows').onclick = e => { const row = e.target.closest('[data-id]'); if (row) editRecord(ctx, col, row.dataset.id); };
}

export async function editRecord(ctx, col, id, preset = {}) {
  const sc = SCHEMA[col];
  const c = ctx.core.collection(col);
  const rec = id ? c.get(id) : { ...preset };
  const atts = id && sc.attach ? ctx.media.forOwner(`${col}:${id}`) : [];
  await modal(`<form id="ef"><div class="dlg-h"><h2>${esc(sc.name)} ${id ? '고치기' : '새로'}</h2><button type="button" class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div>
    ${rec._conflicts?.length ? `<div class="warn"><b>두 사람이 같은 때 고친 내용이 있어요.</b> 지금 보이는 것이 나중에 고친 것이고, 다른 값은 아래와 같아요.<br>${rec._conflicts.map(x => `${esc(x.field)}: ${esc(typeof x.value === 'object' ? JSON.stringify(x.value) : String(x.value))} (${esc(x.by)})`).join('<br>')}<br><button type="button" class="btn small soft" id="clr-conf" style="margin-top:6px">확인했어요</button></div>` : ''}
    ${sc.fields.map(f => fieldHtml(f, rec[f.k], ctx)).join('')}
    ${col === 'songs' && (rec.scoreFiles || []).length ? `<p class="help">노션에 있던 악보: ${rec.scoreFiles.map(esc).join(', ')}</p>` : ''}
    ${sc.attach ? `<div class="f"><span style="font-weight:700;color:var(--text-2);font-size:14px">첨부 (PDF·사진)</span>
      <div id="atts" style="margin-top:6px">${atts.map(m => `<div class="att">${icon(m.kind === 'pdf' ? 'pdf' : 'photo')}<span class="grow">${esc(m.name)}</span><span class="tiny muted">${size(m.size)}</span><button type="button" class="icon-btn" data-delatt="${esc(m.id)}" aria-label="휴지통">${icon('trash')}</button></div>`).join('')}</div>
      <label class="btn small soft" style="margin-top:4px">${icon('upload')} 파일 붙이기<input type="file" id="att-in" multiple accept="${esc(sc.accept || 'application/pdf,image/*')}" hidden></label> <span class="tiny muted" id="att-pick"></span></div>` : ''}
    <div class="row between" style="margin-top:8px">${id ? `<button type="button" class="btn ghost" id="del" style="color:var(--danger)">${icon('trash')} 휴지통</button>` : '<span></span>'}
      <div class="row"><button type="button" class="btn ghost" data-close>취소</button><button class="btn primary">저장</button></div></div></form>`, {
    wide: col === 'songs',
    onOpen: (b, close) => {
      bindLinks(b);
      let picked = [];
      b.querySelector('#att-in')?.addEventListener('change', e => { picked = [...e.target.files]; b.querySelector('#att-pick').textContent = picked.length ? `${picked.length}개 고름 (저장하면 올려요)` : ''; });
      b.querySelector('#clr-conf')?.addEventListener('click', async () => { await c.clearConflicts(id); close(); ctx.render(); });
      b.querySelector('#atts')?.addEventListener('click', async e => {
        const d = e.target.closest('[data-delatt]');
        if (d && (await confirmBox('이 첨부를 휴지통에 넣을까요?'))) { await ctx.core.collection('media').softDelete(d.dataset.delatt); d.closest('.att').remove(); }
      });
      b.querySelector('#del')?.addEventListener('click', async () => {
        if (await confirmBox(`이 ${sc.name}을(를) 휴지통에 넣을까요? 설정 → 휴지통에서 되살릴 수 있어요.`, { ok: '휴지통에 넣기', danger: true })) { await c.softDelete(id); close(); toast('휴지통에 넣었어요.'); ctx.render(); }
      });
      b.querySelector('#ef').onsubmit = async e => {
        e.preventDefault();
        try {
          const vals = readFields(b, sc.fields);
          const saved = id ? await c.patch(id, vals) : await c.put({ ...preset, ...vals });
          if (picked.length) await startUpload(ctx, picked, `${col}:${saved.id}`, col === 'albums' ? { id: saved.id, title: saved.title, date: saved.date } : null);
          close(saved);
          toast('저장했어요.');
          ctx.render();
        } catch (err) { toastErr(err); }
      };
    },
  });
}

// ---------- 올리기 ----------
export async function startUpload(ctx, files, owner, album) {
  files = [...files];
  const big = files.filter(f => kindOf(f) === 'pdf' && f.size > PDF_WARN && f.size <= PDF_MAX);
  const tooBig = files.filter(f => f.size > PDF_MAX);
  if (tooBig.length) toastErr(new Error(`95MB 넘는 파일은 올릴 수 없어요: ${tooBig.map(f => f.name).join(', ')}`));
  if (big.length && !(await confirmBox(`큰 PDF 가 있어요 (${big.map(f => `${f.name} ${size(f.size)}`).join(', ')}).\n학부모님 휴대폰에서 열 때 오래 걸릴 수 있어요. 그래도 올릴까요?`, { ok: '올리기' }))) return;
  const ok = files.filter(f => f.size <= PDF_MAX);
  if (!ok.length) return;
  const g = ctx.core.collection('settings').get('google') || {};
  const original = !!g.clientId && g.enabled !== false && ok.some(f => kindOf(f) === 'photo');
  await ctx.uploads.add(ok, { owner, album, original });
  toast(`${ok.length}개를 올리기 시작했어요. 화면을 닫지 말고 기다려 주세요.`);
  if (original && !ctx.gAuth.signedIn()) {
    ctx.gAuth.loadGis().catch(() => {});
    const go = await confirmBox(`사진 원본을 Google 포토에 보관하려면 Google 에 로그인해야 해요.\n꼭 합창단 계정(${ACCOUNT_HINT})으로 로그인해 주세요.\n\n사이트에는 지금 바로 올라가요. 원본은 로그인한 뒤 올라가요.`, { ok: 'Google 로그인', cancel: '나중에' });
    if (go) { try { await ctx.gAuth.signIn(); ctx.uploads.kick(); toast('Google 에 로그인했어요. 원본도 올려요.'); } catch (e) { toastErr(e); } }
  }
}

// ---------- 빠른 추가 (휴대폰에서) ----------
async function quickAdd(ctx) {
  const v = await modal(`<div><div class="dlg-h"><h2>빠른 추가</h2><button class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div>
    <div class="quick-add"><button data-close="event">${icon('cal')} 일정 추가</button><button data-close="notice">${icon('bell')} 공지 쓰기</button><button data-close="photos">${icon('photo')} 사진 올리기</button><button data-close="pdf">${icon('pdf')} 악보·자료 PDF 올리기</button></div></div>`);
  if (v === 'event') editRecord(ctx, 'events', null);
  else if (v === 'notice') editRecord(ctx, 'notices', null);
  else if (v === 'photos') pickAlbumAndUpload(ctx);
  else if (v === 'pdf') { const s = ctx.core.collection('songs').list().sort(SCHEMA.songs.sort); if (s.length) pickSongPdf(ctx, s); else editRecord(ctx, 'songs', null); }
}

async function pickAlbumAndUpload(ctx, albumId) {
  const albums = ctx.core.collection('albums').list().sort(SCHEMA.albums.sort);
  await modal(`<div><div class="dlg-h"><h2>사진 올리기</h2><button class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div>
    <label class="f"><span>어느 사진첩에?</span><select id="qa-alb"><option value="">+ 새 사진첩</option>${albums.map(a => `<option value="${esc(a.id)}"${a.id === albumId ? ' selected' : ''}>${esc(dateDot(a.date))} ${esc(a.title)}</option>`).join('')}</select></label>
    <div id="qa-new">${fieldHtml(SCHEMA.albums.fields[0], '', ctx)}${fieldHtml(SCHEMA.albums.fields[1], undefined, ctx)}</div>
    <label class="btn primary block">${icon('photo')} 사진 고르기 (여러 장)<input type="file" id="qa-files" accept="image/*" multiple hidden></label>
    <p class="help" style="margin-top:10px">긴 변 1600px·400KB 이하로 줄여 올리고 위치 정보(EXIF)는 지워요. 원본은 설정에 따라 Google 포토에 보관해요.</p></div>`, {
    onOpen: (b, close) => {
      const sel = b.querySelector('#qa-alb');
      const sync = () => { b.querySelector('#qa-new').hidden = !!sel.value; };
      sel.onchange = sync;
      sync();
      b.querySelector('#qa-files').onchange = async e => {
        const files = [...e.target.files];
        if (!files.length) return;
        try {
          let a = sel.value ? ctx.core.collection('albums').get(sel.value) : null;
          if (!a) a = await ctx.core.collection('albums').put(readFields(b.querySelector('#qa-new'), SCHEMA.albums.fields.slice(0, 2)));
          close();
          await startUpload(ctx, files, `albums:${a.id}`, { id: a.id, title: a.title, date: a.date });
          ctx.go(`#/admin/albums/${a.id}`);
        } catch (err) { toastErr(err); }
      };
    },
  });
}

async function pickSongPdf(ctx, songs) {
  await modal(`<div><div class="dlg-h"><h2>PDF 올리기</h2><button class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div>
    <label class="f"><span>어느 곡에? (공지에 붙이려면 공지 쓰기에서)</span><select id="qs">${songs.map(s => `<option value="${esc(s.id)}">${esc(s.group)} · ${esc(s.title)}</option>`).join('')}</select></label>
    <label class="btn primary block">${icon('pdf')} PDF 고르기 (여러 개)<input type="file" id="qs-files" accept="application/pdf" multiple hidden></label></div>`, {
    onOpen: (b, close) => {
      b.querySelector('#qs-files').onchange = async e => { const f = [...e.target.files]; if (!f.length) return; close(); await startUpload(ctx, f, `songs:${b.querySelector('#qs').value}`, null); };
    },
  });
}

// ---------- 사진첩 ----------
function albumList(ctx, body) {
  const list = ctx.core.collection('albums').list().sort(SCHEMA.albums.sort);
  body.innerHTML = `<div class="row between"><h1 style="margin:0">사진</h1><div class="row"><button class="btn soft" data-up>${icon('upload')} 사진 올리기</button><button class="btn primary" data-new>${icon('plus')} 새 사진첩</button></div></div>
    <p class="help" style="margin-top:8px">사진첩은 "행사 + 날짜" 하나씩. 휴대폰에서 여러 장을 한꺼번에 골라 올릴 수 있어요.</p>
    <div class="albums">${list.map(a => {
      const ph = ctx.media.forOwner(`albums:${a.id}`).filter(m => m.kind === 'photo');
      const cover = ph.find(m => m.id === a.cover) || ph[0];
      if (cover) ctx.reg(cover.id, toEntry(cover));
      return `<a class="album" href="#/admin/albums/${esc(a.id)}"><span class="ph">${cover ? `<img data-fid="${esc(cover.id)}" alt="">` : ''}</span>
        <div class="cap"><b>${esc(a.title)}${a.hidden ? ' <span class="chip">숨김</span>' : ''}</b><span class="tiny muted">${esc(dateDot(a.date))} · ${ph.length}장</span></div></a>`;
    }).join('') || '<div class="card empty" style="grid-column:1/-1">아직 사진첩이 없어요.</div>'}</div>`;
  body.querySelector('[data-new]').onclick = () => editRecord(ctx, 'albums', null).then(saved => saved && ctx.go(`#/admin/albums/${saved.id}`));
  body.querySelector('[data-up]').onclick = () => pickAlbumAndUpload(ctx);
  ctx.hydrate(body);
}

function albumDetail(ctx, body, id) {
  const a = ctx.core.collection('albums').get(id);
  if (!a || a.deletedAt) { body.innerHTML = '<div class="card empty">사진첩을 찾지 못했어요. <a href="#/admin/albums">목록</a></div>'; return; }
  const all = ctx.media.forOwner(`albums:${id}`);
  const ph = all.filter(m => m.kind === 'photo');
  const other = all.filter(m => m.kind !== 'photo');
  for (const m of all) ctx.reg(m.id, toEntry(m));
  const coverId = (ph.find(m => m.id === a.cover) || ph[0])?.id;
  body.innerHTML = `<a class="btn small ghost" href="#/admin/albums">${icon('left')} 사진첩</a>
    <div class="row between" style="margin-top:6px"><div><h1 style="margin:0">${esc(a.title)}${a.hidden ? ' <span class="chip">학부모에게 숨김</span>' : ''}</h1><span class="muted small">${esc(dateKo(a.date, { year: true }))} · 사진 ${ph.length}장</span></div>
      <div class="row"><button class="btn ghost" data-edit>${icon('edit')} 고치기</button><label class="btn primary">${icon('upload')} 사진·PDF 올리기<input type="file" id="al-files" multiple accept="image/*,application/pdf" hidden></label></div></div>
    ${other.length ? `<div class="card" style="margin-top:12px">${other.map(m => `<div class="att">${icon('pdf')}<span class="grow">${esc(m.name)}</span><button class="icon-btn" data-trash="${esc(m.id)}">${icon('trash')}</button></div>`).join('')}</div>` : ''}
    <div class="adm-photos" style="margin-top:14px">${ph.map(m => `<div class="adm-photo${m.id === coverId ? ' cover' : ''}"><button class="ph" data-view="${esc(m.id)}"><img data-fid="${esc(m.id)}" alt=""></button>
      <div class="acts"><button data-cover="${esc(m.id)}" title="대표 사진으로" aria-label="대표 사진으로">${icon('pin')}</button><button data-trash="${esc(m.id)}" title="휴지통" aria-label="휴지통">${icon('trash')}</button></div></div>`).join('') || '<div class="card empty" style="grid-column:1/-1">아직 사진이 없어요. 위의 "사진·PDF 올리기"를 누르세요.</div>'}</div>`;
  body.querySelector('[data-edit]').onclick = () => editRecord(ctx, 'albums', id);
  body.querySelector('#al-files').onchange = e => startUpload(ctx, e.target.files, `albums:${id}`, { id, title: a.title, date: a.date });
  body.onclick = async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.cover) { await ctx.core.collection('albums').patch(id, { cover: t.dataset.cover }); toast('대표 사진으로 정했어요.'); ctx.render(); }
    else if (t.dataset.trash) { if (await confirmBox('이 사진을 휴지통에 넣을까요? (학부모 화면에서 빠져요. 설정 → 휴지통에서 되살릴 수 있어요)')) { await ctx.core.collection('media').softDelete(t.dataset.trash); ctx.render(); } }
    else if (t.dataset.view) { const { lightbox } = await import('./views-parent.js'); const list = ph.map(m => ({ id: m.id, n: m.name })); lightbox(ctx, list, list.findIndex(x => x.id === t.dataset.view), a.title); }
  };
  ctx.hydrate(body);
  // 올리기가 끝나면 다시 그린다
  const un = ctx.uploads;
  let last = un.snapshot().siteDone;
  const t = setInterval(() => { if (!body.isConnected) return clearInterval(t); const n = un.snapshot().siteDone; if (n !== last) { last = n; clearInterval(t); ctx.render(); } }, 1500);
}

// ---------- 명단 (연락처 포함) ----------
function membersView(ctx, body) {
  const list = sortMembers(ctx.core.collection('members').list());
  body.innerHTML = `<div class="row between"><h1 style="margin:0">명단 <span class="chip brand">${list.length}명</span></h1><button class="btn primary" data-new>${icon('plus')} 새 단원</button></div>
    <div class="warn" style="margin-top:10px">${icon('lock')} 부모님 이름·연락처·비고·성별·입단일은 <b>관리자만</b> 봐요. 학부모 화면에는 이름과 학년만 보여요.</div>
    <div class="mcards only-narrow">${list.map(m => `<div class="mcard" data-id="${esc(m.id)}"><div class="top"><span class="chip brand">${esc(/^\d+$/.test(m.grade) ? `${m.grade}학년` : m.grade || '')}</span><b>${esc(m.name)}</b><span class="muted small">${esc(m.gender || '')}</span><span class="grow"></span><span class="tiny muted">${esc(m.joined || '')}</span></div>
      <div class="sub"><span class="priv">${esc(m.parentName || '')}</span>${m.phone ? `<a href="tel:${esc(String(m.phone).replace(/[^\d+]/g, ''))}" data-tel>${icon('phone')} ${esc(m.phone)}</a>` : ''}</div>${m.note ? `<div class="nt">${esc(m.note)}</div>` : ''}</div>`).join('')}</div>
    <div class="card only-wide" style="padding:0"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>학년</th><th>이름</th><th class="priv">성별</th><th class="priv">부모님</th><th class="priv">연락처</th><th class="priv">비고</th><th class="priv">입단</th></tr></thead>
    <tbody>${list.map((m, i) => `<tr data-id="${esc(m.id)}"><td>${i + 1}</td><td>${esc(m.grade)}</td><td><b>${esc(m.name)}</b></td><td>${esc(m.gender || '')}</td><td>${esc(m.parentName || '')}</td>
      <td>${m.phone ? `<a href="tel:${esc(String(m.phone).replace(/[^\d+]/g, ''))}" data-tel>${esc(m.phone)}</a>` : ''}</td><td class="wrap">${esc(m.note || '')}</td><td>${esc(m.joined || '')}</td></tr>`).join('')}</tbody></table></div></div>
    <p class="help">줄을 누르면 고쳐요. 전화번호를 누르면 전화를 걸어요.</p>`;
  body.querySelector('[data-new]').onclick = () => editRecord(ctx, 'members', null, { grade: '1' });
  body.onclick = e => { if (e.target.closest('[data-tel]')) return; const tr = e.target.closest('tr[data-id], .mcard'); if (tr) editRecord(ctx, 'members', tr.dataset.id); };
}

// ---------- 안내 (사이트 정보) ----------
function siteView(ctx, body) {
  const c = ctx.core.collection('settings');
  const s = c.get('site') || {};
  const cover = ctx.media.forOwner('site:cover').filter(m => m.kind === 'photo').pop();
  const files = ctx.media.forOwner('site:info');
  body.innerHTML = `<h1>안내</h1><p class="help">첫 화면의 환영 글·활동 안내·회비·문의, 명단 위 소개. ${PRIV} 칸은 학부모에게 보이지 않아요.</p>
    <form class="card" id="sf">${SITE_FIELDS.map(f => fieldHtml(f, s[f.k], ctx)).join('')}<div class="row end"><button class="btn primary">저장</button></div></form>
    <div class="card"><h3>첫 화면 대표 사진</h3><p class="small muted">${cover ? esc(cover.name) : '없음 (보라색 배경)'}</p>
      <label class="btn soft">${icon('photo')} 사진 고르기<input type="file" id="cover-in" accept="image/*" hidden></label></div>
    <div class="card"><h3>안내 자료 (PDF)</h3>${files.map(m => `<div class="att">${icon('pdf')}<span class="grow">${esc(m.name)}</span><button class="icon-btn" data-trash="${esc(m.id)}">${icon('trash')}</button></div>`).join('') || '<p class="small muted">없음</p>'}
      <label class="btn soft">${icon('upload')} PDF 올리기<input type="file" id="info-in" accept="application/pdf,image/*" multiple hidden></label></div>`;
  body.querySelector('#sf').onsubmit = async e => {
    e.preventDefault();
    try { await c.put({ ...(c.get('site') || {}), ...readFields(body, SITE_FIELDS), id: 'site' }); toast('저장했어요.'); } catch (err) { toastErr(err); }
  };
  body.querySelector('#cover-in').onchange = e => startUpload(ctx, e.target.files, 'site:cover', { id: 'site', title: '대표 사진', date: '' });
  body.querySelector('#info-in').onchange = e => startUpload(ctx, e.target.files, 'site:info', null);
  body.onclick = async e => { const t = e.target.closest('[data-trash]'); if (t && (await confirmBox('휴지통에 넣을까요?'))) { await ctx.core.collection('media').softDelete(t.dataset.trash); ctx.render(); } };
}

// ---------- 가져오기 ----------
function importView(ctx, body) {
  body.innerHTML = `<h1>가져오기</h1>
    <div class="card"><h2>노션에서 가져오기</h2>
      <p class="small">노션 페이지 → 오른쪽 위 ··· → <b>내보내기</b> → 형식 <b>Markdown & CSV</b>, <b>하위 페이지 포함</b> 켜기 → 받은 zip 을 여기에 넣으세요. 이 기기 안에서만 읽어요. 노션 페이지는 그대로 둬요.</p>
      <label class="btn primary">${icon('upload')} 노션 zip 고르기<input type="file" id="zip-in" accept=".zip,application/zip" hidden></label>
      <div id="zip-out"></div></div>
    <div class="card"><h2>준비된 자료 불러오기</h2>
      <p class="small">처음 설정한 뒤 한 번만: 노션 공개 페이지에서 미리 옮겨 둔 JSON 파일(jayangchoir-seed.json). 연락처가 들어 있으니 불러온 뒤 그 파일은 지워 주세요.</p>
      <label class="btn soft">${icon('upload')} JSON 고르기<input type="file" id="seed-in" accept=".json,application/json" hidden></label>
      <div id="seed-out"></div></div>
    <p class="help">여러 번 가져와도 같은 내용이 두 번 생기지 않아요. 이미 있는 내용은 덮어쓰지 않고 빈 칸만 채워요. 지우는 일은 없어요.</p>`;
  body.querySelector('#seed-in').onchange = async e => {
    const out = body.querySelector('#seed-out');
    try {
      const plan = JSON.parse(await e.target.files[0].text());
      if (plan.kind !== 'jayangchoir-seed') throw new Error('준비된 자료 파일이 아니에요.');
      out.innerHTML = '<p><span class="spin"></span> 넣는 중…</p>';
      const r = await applyPlan(plan, { core: ctx.core });
      out.innerHTML = `<div class="ok-box">불러왔어요: ${esc(Object.entries(r.counts).map(([k, n]) => `${k} ${n}`).join(', ') || '바뀐 것 없음 (이미 있어요)')}</div>`;
      toast('불러왔어요.');
    } catch (err) { out.innerHTML = `<div class="err">${esc(err.message)}</div>`; }
    e.target.value = '';
  };
  body.querySelector('#zip-in').onchange = async e => {
    const out = body.querySelector('#zip-out');
    const file = e.target.files[0];
    if (!file) return;
    out.innerHTML = '<p><span class="spin"></span> zip 을 읽는 중… (사진이 많으면 1~2분)</p>';
    try {
      const JSZip = await loadJSZip();
      const { parseNotionZip } = await import('./notion-import.js');
      const { plan, report } = await parseNotionZip(JSZip, await file.arrayBuffer());
      const c = report.counts;
      out.innerHTML = `<div class="ok-box">찾은 것: 일정 ${c.events} · 곡 ${c.songs} (악보 PDF ${c.pdfs}) · 영상 ${c.videos} · 명단 ${c.members}명 · 사진첩 ${c.albums} (사진 ${c.photos}장)</div>
        ${Object.entries(report.pages).filter(([, v]) => !v).length ? `<div class="warn">찾지 못한 페이지: ${Object.entries(report.pages).filter(([, v]) => !v).map(([k]) => esc(k)).join(', ')}</div>` : ''}
        ${report.warnings.length ? `<div class="warn">${report.warnings.map(esc).join('<br>')}</div>` : ''}
        ${plan.albums.length ? `<p class="small">사진첩: ${plan.albums.map(a => `${esc(a.date)} ${esc(a.title)} (${a.photos.length})`).join(', ')}</p>` : ''}
        <label class="check"><input type="checkbox" id="zip-orig"> 사진 원본을 Google 포토에도 보관 (설정에서 켠 경우)</label>
        <button class="btn primary" id="zip-go">가져오기</button>`;
      out.querySelector('#zip-go').onclick = async ev => {
        await busy(ev.currentTarget, '가져오는 중…', async () => {
          try {
            const g = ctx.core.collection('settings').get('google') || {};
            plan.original = out.querySelector('#zip-orig').checked && !!g.clientId;
            const r = await applyPlan(plan, { core: ctx.core, uploads: ctx.uploads, media: ctx.media });
            out.innerHTML = `<div class="ok-box">가져왔어요: ${esc(Object.entries(r.counts).map(([k, n]) => `${k} ${n}`).join(', ') || '새 기록 없음')} · 올릴 파일 ${r.queued}개 (아래 상황판에서 진행을 볼 수 있어요)</div>`;
          } catch (err) { toastErr(err); }
        });
      };
    } catch (err) { out.innerHTML = `<div class="err">zip 을 읽지 못했어요: ${esc(err.message)}</div>`; }
    e.target.value = '';
  };
}

let jszipP = null;
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  jszipP ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'js/vendor/jszip.min.js';
    s.onload = () => res(window.JSZip);
    s.onerror = () => { jszipP = null; rej(new Error('zip 도구를 불러오지 못했어요.')); };
    document.head.append(s);
  });
  return jszipP;
}

// ---------- 설정 ----------
function settingsView(ctx, body) {
  const s = ctx.core.status();
  const g = ctx.core.collection('settings').get('google') || {};
  body.innerHTML = `<h1>설정</h1>
    <div class="card"><h3>내 이름</h3><div class="row nowrap"><input id="me" value="${esc(s.user)}"><button class="btn soft" id="me-save">저장</button></div><p class="help" style="margin-top:6px">고친 사람으로 남아요.</p></div>
    <div class="card"><h3>사진 원본 보관 (Google)</h3>
      <p class="small">사진을 올릴 때 원본(줄이기 전, 촬영 정보 포함)을 합창단 Google 계정(${ACCOUNT_HINT})에 따로 보관해요. 처음 한 번 README 의 "Google 설정" 대로 클라이언트 ID 를 만들어 넣으세요.</p>
      <label class="f"><span>OAuth 클라이언트 ID</span><input id="g-cid" value="${esc(g.clientId || '')}" placeholder="…apps.googleusercontent.com"></label>
      <label class="check"><input type="checkbox" id="g-on"${g.enabled !== false ? ' checked' : ''}> 원본을 Google 포토에 보관</label>
      <label class="f"><span>보관할 곳</span><select id="g-be"><option value="photos"${g.backend !== 'drive' ? ' selected' : ''}>Google 포토 (앨범: 합창단 · 날짜 행사)</option><option value="drive"${g.backend === 'drive' ? ' selected' : ''}>Google Drive (폴더: 합창단 사진 원본/…) — 포토가 안 될 때</option></select></label>
      <div class="row"><button class="btn soft" id="g-save">저장</button><button class="btn ghost" id="g-sign">${ctx.gAuth.signedIn() ? 'Google 로그인됨 ✓' : 'Google 로그인'}</button></div></div>
    <div class="card"><h3>비상용 열쇠</h3><p class="small">관리자는 평소 로그인 화면에서 관리자 코드로 들어와요. 아래는 코드를 모두 잃었을 때 쓰는 것들이에요.</p>
      <div class="row"><button class="btn soft" id="mrc">새 명단 복구 코드</button><button class="btn soft" id="pw">관리자 데이터 비밀번호 바꾸기</button><button class="btn soft" id="rc">새 데이터 복구 코드</button></div></div>
    <div class="card"><h3>GitHub 토큰 바꾸기</h3><p class="small">1년에 한 번, 만료되기 전에. 다른 기기는 다음에 열 때 저절로 새 토큰을 써요. README 의 "토큰 만들기" 참고.</p>
      <div class="row nowrap"><input id="tok" type="password" autocomplete="off" placeholder="새 토큰"><button class="btn soft" id="tok-save">바꾸기</button></div></div>
    <div class="card"><h3>백업 · 휴지통</h3><div class="row"><button class="btn soft" id="bk">${icon('down')} 백업 받기 (암호화된 그대로)</button><a class="btn soft" href="#/admin/trash">${icon('trash')} 휴지통</a></div></div>
    <div class="card"><h3>이 기기</h3><div class="row"><button class="btn soft" id="lock">${icon('lock')} 잠그기</button><button class="btn ghost" id="forget" style="color:var(--danger)">이 기기 연결 끊기</button></div>
      <p class="help" style="margin-top:8px">${s.memoryOnly ? '이 브라우저는 기기에 저장할 수 없어서 탭을 닫으면 다시 연결해야 해요.' : '연결 끊기는 이 기기의 사본만 지워요(GitHub 데이터는 그대로). 아직 못 올린 변경이 있으면 거부해요.'}</p></div>`;
  const $ = s2 => body.querySelector(s2);
  $('#me-save').onclick = async () => { await ctx.core.setUser($('#me').value); toast('저장했어요.'); };
  $('#mrc').onclick = async () => { if (await confirmBox('새 명단 복구 코드를 만들까요? 예전 코드는 바로 못 써요.')) { try { await showCodes([['명단 복구 코드', await ctx.session.admin.newRecoveryCode(), '관리자 코드를 잃었을 때']]); } catch (e) { toastErr(e); } } };
  $('#g-save').onclick = async () => {
    const cur = ctx.core.collection('settings').get('google') || {};
    await ctx.core.collection('settings').put({ ...cur, id: 'google', clientId: $('#g-cid').value.trim(), enabled: $('#g-on').checked, backend: $('#g-be').value });
    toast('저장했어요.');
  };
  $('#g-sign').onclick = async () => { try { await ctx.gAuth.signIn(); toast('Google 에 로그인했어요.'); ctx.uploads.kick(); ctx.render(); } catch (e) { toastErr(e); } };
  $('#pw').onclick = async () => {
    await modal(`<form><h2>관리자 비밀번호 바꾸기</h2><label class="f"><span>지금 비밀번호</span><input id="op" type="password" required></label><label class="f"><span>새 비밀번호 (8자 이상)</span><input id="np1" type="password" required minlength="8"></label><label class="f"><span>한 번 더</span><input id="np2" type="password" required></label><div class="row end"><button type="button" class="btn ghost" data-close>취소</button><button class="btn primary">바꾸기</button></div></form>`, {
      onOpen: (b, close) => {
        b.querySelector('form').onsubmit = async e => {
          e.preventDefault();
          try {
            if (!(await ctx.core.checkPassword(b.querySelector('#op').value))) throw new Error('지금 비밀번호가 맞지 않아요.');
            if (b.querySelector('#np1').value !== b.querySelector('#np2').value) throw new Error('두 비밀번호가 달라요.');
            await ctx.core.changePassword(b.querySelector('#np1').value);
            close();
            toast('바꿨어요. 다른 기기는 다음에 열 때 새 비밀번호를 물어요.');
          } catch (err) { toastErr(err); }
        };
      },
    });
  };
  $('#rc').onclick = async () => { if (await confirmBox('새 데이터 복구 코드를 만들까요? 예전 코드는 바로 못 쓰게 돼요.')) { try { await showCodes([['데이터 복구 코드', await ctx.core.newRecoveryCode(), '관리자 데이터 비밀번호를 잊었을 때']]); } catch (e) { toastErr(e); } } };
  $('#tok-save').onclick = async e => { await busy(e.currentTarget, '확인 중…', async () => { try { const t = $('#tok').value.trim(); await ctx.core.rotateToken(t); await ctx.session.admin.setToken(t); await ctx.pub.clearTokenWarn(); $('#tok').value = ''; toast('토큰을 바꿨어요. 스탭들은 다음에 열 때 새 토큰을 받아요. 예전 토큰은 GitHub 에서 지우세요.'); } catch (err) { toastErr(err); } }); };
  $('#bk').onclick = async () => { try { download(new Blob([await ctx.core.exportBackup()], { type: 'application/json' }), `jayangchoir-backup-${ymd()}.json`); } catch (e) { toastErr(e); } };
  $('#lock').onclick = () => { location.hash = '#/logout'; };
  $('#forget').onclick = async () => {
    if (!(await confirmBox('이 기기의 연결과 사본을 지울까요? GitHub 의 데이터는 그대로예요.', { ok: '연결 끊기', danger: true }))) return;
    try { await ctx.gAuth.revoke(); await ctx.session.logout(); await ctx.core.forgetDevice(); ctx.go('#/'); } catch (e) { toastErr(e); }
  };
}

// ---------- 휴지통 ----------
function trashView(ctx, body) {
  const cols = ['notices', 'events', 'songs', 'videos', 'albums', 'members', 'media'];
  const name = c => (c === 'media' ? '사진·파일' : SCHEMA[c].name);
  const label = (c, r) => esc(r.title || r.name || r.id);
  const rows = cols.flatMap(c => ctx.core.collection(c).trash().map(r => ({ c, r })));
  body.innerHTML = `<h1>휴지통</h1><p class="help">지운 것은 여기 남아요. 되살리면 원래 자리로 가요. 정말로 없애는 기능은 없어요.</p>
    <div class="card rows">${rows.map(({ c, r }) => `<div class="rowi"><div class="t"><b>${label(c, r)}</b><small>${esc(name(c))} · ${esc(timeAgo(r.deletedAt))} ${esc(r.deletedBy || '')}</small></div><button class="btn small soft" data-restore="${esc(c)}|${esc(r.id)}">되살리기</button></div>`).join('') || '<div class="empty">비어 있어요.</div>'}</div>`;
  body.onclick = async e => { const t = e.target.closest('[data-restore]'); if (!t) return; const [c, id] = t.dataset.restore.split('|'); await ctx.core.collection(c).restore(id); toast('되살렸어요.'); ctx.render(); };
}

void SITE_PRIVATE; void textHtml; void closeModal; void ids;
