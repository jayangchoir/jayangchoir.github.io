// 개발용: tools/demo.html(가짜 GitHub)로 관리자 설정 → 준비된 자료 불러오기 → 학부모 비밀번호 → 반영 → 학부모 화면을 휴대폰·PC 폭으로 찍는다.
//   node tools/shots.mjs <준비된 자료 json> <찍은 그림 폴더>
// 준비된 자료에는 개인정보가 있으니 저장소 밖(스크래치패드)에 두고 경로로만 넘긴다. 콘솔 오류·CSP 위반이 있으면 실패.
import { serve, launch, newPage } from './cdp.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [seed, outDir] = process.argv.slice(2).map(p => resolve(p));
if (!seed || !outDir) { console.error('node tools/shots.mjs <seed.json> <out-dir>'); process.exit(2); }
await mkdir(outDir, { recursive: true });
const seedJson = JSON.parse(await readFile(seed, 'utf8'));
const secrets = [...new Set([
  ...seedJson.members.flatMap(m => [m.parentName, String(m.phone || '').replace(/\D/g, '')]),
  seedJson.site?.accountHolder, seedJson.site?.contactName, String(seedJson.site?.contactPhone || '').replace(/\D/g, ''),
].filter(v => v && v.length >= 3))];
const { server, port } = await serve(root);
const { browser, close } = await launch();
const PW = '봄비-기린-리코더-등대-42';
const sizes = [['phone', 400, 850, true], ['pc', 1280, 900, false]];
const shots = [];
let bad = 0;

async function run(tag, w, h, mobile) {
  const page = await newPage(browser, { width: w, height: h, mobile });
  const shot = async name => { await new Promise(r => setTimeout(r, 700)); const p = join(outDir, `${tag}-${name}.png`); await page.shot(p); shots.push(p); };
  const go = async hash => { await page.eval(`location.hash = ${JSON.stringify(hash)}`); await new Promise(r => setTimeout(r, 400)); };
  await page.goto(`http://127.0.0.1:${port}/tools/demo.html#/admin`);
  await page.waitFor('window.__demo && window.__demo.ctx');
  // 처음 설정
  await page.waitFor('document.querySelector("#f-setup")');
  await page.eval(`(() => { const v = (s, x) => { document.querySelector(s).value = x; };
    v('#s-token', 'demo-token'); v('#s-pw', 'admin-pass-2026'); v('#s-pw2', 'admin-pass-2026'); v('#s-name', '총무');
    document.querySelector('#f-setup').requestSubmit(); })()`);
  await page.waitFor('document.querySelector("#rc-ok")', 30000);
  await page.eval(`document.querySelector('#rc-ok').click(); document.querySelector('#rc-close').click();`);
  await page.waitFor('document.querySelector(".admin-tabs")');
  // 준비된 자료
  await go('#/admin/import');
  await page.waitFor('document.querySelector("#seed-in")');
  await page.setFiles('#seed-in', [seed]);
  await page.waitFor('document.querySelector("#seed-out .ok-box, #seed-out .err")', 20000);
  const seedMsg = await page.eval('document.querySelector("#seed-out").textContent');
  console.log(`[${tag}] ${seedMsg.trim()}`);
  // 화면 확인용 예시 사진·악보 (실제 자료 아님 — "(예시)" 라고 붙임)
  await page.eval(`(async () => {
    const ctx = window.__demo.ctx;
    const mk = async (i) => { const c = new OffscreenCanvas(1600, 1200); const g = c.getContext('2d');
      const hue = (i * 47) % 360; const gr = g.createLinearGradient(0, 0, 1600, 1200); gr.addColorStop(0, 'hsl(' + hue + ' 70% 72%)'); gr.addColorStop(1, 'hsl(' + ((hue + 60) % 360) + ' 70% 55%)');
      g.fillStyle = gr; g.fillRect(0, 0, 1600, 1200); g.fillStyle = 'rgba(255,255,255,.85)'; g.font = 'bold 150px sans-serif'; g.textAlign = 'center'; g.fillText('♪ 예시 ' + (i + 1), 800, 650);
      return new File([await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })], '예시-' + (i + 1) + '.jpg', { type: 'image/jpeg' }); };
    const a = await ctx.core.collection('albums').put({ title: '(예시) 화면 확인용 사진첩', date: '2026-08-30' });
    const files = []; for (let i = 0; i < 9; i++) files.push(await mk(i));
    await ctx.uploads.add(files, { owner: 'albums:' + a.id, album: { id: a.id, title: a.title, date: a.date } });
    const song = ctx.core.collection('songs').list().find(s => s.title === '주 품에');
    const pdf = new TextEncoder().encode('%PDF-1.4\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\\ntrailer<</Root 1 0 R>>\\n%%EOF');
    if (song) await ctx.uploads.add([new File([pdf], '(예시) 주 품에 악보.pdf', { type: 'application/pdf' })], { owner: 'songs:' + song.id });
    await ctx.uploads.kick();
  })()`);
  await page.waitFor('window.__demo.ctx.uploads.snapshot().siteDone === 10', 60000);
  // 학부모 비밀번호 정하기 + 반영
  await page.eval(`window.__demo.ctx.pub.setParentPassword(${JSON.stringify(PW)}).then(() => window.__demo.ctx.render())`);
  await go('#/admin');
  await page.waitFor('document.querySelector(".publish-bar.ok")', 20000);
  await shot('admin-dashboard');
  await go('#/admin/members');
  await page.waitFor('document.querySelector("table.tbl")');
  await shot('admin-roster');
  // 학부모: 로그인 화면
  await page.eval('window.__demo.ctx.logoutParent()');
  await go('#/');
  await page.waitFor('document.querySelector("#login-form")');
  await shot('parent-login');
  // 틀린 비밀번호
  await page.eval(`document.querySelector('#ppw').value = 'wrong-password-1'; document.querySelector('#login-form').requestSubmit();`);
  await page.waitFor('document.querySelector("#login-msg .err")', 20000);
  await page.eval(`document.querySelector('#ppw').value = ${JSON.stringify(PW)}; document.querySelector('#login-form').requestSubmit();`);
  await page.waitFor('document.querySelector(".hero")', 20000);
  await page.waitFor('document.querySelectorAll("#home-strip img.ld").length >= 3', 20000).catch(() => {});
  await shot('parent-home');
  await go('#/schedule');
  await shot('parent-schedule');
  await page.eval(`document.querySelector('[data-mode=cal]').click()`);
  await shot('parent-calendar');
  await go('#/songs');
  await shot('parent-songs');
  // 악보 PDF 열기 (이 기기에서 풀어 blob: 주소로)
  await page.eval(`document.querySelector('[data-open]').click()`);
  await page.waitFor('document.querySelector("#pdf-body a[download]")', 20000);
  const pdfOk = await page.eval(`(async () => { const a = document.querySelector('#pdf-body a[download]'); const P = window.__demo.parent; const id = document.querySelector('[data-open]').dataset.open;
    const blob = await P.file(id, P.bundle.files[id]); return [a.getAttribute('download'), new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5)), a.href.slice(0, 5)]; })()`);
  console.log(`[${tag}] PDF 열기: ${JSON.stringify(pdfOk)}`);
  if (pdfOk[1] !== '%PDF-') bad++;
  await new Promise(r => setTimeout(r, 800));
  { const p = join(outDir, `${tag}-parent-pdf.png`); await page.shot(p, { full: false }); shots.push(p); }
  await page.eval(`document.querySelector('#modal [data-close]').click()`);
  await go('#/videos');
  await shot('parent-videos');
  await go('#/photos');
  await page.waitFor('document.querySelector(".album img.ld")', 20000).catch(() => {});
  await shot('parent-photos');
  await go(await page.eval(`document.querySelector('.album').getAttribute('href')`));
  await page.waitFor('document.querySelector("#album-grid [data-lb]")', 20000);
  await page.waitFor('document.querySelectorAll("#album-grid img.ld").length >= 6', 20000).catch(() => {});
  await shot('parent-album');
  await page.eval(`document.querySelector('[data-lb="1"]').click()`);
  await page.waitFor('document.querySelector(".lightbox img") && document.querySelector(".lightbox img").src.startsWith("blob:")', 20000).catch(() => {});
  await shot('parent-lightbox');
  await page.eval(`document.querySelector('.lightbox [data-x]').click()`);
  await go('#/roster');
  await shot('parent-roster');
  await go('#/notices');
  await shot('parent-notices');
  // 학부모 명단 화면에 연락처가 없는지 (화면 글자로도 확인)
  await go('#/roster');
  const txt = await page.eval('document.body.innerText');
  // 비밀 값은 준비된 자료 파일에서 읽는다 (이 파일에 개인정보를 적지 않으려고)
  const leaked = secrets.filter(v => txt.includes(v) || txt.replace(/\D/g, ' ').includes(v));
  if (leaked.length || /01[016789][-\s]?\d{3,4}[-\s]?\d{4}/.test(txt)) { console.log(`[${tag}] ✕ 학부모 명단 화면에 연락처·부모님 이름이 보여요 (${leaked.length}개)`); bad++; }
  const probs = page.problems.filter(p => !/i\.ytimg\.com/.test(p));
  if (page.problems.length) console.log(`[${tag}] 문제:\n  ${page.problems.join('\n  ')}`);
  if (probs.length) bad++;
  await page.close();
}

try {
  for (const s of sizes) await run(...s);
} catch (e) {
  console.error(e);
  bad++;
} finally {
  await close();
  server.close();
}
console.log(shots.join('\n'));
process.exit(bad ? 1 : 0);
