// 로그인 한 곳 — 공유 모듈 access.js 위에서 (공개 · 학부모 · 스탭 · 관리자)
//
// 로그인 화면은 하나: "이름(아이디)" + "접속 코드". 역할은 고르지 않고 자리(slot)가 정한다.
// 관리자도 같은 로그인으로 들어오고, 관리자 꾸러미 안의 데이터 열쇠로 비공개 데이터 저장소(core)까지 연다(access.openAdmin).
// 이 기기 기억: access 의 30일 기억. 막힌(탈퇴) 사람은 다음에 열 때 AccessError('revoked') → 공개로 돌아가고 안내.

import { ITEM } from './access-config.js';
import { readEntry, readThumb, fetchPublic } from './media.js';

export function createSession({ access, core = null, read = fetchPublic } = {}) {
  const st = { pub: null, bundle: null, albums: new Map(), staff: null, staffItems: [], notice: '', offline: false, admin: null };

  async function loadContent() {
    st.bundle = null;
    st.albums = new Map();
    st.staff = null;
    st.staffItems = [];
    try {
      if (access.canSee('parent')) {
        for (const it of await access.list('parent')) {
          if (it.id === ITEM.content) st.bundle = it.data;
          else if (it.id.startsWith('album-')) st.albums.set(it.id.slice(6), it.data);
        }
      }
      if (access.canSee('staff')) {
        st.staffItems = await access.list('staff');
        st.staff = st.staffItems.find(i => i.id === ITEM.staff)?.data || null;
      }
      st.offline = false;
    } catch (e) {
      if (e.code === 'revoked') { st.notice = '이 기기의 접속이 끝났어요. 코드가 새로 발급되었거나 합창단을 떠난 경우예요. 새 코드는 총무님께 받을 수 있어요.'; st.admin = null; return; }
      if (e.code === 'offline') { st.offline = true; return; }
      throw e;
    }
  }

  async function openAdminIfNeeded() {
    st.admin = null;
    if (!core || !access.me()?.isAdmin) return;
    try { st.admin = await access.openAdmin(core); } catch (e) { console.warn('[session] openAdmin', e); st.notice = e.message; }
  }

  async function load() {
    st.notice = '';
    try {
      st.pub = (await access.list('public')).find(i => i.id === ITEM.public)?.data || null;
    } catch (e) { if (e.code === 'offline') st.offline = true; else console.warn(e); }
    await access.resume();
    await openAdminIfNeeded();
    await loadContent();
    return role();
  }

  async function login(identifier, secret, { remember = true } = {}) {
    st.notice = '';
    const r = await access.login(identifier, secret, { remember });
    await openAdminIfNeeded();
    await loadContent();
    return r.role;
  }

  async function logout() {
    await access.logout();
    st.admin = null;
    if (core?.status().open) await core.lock();
    st.bundle = null; st.staff = null; st.staffItems = []; st.albums = new Map();
  }

  const role = () => access.me()?.role || 'public';

  return {
    load, login, logout, loadContent, openAdminIfNeeded,
    has: tier => access.canSee(tier),
    album: async meta => st.albums.get(meta.id) || { id: meta.id, photos: [] },
    file: (id, e, onProgress) => readEntry(id, e, read, onProgress),
    thumb: (id, e) => readThumb(id, e, read),
    read, access,
    get role() { return role(); },
    get person() { const m = access.me(); return m ? { id: m.pid, name: m.name, labels: m.labels, roleName: m.roleName } : null; },
    get admin() { return st.admin; },
    get bundle() { return st.bundle; }, get staff() { return st.staff; }, get staffItems() { return st.staffItems; },
    get pub() { return st.pub; }, get offline() { return st.offline; }, get notice() { return st.notice; },
  };
}
