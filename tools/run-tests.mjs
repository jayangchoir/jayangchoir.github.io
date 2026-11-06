// 개발용: 처음 설정 전 공개 화면(tools/public-check.mjs) · core-test.html · access-test.html · tier-test.html 을 헤드리스 Edge 로 돌리고 결과를 보여 준다.
//   node tools/run-tests.mjs            (모두)
//   node tools/run-tests.mjs tier-test.html
// 콘솔 오류·CSP 위반이 있으면 실패로 친다.
import { serve, launch, newPage } from './cdp.mjs';
import { publicCheck } from './public-check.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const all = !process.argv.slice(2).length;
const pages = all ? ['core-test.html', 'access-test.html', 'tier-test.html'] : process.argv.slice(2);
const { server, port } = await serve(root);
const { browser, close } = await launch();
let bad = 0;
try {
  // 먼저(이 브라우저에 아직 아무것도 저장되지 않았을 때): 처음 설정 전 방문자 화면
  if (all) {
    const t0 = Date.now();
    const res = await publicCheck({ browser, port });
    const n = res.filter(r => r.startsWith('✗')).length;
    console.log(`\n== 처음 설정 전 공개 화면: ${n ? 'FAIL' : 'PASS'} ${res.length - n}/${res.length} (${Math.round((Date.now() - t0) / 1000)}s)`);
    for (const r of res) console.log('  ' + r);
    if (n) bad++;
  }
  for (const p of pages) {
    const page = await newPage(browser);
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/${p}`);
    await page.waitFor('document.body.dataset.done', 300000);
    const res = await page.eval(`[...document.querySelectorAll('#out li')].map(li => li.textContent)`);
    const sum = await page.eval('document.body.dataset.done');
    console.log(`\n== ${p}: ${sum} (${Math.round((Date.now() - t0) / 1000)}s)`);
    for (const r of res) console.log('  ' + r);
    // 시험 안에서 일부러 낸 오류(console.error)는 시험 결과로 이미 판정했으므로, 시험이 아닌 문제만 따로 센다
    const probs = page.problems.filter(x => !/^console\.error/.test(x));
    if (probs.length) { console.log('  문제:', probs.join('\n  ')); bad++; }
    if (!sum.startsWith('PASS')) bad++;
    await page.close();
  }
} finally {
  await close();
  server.close();
}
process.exit(bad ? 1 : 0);
