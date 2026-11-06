// IndexedDB 키-값 저장소 (personal-hub/js/idb.js 를 데이터베이스 이름을 받도록 바꾼 것).
// 기기 하나에 core 하나면 이름 하나. 시험(core-test.html)은 기기마다 다른 이름을 써서 두 기기를 흉내 낸다.
// IndexedDB를 못 쓰는 환경(일부 사생활 보호 모드)에서는 메모리로 대신한다 (그때는 탭을 닫으면 사라지므로 status.memoryOnly 로 알린다).

const STORE = 'kv';

export class KV {
  constructor(name) {
    this.name = name;
    this.dbp = null;
    this.mem = new Map();
    this.useMem = typeof indexedDB === 'undefined';
  }

  open() {
    if (!this.dbp) {
      this.dbp = new Promise((res, rej) => {
        const r = indexedDB.open(this.name, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return this.dbp;
  }

  async run(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }

  async get(k) {
    if (!this.useMem) {
      try { return await this.run('readonly', s => s.get(k)); } catch { this.useMem = true; }
    }
    return this.mem.get(k);
  }

  async set(k, v) {
    if (!this.useMem) {
      try { await this.run('readwrite', s => s.put(v, k)); return; } catch { this.useMem = true; }
    }
    this.mem.set(k, v);
  }

  async del(k) {
    if (!this.useMem) {
      try { await this.run('readwrite', s => s.delete(k)); return; } catch { this.useMem = true; }
    }
    this.mem.delete(k);
  }

  async keys() {
    if (!this.useMem) {
      try { return await this.run('readonly', s => s.getAllKeys()); } catch { this.useMem = true; }
    }
    return [...this.mem.keys()];
  }

  async clear() {
    this.mem.clear();
    if (!this.useMem) {
      try { await this.run('readwrite', s => s.clear()); } catch {}
    }
  }
}
