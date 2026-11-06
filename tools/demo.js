// 개발용 데모: 가짜 GitHub(메모리)로 사이트 전체를 돌린다. 실제 저장소에는 연결하지 않는다.
import { createCore } from '../js/core/core.js';
import { FakeGitHub } from '../js/core/fake-backend.js';
import * as C from '../js/core/crypto.js';
import { makeAccess } from '../js/access-config.js';
import { createSession } from '../js/session.js';
import { repoName } from '../js/media.js';
import { start } from '../js/app.js';

const RUN = Date.now().toString(36);
const gh = new FakeGitHub({ owner: 'jayangchoir', tokens: ['demo-token'], creators: ['demo-token'] });
gh.repo('jayangchoir-data', { isPublic: false });
const site = gh.repo('jayangchoir.github.io', { isPublic: true });
site.files.set('index.html', { sha: 'sha0', bytes: C.utf8('<!doctype html>') });
site.addCommit('init', ['index.html']);
const reader = gh.reader('jayangchoir.github.io');
const raw = async (n, p) => { await new Promise(r => setTimeout(r, 5)); const b = await reader.file(repoName(n), p); if (!b) throw Object.assign(new Error('아직 올라가지 않은 파일이에요.'), { status: 404 }); return b; };
const here = location.href.split('#')[0];
const core = createCore({ dbName: `jc-demo-${RUN}`, backend: (t, dev) => gh.client(t, dev.repo), siteUrl: here });
const access = makeAccess({ reader, backendFor: (t, r) => gh.client(t, r.repo), kvName: `jc-demo-ax-${RUN}`, config: { siteUrl: here } });
const session = createSession({ access, core, read: raw });
window.__demo = { gh, core, access, session, ready: start({ core, access, session, read: raw, demo: true, uploadsDb: `jc-demo-up-${RUN}` }).then(ctx => { window.__demo.ctx = ctx; return ctx; }) };
