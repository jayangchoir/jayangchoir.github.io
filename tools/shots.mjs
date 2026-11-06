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
    v('#s-token', 'demo-token'); v('#s-pw', 'data-pass-2026'); v('#s-pw2', 'data-pass-2026'); v('#s-name', '총무'); v('#s-id', 'choir-admin');
    document.querySelector('#f-setup').requestSubmit(); })()`);
  await page.waitFor('document.querySelector("#rc-ok")', 30000);
  { const p = join(outDir, `${tag}-admin-setup-codes.png`); await new Promise(r => setTimeout(r, 400)); await page.shot(p, { full: false }); shots.push(p); }
  const adminCode = await page.eval(`document.querySelector('.code-box').textContent.split('/')[1].trim()`);
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
  // 가족 코드(명단으로) + 예시 스탭 코드 → 반영 (코드는 이때 한 번만 나온다)
  const made = await page.eval(`(async () => { const ctx = window.__demo.ctx; const out = [];
    for (const f of await ctx.pub.suggestFamilies()) { const r = await ctx.pub.addFamily(f); out.push({ login: r.person.identifier, code: r.code }); }
    const st = await ctx.session.admin.addPerson({ name: '(예시) 스탭', identifier: '예시스탭', role: 'staff', labels: ['총무'] });
    await ctx.pub.publish(); await ctx.session.loadContent(); ctx.render();
    return { fams: out, staff: { login: '예시스탭', code: st.code } }; })()`);
  await go('#/admin');
  try { await page.waitFor('document.querySelector(".publish-bar.ok")', 60000); } catch (e) {
    console.log('DEBUG', await page.eval(`window.__demo.ctx.pub.state().then(s => JSON.stringify(s))`), await page.eval('document.querySelector("#view").innerText.slice(0, 600)'), page.problems);
    throw e;
  }
  await shot('admin-dashboard');
  await go('#/admin/access');
  await page.waitFor('document.querySelector("[data-more]")');
  await shot('admin-access');
  // 한 가족의 "새 코드" → 안내문 (한 번만 보임)
  await page.eval(`document.querySelector('[data-more]').click()`);
  await page.waitFor('document.querySelector("#modal [data-close=reset]")');
  await page.eval(`document.querySelector('#modal [data-close=reset]').click()`);
  await page.waitFor('document.querySelector("#modal [data-close=yes]")');
  await page.eval(`document.querySelector('#modal [data-close=yes]').click()`);
  await page.waitFor('document.querySelector("#cp-all")', 60000);
  { const p = join(outDir, `${tag}-admin-invite.png`); await new Promise(r => setTimeout(r, 500)); await page.shot(p, { full: false }); shots.push(p); }
  const resetLogin = await page.eval(`document.querySelector('#modal pre').textContent.match(/아이디: (.+)/)?.[1]?.trim() || ''`);
  await page.eval(`document.querySelector('#modal [data-close]').click()`);
  const fam = made.fams.find(f => f.login !== resetLogin);
  const stf = made.staff;
  await go('#/admin/members');
  await page.waitFor('document.querySelector(".mcards, table.tbl")');
  await shot('admin-roster');
  // 로그아웃 → 공개 첫 화면
  await go('#/logout');
  await page.waitFor('location.hash === "#/" && document.querySelector(".pub-hero")', 20000);
  await shot('public-home');
  await go('#/join');
  await shot('public-join');
  // 하나뿐인 로그인 화면: 가족 코드
  await go('#/login');
  await page.waitFor('document.querySelector("#login-form")');
  await shot('login');
  await page.eval(`document.querySelector('#lid').value = ${JSON.stringify(fam.login)}; document.querySelector('#lpw').value = 'WRNG-CODE-XXXX'; document.querySelector('#login-form').requestSubmit();`);
  await page.waitFor('document.querySelector("#login-msg .err")', 20000);
  await page.eval(`document.querySelector('#lpw').value = ${JSON.stringify(fam.code.toLowerCase())}; document.querySelector('#login-form').requestSubmit();`);
  await page.waitFor('location.hash === "#/home" && document.querySelector(".next, .quick")', 20000);
  await page.waitFor('document.querySelectorAll("#home-strip img.ld").length >= 3', 20000).catch(() => {});
  await shot('parent-home');
  await go('#/schedule');
  await shot('parent-schedule');
  await page.eval(`document.querySelector('[data-mode=cal]').click()`);
  await shot('parent-calendar');
  await go('#/songs');
  await shot('parent-songs');
  await page.eval(`document.querySelector('[data-open]').click()`);
  await page.waitFor('document.querySelector("#pdf-body a[download]")', 20000);
  const pdfOk = await page.eval(`(async () => { const a = document.querySelector('#pdf-body a[download]'); const S = window.__demo.session; const id = document.querySelector('[data-open]').dataset.open;
    const blob = await S.file(id, S.bundle.files[id]); return [a.getAttribute('download'), new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5)), a.href.slice(0, 5)]; })()`);
  console.log(`[${tag}] PDF 열기: ${JSON.stringify(pdfOk)}`);
  if (pdfOk[1] !== '%PDF-') bad++;
  { await new Promise(r => setTimeout(r, 800)); const p = join(outDir, `${tag}-parent-pdf.png`); await page.shot(p, { full: false }); shots.push(p); }
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
  await go('#/notices');
  await shot('parent-notices');
  await go('#/roster');
  await shot('parent-roster');
  const txt = await page.eval('document.body.innerText');
  // 비밀 값은 준비된 자료 파일에서 읽는다 (이 파일에 개인정보를 적지 않으려고)
  const leaked = secrets.filter(v => txt.includes(v) || txt.replace(/\D/g, ' ').includes(v));
  if (leaked.length || /01[016789][-\s]?\d{3,4}[-\s]?\d{4}/.test(txt)) { console.log(`[${tag}] ✕ 학부모 명단 화면에 연락처·부모님 이름이 보여요 (${leaked.length}개)`); bad++; }
  const staffLink = await page.eval('!!document.querySelector(\'a[href="#/staff"]\')');
  if (staffLink) { console.log(`[${tag}] ✕ 학부모에게 스탭 메뉴가 보여요`); bad++; }
  // 스탭 코드로 로그인
  await go('#/logout');
  await page.waitFor('location.hash === "#/"', 20000);
  await go(`#/login/${encodeURIComponent(stf.login)}`);
  await page.waitFor('document.querySelector("#login-form")');
  await page.eval(`document.querySelector('#lpw').value = ${JSON.stringify(stf.code)}; document.querySelector('#login-form').requestSubmit();`);
  await page.waitFor('location.hash === "#/home"', 20000);
  await page.eval(`(async () => { const ctx = window.__demo.ctx; const { createStaffStore } = await import('./js/staff.js');
    const st = createStaffStore({ access: ctx.session.access });
    const pdf = new TextEncoder().encode('%PDF-1.4 (예시) 회의 자료');
    const att = await st.attach([new File([pdf], '(예시) 11월 회의 안건.pdf', { type: 'application/pdf' })]);
    await st.put('meetings', { title: '(예시) 11월 스탭 회의', date: '2026-11-08', body: '이웃 초청 음악회 준비\\n· 단복 점검\\n· 간식 당번 정하기', attachments: att });
    await st.put('snacks', { date: '2026-11-15', who: '(예시) 가족', items: '귤, 물', note: '연습 끝나고' });
    await st.put('snacks', { date: '2026-11-29', who: '(예시) 가족 2', items: '빵 40개', note: '' }); })()`);
  await go('#/staff');
  await page.waitFor('document.querySelector(".mcards")', 20000);
  await shot('staff-contacts');
  await go('#/staff/meetings');
  await page.waitFor('document.querySelector("[data-edit]")', 20000);
  await shot('staff-meetings');
  await go('#/staff/snacks');
  await page.waitFor('document.querySelector(".rowi")', 20000);
  await shot('staff-snacks');
  const stxt = await page.eval('document.body.innerText');
  if (!/010[-\s]?\d{3,4}/.test(stxt) && !/010/.test(await page.eval(`(async () => { location.hash = '#/staff'; await new Promise(r => setTimeout(r, 600)); return document.body.innerText; })()`))) { console.log(`[${tag}] ✕ 스탭에게 연락처가 안 보여요`); bad++; }
  // 관리자도 같은 로그인 화면에서 (관리자 코드)
  await go('#/logout');
  await page.waitFor('location.hash === "#/"', 20000);
  await go('#/login');
  await page.waitFor('document.querySelector("#login-form")');
  await page.eval(`document.querySelector('#lid').value = 'choir-admin'; document.querySelector('#lpw').value = ${JSON.stringify(adminCode)}; document.querySelector('#login-form').requestSubmit();`);
  await page.waitFor('location.hash === "#/admin" && document.querySelector(".admin-tabs")', 20000);
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
