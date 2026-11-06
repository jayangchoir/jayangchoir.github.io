// 개발용: 처음 설정 전(keyring.json 이 아직 없음) 사이트를 처음 여는 방문자 시험. run-tests.mjs 가 부른다.
//   node tools/public-check.mjs            (이것만)
//
// 이 저장소를 그대로 내주면 keyring.json 이 404 이고 공개 페이지는 비어 있다 → 처음 설정 전과 같다.
// 휴대폰(400×850 · 360×740)·PC(1280×860) 에서, IndexedDB 가 보통일 때와 영영 열리지 않을 때(느리거나 막힌 브라우저) 모두
//   3초 안에 공개 화면(이름·소개·«로그인»)이 보이고, 관리자용 «처음 설정»이 있고, 위 막대 버튼이 화면 밖으로 잘리지 않는지 본다.
//   콘솔 오류(아직 없음 404 말고)·CSP 위반이 있으면 실패.
import { serve, launch, newPage } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// IndexedDB.open 이 끝나지 않는 브라우저 흉내 (성공도 실패도 오지 않음)
const STALL_IDB = `Object.defineProperty(window, 'indexedDB', { value: { open: () => ({}), deleteDatabase: () => ({}) }, configurable: true });`;

const SHOWN = `(() => {
  const v = document.getElementById('view');
  const login = [...document.querySelectorAll('a, button')].some(b => /로그인/.test(b.textContent) && b.offsetParent);
  return v && v.querySelector('.pub-hero h1') && v.querySelector('.card .txt') && login;
})()`;

const LAYOUT = `(() => {
  const cw = document.documentElement.clientWidth;
  const clipped = [...document.querySelectorAll('.topbar a, .topbar button')].filter(b => {
    if (!b.offsetParent) return false;
    const r = b.getBoundingClientRect();
    return r.width && (r.right > cw + 0.5 || r.left < -0.5);
  }).map(b => b.textContent.trim() || b.getAttribute('aria-label'));
  return { clipped, wide: document.documentElement.scrollWidth > cw, title: document.querySelector('.pub-hero h1')?.textContent || '' };
})()`;

export async function publicCheck({ browser, port, out = join(root, 'tools', '_tmp-public') }) {
  await mkdir(out, { recursive: true });
  const res = [];
  const ok = (name, cond, detail = '') => res.push(`${cond ? '✓' : '✗ 실패'} ${name}${detail ? ` — ${detail}` : ''}`);
  for (const [w, h, mobile] of [[400, 850, true], [1280, 860, false], [360, 740, true]]) {
    for (const idb of ['보통', '안 열림']) {
      const tag = `${w}px · IndexedDB ${idb}`;
      const page = await newPage(browser, { width: w, height: h, mobile });
      if (idb === '안 열림') await page.send('Page.addScriptToEvaluateOnNewDocument', { source: STALL_IDB });
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('securitypolicyviolation', e => console.error('CSP', e.violatedDirective, e.blockedURI));` });
      const t0 = Date.now();
      let shown = true;
      try {
        await page.goto(`http://127.0.0.1:${port}/`);
        await page.waitFor(SHOWN, Math.max(100, 3000 - (Date.now() - t0)));
      } catch { shown = false; }
      ok(`${tag}: 3초 안에 공개 화면`, shown, `${Date.now() - t0}ms`);
      let setup = true;
      try { await page.waitFor(`document.querySelector('.setup-hint a[href="#/admin"]')`, 3000); } catch { setup = false; }
      ok(`${tag}: 관리자용 «처음 설정»`, setup);
      const lay = await page.eval(LAYOUT);
      ok(`${tag}: 이름`, lay.title.includes('합창단'), lay.title);
      ok(`${tag}: 위 막대 버튼이 잘리지 않음`, !lay.clipped.length && !lay.wide, lay.clipped.join(',') || (lay.wide ? '가로로 넘침' : ''));
      await page.shot(join(out, `public-${w}-${idb === '보통' ? 'idb' : 'noidb'}.png`), { full: false });
      if (idb === '보통' && w === 400 && setup) {
        await page.eval(`document.querySelector('.setup-hint a[href="#/admin"]').click()`);
        let gate = true;
        try { await page.waitFor(`document.getElementById('f-setup')`, 5000); } catch { gate = false; }
        ok(`${tag}: «처음 설정» → 처음 설정 화면`, gate);
        await page.shot(join(out, 'public-setup.png'), { full: false });
      }
      // 처음 설정 전에는 keyring.json 이 없다 (404 는 오류가 아니라 '아직 없음')
      const probs = page.problems.filter(x => !/status of 404/.test(x));
      ok(`${tag}: 콘솔 오류·CSP 위반 없음`, !probs.length, probs.join(' | '));
      await page.close();
    }
  }
  return res;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { server, port } = await serve(root);
  const { browser, close } = await launch();
  let res;
  try { res = await publicCheck({ browser, port }); } finally { await close(); server.close(); }
  const bad = res.filter(r => r.startsWith('✗')).length;
  console.log(`== 처음 설정 전 공개 화면: ${bad ? 'FAIL' : 'PASS'} ${res.length - bad}/${res.length}`);
  for (const r of res) console.log('  ' + r);
  process.exit(bad ? 1 : 0);
}
