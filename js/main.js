// 사이트 시작 (실제 GitHub). 시험·화면 찍기용 가짜 저장소는 tools/demo.js
import core from './core/index.js';
import { makeAccess } from './access-config.js';
import { createSession } from './session.js';
import { fetchPublic } from './media.js';
import { start } from './app.js';

// 공개 파일은 이 페이지와 같은 곳에서 읽는다 (실제 사이트에서는 https://jayangchoir.github.io/, PC 시험 때는 localhost)
const access = makeAccess({ config: { siteUrl: new URL('./', location.href).href } });
start({ core, access, session: createSession({ access, core }), read: fetchPublic });
