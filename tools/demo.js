// 개발용 데모: 가짜 GitHub(메모리)로 사이트 전체를 돌린다. 실제 저장소에는 연결하지 않는다.
import { createCore } from '../js/core/core.js';
import { FakeGitHub } from '../js/core/fake-backend.js';
import { createSession } from '../js/session.js';
import { repoName } from '../js/media.js';
import { start } from '../js/app.js';

const RUN = Date.now().toString(36);
const gh = new FakeGitHub(['demo-token'], ['jayangchoir-data', 'jayangchoir.github.io']);
const raw = async (n, p) => { await new Promise(r => setTimeout(r, 5)); const b = gh.raw(repoName(n), p); if (!b) throw Object.assign(new Error('아직 올라가지 않은 파일이에요.'), { status: 404 }); return b; };
const getText = async p => { const b = gh.raw('jayangchoir.github.io', p.split('?')[0]); return b ? new TextDecoder().decode(b) : null; };
const core = createCore({ dbName: `jc-demo-${RUN}`, backend: (t, dev) => gh.client(t, dev), account: t => gh.account(t), siteUrl: location.href.split('#')[0] });
const session = createSession({ getText, read: raw, dbName: `jc-demo-session-${RUN}`, core });
window.__demo = { gh, core, session, ready: start({ core, session, read: raw, demo: true, uploadsDb: `jc-demo-up-${RUN}`, staffBackend: (t, dev) => gh.client(t, dev) }).then(ctx => { window.__demo.ctx = ctx; return ctx; }) };
