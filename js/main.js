// 사이트 시작 (실제 GitHub). 시험·화면 찍기용 가짜 저장소는 tools/demo.js
import core from './core/index.js';
import { createParent } from './parent.js';
import { fetchPublic } from './media.js';
import { start } from './app.js';

start({ core, parent: createParent(), read: fetchPublic });
