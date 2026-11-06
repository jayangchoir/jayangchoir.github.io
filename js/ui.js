// 화면 도우미 — 글자 이스케이프, 알림, 대화 상자, 날짜 쓰기, 링크 만들기
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 글 → HTML: 줄바꿈 유지, http 주소는 링크(새 창), 전화번호는 그대로 글자
export function textHtml(s) {
  return esc(s).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`).replace(/\n/g, '<br>');
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export const parseYmd = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
export const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function dateKo(s, { year = false, dow = true } = {}) {
  const d = parseYmd(s);
  if (!d) return s || '';
  return `${year ? `${d.getFullYear()}년 ` : ''}${d.getMonth() + 1}월 ${d.getDate()}일${dow ? ` (${DOW[d.getDay()]})` : ''}`;
}
export const dateDot = s => { const d = parseYmd(s); return d ? `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}` : ''; };
export const dDay = s => { const d = parseYmd(s); if (!d) return ''; const n = Math.round((d - parseYmd(ymd())) / 864e5); return n === 0 ? '오늘' : n === 1 ? '내일' : n > 0 ? `D-${n}` : ''; };
export const size = n => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}MB` : `${Math.max(1, Math.round(n / 1e3))}KB`);
export const timeAgo = iso => {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return dateKo(iso.slice(0, 10), { dow: false });
};

let toastT;
export function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast${bad ? ' bad' : ''}`;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 2600);
}
export const toastErr = e => { console.warn(e); toast(e?.message || String(e), true); };

// 대화 상자: html 을 넣고 data-close 단추나 바깥 누르면 닫힘. 닫힐 때 돌려준 값으로 끝나는 Promise
let closeFn = null;
export function modal(html, { wide = false, onOpen } = {}) {
  const d = $('#modal');
  const body = $('#modal-body');
  body.innerHTML = html;
  d.className = `modal${wide ? ' wide' : ''}`;
  if (!d.open) d.showModal();
  return new Promise(res => {
    closeFn = v => { closeFn = null; if (d.open) d.close(); body.innerHTML = ''; res(v); };
    onOpen?.(body, v => closeFn?.(v));
  });
}
export const closeModal = v => closeFn?.(v);
export function initModal() {
  const d = $('#modal');
  d.addEventListener('click', e => {
    if (e.target === d) closeModal(undefined);
    const c = e.target.closest('[data-close]');
    if (c) closeModal(c.dataset.close || undefined);
  });
  d.addEventListener('cancel', e => { e.preventDefault(); closeModal(undefined); });
}

export async function confirmBox(msg, { ok = '확인', danger = false, cancel = '취소' } = {}) {
  const v = await modal(`<div class="dlg"><p class="dlg-msg">${textHtml(msg)}</p><div class="row end"><button class="btn ghost" data-close="no">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-close="yes">${esc(ok)}</button></div></div>`);
  return v === 'yes';
}

// 단추를 누르는 동안 막고 "…중" 표시
export async function busy(btn, label, fn) {
  const old = btn?.innerHTML;
  if (btn) { btn.disabled = true; if (label) btn.innerHTML = `<span class="spin"></span>${esc(label)}`; }
  try { return await fn(); } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
}

export const ICONS = {
  home: '<path d="M3 11 12 3l9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  video: '<rect x="2" y="5" width="15" height="14" rx="2"/><path d="m17 10 5-3v10l-5-3"/>',
  photo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 6 4.8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  down: '<path d="M12 3v12m0 0-5-5m5 5 5-5M4 21h16"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  audio: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="2" y="14" width="5" height="7" rx="1.5"/><rect x="17" y="14" width="5" height="7" rx="1.5"/>',
  yt: '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 5 3-5 3z" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  up: '<path d="M12 21V9m0 0-5 5m5-5 5 5M4 3h16"/>',
  left: '<path d="m15 5-7 7 7 7"/>', right: '<path d="m9 5 7 7-7 7"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  check: '<path d="m5 12 5 5 9-10"/>', pin: '<path d="M12 17v5M5 17h14l-2-4V5H7v8z"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  won: '<path d="M3 7l4 12 5-12 5 12 4-12M2 11h20M2 14h20"/>', phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  map: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>', upload: '<path d="M12 16V4m0 0-5 5m5-5 5 5M4 20h16"/>',
};
export const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;

// 파일 내려받기 (원래 이름으로)
export function download(blob, name) {
  const a = document.createElement('a');
  const u = URL.createObjectURL(blob);
  a.href = u;
  a.download = name || 'file';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}

export const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
// 이 브라우저가 페이지 안(iframe)에서 PDF 를 보여 줄 수 있는가 — 안드로이드 크롬·iOS 사파리는 못하거나 첫 쪽만
export const inlinePdfOk = () => navigator.pdfViewerEnabled === true && !isIOS() && !/Android/i.test(navigator.userAgent) && !matchMedia('(pointer: coarse)').matches;

export async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('복사했어요'); } catch { toast('복사하지 못했어요. 길게 눌러 복사해 주세요.', true); }
}
