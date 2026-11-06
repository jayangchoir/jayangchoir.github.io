// 시험용 가짜 GitHub (메모리). 인터넷 없이 core.js 를 시험할 때 쓴다 (core-test.html).
//   const repo = new FakeRepo(['tok-1']);          // 쓸 수 있는 토큰 목록
//   createCore({ backend: (token) => repo.client(token), ... })
//   repo.online = false        → 모든 요청이 status 0 (인터넷 없음)
//   repo.revoke('tok-1')       → 그 토큰은 401
//   repo.beforePut = async (path) => { … }   → 올리기 직전에 끼어들기 (동시에 고치기 흉내)

import { BackendError } from './github.js';

export class FakeRepo {
  constructor(tokens = []) {
    this.files = new Map(); // path → { sha, bytes }
    this.tokens = new Set(tokens);
    this.online = true;
    this.n = 0;
    this.log = []; // [method, path]
    this.beforePut = null;
    this.conflicts = 0; // 409/422 를 돌려준 횟수
  }

  addToken(t) { this.tokens.add(t); }
  revoke(t) { this.tokens.delete(t); }

  client(token) {
    const repo = this;
    const gate = async () => {
      await new Promise(r => setTimeout(r, 0));
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
      async commitFiles(files) {
        await gate();
        if (repo.beforePut) { const h = repo.beforePut; repo.beforePut = null; await h(files[0]?.path); }
        repo.log.push(['commit', files.map(f => f.path).join(',')]);
        for (const f of files) repo.files.set(f.path, { sha: `sha${++repo.n}`, bytes: new TextEncoder().encode(f.text) });
        return `c${repo.n}`;
      },
      async put(path, bytes, sha) {
        await gate();
        if (repo.beforePut) { const h = repo.beforePut; repo.beforePut = null; await h(path); }
        repo.log.push(['put', path]);
        const cur = repo.files.get(path);
        if (cur && !sha) { repo.conflicts++; throw new BackendError(422, '"sha" wasn\'t supplied'); }
        if ((cur?.sha || null) !== (sha || null)) { repo.conflicts++; throw new BackendError(409, `${path} does not match ${sha}`); }
        const nsha = `sha${++repo.n}`;
        repo.files.set(path, { sha: nsha, bytes: bytes.slice() });
        return nsha;
      },
    };
  }
}

// 계정 하나 (저장소 여러 개). 합창단 시험용: 데이터 저장소 + 공개 사이트 저장소 + 사진 저장소 choir-photos-N
//   const gh = new FakeGitHub(['tok-1'], ['jayangchoir-data', 'jayangchoir.github.io']);
//   createCore({ backend: (t, dev) => gh.client(t, dev), account: t => gh.account(t) })
export class FakeGitHub {
  constructor(tokens = [], names = []) {
    this.tokens = new Set(tokens);
    this.repos = new Map(); // 이름 → { repo: FakeRepo, private }
    this.online = true;
    for (const n of names) this.add(n, n.endsWith('-data'));
  }

  add(name, priv = false) {
    if (!this.repos.has(name)) {
      const repo = new FakeRepo();
      repo.tokens = this.tokens; // 토큰 목록을 함께 쓴다
      this.repos.set(name, { repo, private: priv });
    }
    return this.repos.get(name).repo;
  }

  repo(name) { return this.repos.get(name)?.repo || null; }

  client(token, dev) {
    const r = this.repo(dev.repo);
    if (!r) {
      const gate = async () => { throw new BackendError(404, `${dev.repo} 저장소가 없어요.`); };
      return { token, check: gate, tree: gate, get: gate, put: gate, commitFiles: gate };
    }
    r.online = this.online;
    return r.client(token);
  }

  account(token) {
    const gh = this;
    const gate = async () => {
      await new Promise(res => setTimeout(res, 0));
      if (!gh.online) throw new BackendError(0, '인터넷에 연결되어 있지 않아요.');
      if (!gh.tokens.has(token)) throw new BackendError(401, '토큰이 틀렸거나 만료되었어요.');
    };
    return {
      async repoInfo(name) {
        await gate();
        const r = gh.repos.get(name);
        if (!r) return null;
        let bytes = 0;
        for (const f of r.repo.files.values()) bytes += f.bytes.length;
        return { private: r.private, size: Math.round(bytes / 1024), branch: 'main' };
      },
      async createRepo(name, { private: priv = false } = {}) {
        await gate();
        gh.add(name, priv);
        return this.repoInfo(name);
      },
    };
  }

  // 공개 저장소를 토큰 없이 읽기 (raw.githubusercontent.com 흉내). 없으면 null
  raw(name, path) {
    const r = this.repos.get(name);
    if (!r || r.private) return null;
    const f = r.repo.files.get(path);
    return f ? f.bytes.slice() : null;
  }
}
