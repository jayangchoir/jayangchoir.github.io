// 저장소 연결(백엔드) — 비공개 데이터 저장소 jayangchoir/jayangchoir-data 를 GitHub REST API로 읽고 쓴다.
//
// core.js 는 아래 네 가지만 부른다. 같은 모양이면 무엇이든 백엔드가 될 수 있다 (시험용: fake-backend.js).
//   tree()                         → [{ path, sha }]  저장소의 모든 파일 (빈 저장소면 [])
//   get(path)                      → { sha, bytes: Uint8Array } | null
//   put(path, bytes, sha, message) → 새 sha.  sha 가 GitHub의 지금 sha 와 다르면 오류 status 409
//   check()                        → { branch } 토큰으로 저장소를 볼 수 있는지 확인 (비공개가 아니면 거부)
// 오류는 BackendError: status 0 = 인터넷 없음, 401 = 토큰이 틀림/만료, 403·404 = 권한 없음, 409 = 다른 기기가 먼저 고침.
// 파일을 지우는 함수는 일부러 없다 (데이터는 지우지 않는다).
//
// access.js(공개 사이트 저장소에 올리기)는 여기에 더해 아래를 쓴다:
//   head()                         → 기본 브랜치 끝 커밋 sha (빈 저장소면 null)
//   get(path, ref)                 → ref(커밋 sha)에서 읽기
//   commit(files, message, parent) → 여러 파일 [{ path, bytes }] 을 커밋 하나로 (git trees API).
//                                    parent 가 브랜치 끝이 아니면(누가 먼저 올림) status 409
//   createRepo(name)               → { name, created } 공개 저장소 만들기 (이미 있으면 created:false)
// publicReader(...) 는 토큰 없이 공개 사이트(GitHub Pages)와 공개 파일 저장소(raw.githubusercontent.com)를 읽는다.

import { b64, unb64 } from './crypto.js';

const API = 'https://api.github.com';

export class BackendError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const isConflict = e => e?.status === 409 || e?.status === 422;

export class GitHubBackend {
  constructor({ token, owner, repo, branch }) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch || 'main';
  }

  async req(method, path, body) {
    let r;
    try {
      r = await fetch(API + path, {
        method,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new BackendError(0, '인터넷에 연결되어 있지 않아요.');
    }
    if (!r.ok) {
      let msg = '';
      try { msg = (await r.json()).message || ''; } catch {}
      if (r.status === 401) msg = '연결 열쇠(토큰)가 만료되었거나 바뀌었어요. 관리자에게 QR로 다시 연결해 달라고 하세요.';
      // 'sha' 가 안 맞으면 GitHub는 409 또는 422 를 준다
      throw new BackendError(r.status, msg || `GitHub 오류 ${r.status}`);
    }
    return r.status === 204 ? null : r.json();
  }

  base() {
    return `/repos/${this.owner}/${this.repo}`;
  }

  async check() {
    let info;
    try {
      info = await this.req('GET', this.base());
    } catch (e) {
      if (e.status === 404 || e.status === 403) throw new BackendError(e.status, `이 토큰으로는 ${this.owner}/${this.repo} 저장소를 볼 수 없어요. 토큰의 저장소·권한(Contents: Read and write)을 확인하세요.`);
      throw e;
    }
    if (!info.private) throw new BackendError(400, `${this.owner}/${this.repo} 저장소가 공개 상태예요. 먼저 비공개(Private)로 바꿔 주세요.`);
    this.branch = info.default_branch || this.branch;
    return { branch: this.branch };
  }

  async tree() {
    try {
      const t = await this.req('GET', `${this.base()}/git/trees/${encodeURIComponent(this.branch)}?recursive=1`);
      if (t.truncated) throw new BackendError(500, '저장소 파일이 너무 많아 목록을 다 받지 못했어요.');
      return t.tree.filter(x => x.type === 'blob').map(x => ({ path: x.path, sha: x.sha }));
    } catch (e) {
      if (e.status === 409 || e.status === 404) return []; // 빈 저장소
      throw e;
    }
  }

  async get(path, ref) {
    let j;
    try {
      j = await this.req('GET', `${this.base()}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref || this.branch)}`);
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
    if (j.encoding === 'base64' && j.content) return { sha: j.sha, bytes: unb64(j.content) };
    if (!j.size) return { sha: j.sha, bytes: new Uint8Array(0) };
    // 1MB 넘는 파일은 contents API가 내용을 주지 않는다 → blob API (100MB까지)
    const blob = await this.req('GET', `${this.base()}/git/blobs/${j.sha}`);
    return { sha: j.sha, bytes: unb64(blob.content) };
  }

  async put(path, bytes, sha, message = 'save') {
    // branch 를 넣지 않으면 기본 브랜치에 쓴다 (check() 가 this.branch 를 기본 브랜치로 맞춘다).
    // 빈 저장소에 처음 쓸 때는 브랜치가 아직 없어서 branch 를 넣으면 실패하므로 넣지 않는다.
    const body = { message, content: b64(bytes), ...(sha ? { sha } : {}) };
    const j = await this.req('PUT', `${this.base()}/contents/${encodeURI(path)}`, body);
    return j.content.sha;
  }

  async head() {
    try {
      const r = await this.req('GET', `${this.base()}/git/ref/heads/${encodeURIComponent(this.branch)}`);
      return r.object.sha;
    } catch (e) {
      if (e.status === 404 || e.status === 409) return null; // 빈 저장소
      throw e;
    }
  }

  async commit(files, message, parent) {
    if (!parent) throw new BackendError(400, '빈 저장소에는 commit 할 수 없어요 (README 하나를 먼저 만드세요).');
    const pc = await this.req('GET', `${this.base()}/git/commits/${parent}`);
    const tree = [];
    for (const f of files) {
      const b = await this.req('POST', `${this.base()}/git/blobs`, { content: b64(f.bytes), encoding: 'base64' });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: b.sha });
    }
    const t = await this.req('POST', `${this.base()}/git/trees`, { base_tree: pc.tree.sha, tree });
    const c = await this.req('POST', `${this.base()}/git/commits`, { message, tree: t.sha, parents: [parent] });
    try {
      await this.req('PATCH', `${this.base()}/git/refs/heads/${encodeURIComponent(this.branch)}`, { sha: c.sha, force: false });
    } catch (e) {
      if (e.status === 422) throw new BackendError(409, '다른 사람이 먼저 올렸어요.'); // fast-forward 아님
      throw e;
    }
    return c.sha;
  }

  // 공개 저장소 만들기 (파일 저장소 <site>-files-N). org: 조직 계정이면 true
  async createRepo(name, { org = false, description = '' } = {}) {
    try {
      await this.req('GET', `/repos/${this.owner}/${name}`);
      return { name, created: false };
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const body = { name, private: false, auto_init: true, description, has_issues: false, has_wiki: false, has_projects: false };
    try {
      await this.req('POST', org ? `/orgs/${this.owner}/repos` : '/user/repos', body);
    } catch (e) {
      if (e.status === 422) return { name, created: false }; // 그사이 다른 사람이 만듦
      if (e.status === 403 || e.status === 404) throw new BackendError(e.status, `저장소 ${name} 을(를) 만들 권한이 없어요. 쓰기 토큰에 저장소 만들기(Administration) 권한이 있는지 확인하세요.`);
      throw e;
    }
    return { name, created: true };
  }
}

// 토큰 없이 읽기: 사이트 파일은 GitHub Pages(siteUrl)에서, 파일 저장소는 raw.githubusercontent.com 에서.
// 사이트 CSP connect-src 에 https://raw.githubusercontent.com 이 있어야 한다.
export function publicReader({ siteUrl, owner, branch = 'main' }) {
  const grab = async url => {
    let r;
    try {
      r = await fetch(url, { cache: 'no-store' });
    } catch {
      throw new BackendError(0, '인터넷에 연결되어 있지 않아요.');
    }
    if (r.status === 404) return null;
    if (!r.ok) throw new BackendError(r.status, `내려받지 못했어요 (${r.status}).`);
    return new Uint8Array(await r.arrayBuffer());
  };
  return {
    site: path => grab(`${new URL(path, siteUrl)}?t=${Date.now()}`),
    file: (repo, path) => grab(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`),
  };
}
