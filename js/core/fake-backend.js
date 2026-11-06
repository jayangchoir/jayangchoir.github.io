// 시험용 가짜 GitHub (메모리). 인터넷 없이 core.js · access.js 를 시험할 때 쓴다 (core-test.html, access-test.html).
//   const repo = new FakeRepo(['tok-1']);          // 쓸 수 있는 토큰 목록
//   createCore({ backend: (token) => repo.client(token), ... })
//   repo.online = false        → 모든 요청이 status 0 (인터넷 없음)
//   repo.revoke('tok-1')       → 그 토큰은 401
//   repo.beforePut = async (path) => { … }   → 올리기 직전에 끼어들기 (동시에 고치기 흉내)
//   repo.beforeCommit = async (files) => { … } → commit 직전에 끼어들기
//   repo.commitLog             → [{ sha, message, paths }]  커밋 하나마다 한 줄
//
// 저장소 여러 개 (access.js: 공개 사이트 저장소 + 파일 저장소 <site>-files-N):
//   const gh = new FakeGitHub({ owner: 'jayangchild', tokens: ['pub'], creators: ['pub'] });
//   gh.repo('jayangchild.github.io', { isPublic: true })
//   gh.client(token, 'jayangchild.github.io')   → GitHubBackend 와 같은 모양 (+ head · commit · createRepo)
//   gh.reader('jayangchild.github.io')          → 토큰 없이 공개 저장소 읽기 (access.js 의 reader 모양)

import { BackendError } from './github.js';

const tick = () => new Promise(r => setTimeout(r, 0));

export class FakeRepo {
  constructor(tokens = [], { name = '', isPublic = false } = {}) {
    this.name = name;
    this.isPublic = isPublic;
    this.files = new Map(); // path → { sha, bytes }
    this.tokens = new Set(tokens);
    this.online = true;
    this.n = 0;
    this.log = []; // [method, path]
    this.beforePut = null;
    this.beforeCommit = null;
    this.conflicts = 0; // 409/422 를 돌려준 횟수
    this.commitLog = [];
  }

  addToken(t) { this.tokens.add(t); }
  revoke(t) { this.tokens.delete(t); }
  headSha() { return this.commitLog.length ? this.commitLog[this.commitLog.length - 1].sha : null; }
  addCommit(message, paths) { this.commitLog.push({ sha: `c${this.commitLog.length + 1}`, message, paths }); }

  client(token) {
    const repo = this;
    const gate = async () => {
      await tick();
      if (!repo.online) throw new BackendError(0, '인터넷에 연결되어 있지 않아요.');
      if (!repo.tokens.has(token)) throw new BackendError(401, '토큰이 틀렸거나 만료되었어요.');
    };
    return {
      token,
      async check() { await gate(); return { branch: 'main' }; },
      async tree() {
        await gate();
        repo.log.push(['tree']);
        return [...repo.files].map(([path, f]) => ({ path, sha: f.sha }));
      },
      async get(path) {
        await gate();
        repo.log.push(['get', path]);
        const f = repo.files.get(path);
        return f ? { sha: f.sha, bytes: f.bytes.slice() } : null;
      },
      async put(path, bytes, sha, message = 'save') {
        await gate();
        if (repo.beforePut) { const h = repo.beforePut; repo.beforePut = null; await h(path); }
        repo.log.push(['put', path]);
        const cur = repo.files.get(path);
        if (cur && !sha) { repo.conflicts++; throw new BackendError(422, '"sha" wasn\'t supplied'); }
        if ((cur?.sha || null) !== (sha || null)) { repo.conflicts++; throw new BackendError(409, `${path} does not match ${sha}`); }
        const nsha = `sha${++repo.n}`;
        repo.files.set(path, { sha: nsha, bytes: bytes.slice() });
        repo.addCommit(message, [path]);
        return nsha;
      },
      // 지금 브랜치 끝 커밋 (빈 저장소면 null)
      async head() { await gate(); return repo.headSha(); },
      // 여러 파일을 커밋 하나로. parent 가 지금 끝 커밋이 아니면(누가 먼저 올림) 409
      async commit(files, message, parent) {
        await gate();
        if (repo.beforeCommit) { const h = repo.beforeCommit; repo.beforeCommit = null; await h(files); }
        repo.log.push(['commit', files.map(f => f.path)]);
        if ((parent || null) !== repo.headSha()) { repo.conflicts++; throw new BackendError(409, 'Update is not a fast forward'); }
        for (const f of files) repo.files.set(f.path, { sha: `sha${++repo.n}`, bytes: f.bytes.slice() });
        repo.addCommit(message, files.map(f => f.path));
        return repo.headSha();
      },
    };
  }

  // 토큰 없이 읽기 (공개 저장소만)
  read(path) {
    if (!this.isPublic) throw new BackendError(404, 'Not Found');
    if (!this.online) throw new BackendError(0, '인터넷에 연결되어 있지 않아요.');
    const f = this.files.get(path);
    return f ? f.bytes.slice() : null;
  }
}

export class FakeGitHub {
  constructor({ owner = 'owner', tokens = [], creators = [] } = {}) {
    this.owner = owner;
    this.tokens = new Set(tokens); // 모든 저장소에 쓸 수 있는 토큰
    this.creators = new Set(creators); // 새 저장소를 만들 수 있는 토큰
    this.repos = new Map();
    this.created = []; // createRepo 로 만든 이름
  }

  repo(name, { isPublic = true } = {}) {
    if (!this.repos.has(name)) {
      const r = new FakeRepo([], { name, isPublic });
      r.tokens = this.tokens;
      this.repos.set(name, r);
    }
    return this.repos.get(name);
  }

  setOnline(v) { for (const r of this.repos.values()) r.online = v; }

  client(token, name) {
    const gh = this;
    const createRepo = n => gh.createRepoBy(token, n);
    if (!gh.repos.has(name)) {
      const nf = async () => { await tick(); throw new BackendError(404, 'Not Found'); };
      return { token, check: nf, tree: nf, get: nf, put: nf, head: nf, commit: nf, createRepo };
    }
    return { ...gh.repo(name).client(token), createRepo };
  }

  async createRepoBy(token, name) {
    await tick();
    if (!this.tokens.has(token)) throw new BackendError(401, '토큰이 틀렸거나 만료되었어요.');
    if (this.repos.has(name)) return { name, created: false };
    if (!this.creators.has(token)) throw new BackendError(403, 'Resource not accessible by personal access token');
    const r = this.repo(name, { isPublic: true });
    r.files.set('README.md', { sha: `sha${++r.n}`, bytes: new TextEncoder().encode(`# ${name}\n`) });
    r.addCommit('Initial commit', ['README.md']);
    this.created.push(name);
    return { name, created: true };
  }

  // access.js 의 reader 모양: site(path) · file(repo, path) → Uint8Array | null
  reader(siteRepo) {
    const gh = this;
    return {
      async site(path) { await tick(); return gh.repo(siteRepo).read(path); },
      async file(repo, path) { await tick(); return gh.repos.has(repo) ? gh.repo(repo).read(path) : null; },
    };
  }
}
