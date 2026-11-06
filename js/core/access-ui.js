// 등급 접속 화면 조각 (한국어). 사이트마다 그대로 가져다 쓴다. 틀(DOM)만 만들고, 모양은 ax- 로 시작하는 작은 CSS 하나.
//   import { loginCard, invitationCard, peopleTable, confirmRevoke } from './core/access-ui.js';
//
// 규칙: 첫 화면은 공개 페이지. 로그인은 하나(아이디 + 코드) — 역할은 고르지 않고 자리(slot)가 정한다.
// 잠금·코드·토큰·막기 글에는 무엇이 안전하게 남는지를 같이 적는다. "마지막 접속" 같은 없는 정보는 보여 주지 않는다.

import { invitationText } from './access.js';

const CSS = `
.ax-card{max-width:420px;margin:0 auto;padding:20px;border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:14px;background:Canvas;color:CanvasText;font:15px/1.55 system-ui,sans-serif}
.ax-card h2{font-size:18px;margin:0 0 12px}
.ax-field{display:block;margin:10px 0}
.ax-field span{display:block;font-size:13px;margin-bottom:4px;opacity:.85}
.ax-field input,.ax-field select,.ax-msg{width:100%;box-sizing:border-box;padding:10px 12px;font:inherit;border:1px solid color-mix(in srgb,CanvasText 30%,transparent);border-radius:10px;background:Canvas;color:CanvasText}
.ax-msg{min-height:220px;font-size:13px;white-space:pre-wrap}
.ax-check{display:flex;gap:8px;align-items:flex-start;font-size:13px;margin:8px 0}
.ax-btn{padding:10px 16px;font:inherit;border-radius:10px;border:1px solid color-mix(in srgb,CanvasText 30%,transparent);background:Canvas;color:CanvasText;cursor:pointer}
.ax-btn.ax-main{background:#d9792b;border-color:#d9792b;color:#fff;font-weight:600}
.ax-btn.ax-danger{background:#cf222e;border-color:#cf222e;color:#fff}
.ax-btn:disabled{opacity:.6;cursor:wait}
.ax-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.ax-note{font-size:12.5px;opacity:.8;margin:8px 0 0}
.ax-err{color:#cf222e;font-size:13.5px;margin:8px 0 0;min-height:1em}
.ax-ok{color:#1a7f37;font-size:13.5px;margin:8px 0 0}
.ax-table{width:100%;border-collapse:collapse;font:14px/1.45 system-ui,sans-serif}
.ax-table th,.ax-table td{padding:8px 6px;border-bottom:1px solid color-mix(in srgb,CanvasText 14%,transparent);text-align:left;vertical-align:top}
.ax-table th{font-size:12.5px;opacity:.75;font-weight:600}
.ax-revoked td{opacity:.55}
.ax-tag{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;border:1px solid currentColor}
.ax-people{display:grid;gap:14px}
.ax-add{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;align-items:end}
.ax-scroll{overflow-x:auto}
dialog.ax-dialog{max-width:460px;border:none;border-radius:14px;padding:0}
dialog.ax-dialog::backdrop{background:rgba(0,0,0,.45)}
.ax-print-card{display:none}
@media print{html.ax-printing body>*:not(.ax-print-card){display:none!important}html.ax-printing .ax-print-card{display:block;width:85mm;border:1px solid #000;border-radius:4mm;padding:6mm;font:11pt/1.5 system-ui,sans-serif;color:#000}.ax-print-card b{font-size:14pt;letter-spacing:.06em}}
`;

function styles() {
  if (typeof document === 'undefined' || document.getElementById('ax-style')) return;
  const s = document.createElement('style');
  s.id = 'ax-style';
  s.textContent = CSS;
  document.head.append(s);
}

// 작은 DOM 도우미: h('div', { class: 'x', onclick }, '글', child)
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const fmtDate = iso => (iso ? new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : '');

async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}

// ---------------------------------------------------------------
// 로그인 카드: 아이디 + 코드 하나. 역할은 고르지 않는다.
//   loginCard({ access, onLogin(result), title, remember: true })
//   result = access.login() 의 값 { role, roleName, labels, name, tiers, canWrite, isAdmin, bundle }
// ---------------------------------------------------------------
export function loginCard({ access, onLogin, title = '로그인', idLabel = '아이디', codeLabel = '접속 코드 (또는 내가 정한 비밀문장)', remember = true, onCancel } = {}) {
  styles();
  const id = h('input', { name: 'identifier', autocomplete: 'username', required: true, placeholder: '안내문에 적힌 아이디' });
  const code = h('input', { name: 'code', type: 'password', autocomplete: 'current-password', required: true, placeholder: '예) K7QX-M2PA-9TRD', autocapitalize: 'characters', spellcheck: 'false' });
  const rem = h('input', { type: 'checkbox', name: 'remember' });
  const msg = h('p', { class: 'ax-err', role: 'alert' });
  const go = h('button', { class: 'ax-btn ax-main', type: 'submit' }, '들어가기');
  const form = h('form', { class: 'ax-card ax-login', novalidate: true },
    h('h2', {}, title),
    h('label', { class: 'ax-field' }, h('span', {}, idLabel), id),
    h('label', { class: 'ax-field' }, h('span', {}, codeLabel), code),
    remember ? h('label', { class: 'ax-check' }, rem, h('span', {}, '이 기기 기억하기 (30일). 여러 사람이 쓰는 PC에서는 켜지 마세요.')) : null,
    msg,
    h('div', { class: 'ax-row' }, go, onCancel ? h('button', { class: 'ax-btn', type: 'button', onclick: onCancel }, '공개 페이지로') : null),
    h('p', { class: 'ax-note' }, '코드는 이 기기 안에서만 확인하고 어디에도 보내지 않아요. 확인하는 데 몇 초 걸려요.'),
    h('p', { class: 'ax-note' }, '코드를 잃어버렸으면 관리자에게 새 코드를 받으세요. 새 코드를 받으면 예전 코드는 바로 못 쓰게 되고, 볼 수 있는 내용은 그대로예요.'),
  );
  form.addEventListener('submit', async e => {
    e.preventDefault();
    msg.textContent = '';
    if (!id.value.trim() || !code.value.trim()) { msg.textContent = '아이디와 코드를 모두 넣어 주세요.'; return; }
    try {
      const r = await busy(go, '확인하는 중…', () => access.login(id.value, code.value, { remember: rem.checked }));
      code.value = '';
      onLogin?.(r);
    } catch (er) {
      msg.textContent = er.message || String(er);
    }
  });
  return form;
}

// ---------------------------------------------------------------
// 안내문 (보낼 글) + 복사 + 인쇄용 카드
// ---------------------------------------------------------------
export { invitationText };

export function invitationCard({ title, siteUrl, name, identifier, code, roleLabel }) {
  styles();
  const text = invitationText({ title, siteUrl, name, identifier, code, roleLabel });
  const area = h('textarea', { class: 'ax-msg', readOnly: true, rows: 14 });
  area.value = text;
  const note = h('p', { class: 'ax-note' });
  const copy = h('button', { class: 'ax-btn ax-main', type: 'button' }, '안내문 복사');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      note.textContent = '복사했어요. 카카오톡·문자에 붙여 그분께만 보내 주세요 (단체방 X).';
    } catch {
      area.select();
      note.textContent = '복사하지 못했어요. 글을 길게 눌러 직접 복사해 주세요.';
    }
  });
  const print = h('button', { class: 'ax-btn', type: 'button', onclick: () => printCard({ title, siteUrl, name, identifier, code, roleLabel }) }, '카드 인쇄');
  return h('div', { class: 'ax-card ax-invite' },
    h('h2', {}, `${name}님께 보낼 안내문`),
    area,
    h('div', { class: 'ax-row' }, copy, print),
    note,
    h('p', { class: 'ax-note' }, '이 코드는 지금 한 번만 보여요. 관리자도 다시 볼 수 없어요 (어디에도 저장하지 않아서 새어 나갈 곳이 없어요). 잃어버리면 "새 코드"로 다시 만들면 되고, 그때 예전 코드는 바로 못 쓰게 돼요.'),
  );
}

// 지갑에 넣는 카드 한 장 인쇄
export function printCard({ title, siteUrl, name, identifier, code, roleLabel }) {
  styles();
  const card = h('div', { class: 'ax-print-card' },
    h('div', {}, `${title}${roleLabel ? ` · ${roleLabel}` : ''}`),
    h('div', {}, `${name}님`),
    h('div', {}, `주소: ${siteUrl}`),
    h('div', {}, `아이디: ${identifier}`),
    h('div', {}, '접속 코드: ', h('b', {}, code)),
    h('div', { style: 'font-size:9pt;margin-top:3mm' }, '본인만 쓰세요. 잃어버리면 관리자에게 새 코드를 받으세요 (예전 코드는 바로 못 쓰게 돼요).'),
  );
  document.body.append(card);
  document.documentElement.classList.add('ax-printing');
  const done = () => { card.remove(); document.documentElement.classList.remove('ax-printing'); removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 60000);
}

// ---------------------------------------------------------------
// 막기 확인 → Promise<boolean>
// ---------------------------------------------------------------
export function revokeMessage(person) {
  const n = person?.name || '이분';
  const lines = [
    `${n}님을 막으면, 앞으로 올리는 새 내용은 ${n}님이 볼 수 없어요.`,
    `하지만 ${n}님이 이미 내려받았거나 화면에 띄워 본 예전 내용은 그 기기에 남아 있을 수 있어요. 그것까지 되돌릴 방법은 없어요.`,
    '남은 분들은 지금 쓰는 코드 그대로 들어올 수 있어요. 사이트 열쇠는 자동으로 바뀌어요.',
    '명단에서 지우지 않고 "막음"으로 남겨요. 나중에 "다시 허용"하면 새 코드를 드려요.',
  ];
  if (person?.canWrite) lines.push('이분은 올리기 권한이 있어서 쓰기 토큰을 알고 있어요. 막은 뒤 새 토큰을 만들어 바꾸고, 예전 토큰은 GitHub에서 지워 주세요.');
  return lines.join('\n');
}

export function confirmRevoke(person) {
  styles();
  return new Promise(resolve => {
    const yes = h('button', { class: 'ax-btn ax-danger', type: 'button' }, '막기');
    const no = h('button', { class: 'ax-btn', type: 'button' }, '취소');
    const dlg = h('dialog', { class: 'ax-dialog' },
      h('div', { class: 'ax-card' },
        h('h2', {}, `${person?.name || ''}님 막기`),
        ...revokeMessage(person).split('\n').map(t => h('p', {}, t)),
        h('div', { class: 'ax-row' }, yes, no)),
    );
    const end = v => { dlg.close(); dlg.remove(); resolve(v); };
    yes.addEventListener('click', () => end(true));
    no.addEventListener('click', () => end(false));
    dlg.addEventListener('cancel', e => { e.preventDefault(); end(false); });
    document.body.append(dlg);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  });
}

// ---------------------------------------------------------------
// 사람 명단 (관리자): 추가 · 새 코드 · 역할 바꾸기 · 막기 · 다시 허용
//   peopleTable({ admin, access, onChange })  — admin = await access.openAdmin(core)
// ---------------------------------------------------------------
export function peopleTable({ admin, access, onChange, confirm = confirmRevoke } = {}) {
  styles();
  const roles = admin.roles;
  const cfg = access.config;
  const keyedRoles = roles.list.filter(r => r.id !== 'public');
  const wrap = h('div', { class: 'ax-people' });
  const out = h('div');
  const msg = h('p', { class: 'ax-err', role: 'alert' });

  const roleSelect = (value, labels = []) => {
    const sel = h('select', {}, ...keyedRoles.flatMap(r => (r.labels.length ? r.labels.map(l => h('option', { value: `${r.id}|${l}` }, `${roles.name(r.id)} · ${l}`)) : []).concat(h('option', { value: `${r.id}|` }, roles.name(r.id)))));
    sel.value = `${value}|${labels[0] || ''}`;
    return sel;
  };
  const parseRole = v => { const [role, label] = v.split('|'); return { role, labels: label ? [label] : [] }; };

  const showInvite = (person, code) => {
    out.replaceChildren(invitationCard({ title: cfg.title, siteUrl: cfg.siteUrl, name: person.name, identifier: person.identifier, code, roleLabel: person.roleLabel }));
    out.scrollIntoView?.({ block: 'nearest' });
  };

  const act = async (btn, label, fn) => {
    msg.textContent = '';
    try { await busy(btn, label, fn); await render(); onChange?.(); } catch (e) { msg.textContent = e.message || String(e); }
  };

  // 추가
  const nName = h('input', { placeholder: '이름' });
  const nId = h('input', { placeholder: '아이디 (예: 전화번호, 이름+숫자)' });
  const nRole = roleSelect(keyedRoles[0].id);
  const addBtn = h('button', { class: 'ax-btn ax-main', type: 'button' }, '추가하고 코드 만들기');
  addBtn.addEventListener('click', () => act(addBtn, '만드는 중…', async () => {
    const r = await admin.addPerson({ name: nName.value, identifier: nId.value, ...parseRole(nRole.value) });
    nName.value = '';
    nId.value = '';
    showInvite(r.person, r.code);
  }));

  const tbody = h('tbody');
  async function render() {
    const people = await admin.people();
    const me = access.me()?.pid;
    tbody.replaceChildren(...people.map(p => {
      const active = p.status === 'active';
      const sel = roleSelect(p.role, p.labels);
      const bCode = h('button', { class: 'ax-btn', type: 'button' }, active ? '새 코드' : '다시 허용');
      bCode.addEventListener('click', () => act(bCode, '만드는 중…', async () => { const r = await admin.resetCode(p.id); showInvite(r.person, r.code); }));
      const bRole = h('button', { class: 'ax-btn', type: 'button' }, '역할 바꾸기');
      bRole.addEventListener('click', () => act(bRole, '바꾸는 중…', async () => {
        const { role, labels } = parseRole(sel.value);
        const r = await admin.changeRole(p.id, role, labels);
        if (r.recoveryCode) out.replaceChildren(h('p', { class: 'ax-ok' }, `관리자 열쇠가 바뀌었어요. 새 명단 복구 코드: ${r.recoveryCode} — 종이에 적어 봉투에 넣어 주세요.`));
        else if (r.tokenExposed) out.replaceChildren(h('p', { class: 'ax-ok' }, '올리기 권한이 빠졌어요. 이분이 알던 쓰기 토큰은 새로 바꾸고 예전 것은 GitHub에서 지워 주세요.'));
      }));
      const bRevoke = h('button', { class: 'ax-btn ax-danger', type: 'button' }, '막기');
      bRevoke.addEventListener('click', async () => {
        if (!(await confirm(p))) return;
        await act(bRevoke, '막는 중…', async () => {
          const r = await admin.revoke(p.id);
          const notes = [`${p.name}님을 막았어요. 남은 분들은 지금 코드 그대로 쓸 수 있어요.`];
          if (r.tokenExposed) notes.push('쓰기 토큰을 새로 만들어 "토큰 바꾸기"를 하고, 예전 토큰은 GitHub에서 지워 주세요.');
          if (r.recoveryCode) notes.push(`새 명단 복구 코드: ${r.recoveryCode} — 종이에 적어 봉투에 넣어 주세요.`);
          out.replaceChildren(...notes.map(t => h('p', { class: 'ax-ok' }, t)));
        });
      });
      const self = p.id === me;
      return h('tr', { class: active ? '' : 'ax-revoked', 'data-pid': p.id },
        h('td', {}, p.name, self ? ' (나)' : ''),
        h('td', {}, p.identifier),
        h('td', {}, active ? sel : p.roleLabel),
        h('td', {}, h('span', { class: 'ax-tag' }, active ? (p.secret === 'passphrase' ? '사용 중 · 비밀문장' : '사용 중 · 코드') : '막음')),
        h('td', {}, fmtDate(p.issuedAt), p.revokedAt ? h('div', { class: 'ax-note' }, `막은 날 ${fmtDate(p.revokedAt)}`) : null),
        h('td', {}, h('div', { class: 'ax-row', style: 'margin:0' }, bCode, active && !self ? bRole : null, active && !self ? bRevoke : null)),
      );
    }));
  }

  wrap.append(
    h('div', { class: 'ax-card', style: 'max-width:none' },
      h('h2', {}, '사람 추가'),
      h('div', { class: 'ax-add' },
        h('label', { class: 'ax-field' }, h('span', {}, '이름'), nName),
        h('label', { class: 'ax-field' }, h('span', {}, '아이디'), nId),
        h('label', { class: 'ax-field' }, h('span', {}, '역할'), nRole),
        addBtn),
      h('p', { class: 'ax-note' }, '추가하면 접속 코드가 한 번 보여요. 안내문을 복사해 그분께만 보내 주세요.')),
    out,
    msg,
    h('div', { class: 'ax-scroll' }, h('table', { class: 'ax-table' },
      h('thead', {}, h('tr', {}, ...['이름', '아이디', '역할', '상태', '발급일', ''].map(t => h('th', {}, t)))),
      tbody)),
    h('p', { class: 'ax-note' }, '언제 들어왔는지(마지막 접속)는 기록되지 않아요. 서버가 없는 사이트라 확인할 방법이 없어요.'),
    h('p', { class: 'ax-note' }, '막은 사람도 명단에서 지우지 않아요. 코드는 어디에도 저장하지 않으니, 잃어버린 분께는 "새 코드"를 만들어 주세요.'),
  );
  wrap.ready = render();
  wrap.refresh = render;
  return wrap;
}
