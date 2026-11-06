// 사진 원본을 합창단 Google 계정(jayangchoir@gmail.com)에 보관 — Google 포토 (안 되면 Google Drive)
//
// - 로그인: Google Identity Services 토큰 클라이언트 (personal-hub/js/tasks.js 와 같은 방식).
//   OAuth 클라이언트 ID 는 관리자가 한 번 붙여 넣고 관리자 데이터(비공개·암호화)의 settings/google 에 둔다.
//   받은 토큰(약 1시간)은 메모리와 이 탭의 sessionStorage 에만 두고, 관리자 화면을 잠그면 취소(revoke)한다.
// - Google 포토: 범위 photoslibrary.appendonly — 바이트 올리기(uploads) → 앨범 만들기(albums.create) → mediaItems:batchCreate (50개씩)
// - Drive(예비): 범위 drive.file — "합창단 사진 원본/<앨범>" 폴더에 multipart 로 올리기
// - 원본은 그대로 올린다(EXIF 포함). 이 사본은 비공개 Google 계정에만 있다. 사이트에 올리는 사본은 EXIF 를 지운 것.
// - 사이트 올리기와 따로 돈다(uploads.js). 여기서 실패해도 사이트 쪽은 영향이 없고, 실패한 원본은 "다시"로 다시 올린다.

export const GIS = 'https://accounts.google.com/gsi/client';
export const SCOPES = {
  photos: 'https://www.googleapis.com/auth/photoslibrary.appendonly',
  drive: 'https://www.googleapis.com/auth/drive.file',
};
export const ACCOUNT_HINT = 'jayangchoir@gmail.com';
const TK = 'jc.gtoken';
const BATCH = 50;
const TOKEN_DAY = 20 * 3600e3; // uploadToken 은 하루 유효 — 넉넉히 20시간 안에만 다시 쓴다

export const albumTitle = a => `합창단 · ${[a?.date, a?.title].filter(Boolean).join(' ')}`.trim();

class GErr extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

function httpErr(status, what) {
  if (status === 401) return '구글 로그인이 풀렸어요. 다시 로그인해 주세요.';
  if (status === 403) return `${what} 권한이 없어요. Google Cloud 에서 API 를 켰는지, 로그인할 때 권한에 체크했는지 확인해 주세요.`;
  if (status === 429) return '요청이 너무 많아요. 잠시 뒤 다시 해 주세요.';
  if (status >= 500) return 'Google 쪽에 잠시 문제가 있어요. 조금 뒤 다시 해 주세요.';
  return `${what} 요청이 실패했어요. (${status})`;
}

async function gfetch(url, init, what) {
  let r;
  try {
    r = await fetch(url, init);
  } catch {
    throw new GErr('Google 에 연결하지 못했어요 (인터넷 또는 브라우저가 막음).', 0);
  }
  if (!r.ok) throw new GErr(httpErr(r.status, what), r.status);
  return r;
}

// ---------- 실제 Google 백엔드 ----------

export function photosBackend(getToken) {
  const H = async () => ({ Authorization: `Bearer ${await getToken()}` });
  return {
    kind: 'photos',
    async createAlbum(title) {
      const r = await gfetch('https://photoslibrary.googleapis.com/v1/albums', {
        method: 'POST', headers: { ...(await H()), 'Content-Type': 'application/json' }, body: JSON.stringify({ album: { title } }),
      }, 'Google 포토 앨범 만들기');
      return (await r.json()).id;
    },
    async uploadBytes(blob, name, type) {
      const r = await gfetch('https://photoslibrary.googleapis.com/v1/uploads', {
        method: 'POST',
        headers: { ...(await H()), 'Content-Type': 'application/octet-stream', 'X-Goog-Upload-Content-Type': type || 'image/jpeg', 'X-Goog-Upload-Protocol': 'raw', 'X-Goog-Upload-File-Name': encodeURIComponent(name || 'photo.jpg') },
        body: blob,
      }, 'Google 포토 올리기');
      return (await r.text()).trim();
    },
    // → [{ ok, error }] 같은 순서
    async batchCreate(albumId, list) {
      const r = await gfetch('https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate', {
        method: 'POST', headers: { ...(await H()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ albumId, newMediaItems: list.map(x => ({ simpleMediaItem: { uploadToken: x.token, fileName: x.name } })) }),
      }, 'Google 포토 저장');
      const j = await r.json();
      const res = j.newMediaItemResults || [];
      return list.map(x => {
        const m = res.find(y => y.uploadToken === x.token);
        const code = m?.status?.code || 0;
        return code === 0 || m?.status?.message === 'Success' || m?.status?.message === 'OK' ? { ok: true } : { ok: false, error: m?.status?.message || '저장되지 않았어요.' };
      });
    },
  };
}

export function driveBackend(getToken) {
  const H = async () => ({ Authorization: `Bearer ${await getToken()}` });
  const API = 'https://www.googleapis.com/drive/v3/files';
  async function folder(name, parent) {
    const q = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'${parent ? ` and '${parent}' in parents` : ''}`;
    const r = await gfetch(`${API}?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, { headers: await H() }, 'Google Drive 폴더 찾기');
    const have = (await r.json()).files?.[0]?.id;
    if (have) return have;
    const c = await gfetch(`${API}?fields=id`, {
      method: 'POST', headers: { ...(await H()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }),
    }, 'Google Drive 폴더 만들기');
    return (await c.json()).id;
  }
  return {
    kind: 'drive',
    async createAlbum(title) {
      const root = await folder('합창단 사진 원본');
      return folder(title.replace(/^합창단 · /, ''), root);
    },
    async uploadBytes() { return ''; }, // Drive 는 batchCreate 에서 한 번에
    async batchCreate(folderId, list) {
      const out = [];
      for (const x of list) {
        try {
          const meta = JSON.stringify({ name: x.name, parents: [folderId] });
          const boundary = `jc${Math.random().toString(36).slice(2)}`;
          const body = new Blob([
            `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${x.type || 'application/octet-stream'}\r\n\r\n`,
            x.blob, `\r\n--${boundary}--`,
          ]);
          await gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
            method: 'POST', headers: { ...(await H()), 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
          }, 'Google Drive 올리기');
          out.push({ ok: true });
        } catch (e) {
          if (e.status === 401 || e.status === 0) throw e;
          out.push({ ok: false, error: e.message });
        }
      }
      return out;
    },
  };
}

// ---------- 로그인 (GIS 토큰 클라이언트) ----------

export function createGoogleAuth({ getClientId, scope }) {
  let token = null; // { v, exp, cid, scope }
  try { token = JSON.parse(sessionStorage.getItem(TK)); } catch {}
  let gisP = null;
  const loadGis = () => {
    if (!gisP) {
      gisP = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = GIS;
        s.async = true;
        s.onload = () => (window.google?.accounts?.oauth2 ? res(window.google.accounts.oauth2) : rej(new Error('Google 로그인 도구가 열리지 않았어요.')));
        s.onerror = () => { gisP = null; s.remove(); rej(new Error('Google 로그인 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.')); };
        document.head.append(s);
      });
    }
    return gisP;
  };
  const ok = () => !!token && token.cid === getClientId() && token.scope === scope() && token.exp > Date.now() + 60e3;
  const ERR = {
    access_denied: '권한을 허락하지 않아서 로그인하지 못했어요.',
    popup_closed: '로그인 창이 닫혔어요. 다시 눌러 주세요.',
    popup_failed_to_open: '로그인 창이 열리지 않았어요. 팝업 차단을 풀고 다시 눌러 주세요.',
  };
  async function signIn(prompt = '') {
    if (!getClientId()) throw new Error('먼저 설정에서 Google OAuth 클라이언트 ID 를 넣어 주세요.');
    const oauth2 = await loadGis();
    const r = await new Promise((res, rej) => {
      const tc = oauth2.initTokenClient({
        client_id: getClientId(), scope: scope(), prompt, hint: ACCOUNT_HINT, login_hint: ACCOUNT_HINT, callback: res,
        error_callback: e => rej(new Error(ERR[e?.type] || 'Google 로그인에 실패했어요.')),
      });
      tc.requestAccessToken({ prompt });
    });
    if (r.error) {
      if (prompt === '' && /interaction_required|consent_required|login_required/.test(r.error)) return signIn('consent');
      throw new Error(ERR[r.error] || `Google 로그인에 실패했어요. (${r.error})`);
    }
    if (oauth2.hasGrantedAllScopes && !oauth2.hasGrantedAllScopes(r, scope())) throw new Error('사진 보관 권한에 체크하지 않았어요. 다시 로그인하면서 체크해 주세요.');
    token = { v: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000, cid: getClientId(), scope: scope() };
    try { sessionStorage.setItem(TK, JSON.stringify(token)); } catch {}
    return token.v;
  }
  function forget() {
    token = null;
    try { sessionStorage.removeItem(TK); } catch {}
  }
  // 잠글 때: Google 쪽에서도 토큰을 무효로
  async function revoke() {
    const t = token?.v;
    forget();
    if (!t) return;
    try {
      if (window.google?.accounts?.oauth2?.revoke) window.google.accounts.oauth2.revoke(t, () => {});
      else await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${encodeURIComponent(t)}` });
    } catch {}
  }
  return {
    loadGis, signIn, forget, revoke,
    signedIn: ok,
    // 일꾼용: 로그인되어 있으면 토큰, 아니면 오류(창을 띄우지 않음)
    async token() { if (ok()) return token.v; throw new GErr('구글 로그인이 필요해요.', 401); },
  };
}

// ---------- 원본 일꾼 ----------
// cfg(): { enabled, backend: 'photos'|'drive' }   albumId(a) / setAlbumId(a, id): 사이트 앨범 ↔ Google 앨범(폴더) id
// backendFor(kind): 위 photosBackend / driveBackend (시험에서는 가짜)   ready(): 로그인되어 있는가
export function createOriginals({ cfg, backendFor, ready, albumId, setAlbumId }) {
  async function drain(list, save) {
    const c = cfg();
    if (!c.enabled) {
      for (const it of list) { it.orig = 'off'; await save(it); }
      return;
    }
    if (!ready()) return; // 로그인할 때까지 기다린다 (항목은 pending 그대로, 새로고침해도 남음)
    const be = backendFor(c.backend || 'photos');
    const groups = new Map();
    for (const it of list) {
      const k = it.album?.id || '_';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
    for (const [, group] of groups) {
      const a = group[0].album || { id: '_', title: '기타 사진' };
      const key = `${be.kind}:${a.id}`;
      let gid = albumId(key);
      try {
        if (!gid) { gid = await be.createAlbum(albumTitle(a)); await setAlbumId(key, gid); }
      } catch (e) {
        for (const it of group) { it.orig = 'error'; it.origErr = e.message; await save(it); }
        if (e.status === 401 || e.status === 0) return;
        continue;
      }
      for (let i = 0; i < group.length; i += BATCH) {
        const batch = group.slice(i, i + BATCH);
        const ready2 = [];
        for (const it of batch) {
          try {
            if (be.kind === 'photos' && (!it.gTok || Date.now() - (it.gTokAt || 0) > TOKEN_DAY)) {
              it.gTok = await be.uploadBytes(it.file, it.name, it.type);
              it.gTokAt = Date.now();
              await save(it);
            }
            ready2.push(it);
          } catch (e) {
            it.orig = 'error';
            it.origErr = e.message;
            await save(it);
            if (e.status === 401 || e.status === 0) return;
          }
        }
        if (!ready2.length) continue;
        let res;
        try {
          res = await be.batchCreate(gid, ready2.map(it => ({ token: it.gTok, name: it.name, type: it.type, blob: it.file })));
        } catch (e) {
          for (const it of ready2) { it.orig = 'error'; it.origErr = e.message; await save(it); }
          if (e.status === 401 || e.status === 0) return;
          continue;
        }
        for (let j = 0; j < ready2.length; j++) {
          const it = ready2[j];
          if (res[j]?.ok) { it.orig = 'done'; it.origErr = ''; it.gTok = null; } else { it.orig = 'error'; it.origErr = res[j]?.error || '저장되지 않았어요.'; }
          await save(it);
        }
      }
    }
  }
  return { drain };
}
