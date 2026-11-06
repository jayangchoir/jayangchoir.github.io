// tier-test.html 의 시험들. node tools/run-tests.mjs 로 헤드리스 Edge 에서 돈다.
import { createCore } from './js/core/core.js';
import { FakeGitHub } from './js/core/fake-backend.js';
import { BackendError } from './js/core/github.js';
import * as C from './js/core/crypto.js';
import { indexPath, KEYRING } from './js/core/access.js';
import { makeAccess, ITEM } from './js/access-config.js';
import { buildBundle, assertNoContacts, MEMBER_PRIVATE } from './js/bundle.js';
import { createPublisher } from './js/publish.js';
import { createSession } from './js/session.js';
import { createStaffStore } from './js/staff.js';
import { createMedia, repoName } from './js/media.js';
import { createUploads } from './js/uploads.js';
import { createOriginals } from './js/google.js';
import { applyPlan, ids } from './js/plan.js';
import { parseNotionZip, parseDate } from './js/notion-import.js';

const out = document.getElementById('out');
const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const li = document.createElement('li');
  li.className = ok ? 'ok' : 'bad';
  li.textContent = `${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`;
  out.append(li);
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
async function rejects(p, code, m) {
  try { await p; } catch (e) { assert(!code || e.code === code, `${m}: 오류 코드 ${e.code} (기대 ${code}) ${e.message}`); return e; }
  throw new Error(`${m}: 오류가 나야 하는데 안 났어요`);
}
async function test(name, fn) {
  const t0 = performance.now();
  try { await fn(); report(name, true, `${Math.round(performance.now() - t0)}ms`); } catch (e) { console.error(e); report(name, false, e.message); }
}
const hex = u => [...u].map(b => b.toString(16).padStart(2, '0')).join('');
const td = new TextDecoder();
const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error('기다림 시간 초과'); await new Promise(r => setTimeout(r, 30)); } };

// ---------- 지어낸 시험 자료 (실제 사람 아님) ----------
const FAKE = {
  site: { title: '시험 합창단', welcome: '환영합니다', fees: '상반기 5만원', bankName: '시험은행', bankAccount: '999-0000-1111', accountHolder: '홍예금', contactNote: '문의: 총무', contactName: '박총무', contactPhone: '010-9999-0001', activity: '주일 11:30 연습' },
  members: [
    { name: '김하나', grade: '1', gender: '여', parentName: '김부모', phone: '010-1111-2222', note: '자매 (긴급 010-3333-4444)', joined: "24' 3/3", order: 1 },
    { name: '이두리', grade: '중1', gender: '남', parentName: '이보호', phone: '01055556666', note: '총무', joined: "25' 2/1", order: 2 },
    { name: '박세찌', grade: '3', gender: '남', parentName: '박엄마', phone: '010-7777-8888', note: '', joined: '', order: 3 },
  ],
  events: [{ date: '2026-11-11', time: '미정', place: '', title: '이웃 초청 음악회', note: '‘주품에’ 외 1곡' }],
  songs: [{ title: "26’ 6월 연습곡", audio: [{ label: '주 품에 (alt.)', url: 'https://drive.google.com/file/d/x/view' }], videos: [{ label: '주 품에', url: 'https://www.youtube.com/watch?v=YqW9yiRRWYg' }] }],
  videos: [{ kind: 'perf', date: '2026-05-31', title: '오후 예배', urls: ['https://youtu.be/R_vawI3ovOY'] }],
  notices: [{ title: '연습 안내', body: '이번 주는 쉽니다', date: '2026-11-01' }],
  albums: [{ title: '이웃초청음악회', date: '2026-11-11' }],
};
const SECRETS = ['홍예금', '박총무', '010-9999-0001', '01099990001', '김부모', '이보호', '박엄마', '010-1111-2222', '01011112222', '3333-4444', '01055556666', '7777-8888', '자매 (긴급'];

const RUN = Date.now().toString(36);
const gh = new FakeGitHub({ owner: 'jayangchoir', tokens: ['tok-1', 'tok-2'], creators: ['tok-1', 'tok-2'] });
gh.repo('jayangchoir-data', { isPublic: false });
const siteRepo = gh.repo('jayangchoir.github.io', { isPublic: true });
siteRepo.files.set('index.html', { sha: 'sha0', bytes: C.utf8('<!doctype html>') });
siteRepo.addCommit('init', ['index.html']);
const reader = gh.reader('jayangchoir.github.io');
const raw = async (n, p) => { const b = await reader.file(repoName(n), p); if (!b) throw Object.assign(new Error('없음'), { status: 404 }); return b; };
const siteAll = () => [...siteRepo.files].map(([p, f]) => `${p}\n${td.decode(f.bytes)}`).join('\n');
const siteJSON = p => JSON.parse(td.decode(siteRepo.files.get(p).bytes));
const dbs = [];
const db = tag => { const n = `jc-tier-${RUN}-${tag}`; dbs.push(n); return n; };
const mkCore = tag => createCore({ dbName: db(tag), backend: (t, dev) => gh.client(t, dev.repo), autoSync: false, user: tag, siteUrl: 'https://jayangchoir.github.io/' });
const mkAccess = kvName => makeAccess({ reader, backendFor: (t, r) => gh.client(t, r.repo), kvName });
// 기기 하나 = access + session (core 는 관리자 기기만)
const mkSession = (tag, core = null, kvName = db(`ax-${tag}`)) => { const access = mkAccess(kvName); return Object.assign(createSession({ access, core, read: raw }), { kvName }); };
const staffStore = s => createStaffStore({ access: s.access });
const CORE_PW = 'core-pass-1234';
const FAM = {}; // 로그인 이름 → { person, code }
let STAFF1, STAFF2, admin, adminCode;

async function jpeg(w, h, seed = 1) {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d');
  for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${(i * 37 * seed) % 360} 70% ${30 + (i % 50)}%)`; g.fillRect((i * 97) % w, (i * 53) % h, 40 + (i % 80), 30 + (i % 60)); }
  return new File([await c.convertToBlob({ type: 'image/jpeg', quality: 0.95 })], `photo-${seed}.jpg`, { type: 'image/jpeg' });
}
function pdfBytes(n) {
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(u.subarray(i, Math.min(n, i + 65536)));
  u.set(new TextEncoder().encode('%PDF-1.4\n'));
  return u;
}

let A, pub, media, ups;

// ---------- 1. 관리자 준비 ----------
let AS;
await test('관리자: core setup + access.setup(관리자 코드·명단 복구 코드) → 준비된 자료 넣기 → 두 번 넣어도 그대로', async () => {
  A = mkCore('A');
  await A.setup('tok-1', CORE_PW, { user: '관리자A' });
  AS = mkSession('admin', A);
  const r = await AS.access.setup(A, { token: 'tok-1', name: '관리자A', identifier: 'choir-admin' });
  admin = r.admin;
  adminCode = r.code;
  assert(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){2}$/.test(adminCode) && r.recoveryCode, '관리자 코드·명단 복구 코드');
  await AS.openAdminIfNeeded();
  eq(AS.role, 'admin', '관리자로 로그인된 상태');
  pub = createPublisher({ core: A, access: AS.access, getAdmin: async () => admin });
  media = createMedia({ core: A, limit: 1.5e6, read: raw });
  const r1 = await applyPlan(FAKE, { core: A });
  assert(r1.counts.members === 3 && r1.counts.events === 1, `처음: ${JSON.stringify(r1.counts)}`);
  eq((await applyPlan(FAKE, { core: A })).counts, {}, '두 번째는 바뀐 것 없음');
  eq(A.collection('members').get(ids.member({ name: '김하나' })).phone, '010-1111-2222', '관리자는 연락처를 봄');
});

await test('가족 코드(형제는 한 가족, 이름=아이 이름) + 스탭 개인 코드 + 반영 → 공개 저장소에는 암호문과 평문 공개 페이지만', async () => {
  const sug = await pub.suggestFamilies();
  eq(sug.map(f => f.identifier).sort(), ['김하나', '박세찌', '이두리'], '연락처가 다른 세 가족');
  for (const f of sug) FAM[f.identifier] = await pub.addFamily(f);
  assert(FAM['김하나'].invitation.includes(FAM['김하나'].code) && FAM['김하나'].invitation.includes('김하나'), '초대 안내문');
  STAFF1 = await admin.addPerson({ name: '박총무', identifier: '박총무', role: 'staff', labels: ['총무'] });
  STAFF2 = await admin.addPerson({ name: '이회계', identifier: '이회계', role: 'staff', labels: ['회계'] });
  await rejects(admin.addPerson({ name: 'x', identifier: ' 김하나 ', role: 'parent' }), 'duplicate', '같은 로그인 이름');
  await A.collection('settings').put({ id: 'public', title: '시험 합창단', intro: '함께 노래해요', join: '입단 문의는 교회 사무실로' });
  const r = await pub.publish();
  for (const k of ['public/site', 'parent/content', 'staff/staff-info', `parent/album-${ids.album(FAKE.albums[0])}`]) assert(r.items.includes(k), `반영 항목 ${k}: ${r.items}`);
  const all = siteAll();
  for (const x of SECRETS) assert(!all.includes(x), `공개 저장소 글자에 "${x}"`);
  for (const x of ['김하나', '이두리', '시험은행', '이웃 초청', 'tok-1', FAM['김하나'].code]) assert(!all.includes(x), `암호화되지 않은 "${x}"`);
  const pubIdx = siteJSON(indexPath('public'));
  eq([pubIdx.items.site.d.title, pubIdx.items.site.d.intro], ['시험 합창단', '함께 노래해요'], '공개 페이지는 평문');
  assert(!JSON.stringify(pubIdx).includes('이웃 초청'), '공개에 학부모 내용 없음');
  eq((await pub.state()).dirty, false, '반영 끝');
});

let F1, S1;
await test('한 로그인 화면: 가족 코드 → 학부모, 스탭 코드 → 스탭, 관리자 코드 → 관리자(데이터 저장소까지 열림), 틀리면 실패', async () => {
  F1 = mkSession('F1');
  eq(await F1.load(), 'public', '처음엔 공개');
  eq(F1.pub.title, '시험 합창단', '공개 페이지는 로그인 없이');
  await rejects(F1.login('김하나', 'WRNG-CODE-XXXX'), 'bad-login', '틀린 코드');
  await rejects(F1.login('없는아이', FAM['김하나'].code), 'bad-login', '틀린 이름');
  await rejects(F1.login('박세찌', FAM['김하나'].code), 'bad-login', '다른 가족 이름 + 내 코드');
  eq(await F1.login('김하나', FAM['김하나'].code.toLowerCase()), 'parent', '가족 코드 → 학부모');
  assert(!F1.has('staff') && !F1.access.me().canWrite && !F1.staff, '학부모에게 스탭 등급·쓰기 없음');
  eq(F1.bundle.events[0].title, '이웃 초청 음악회', '학부모 내용');
  await rejects(F1.access.list('staff'), 'no-access', '스탭 목록은 못 엶');
  const F1b = mkSession('F1b', null, F1.kvName);
  eq(await F1b.load(), 'parent', '다시 열면 코드 없이');
  S1 = mkSession('S1');
  eq(await S1.login(' 박총무 ', STAFF1.code), 'staff', '스탭 코드 → 스탭');
  assert(S1.access.me().canWrite && S1.staff && S1.bundle, '스탭은 쓰기·스탭 내용·학부모 내용');
  eq(S1.staff.members.find(m => m.name === '김하나').phone, '010-1111-2222', '스탭은 연락처를 봄');
  eq(S1.staff.site.accountHolder, '홍예금', '스탭은 예금주를 봄');
  eq(S1.staff.families.length, 3, '가족 목록');
  // 관리자: 연결된 적 없는 새 기기에서도 같은 로그인 → 데이터 저장소까지 열림
  const B = mkCore('B');
  const AB = mkSession('AB', B);
  eq(await AB.login('choir-admin', adminCode), 'admin', '관리자 코드 → 관리자');
  assert(B.status().open && AB.admin && (await AB.admin.people()).length === 6, '데이터 저장소 열림 · 명단');
  eq(B.collection('members').get(ids.member({ name: '김하나' })).phone, '010-1111-2222', '새 기기에서 관리자 데이터');
  await AB.logout();
  eq([AB.role, B.status().open], ['public', false], '로그아웃 → 공개, 데이터 저장소 잠김');
});

await test('학부모 등급에는 연락처가 없다 (명단은 이름·학년만, 예금주·문의 연락처 없음)', async () => {
  const b = F1.bundle;
  const text = JSON.stringify(b);
  for (const x of SECRETS) assert(!text.includes(x), `학부모 묶음에 "${x}"`);
  for (const m of b.roster) for (const k of Object.keys(m)) assert(['id', 'name', 'grade'].includes(k), `명단 칸 ${k}`);
  eq(b.roster.map(m => [m.name, m.grade]), [['김하나', '1'], ['박세찌', '3'], ['이두리', '중1']], '이름·학년 (학년 순)');
  for (const k of ['accountHolder', 'contactName', 'contactPhone']) assert(!(k in b.site), `site.${k}`);
  eq([b.site.bankName, b.site.bankAccount], ['시험은행', '999-0000-1111'], '계좌번호는 보임');
  await A.collection('members').patch(ids.member({ name: '김하나' }), { secretNew: '비밀칸' });
  const { bundle } = buildBundle(pub.gather());
  assert(!JSON.stringify(bundle).includes('비밀칸'), '허용 목록 밖의 새 칸은 가지 않음');
  for (const k of MEMBER_PRIVATE) assert(!JSON.stringify(bundle.roster).includes(`"${k}"`), k);
});

await test('연락처가 공지·공개 페이지에 섞이면 반영 거부 → 휴지통에 넣으면 반영', async () => {
  const n = await A.collection('notices').put({ title: '급히 연락', body: '김부모님께 01011112222 로 연락 바랍니다', date: '2026-11-05' });
  await rejects(pub.publish(), 'contact-leak', '전화번호 섞임');
  assert(!siteAll().includes('01011112222'), '올라가지 않음');
  await A.collection('notices').softDelete(n.id);
  await pub.publish();
  eq((await pub.state()).dirty, false, '반영 끝');
  await A.collection('settings').patch('public', { join: '문의 010-2468-1357' });
  await rejects(pub.publish(), 'contact-leak', '공개 페이지에 휴대폰 번호');
  await A.collection('settings').patch('public', { join: '입단 문의는 교회 사무실로' });
  await pub.publish();
  assertNoContacts([{ a: '2026-11-11', s: 4325155, w: 1600 }], pub.gather());
});

let S2;
await test('스탭: 회의자료(첨부 PDF 바이트 그대로)·간식 당번을 쓰고, 다른 스탭·관리자가 읽음. 같은 때 고치면 합침. 학부모는 못 씀', async () => {
  const st1 = staffStore(S1);
  const pdf = pdfBytes(120e3);
  const att = await st1.attach([new File([pdf], '11월 회의.pdf', { type: 'application/pdf' })]);
  await st1.put('meetings', { title: '11월 임원 회의', date: '2026-11-08', body: '음악회 준비', attachments: att });
  await st1.put('snacks', { date: '2026-11-15', who: '김하나 가족', items: '귤 40개', note: '' });
  assert(!siteAll().includes('음악회 준비') && !siteAll().includes('귤 40개'), '공개 저장소에는 암호문');
  assert(gh.repos.has('choir-files-1'), '첨부는 파일 저장소 choir-files-1');
  S2 = mkSession('S2');
  await S2.login('이회계', STAFF2.code);
  const st2 = staffStore(S2);
  const ms = await st2.list('meetings');
  eq(ms.map(x => [x.title, x.createdBy]), [['11월 임원 회의', '박총무']], '다른 스탭이 읽음');
  const got = new Uint8Array(await (await st2.file(ms[0].attachments[0])).arrayBuffer());
  assert(got.length === pdf.length && got.every((b, k) => b === pdf[k]), '첨부 바이트 그대로');
  const sn = (await st2.list('snacks'))[0];
  await st1.list('snacks');
  await st1.put('snacks', { ...sn, items: '귤 50개' });
  await st2.put('snacks', { ...sn, note: '현관 앞에' });
  const merged = (await staffStore(S1).list('snacks'))[0];
  eq([merged.items, merged.note], ['귤 50개', '현관 앞에'], '다른 칸은 둘 다');
  eq((await staffStore(AS).list('meetings')).length, 1, '관리자 읽음');
  await rejects(staffStore(F1).put('snacks', { date: '2026-11-22', who: 'x' }), 'forbidden', '학부모는 쓸 수 없음');
  const stx = staffStore(S1);
  await stx.list('snacks');
  await stx.softDelete('snacks', merged);
  eq((await st2.list('snacks')).length, 0, '휴지통');
  eq((await st2.list('snacks', { deleted: true })).length, 1, '휴지통에 남음');
});

let P1;
await test('학부모: 기억한 기기는 코드 없이 다시 열림', async () => {
  P1 = mkSession('P1');
  await P1.login('박세찌', FAM['박세찌'].code);
  const P1b = mkSession('P1b', null, P1.kvName);
  eq(await P1b.load(), 'parent', '코드 없이');
});

let pdfA, pdfBig;
await test('사진 여러 장: 1600px·400KB 이하로 줄이고 작은 그림(400px) → 사진 저장소 → 학부모가 앨범에서 봄', async () => {
  ups = createUploads({ media, dbName: db('U') });
  const alb = ids.album(FAKE.albums[0]);
  const files = [await jpeg(3000, 2000, 1), await jpeg(2400, 3200, 2), await jpeg(1200, 900, 3)];
  await ups.add(files, { owner: `albums:${alb}`, album: { id: alb, title: '이웃초청음악회', date: '2026-11-11' } });
  await ups.kick();
  const s = ups.snapshot();
  eq([s.siteDone, s.siteErr], [3, 0], `올리기 ${JSON.stringify(s.list.map(x => x.siteErr))}`);
  const ms = media.forOwner(`albums:${alb}`);
  eq(ms.length, 3, 'media 3');
  for (const m of ms) {
    assert(Math.max(m.w, m.h) <= 1600, `크기 ${m.w}x${m.h}`);
    assert(m.size <= 400e3, `용량 ${m.size}`);
    assert(m.thumb, '작은 그림');
  }
  assert(ms[0].w === 1600 && ms[0].h === 1067, `가로 사진 ${ms[0].w}x${ms[0].h}`);
  // 공개 사진 저장소에는 암호문만 (JPEG 머리 FF D8 없음)
  for (const [p, f] of gh.repo(repoName(1)).files) if (p.startsWith('m/')) assert(!(f.bytes[12] === 0xff && f.bytes[13] === 0xd8) && !(f.bytes[0] === 0xff && f.bytes[1] === 0xd8), `${p} 가 암호문이 아님`);
  await pub.publish();
  await P1.load();
  const a = P1.bundle.albums.find(x => x.id === alb);
  eq(a.count, 3, '앨범 사진 수');
  const list = await P1.album(a);
  eq(list.photos.length, 3, '앨범 목록');
  const th = await P1.thumb(list.photos[0].id, list.photos[0]);
  const bmp = await createImageBitmap(th);
  assert(Math.max(bmp.width, bmp.height) <= 400, `작은 그림 ${bmp.width}`);
  const full = await P1.file(list.photos[0].id, list.photos[0]);
  const bmp2 = await createImageBitmap(full);
  eq([bmp2.width, bmp2.height], [1600, 1067], '큰 그림');
});

await test('PDF: 올린 것을 학부모 단계로 받으면 바이트까지 같음 (8MB 넘는 것은 조각으로)', async () => {
  const song = ids.song(FAKE.songs[0]);
  pdfA = pdfBytes(300e3);
  pdfBig = pdfBytes(9.2e6);
  await ups.add([new File([pdfA], '주 품에 악보.pdf', { type: 'application/pdf' }), new File([pdfBig], '큰 악보.pdf', { type: 'application/pdf' })], { owner: `songs:${song}` });
  await ups.kick();
  eq(ups.snapshot().siteErr, 0, '오류 없음');
  const ms = media.forOwner(`songs:${song}`);
  eq(ms.map(m => [m.kind, m.name, m.parts]), [['pdf', '주 품에 악보.pdf', 1], ['pdf', '큰 악보.pdf', 2]], 'PDF 기록');
  await pub.publish();
  await P1.load();
  const s = P1.bundle.songs.find(x => x.id === song);
  eq(s.files.length, 2, '곡에 PDF 2개');
  for (const [i, want] of [[0, pdfA], [1, pdfBig]]) {
    const e = P1.bundle.files[s.files[i]];
    const got = new Uint8Array(await (await P1.file(s.files[i], e)).arrayBuffer());
    assert(got.length === want.length, `길이 ${got.length} ≠ ${want.length}`);
    let same = true;
    for (let k = 0; k < want.length; k++) if (got[k] !== want[k]) { same = false; break; }
    assert(same, `${e.n} 바이트가 다름`);
    eq(e.n, i ? '큰 악보.pdf' : '주 품에 악보.pdf', '원래 파일 이름');
  }
});

await test('PDF 95MB 넘으면 거부 (20MB 넘으면 화면이 경고)', async () => {
  const fake = { name: '너무 큰.pdf', type: 'application/pdf', size: 96e6, lastModified: 0 };
  const [it] = await ups.add([fake], { owner: 'notices:x' });
  eq(it.site, 'error', '거부');
  assert(/95MB/.test(it.siteErr), it.siteErr);
  await ups.dismiss(it.qid);
});

await test('사진 저장소가 차면 다음 저장소(choir-photos-2, -3)를 만들어 이어서 · 용량 표시', async () => {
  // 한도 1.5MB 로 시험: 사진 3장(약 0.8MB)이 든 1번에 9.2MB PDF 는 안 들어가서 2번이 생겼다. 빈 저장소에는 큰 파일 하나도 넣는다
  let u = media.usage();
  eq(u.map(x => [x.name, x.count]), [['choir-photos-1', 4], ['choir-photos-2', 1]], '처음');
  assert(u[0].bytes > 0 && u[1].pct === 100, `용량 ${JSON.stringify(u)}`);
  const alb = ids.album(FAKE.albums[0]);
  await ups.add([await jpeg(3000, 2000, 7), await jpeg(3000, 2000, 8)], { owner: `albums:${alb}`, album: { id: alb, title: 'x', date: '' } });
  await ups.kick();
  assert(gh.repo(repoName(3)), 'choir-photos-3 이 만들어짐');
  u = media.usage();
  eq(u.map(x => x.name), ['choir-photos-1', 'choir-photos-2', 'choir-photos-3'], '저장소 목록');
  eq(u[2].count, 2, '3번에 사진 2장');
  eq(A.collection('settings').get('storage').repos, [1, 2, 3], '만든 저장소 기록');
  await pub.publish();
  await P1.load();
  const a = P1.bundle.albums.find(x => x.id === alb);
  const list = await P1.album(a);
  const in3 = list.photos.filter(p => p.r === 3);
  eq(in3.length, 2, '3번 저장소 사진이 앨범에');
  await createImageBitmap(await P1.thumb(in3[0].id, in3[0]));
});

await test('올리다 끊기면 이어서: 같은 키·같은 자리로 다시 올려도 열림', async () => {
  const alb = ids.album(FAKE.albums[0]);
  const n = media.usage().at(-1).n;
  const repo = gh.repo(repoName(n));
  // 첫 조각(작은 그림)은 올라가고, 다음 조각에서 인터넷이 끊긴 것처럼
  repo.beforePut = async () => { repo.beforePut = async () => { throw new BackendError(0, '인터넷에 연결되어 있지 않아요.'); }; };
  const [it] = await ups.add([await jpeg(800, 600, 9)], { owner: `albums:${alb}`, album: { id: alb, title: 'x', date: '' } });
  await ups.kick();
  const mid = ups.snapshot().list.find(x => x.qid === it.qid);
  eq(mid.site, 'pending', `끊긴 뒤 기다림 (${mid.siteErr})`);
  assert(!A.collection('media').get(it.id), '아직 media 기록 없음');
  await ups.kick();
  eq(ups.snapshot().list.find(x => x.qid === it.qid).site, 'done', '이어서 끝남');
  const m = A.collection('media').get(it.id);
  eq(m.repo, n, '같은 저장소');
  const b = await media.blob(m);
  eq(b.size, m.size, '받은 크기');
  await createImageBitmap(b);
});

// ---------- 5. 탈퇴 · 그만둠 · 역할 ----------
await test('가족 탈퇴: admin.revoke → 칸 삭제 + 학부모 열쇠 바꿈(커밋 하나) → 탈퇴 가족은 못 열고, 남은 가족은 코드 없이 계속', async () => {
  const ring0 = siteJSON(KEYRING);
  const idx0 = siteJSON(indexPath('parent'));
  const commits0 = siteRepo.commitLog.length;
  const r = await admin.revoke(FAM['김하나'].person.id);
  eq(r.tokenExposed, false, '읽기 역할이라 토큰 걱정 없음');
  eq(siteRepo.commitLog.length, commits0 + 1, '커밋 하나');
  const ring = siteJSON(KEYRING);
  eq(Object.keys(ring.slots).length, Object.keys(ring0.slots).length - 1, '칸 하나 줄어듦');
  const idx = siteJSON(indexPath('parent'));
  assert(idx.kv > idx0.kv, '학부모 열쇠 판이 올라감');
  eq(idx.items.content.r, idx0.items.content.r, '내용 암호문은 그대로 (항목 열쇠만 다시 감쌈)');
  assert(idx.items.content.k.ct !== idx0.items.content.k.ct, '항목 열쇠는 새 열쇠로');
  // 탈퇴 가족의 기억한 기기 → 공개로 + 안내
  const F1c = mkSession('F1c', null, F1.kvName);
  eq(await F1c.load(), 'public', '탈퇴 가족 기기는 공개로');
  assert(/접속이 끝났어요/.test(F1c.notice), '안내 문장');
  await rejects(mkSession('F1d').login('김하나', FAM['김하나'].code), 'bad-login', '예전 코드');
  // 남은 가족
  const P1c = mkSession('P1c', null, P1.kvName);
  eq(await P1c.load(), 'parent', '남은 가족은 그대로');
  assert(P1c.bundle?.albums.length, '새 열쇠로 내용이 열림');
  const ppl = await admin.people();
  eq(ppl.find(p => p.id === FAM['김하나'].person.id).status, 'revoked', '기록은 남음(탈퇴)');
  // 다시 가입 = 새 코드
  const back = await admin.resetCode(FAM['김하나'].person.id);
  eq(await mkSession('F1e').login('김하나', back.code), 'parent', '다시 가입 후 새 코드로');
  await admin.revoke(FAM['김하나'].person.id);
});

await test('스탭 그만둠: 스탭·학부모 열쇠 바꿈, 토큰 알림 → 토큰 바꾸면 남은 스탭은 새 토큰, 회의자료는 계속 읽힘', async () => {
  const r = await admin.revoke(STAFF1.person.id);
  eq(r.tokenExposed, true, '쓰기 역할 → 토큰 바꾸라는 표시');
  await pub.warnToken('박총무');
  eq((await pub.state()).tokenWarn?.name, '박총무', '알림');
  await rejects(mkSession('S1x').login('박총무', STAFF1.code), 'bad-login', '그만둔 스탭 코드');
  await A.rotateToken('tok-2');
  await admin.setToken('tok-2');
  await pub.clearTokenWarn();
  eq((await pub.state()).tokenWarn, null, '알림 지움');
  const S2b = mkSession('S2b', null, S2.kvName);
  await S2b.load();
  eq(S2b.access.me().bundle.token, 'tok-2', '남은 스탭은 새 토큰');
  eq((await staffStore(S2b).list('meetings'))[0].title, '11월 임원 회의', '남은 스탭은 회의자료를 읽음');
  await staffStore(S2b).put('snacks', { date: '2026-11-29', who: '박세찌 가족', items: '빵' });
});

await test('역할 바꾸기: 가족 → 스탭(같은 코드로 스탭 화면) → 다시 가족(스탭 열쇠 바꿈, 토큰 표시)', async () => {
  const f = FAM['박세찌'];
  await admin.changeRole(f.person.id, 'staff', ['간식']);
  eq(await mkSession('R1').login('박세찌', f.code), 'staff', '같은 코드로 스탭');
  const r = await admin.changeRole(f.person.id, 'parent');
  eq([r.rotated, r.tokenExposed], [['staff'], true], '스탭 열쇠를 바꾸고 토큰 표시');
  eq(await mkSession('R2').login('박세찌', f.code), 'parent', '다시 학부모');
});

await test('학부모가 코드를 비밀문장으로: 요청 글자(비밀문장 없음) → 관리자 적용 → 새 비밀문장으로 로그인, 예전 코드는 안 됨', async () => {
  const f = FAM['이두리'];
  const s = mkSession('CS');
  await s.login('이두리', f.code);
  await rejects(s.access.changeSecret(f.code, '20150304'), 'weak-passphrase', '생일 같은 숫자');
  const r = await s.access.changeSecret(f.code, '우리 아이 웃음소리 2026');
  assert(r.request?.startsWith('ACX1.') && !r.request.includes('웃음소리'), '요청 글자에 비밀문장 없음');
  await admin.applySecretChange(r.request);
  eq(await mkSession('CS2').login('이두리', '우리 아이 웃음소리 2026'), 'parent', '새 비밀문장');
  await rejects(mkSession('CS3').login('이두리', f.code), 'bad-login', '예전 코드');
});

// ---------- 6. 노션 zip ----------
await test('노션 zip 가져오기: 일정·명단·연주곡 PDF·영상·사진첩 (두 번 해도 늘지 않음)', async () => {
  const z = new JSZip();
  const R = '자양교회 어린이 합창단 71cb1b1a024d460987748355f5427b30';
  z.file(`${R}.md`, `# 자양교회 어린이 합창단

**🎶 자양교회 어린이 합창단에 오신걸 환영합니다^^**

🔔 **2026년 8~11월 일정**

| 날짜 | 시간 | 장소 | 내용 | 비고 |
| --- | --- | --- | --- | --- |
| 8/23 | 11:30~12:30 | 초등부실 | 연습 |  |
| 11/29 | 3:15~4:20 | 초등부실 | 오후예배 찬양 |  |

<aside>
💡 **2026년 회비**

- 상반기 5만원

📥 **합창단 계좌번호** : **시험은행 99900001111 **홍예금
</aside>

<aside>
💡 **2026년 활동 안내**

- **정기 연습** : 주일 11:30~12:30

**🛎 등록/일정 문의 : 박총무 010-9999-0001**
</aside>

[유튜브](https://www.youtube.com/@jychoir)
`);
  z.file(`${R}/명단 2ef65921ee4480828610c44a0e84205d.md`, `# 명단

> **지도** : 시험 지도자, **단원** : 2명

| 연번 | 학년 | 학생 | 성별 | 부모님 | 연락처 | 비고 | 입단 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | **김하나** | 여 | 김부모 | [📞2222](tel:010-1111-2222) | 자매 | 26’ 2/1 |
| 2 | 중1 | **최셋째** | 남 | 최부모 | [📞9999](tel:010-1212-9999) | 지휘자님 [📞2833](tel:01000002833) | 24' 3/3 |
`);
  z.file(`${R}/전체일정 30c65921ee44803195fed0539e3c9db6.md`, '# 전체일정\n');
  z.file(`${R}/전체일정 30c65921ee44803195fed0539e3c9db6/2026년 30c65921ee448088ae02fb753747816e.csv`, '﻿이름,날짜,장소\n어린이주일 공연,"2026년 5월 3일",본당\n"합창, 연습","May 17, 2026",초등부실\n');
  const S = `${R}/연주곡 204941ca0b524c318861f1a2a6c4845d`;
  z.file(`${S}.md`, `# 연주곡

**■ 26’ 6월 연습곡**

[20260618_주_품에.pdf](${encodeURI('연주곡 204941ca0b524c318861f1a2a6c4845d/20260618_주_품에.pdf')})

🎶 [주 품에 (alt.).m4a](https://drive.google.com/file/d/11ZG/view?usp=sharing)

:유튜브_youtube: [주 품에](https://www.youtube.com/watch?v=YqW9yiRRWYg)

♡ 알토 파트: 시험

**■ 이전 악보**
`);
  z.file(`${S}/20260618_주_품에.pdf`, pdfBytes(5000));
  z.file(`${S}/바바예투.pdf`, pdfBytes(6000)); // 본문 링크 없는 PDF
  z.file(`${R}/공연영상 6a4662bc39e24d4cb388fbe9ea2dad38.md`, `# 공연영상

## **[2026.05.31] ‘꽃들도’ 오후 예배 찬양대**

[https://youtu.be/R_vawI3ovOY](https://youtu.be/R_vawI3ovOY)

https://www.youtube.com/live/7aEULkdJ6o0?si=x
`);
  z.file(`${R}/연습영상 18265921ee4480e789dfdcbb8b83a158.md`, '# 연습영상\n\n## [2026.08.16] ‘주품에’ 연습 영상\n\nhttps://youtu.be/rD0BNwADR9w?si=zz\n');
  const P = `${R}/사진 e52fd34b92bc4f4aa94126867d1d6d74`;
  z.file(`${P}.md`, '# 사진\n');
  z.file(`${P}/사진첩 91199fdb4ba349ae9d272cc2212f8f50.csv`, '﻿이름,날짜\n어린이주일,2026년 5월 3일\n');
  z.file(`${P}/사진첩 91199fdb4ba349ae9d272cc2212f8f50/어린이주일 aaaabbbbccccddddeeeeffff00001111.md`, `# 어린이주일\n\n날짜: 2026년 5월 3일\n\n![IMG_1.jpg](${encodeURI('어린이주일 aaaabbbbccccddddeeeeffff00001111/IMG_1.jpg')})\n`);
  z.file(`${P}/사진첩 91199fdb4ba349ae9d272cc2212f8f50/어린이주일 aaaabbbbccccddddeeeeffff00001111/IMG_1.jpg`, new Uint8Array(await (await jpeg(640, 480, 4)).arrayBuffer()));
  z.file(`${P}/사진첩 91199fdb4ba349ae9d272cc2212f8f50/어린이주일 aaaabbbbccccddddeeeeffff00001111/IMG_2.jpg`, new Uint8Array(await (await jpeg(480, 640, 5)).arrayBuffer()));
  z.file(`${R}/명단 2ef65921ee4480828610c44a0e84205d/image.png`, new Uint8Array(await (await jpeg(10, 10, 6)).arrayBuffer())); // 명단 표 그림 — 가져오면 안 됨
  // 노션처럼 zip 안에 zip
  const inner = await z.generateAsync({ type: 'uint8array' });
  const outer = new JSZip();
  outer.file('Export-1234-Part-1.zip', inner);
  const data = await outer.generateAsync({ type: 'uint8array' });

  const { plan, report: rep } = await parseNotionZip(window.JSZip, data, { year: 2026 });
  eq(Object.values(rep.pages).every(Boolean), true, `페이지 찾기 ${JSON.stringify(rep.pages)}`);
  eq(plan.events.map(e => [e.date, e.title]).sort(), [['2026-05-03', '어린이주일 공연'], ['2026-05-17', '합창, 연습'], ['2026-08-23', '연습'], ['2026-11-29', '오후예배 찬양']], '일정 (표 + 데이터베이스)');
  eq([plan.site.bankName, plan.site.bankAccount, plan.site.accountHolder, plan.site.contactName, plan.site.contactPhone], ['시험은행', '99900001111', '홍예금', '박총무', '010-9999-0001'], '회비·문의');
  assert(/환영/.test(plan.site.welcome) && plan.site.youtube === 'https://www.youtube.com/@jychoir', '환영·유튜브');
  eq(plan.members.map(m => [m.name, m.grade, m.parentName, m.phone]), [['김하나', '1', '김부모', '010-1111-2222'], ['최셋째', '중1', '최부모', '010-1212-9999']], '명단');
  assert(plan.members[1].note.includes('01000002833'), '비고의 전화번호도 (관리자만)');
  const s0 = plan.songs.find(s => /6월/.test(s.group));
  eq(s0.title, '주 품에', '곡 이름 (악보 파일 이름에서)');
  eq([s0.files.map(f => f.name), s0.audio.map(a => a.label), s0.videos.map(v => v.url)], [['20260618_주_품에.pdf'], ['주 품에 (alt.)'], ['https://www.youtube.com/watch?v=YqW9yiRRWYg']], '연주곡 묶음');
  assert(/알토 파트/.test(s0.note), '메모');
  eq(plan.songs.filter(s => s.group === '이전 악보').map(s => [s.title, s.files.map(f => f.name)]), [['바바예투', ['바바예투.pdf']]], '링크 없는 PDF');
  eq(plan.videos.map(v => [v.kind, v.date, v.urls.length]), [['perf', '2026-05-31', 2], ['practice', '2026-08-16', 1]], '영상');
  eq(plan.albums.map(a => [a.title, a.date, a.photos.length]), [['어린이주일', '2026-05-03', 2]], '사진첩 (명단 표 그림은 빠짐)');
  eq(rep.counts.pdfs, 2, 'PDF 수');

  // 준비된 자료의 곡(노션 PDF 이름을 알고 있음)에 zip 의 PDF 가 붙는다
  await applyPlan({ songs: [{ group: '26’ 6월 연습곡', title: '주 품에(준비된 자료)', scoreFiles: ['20260618_주_품에.pdf'] }] }, { core: A });
  const seedSong = ids.song({ group: '26’ 6월 연습곡', title: '주 품에(준비된 자료)' });
  const before = A.collection('media').list().length;
  const r1 = await applyPlan(plan, { core: A, uploads: ups, media });
  eq(r1.queued, 4, '파일 4개 대기열에');
  await ups.kick();
  eq(A.collection('media').list().length, before + 4, '파일 4개 올라감');
  eq(media.forOwner(`songs:${seedSong}`).map(m => m.name), ['20260618_주_품에.pdf'], 'PDF 가 준비된 자료의 곡에 붙음');
  eq(A.collection('songs').get(seedSong).title, '주 품에(준비된 자료)', '곡 이름은 그대로');
  assert(A.collection('songs').get(seedSong).audio.length === 1, '음원 링크는 합쳐짐');
  const ev = A.collection('events').list().length;
  const r2 = await applyPlan(plan, { core: A, uploads: ups, media });
  eq([r2.queued, A.collection('events').list().length], [0, ev], '두 번째는 늘지 않음');
  // 이미 있던(준비된 자료로 넣은) 김하나는 덮어쓰지 않고 그대로
  eq(A.collection('members').get(ids.member({ name: '김하나' })).note, '자매 (긴급 010-3333-4444)', '고친 내용을 덮어쓰지 않음');
  await pub.publish();
  for (const s of [...SECRETS, '최부모', '010-1212-9999', '01000002833']) assert(!siteAll().includes(s), `공개 저장소에 "${s}"`);
  assert(parseDate('2026년 5월 31일') === '2026-05-31' && parseDate('11/11 (수)', 2026) === '2026-11-11', '날짜');
});

// ---------- 7. 원본 대기열 (가짜 Google) ----------
await test('원본 대기열: Google 실패해도 사이트는 끝남 → 다시 하면 원본도 ✓, 50장씩 묶음', async () => {
  const calls = { create: 0, upload: 0, batch: [] };
  let failUploads = 2;
  const fakeG = {
    kind: 'photos',
    async createAlbum(t) { calls.create++; calls.title = t; return 'gal-1'; },
    async uploadBytes(blob) { calls.upload++; if (failUploads-- > 0) throw Object.assign(new Error('일시 오류'), { status: 503 }); return `ut-${calls.upload}-${blob.size}`; },
    async batchCreate(id, list) { calls.batch.push(list.length); return list.map(() => ({ ok: true })); },
  };
  const gmap = {};
  let ready = true;
  const google = createOriginals({ cfg: () => ({ enabled: true, backend: 'photos' }), backendFor: () => fakeG, ready: () => ready, albumId: k => gmap[k], setAlbumId: (k, v) => { gmap[k] = v; } });
  const name = db('G');
  const U = createUploads({ media, dbName: name, google });
  const alb = await A.collection('albums').put({ title: '이웃초청음악회2', date: '2026-11-12' });
  const small = [];
  for (let i = 0; i < 53; i++) small.push(await jpeg(16, 12, 20 + i));
  await U.add(small, { owner: `albums:${alb.id}`, album: { id: alb.id, title: alb.title, date: alb.date }, original: true });
  await U.kick();
  let s = U.snapshot();
  eq([s.siteDone, s.siteErr], [53, 0], '사이트는 모두 끝남');
  eq([s.origDone, s.origErr], [51, 2], '원본 2장 실패');
  eq(calls.title, '합창단 · 2026-11-12 이웃초청음악회2', '구글 앨범 이름');
  assert(calls.batch.every(n => n <= 50), `묶음 ${calls.batch}`);
  await U.retry('orig');
  s = U.snapshot();
  eq([s.origDone, s.origErr], [53, 0], '다시 하니 모두');
  eq(calls.create, 1, '앨범은 한 번만 만듦');

  // 새로고침해도 남는 대기열: 로그인 전이면 원본은 기다림 → 새 대기열 객체(같은 IndexedDB)가 이어받음
  ready = false;
  const U2 = createUploads({ media, dbName: name, google });
  await U2.add([await jpeg(20, 20, 99)], { owner: `albums:${alb.id}`, album: { id: alb.id, title: alb.title, date: alb.date }, original: true });
  await U2.kick();
  eq([U2.snapshot().siteDone, U2.snapshot().origPending], [1, 1], '사이트 끝, 원본 기다림');
  const U3 = createUploads({ media, dbName: name, google });
  eq(await U3.pending(), 1, '새로고침 뒤에도 대기열에 남음');
  ready = true;
  await U3.kick();
  eq(U3.snapshot().origDone, 1, '로그인 뒤 원본 끝');
  const U4 = createUploads({ media, dbName: name, google });
  eq(await U4.pending(), 0, '끝나면 대기열에서 빠짐');
  // 원본 보관을 끄면 기다리던 것은 'off'
  const off = createOriginals({ cfg: () => ({ enabled: false }), backendFor: () => fakeG, ready: () => true, albumId: () => '', setAlbumId: () => {} });
  const U5 = createUploads({ media, dbName: db('G2'), google: off });
  await U5.add([await jpeg(20, 20, 98)], { owner: `albums:${alb.id}`, album: { id: alb.id }, original: true });
  await U5.kick();
  eq(U5.snapshot().list[0].orig, 'off', '끄면 원본 안 올림');
});

// ---------- 끝 ----------
await A.lock();
for (const n of dbs) indexedDB.deleteDatabase(n);
const fails = results.filter(r => !r.ok);
const summary = `${fails.length ? 'FAIL' : 'PASS'} ${results.length - fails.length}/${results.length}`;
document.getElementById('summary').textContent = summary;
document.getElementById('summary').className = fails.length ? 'bad' : 'ok';
document.title = `합창단 시험 ${summary}`;
document.getElementById('log').textContent = [...gh.repos.keys()].map(n => `${n}: ${gh.repo(n).files.size}개`).join('\n');
document.body.dataset.done = summary;
