// 저장소 연결(백엔드) — 비공개 데이터 저장소 jayangchoir/jayangchoir-data 를 GitHub REST API로 읽고 쓴다.
// 합창단 사이트는 같은 토큰으로 공개 사이트 저장소(학부모용 암호문)와 사진 저장소(choir-photos-N)에도 쓴다:
//   commitFiles(files, message) — 여러 파일을 커밋 하나로 (학부모용 내용이 반쯤 바뀐 채로 보이지 않게)
//   GitHubAccount — 저장소 정보 보기·만들기 (사진 저장소가 차면 다음 것을 만든다)
//
// core.js 는 아래 네 가지만 부른다. 같은 모양이면 무엇이든 백엔드가 될 수 있다 (시험용: fake-backend.js).
//   tree()                         → [{ path, sha }]  저장소의 모든 파일 (빈 저장소면 [])
//   get(path)                      → { sha, bytes: Uint8Array } | null
//   put(path, bytes, sha, message) → 새 sha.  sha 가 GitHub의 지금 sha 와 다르면 오류 status 409
//   check()                        → { branch } 토큰으로 저장소를 볼 수 있는지 확인 (비공개가 아니면 거부)
// 오류는 BackendError: status 0 = 인터넷 없음, 401 = 토큰이 틀림/만료, 403·404 = 권한 없음, 409 = 다른 기기가 먼저 고침.
// 파일을 지우는 함수는 일부러 없다 (데이터는 지우지 않는다).

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

  async get(path) {
    let j;
    try {
      j = await this.req('GET', `${this.base()}/contents/${encodeURI(path)}?ref=${encodeURIComponent(this.branch)}`);
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

  // 여러 글자 파일을 커밋 하나로 올린다: files = [{ path, text }]. 다른 기기가 그사이 올렸으면 다시 (덮어쓰지 않고 그 위에)
  async commitFiles(files, message = 'publish') {
    for (let i = 0; i < 5; i++) {
      const ref = await this.req('GET', `${this.base()}/git/ref/heads/${encodeURIComponent(this.branch)}`);
      const head = ref.object.sha;
      const commit = await this.req('GET', `${this.base()}/git/commits/${head}`);
      const tree = await this.req('POST', `${this.base()}/git/trees`, {
        base_tree: commit.tree.sha,
        tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.text })),
      });
      const next = await this.req('POST', `${this.base()}/git/commits`, { message, tree: tree.sha, parents: [head] });
      try {
        await this.req('PATCH', `${this.base()}/git/refs/heads/${encodeURIComponent(this.branch)}`, { sha: next.sha, force: false });
        return next.sha;
      } catch (e) {
        if (e.status !== 422 && e.status !== 409) throw e; // 그사이 다른 커밋이 생김 → 다시
      }
    }
    throw new BackendError(409, '다른 기기와 동시에 올리느라 반영하지 못했어요. 잠시 뒤 다시 해 주세요.');
  }

  async put(path, bytes, sha, message = 'save') {
    // branch 를 넣지 않으면 기본 브랜치에 쓴다 (check() 가 this.branch 를 기본 브랜치로 맞춘다).
    // 빈 저장소에 처음 쓸 때는 브랜치가 아직 없어서 branch 를 넣으면 실패하므로 넣지 않는다.
    const body = { message, content: b64(bytes), ...(sha ? { sha } : {}) };
    const j = await this.req('PUT', `${this.base()}/contents/${encodeURI(path)}`, body);
    return j.content.sha;
  }
}

// 저장소 정보 보기·만들기 (사진 저장소 choir-photos-N 을 자동으로 만들 때)
// 토큰에 Administration: Read and write 권한이 있어야 만들 수 있다
export class GitHubAccount {
  constructor({ token, owner }) {
    this.be = new GitHubBackend({ token, owner, repo: '' });
    this.owner = owner;
  }

  // → { private, size(KB, GitHub가 늦게 셈), branch } | null
  async repoInfo(name) {
    try {
      const j = await this.be.req('GET', `/repos/${this.owner}/${name}`);
      return { private: j.private, size: j.size, branch: j.default_branch || 'main' };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async createRepo(name, { description = '', private: priv = false } = {}) {
    const have = await this.repoInfo(name);
    if (have) return have;
    try {
      await this.be.req('POST', '/user/repos', { name, description, private: priv, auto_init: true, has_issues: false, has_wiki: false, has_projects: false });
    } catch (e) {
      if (e.status === 422) return this.repoInfo(name); // 이미 있음
      if (e.status === 403 || e.status === 404) {
        throw new BackendError(e.status, `${name} 저장소를 만들 권한이 없어요. 토큰에 "All repositories" + Administration: Read and write 권한을 주세요.`);
      }
      throw e;
    }
    return this.repoInfo(name);
  }
}
