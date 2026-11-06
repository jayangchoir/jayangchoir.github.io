// 사이트에서 쓰는 core 하나 (이 기기의 IndexedDB 'jayangchoir-core', 저장소 jayangchoir/jayangchoir-data).
//   import core from './core/index.js';
// 시험이나 다른 설정이 필요하면 core.js 의 createCore(opts) 를 직접 쓴다.

import { createCore } from './core.js';

export * from './core.js';
const core = createCore();
export default core;
