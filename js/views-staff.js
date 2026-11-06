// 스탭 화면 — 연락처 명단 · 회의자료(첨부) · 간식 당번. 스탭과 관리자만.
// 연락처는 스탭 등급 항목 'staff-info'(관리자가 반영)에서, 회의자료·간식은 스탭이 직접 쓴 스탭 등급 항목에서 온다 (access.js).
import { esc, textHtml, icon, toast, toastErr, modal, confirmBox, busy, dateKo, dateDot, size, ymd, download, inlinePdfOk, timeAgo } from './ui.js';
import { createStaffStore } from './staff.js';

const TABS = [['', '연락처'], ['meetings', '회의자료'], ['snacks', '간식 당번']];

export async function staffView(ctx, view, r) {
  const s = ctx.session;
  if (!s.has('staff')) { view.innerHTML = '<div class="card empty">스탭만 볼 수 있어요.</div>'; return; }
  ctx.staffStore ||= createStaffStore({ access: s.access });
  const tab = r[0] || '';
  view.innerHTML = `<h1>스탭</h1>
    <nav class="admin-tabs" aria-label="스탭 메뉴">${TABS.map(([k, l]) => `<a href="#/staff${k ? `/${k}` : ''}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <div id="stf"><p class="muted"><span class="spin"></span> 불러오는 중…</p></div>`;
  const body = view.querySelector('#stf');
  try {
    if (tab === 'meetings') await meetings(ctx, body);
    else if (tab === 'snacks') await snacks(ctx, body);
    else contacts(ctx, body);
  } catch (e) { body.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

// ---------- 연락처 ----------
function contacts(ctx, body) {
  const d = ctx.session.staff;
  if (!d) { body.innerHTML = '<div class="card empty">스탭 내용이 아직 반영되지 않았어요.</div>'; return; }
  const site = d.site || {};
  body.innerHTML = `<div class="warn">${icon('lock')} 부모님 연락처가 보이는 화면이에요. 캡처해서 단체방에 올리지 말아 주세요.</div>
    <div class="grid2">
      <div class="card info-card"><h3>${icon('won')} 회비 계좌</h3><div class="txt">${esc(site.bankName || '')} ${esc(site.bankAccount || '')}<br>예금주: <b>${esc(site.accountHolder || '-')}</b></div></div>
      <div class="card info-card"><h3>${icon('phone')} 문의 담당</h3><div class="txt">${esc(site.contactName || '-')} ${site.contactPhone ? `<a href="tel:${esc(String(site.contactPhone).replace(/[^\d+]/g, ''))}">${esc(site.contactPhone)}</a>` : ''}</div></div>
    </div>
    ${(d.staff || []).length ? `<p class="small">스탭: ${d.staff.map(x => `${esc(x.name)}${x.labels?.length ? ` <span class="chip">${esc(x.labels.join('·'))}</span>` : ''}`).join(' · ')}</p>` : ''}
    <div class="mcards">${(d.members || []).map(m => `<div class="mcard" style="cursor:default"><div class="top"><span class="chip brand">${esc(/^\d+$/.test(m.grade) ? `${m.grade}학년` : m.grade || '')}</span><b>${esc(m.name)}</b><span class="muted small">${esc(m.gender || '')}</span><span class="grow"></span><span class="tiny muted">${esc(m.joined || '')}</span></div>
      <div class="sub"><span class="priv">${esc(m.parentName || '')}</span>${m.phone ? `<a href="tel:${esc(String(m.phone).replace(/[^\d+]/g, ''))}">${icon('phone')} ${esc(m.phone)}</a>` : ''}</div>${m.note ? `<div class="nt">${esc(m.note)}</div>` : ''}</div>`).join('')}</div>
    <p class="help">명단을 고치는 것은 관리자 화면에서 해요.</p>`;
}

// ---------- 회의자료 ----------
async function meetings(ctx, body) {
  const st = ctx.staffStore;
  const list = (await st.list('meetings')).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  body.innerHTML = `<div class="row between"><p class="help" style="margin:0">회의록·안건·자료 파일을 스탭끼리 나눠요.</p><button class="btn primary" data-new>${icon('plus')} 새 회의자료</button></div>
    ${list.map(m => `<div class="card" style="margin-top:12px"><div class="row between"><div><h3 style="margin:0">${esc(m.title)}</h3><span class="small muted">${esc(dateKo(m.date, { year: true }))} · ${esc(m.updatedBy || m.createdBy || '')} ${esc(timeAgo(m.updatedAt))}</span></div>
      <button class="icon-btn" data-edit="${esc(m.id)}" aria-label="고치기">${icon('edit')}</button></div>
      ${m.body ? `<div class="txt" style="margin-top:8px">${textHtml(m.body)}</div>` : ''}
      ${(m.attachments || []).map((a, i) => `<div class="att" style="margin-top:8px">${icon(/pdf/.test(a.type) ? 'pdf' : 'photo')}<span class="grow">${esc(a.name)}</span><span class="tiny muted">${size(a.size)}</span><button class="btn small soft" data-open="${esc(m.id)}|${i}">보기</button></div>`).join('')}
      ${m._conflicts?.length ? '<div class="warn">두 분이 같은 때 고친 내용이 있어요. 고치기를 눌러 확인해 주세요.</div>' : ''}</div>`).join('') || '<div class="card empty" style="margin-top:12px">아직 회의자료가 없어요.</div>'}`;
  body.onclick = async e => {
    const t = e.target.closest('button');
    if (!t) return;
    if ('new' in t.dataset) editMeeting(ctx, null);
    else if (t.dataset.edit) editMeeting(ctx, list.find(x => x.id === t.dataset.edit));
    else if (t.dataset.open) { const [id, i] = t.dataset.open.split('|'); openAttachment(ctx, list.find(x => x.id === id).attachments[+i]); }
  };
}

async function editMeeting(ctx, m) {
  const st = ctx.staffStore;
  let keep = [...(m?.attachments || [])];
  await modal(`<form id="mf"><div class="dlg-h"><h2>${m ? '회의자료 고치기' : '새 회의자료'}</h2><button type="button" class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div>
    <label class="f"><span>제목 *</span><input id="m-title" value="${esc(m?.title || '')}" required></label>
    <label class="f"><span>날짜</span><input id="m-date" type="date" value="${esc(m?.date || ymd())}"></label>
    <label class="f"><span>내용</span><textarea id="m-body" rows="6">${esc(m?.body || '')}</textarea></label>
    <div id="m-atts">${keep.map((a, i) => `<div class="att">${icon('pdf')}<span class="grow">${esc(a.name)}</span><button type="button" class="icon-btn" data-rm="${i}" aria-label="빼기">${icon('x')}</button></div>`).join('')}</div>
    <label class="btn small soft">${icon('upload')} 파일 붙이기 (여러 개)<input type="file" id="m-files" multiple hidden></label> <span class="tiny muted" id="m-pick"></span>
    <div id="m-prog"></div>
    <div class="row between" style="margin-top:12px">${m ? `<button type="button" class="btn ghost" id="m-del" style="color:var(--danger)">${icon('trash')} 휴지통</button>` : '<span></span>'}
      <div class="row"><button type="button" class="btn ghost" data-close>취소</button><button class="btn primary" id="m-save">저장</button></div></div></form>`, {
    onOpen: (b, close) => {
      let picked = [];
      b.querySelector('#m-files').onchange = e => { picked = [...e.target.files]; b.querySelector('#m-pick').textContent = picked.length ? `${picked.length}개 고름` : ''; };
      b.querySelector('#m-atts').onclick = e => { const x = e.target.closest('[data-rm]'); if (x) { keep.splice(+x.dataset.rm, 1); x.closest('.att').remove(); } };
      b.querySelector('#m-del')?.addEventListener('click', async () => { if (await confirmBox('휴지통에 넣을까요? 첨부 파일도 그대로 남아요.')) { await st.softDelete('meetings', m); close(); ctx.render(); } });
      b.querySelector('#mf').onsubmit = async e => {
        e.preventDefault();
        await busy(b.querySelector('#m-save'), '저장 중…', async () => {
          try {
            const big = picked.filter(f => f.size > 20e6);
            if (big.length && !(await confirmBox(`큰 파일이 있어요: ${big.map(f => `${f.name} ${size(f.size)}`).join(', ')}. 그래도 올릴까요?`))) return;
            const prog = b.querySelector('#m-prog');
            const added = picked.length ? await st.attach(picked, x => { prog.innerHTML = `<div class="bar" style="margin-top:8px"><i style="width:${Math.round(x * 100)}%"></i></div>`; }) : [];
            await st.put('meetings', { ...(m || {}), title: b.querySelector('#m-title').value.trim(), date: b.querySelector('#m-date').value, body: b.querySelector('#m-body').value, attachments: [...keep, ...added] });
            close();
            toast('저장했어요.');
            ctx.render();
          } catch (err) { toastErr(err); }
        });
      };
    },
  });
}

async function openAttachment(ctx, a) {
  modal(`<div><div class="dlg-h"><h2 style="font-size:18px">${esc(a.name)}</h2><button class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div><div id="att-body"><p class="muted"><span class="spin"></span> 여는 중…</p></div></div>`, { wide: true });
  try {
    const blob = await ctx.staffStore.file(a);
    const pdf = /pdf/.test(a.type) || /\.pdf$/i.test(a.name);
    const url = URL.createObjectURL(new Blob([blob], { type: pdf ? 'application/pdf' : a.type || 'application/octet-stream' }));
    ctx.blobUrls.push(url);
    const el = document.getElementById('att-body');
    if (el) el.innerHTML = `${pdf && inlinePdfOk() ? `<iframe class="pdf-frame" src="${url}" title="${esc(a.name)}"></iframe>` : /^image\//.test(a.type) ? `<img src="${url}" alt="" style="width:100%;border-radius:10px">` : ''}
      <div class="row" style="margin-top:12px"><a class="btn primary" href="${url}" target="_blank" rel="noopener">${icon('ext')} 새 탭에서 열기</a><a class="btn soft" href="${url}" download="${esc(a.name)}">${icon('down')} 내려받기</a></div>`;
  } catch (e) { const el = document.getElementById('att-body'); if (el) el.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
}

// ---------- 간식 당번 ----------
async function snacks(ctx, body) {
  const st = ctx.staffStore;
  const list = (await st.list('snacks')).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const t = ymd();
  const up = list.filter(x => x.date >= t);
  const past = list.filter(x => x.date < t).reverse();
  const events = (ctx.session.bundle?.events || []).filter(e => e.date >= t).slice(0, 8);
  const row = x => `<div class="rowi clickable" data-id="${esc(x.id)}"><div class="t"><b>${esc(dateKo(x.date))} · ${esc(x.who || '담당 미정')}</b><small>${esc(x.items || '')}${x.note ? ` · ${esc(x.note)}` : ''}</small></div>${icon('right')}</div>`;
  body.innerHTML = `<div class="row between"><p class="help" style="margin:0">어느 날 누가 무엇을 가져올지 정해요.</p><button class="btn primary" data-new>${icon('plus')} 당번 추가</button></div>
    <div class="card rows" style="margin-top:12px">${up.map(row).join('') || '<div class="empty">다가오는 당번이 없어요.</div>'}</div>
    ${events.length ? `<p class="small muted">다가오는 일정: ${events.map(e => `${esc(dateDot(e.date))} ${esc(e.title)}`).join(' · ')}</p>` : ''}
    ${past.length ? `<details class="card" style="padding:0;overflow:hidden"><summary style="padding:14px 16px;cursor:pointer;font-weight:700">지난 당번 ${past.length}개</summary><div class="rows">${past.map(row).join('')}</div></details>` : ''}`;
  body.onclick = e => {
    if (e.target.closest('[data-new]')) return editSnack(ctx, null, events);
    const r = e.target.closest('[data-id]');
    if (r) editSnack(ctx, list.find(x => x.id === r.dataset.id), events);
  };
}

async function editSnack(ctx, x, events) {
  const st = ctx.staffStore;
  const fams = ctx.session.staff?.families || [];
  await modal(`<form id="sf"><div class="dlg-h"><h2>${x ? '간식 당번 고치기' : '간식 당번 추가'}</h2><button type="button" class="icon-btn" data-close aria-label="닫기">${icon('x')}</button></div>
    <label class="f"><span>날짜 *</span><input id="s-date" type="date" value="${esc(x?.date || events[0]?.date || ymd())}" required></label>
    <label class="f"><span>누가 (가족)</span><input id="s-who" list="dl-fam" value="${esc(x?.who || '')}" placeholder="예: 김하나 가족"><datalist id="dl-fam">${fams.map(f => `<option value="${esc(f.name)}">`).join('')}</datalist></label>
    <label class="f"><span>무엇을</span><input id="s-items" value="${esc(x?.items || '')}" placeholder="예: 귤 40개, 물 2박스"></label>
    <label class="f"><span>메모</span><textarea id="s-note" rows="2">${esc(x?.note || '')}</textarea></label>
    ${x?._conflicts?.length ? `<div class="warn">같은 때 고친 다른 값: ${x._conflicts.map(c => `${esc(c.field)}=${esc(String(c.value))} (${esc(c.by)})`).join(', ')}</div>` : ''}
    <div class="row between">${x ? `<button type="button" class="btn ghost" id="s-del" style="color:var(--danger)">${icon('trash')} 휴지통</button>` : '<span></span>'}
      <div class="row"><button type="button" class="btn ghost" data-close>취소</button><button class="btn primary" id="s-save">저장</button></div></div></form>`, {
    onOpen: (b, close) => {
      b.querySelector('#s-del')?.addEventListener('click', async () => { if (await confirmBox('휴지통에 넣을까요?')) { await st.softDelete('snacks', x); close(); ctx.render(); } });
      b.querySelector('#sf').onsubmit = async e => {
        e.preventDefault();
        await busy(b.querySelector('#s-save'), '저장 중…', async () => {
          try {
            const next = { ...(x || {}), date: b.querySelector('#s-date').value, who: b.querySelector('#s-who').value.trim(), items: b.querySelector('#s-items').value.trim(), note: b.querySelector('#s-note').value.trim() };
            delete next._conflicts;
            await st.put('snacks', next);
            close();
            toast('저장했어요.');
            ctx.render();
          } catch (err) { toastErr(err); }
        });
      };
    },
  });
}

void download;
