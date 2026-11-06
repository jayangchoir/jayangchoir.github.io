// 노션에서 가져오기 — 노션 "내보내기 → Markdown & CSV, 하위 페이지 포함" zip 을 이 기기에서 읽어 가져오기 계획(plan.js)을 만든다.
// 서버로 보내지 않는다. 지금 노션 페이지는 그대로 둔다(읽기만).
//
// 노션 내보내기 모양 (페이지마다 "<제목> <32자리 id>.md", 첨부·하위는 같은 이름의 폴더 안):
//   자양교회 어린이 합창단 71cb….md                 첫 화면: 환영 글, 일정 표, 회비·활동 안내, 문의
//   자양교회 어린이 합창단 71cb…/명단 2ef6….md        명단 표 (부모님·연락처·비고는 관리자만)
//   …/전체일정 30c6….md + …/전체일정 30c6…/2026년 30c6….csv (데이터베이스: 일정 줄들)
//   …/연주곡 2049….md + 같은 이름 폴더 안의 PDF 악보   ■ 제목마다 곡 묶음
//   …/사진 e52f…/<데이터베이스>/<앨범 줄>.md + 사진 파일   앨범마다
//   …/공연영상 6a46….md, …/연습영상 1826….md         "## [2026.05.31] 제목" + 유튜브 주소
// 큰 내보내기는 zip 안에 zip(Part-1.zip …)이 들어 있기도 하다 → 안쪽 zip 도 연다.

import { ytId } from './plan.js';

export const PAGE_IDS = {
  root: '71cb1b1a024d460987748355f5427b30',
  roster: '2ef65921ee4480828610c44a0e84205d',
  schedule: '30c65921ee44803195fed0539e3c9db6',
  songs: '204941ca0b524c318861f1a2a6c4845d',
  photos: 'e52fd34b92bc4f4aa94126867d1d6d74',
  perf: '6a4662bc39e24d4cb388fbe9ea2dad38',
  practice: '18265921ee4480e789dfdcbb8b83a158',
};
const TITLES = { root: '자양교회 어린이 합창단', roster: '명단', schedule: '전체일정', songs: '연주곡', photos: '사진', perf: '공연영상', practice: '연습영상' };
const IMG_RE = /\.(jpe?g|png|gif|webp|heic|heif)$/i;

// ---------- 글자 다듬기 ----------
export const clean = s => String(s || '')
  .replace(/<\/?(aside|b|strong|i|em|u|span|br)[^>]*>/gi, ' ')
  .replace(/\*\*|__/g, '')
  .replace(/\\([\\`*_{}\[\]()#+\-.!~|>])/g, '$1')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[ \t]+/g, ' ').trim();

// 노션 이모지 단축어(:유튜브_youtube:)·장식 글자 빼기
const plainLabel = s => clean(s).replace(/:[^:\s]+:/g, '').replace(/^[🎶🎵📄📎🔔📥🛎💡♡■\s]+/u, '').trim();

// 여러 모양의 날짜 → 'YYYY-MM-DD' (모르면 '')
export function parseDate(s, year = new Date().getFullYear()) {
  const t = String(s || '').trim();
  let m = t.match(/(20\d{2})\s*[년./-]\s*(\d{1,2})\s*[월./-]\s*(\d{1,2})/);
  if (m) return ymd(m[1], m[2], m[3]);
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})/i);
  if (m) return ymd(m[3], MON[m[1].toLowerCase()], m[2]);
  m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/); // 미국식 5/31/2026
  if (m) return ymd(m[3], m[1], m[2]);
  m = t.match(/(\d{2})['’]\s*(\d{1,2})\/(\d{1,2})/); // 26’ 2/1
  if (m) return ymd(`20${m[1]}`, m[2], m[3]);
  m = t.match(/(?:^|\D)(\d{1,2})\s*[/월.]\s*(\d{1,2})(?:\D|$)/); // 8/23, 8월 23
  if (m) return ymd(year, m[1], m[2]);
  return '';
}
const ymd = (y, mo, d) => (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31 ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '');

// CSV (노션은 UTF-8 BOM, 따옴표 안 줄바꿈 있음)
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [head = [], ...body] = rows.filter(r => r.some(x => x.trim()));
  return body.map(r => Object.fromEntries(head.map((hd, i) => [hd.trim(), (r[i] ?? '').trim()])));
}

// 마크다운 표 → [{머리: 값}]
export function parseTables(md) {
  const out = [];
  const lines = md.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) continue;
    const cells = l => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(x => x.trim());
    const head = cells(lines[i]).map(clean);
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const c = cells(lines[j]);
      rows.push(Object.fromEntries(head.map((hd, k) => [hd, c[k] ?? ''])));
    }
    out.push({ head, rows, at: i });
    i = j;
  }
  return out;
}

const col = (row, ...names) => {
  for (const n of names) {
    const k = Object.keys(row).find(x => (n instanceof RegExp ? n.test(x) : clean(x) === n));
    if (k !== undefined && row[k] !== '') return row[k];
  }
  return '';
};
const telOf = s => (String(s).match(/tel:([+\d-]+)/) || String(s).match(/(01[016789][\d-]{7,11})/) || [])[1] || '';
const urlsIn = s => [...String(s).matchAll(/https?:\/\/[^\s)<>\]"']+/g)].map(m => m[0].replace(/&amp;/g, '&').replace(/[.,]+$/, ''));
const mdLinks = s => [...String(s).matchAll(/(!?)\[([^\]]*)\]\(([^)]+)\)/g)].map(m => ({ img: !!m[1], text: m[2], href: m[3] }));

// ---------- zip 열기 ----------
async function entriesOf(JSZip, data, prefix = '', depth = 0) {
  const zip = await JSZip.loadAsync(data);
  const out = new Map();
  for (const [name, f] of Object.entries(zip.files)) {
    if (f.dir) continue;
    if (/\.zip$/i.test(name) && depth < 2) {
      for (const [k, v] of await entriesOf(JSZip, await f.async('uint8array'), '', depth + 1)) out.set(k, v);
    } else out.set(prefix + name.normalize('NFC'), f);
  }
  return out;
}

const dirOf = p => p.slice(0, p.lastIndexOf('/') + 1);
const baseOf = p => p.slice(p.lastIndexOf('/') + 1);
function resolve(fromMd, href) {
  let h = href.split('#')[0].split('?')[0];
  try { h = decodeURIComponent(h); } catch {}
  const parts = (dirOf(fromMd) + h).split('/');
  const out = [];
  for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); }
  return out.join('/').normalize('NFC');
}
const stripId = s => s.replace(/\s+[0-9a-f]{32}$/i, '').replace(/\.md$/i, '').replace(/\s+[0-9a-f]{32}$/i, '').trim();

// ---------- 본체 ----------
// → { plan, report: { pages: {이름: 찾음?}, warnings: [], counts } }
export async function parseNotionZip(JSZip, data, { year } = {}) {
  const files = await entriesOf(JSZip, data);
  const names = [...files.keys()];
  const text = async p => (files.get(p) ? (await files.get(p).async('string')).normalize('NFC') : '');
  const bytes = async p => files.get(p).async('uint8array');
  const warnings = [];
  const pages = {};

  // 페이지 찾기: id 로, 없으면 제목으로 (가장 얕은 것)
  function findPage(key) {
    const id = PAGE_IDS[key];
    let hit = names.filter(n => /\.md$/i.test(n) && n.replace(/-/g, '').includes(id));
    if (!hit.length) hit = names.filter(n => /\.md$/i.test(n) && stripId(baseOf(n)) === TITLES[key]);
    hit.sort((a, b) => a.split('/').length - b.split('/').length);
    pages[TITLES[key]] = !!hit[0];
    return hit[0] || '';
  }
  const folderOf = mdPath => mdPath.replace(/\.md$/i, '/');
  const under = (dir, re) => names.filter(n => n.startsWith(dir) && re.test(n));

  const plan = { site: {}, notices: [], events: [], songs: [], videos: [], members: [], albums: [] };

  // 1. 첫 화면
  const rootP = findPage('root');
  if (rootP) {
    const md = await text(rootP);
    const y = Number((md.match(/(20\d{2})년\s*\d{1,2}\s*~/) || [])[1]) || year || new Date().getFullYear();
    const welcome = md.split(/\r?\n/).map(clean).find(l => /환영/.test(l));
    if (welcome) plan.site.welcome = plainLabel(welcome);
    const yt = urlsIn(md).find(u => /youtube\.com\/@/.test(u));
    if (yt) plan.site.youtube = yt;
    for (const t of parseTables(md)) {
      if (!t.head.some(x => /날짜/.test(x))) continue;
      for (const r of t.rows) {
        const date = parseDate(clean(col(r, '날짜')), y);
        if (!date) continue;
        plan.events.push({ date, time: clean(col(r, '시간')), place: clean(col(r, '장소')), title: clean(col(r, '내용')).replace(/<br\s*\/?>/gi, ' · '), note: clean(col(r, '비고')) });
      }
    }
    // 안내 상자(<aside>) 들
    const asides = [...md.matchAll(/<aside>([\s\S]*?)<\/aside>/g)].map(m => m[1]);
    for (const a of asides) {
      const lines = a.split(/\r?\n/).map(l => clean(l.replace(/^\s*[-*]\s+/, '• '))).filter(Boolean).filter(l => l !== '💡');
      if (lines.some(l => /회비/.test(l))) {
        const acc = lines.find(l => /계좌/.test(l));
        if (acc) {
          const m = acc.match(/:\s*(\S+)\s+([\d-]{6,})\s*(\S+)?/);
          if (m) { plan.site.bankName = m[1]; plan.site.bankAccount = m[2]; if (m[3]) plan.site.accountHolder = m[3]; }
        }
        plan.site.fees = lines.filter(l => l !== acc && !/^.?\s*\d{4}년 회비$/.test(l)).join('\n');
      } else if (lines.some(l => /활동|연습/.test(l))) {
        const ct = lines.find(l => /문의/.test(l));
        if (ct) {
          const ph = telOf(ct);
          const name = (ct.replace(ph, '').match(/:\s*([가-힣]{2,4})/) || [])[1];
          if (ph) plan.site.contactPhone = ph;
          if (name) plan.site.contactName = name;
          plan.site.contactNote = clean(ct.split(':')[0]).replace(/^[^\p{L}]+/u, '') + ': 총무에게 문의해 주세요.';
        }
        plan.site.activity = lines.filter(l => l !== ct && !/활동 안내$/.test(l)).join('\n');
      }
    }
  } else warnings.push('첫 화면 페이지를 찾지 못했어요.');

  // 2. 명단
  const rosterP = findPage('roster');
  if (rosterP) {
    const md = await text(rosterP);
    const intro = md.split(/\r?\n/).map(clean).find(l => /지도|반주|단원/.test(l));
    if (intro) plan.site.intro = intro.replace(/^>\s*/, '');
    let order = 0;
    for (const t of parseTables(md)) {
      if (!t.head.some(x => /학생|이름/.test(x))) continue;
      for (const r of t.rows) {
        const name = clean(col(r, '학생', '이름'));
        if (!name) continue;
        const phoneCell = col(r, '연락처');
        const noteCell = col(r, '비고');
        plan.members.push({
          name, grade: clean(col(r, '학년')), gender: clean(col(r, '성별')), parentName: clean(col(r, '부모님', '보호자')),
          phone: telOf(phoneCell) || clean(phoneCell), note: clean(noteCell.replace(/\[([^\]]*)\]\(tel:([^)]+)\)/g, '$2')),
          joined: clean(col(r, '입단')), order: ++order,
        });
      }
    }
  }

  // 3. 전체일정 (데이터베이스 CSV)
  const schedP = findPage('schedule');
  if (schedP) {
    const csvs = under(folderOf(schedP), /\.csv$/i);
    const csv = csvs.find(n => /_all\.csv$/i.test(n)) || csvs[0];
    if (csv) {
      for (const r of parseCsv(await text(csv))) {
        const dateCell = col(r, /날짜|일자|일시|date/i);
        const date = parseDate(dateCell, year);
        const title = col(r, '이름', '제목', '내용', 'Name', /일정|행사/);
        if (!date || !title) continue;
        const time = col(r, '시간', /time/i) || (String(dateCell).match(/(오전|오후)?\s*\d{1,2}:\d{2}/) || [''])[0];
        plan.events.push({ date, time: clean(time), place: clean(col(r, '장소', /place|location/i)), title: clean(title), note: clean(col(r, '비고', '메모', /note/i)) });
      }
    } else warnings.push('전체일정 데이터베이스(CSV)를 찾지 못했어요.');
  }

  // 4. 연주곡 — "■ 제목"(공연·묶음)마다, 그 안에서 PDF 하나가 곡 하나를 시작한다 (뒤따르는 음원·영상·메모는 그 곡의 것)
  const songsP = findPage('songs');
  if (songsP) {
    const md = await text(songsP);
    let group = { title: '연주곡', date: '' };
    let cur = null;
    let order = 0;
    const songs = [];
    const newSong = () => { cur = { group: group.title, date: group.date, title: '', order: order++, note: '', audio: [], videos: [], files: [] }; songs.push(cur); return cur; };
    const hasStuff = x => x && (x.files.length || x.audio.length || x.videos.length);
    let inAside = false;
    const groupsSeen = [];
    for (const raw of md.split(/\r?\n/)) {
      const line = raw.trim();
      if (/^<aside>/.test(line)) inAside = true;
      if (!line || /^#\s/.test(line) || /메뉴 화면/.test(line)) { if (/<\/aside>/.test(line)) inAside = false; continue; }
      const head = clean(line).match(/^■\s*(.+)$/);
      if (head) { group = { title: head[1].trim(), date: parseDate(head[1], year) }; groupsSeen.push(group.title); cur = null; continue; }
      if (/^\d+\.\s+\S/.test(line) && !mdLinks(line).length) { newSong(); continue; } // "1. 첫번째 곡"
      const links = mdLinks(line);
      let used = false;
      for (const l of links) {
        if (/^https?:/i.test(l.href)) {
          const url = l.href.replace(/&amp;/g, '&');
          if (!cur) newSong();
          if (ytId(url)) cur.videos.push({ label: plainLabel(l.text) || '참고 영상', url });
          else if (/drive\.google|docs\.google/.test(url)) cur.audio.push({ label: plainLabel(l.text).replace(/\.(m4a|mp3|mp4|wav)$/i, ''), url });
          else cur.videos.push({ label: plainLabel(l.text), url });
          used = true;
        } else {
          const p = resolve(songsP, l.href);
          if (files.has(p)) {
            if (!cur || cur.files.length || cur.audio.length || cur.videos.length) newSong();
            cur.files.push({ path: p, name: baseOf(p) });
            used = true;
          } else if (/\.pdf$/i.test(l.href)) warnings.push(`연주곡 PDF 를 zip 안에서 찾지 못했어요: ${l.text}`);
        }
      }
      if (!used) {
        const t = clean(line.replace(/^[-*]\s+/, '').replace(/^>\s*/, '').replace(/<\/?aside>/g, ''));
        if (t && t !== '💡') {
          // 곡이 시작되기 전의 메모(예: "알토 파트: …")는 그 묶음의 다음 곡 대신 지금 곡에, 곡이 없으면 묶음 첫 곡에
          const target = cur || newSong();
          target.note += (target.note ? '\n' : '') + plainLabel(t);
        }
      }
      if (/<\/aside>/.test(line)) inAside = false;
    }
    void inAside;
    // zip 에는 있는데 본문에 링크가 없는 PDF → 곡 하나씩 ("이전 악보" 묶음)
    const linked = new Set(songs.flatMap(x => x.files.map(f => f.path)));
    const loose = under(folderOf(songsP), /\.pdf$/i).filter(p => !linked.has(p));
    if (loose.length) {
      const g = groupsSeen.find(t => /이전/.test(t)) || groupsSeen[groupsSeen.length - 1] || '악보';
      for (const p of loose) songs.push({ group: g, date: '', title: '', order: order++, note: '', audio: [], videos: [], files: [{ path: p, name: baseOf(p) }] });
      warnings.push(`본문에서 위치를 모르는 PDF ${loose.length}개는 "${g}"에 넣었어요.`);
    }
    for (const x of songs) {
      if (!x.title) x.title = scoreTitle(x.files[0]?.name) || ytTitle(x.videos[0]?.label) || x.audio[0]?.label || x.group;
      x.files = await Promise.all(x.files.map(async f => ({ name: f.name, blob: new Blob([await bytes(f.path)], { type: /\.pdf$/i.test(f.name) ? 'application/pdf' : '' }) })));
      if (hasStuff(x) || x.note) plan.songs.push(x);
    }
  }

  // 5. 영상
  for (const kind of ['perf', 'practice']) {
    const p = findPage(kind);
    if (!p) continue;
    const md = await text(p);
    let cur = null;
    for (const raw of md.split(/\r?\n/)) {
      const line = clean(raw);
      const hm = raw.match(/^#{1,3}\s+(.*)$/);
      if (hm && !/^#\s/.test(raw)) {
        const t = clean(hm[1]);
        const dm = t.match(/\[?(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})\]?/);
        cur = { kind: kind === 'perf' ? 'perf' : 'practice', date: dm ? ymd(dm[1], dm[2], dm[3]) : '', title: t.replace(/^\[?20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}\]?\s*/, '').trim(), urls: [] };
        plan.videos.push(cur);
        continue;
      }
      if (!cur) continue;
      for (const u of urlsIn(raw)) if (ytId(u) && !cur.urls.some(x => ytId(x) === ytId(u))) cur.urls.push(u);
      if (!urlsIn(raw).length && line && !/메뉴 화면/.test(line) && kind === 'practice' && /공개/.test(line)) cur.note = line;
    }
    plan.videos = plan.videos.filter(v => v.urls.length);
  }

  // 6. 사진 (데이터베이스: 줄마다 앨범)
  const photosP = findPage('photos');
  if (photosP) {
    const dir = folderOf(photosP);
    const rowMds = under(dir, /\.md$/i);
    const csvs = under(dir, /\.csv$/i);
    const csvRows = [];
    for (const c of csvs.filter(n => !/_all\.csv$/i.test(n) || csvs.length === 1)) csvRows.push(...parseCsv(await text(c)).map(r => ({ r, csv: c })));
    const taken = new Set();
    const albumFor = new Map(); // 제목 → 앨범
    const addAlbum = (title, date) => {
      const k = `${date}|${title}`;
      if (!albumFor.has(k)) { const a = { title, date, note: '', photos: [], paths: [] }; albumFor.set(k, a); plan.albums.push(a); }
      return albumFor.get(k);
    };
    for (const mdPath of rowMds) {
      const md = await text(mdPath);
      const title = clean((md.match(/^#\s+(.+)$/m) || [])[1] || stripId(baseOf(mdPath)));
      const props = Object.fromEntries([...md.matchAll(/^([^\n:#|]{1,20}):\s*(.+)$/gm)].map(m => [m[1].trim(), m[2].trim()]));
      const csvRow = csvRows.find(x => clean(col(x.r, '이름', 'Name', '제목')) === title)?.r || {};
      const date = parseDate(col(props, /날짜|일자|date/i) || col(csvRow, /날짜|일자|date/i) || title, year);
      const a = addAlbum(title.replace(/^\[?20\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}\]?\s*/, '') || title, date);
      const paths = [];
      for (const l of mdLinks(md)) { const p = resolve(mdPath, l.href); if (files.has(p) && IMG_RE.test(p)) paths.push(p); }
      const sub = mdPath.replace(/\.md$/i, '/');
      const sub2 = dirOf(mdPath) + stripId(baseOf(mdPath)) + '/';
      for (const p of names) if ((p.startsWith(sub) || p.startsWith(sub2)) && IMG_RE.test(p) && p.split('/').length === sub.split('/').length) paths.push(p);
      for (const p of paths) if (!taken.has(p)) { taken.add(p); a.paths.push(p); }
    }
    // 줄 페이지가 없고 CSV 의 파일 칸에만 있는 경우
    for (const { r, csv } of csvRows) {
      const title = clean(col(r, '이름', 'Name', '제목'));
      if (!title) continue;
      const date = parseDate(col(r, /날짜|일자|date/i) || title, year);
      for (const cell of Object.values(r)) {
        for (const part of String(cell).split(/,\s*/)) {
          const p = resolve(csv, part.trim());
          if (files.has(p) && IMG_RE.test(p) && !taken.has(p)) { taken.add(p); addAlbum(title, date).paths.push(p); }
        }
      }
    }
    // 어느 앨범에도 안 들어간 사진 (명단 페이지의 표 그림 같은 것은 사진 폴더 밖이라 여기 오지 않는다)
    const rest = under(dir, IMG_RE).filter(p => !taken.has(p));
    if (rest.length) { const a = addAlbum('기타 사진', ''); for (const p of rest) a.paths.push(p); }
    for (const a of plan.albums) {
      a.photos = await Promise.all(a.paths.map(async p => ({ name: baseOf(p), blob: new Blob([await bytes(p)], { type: guessImg(p) }) })));
      delete a.paths;
    }
    plan.albums = plan.albums.filter(a => a.photos.length);
  }

  const counts = {
    events: plan.events.length, songs: plan.songs.length, pdfs: plan.songs.reduce((n, s) => n + s.files.length, 0),
    videos: plan.videos.length, members: plan.members.length, albums: plan.albums.length, photos: plan.albums.reduce((n, a) => n + a.photos.length, 0),
  };
  return { plan, report: { pages, warnings, counts } };
}

const guessImg = p => ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' }[p.split('.').pop().toLowerCase()] || '');

// 악보 파일 이름 → 곡 이름 (예: "20260618_주_품에_-_어린이_-_YW_-_Full_Score.pdf" → "주 품에")
export function scoreTitle(name) {
  if (!name) return '';
  let t = String(name);
  try { t = decodeURIComponent(decodeURIComponent(t)); } catch {}
  t = t.replace(/\.pdf$/i, '').replace(/^\d{8}_/, '').replace(/_/g, ' ');
  t = t.replace(/\s*-\s*(Full Score|CM|YW|어린이|G key|반주|멜로디)(?=\s*(-|$|\d))/gi, '').replace(/\s*-?\s*Full Score.*$/i, '').replace(/\s*\d{8}$/, '');
  t = t.replace(/\((합창악보|합창보|쏠티와 함께)\)/g, '').replace(/\s*(단선악보|영문한글)$/g, '').replace(/[-\s]+(한글|일본어)[-\s]*.*$/, '');
  return t.replace(/\s+-\s*$/, '').replace(/\s{2,}/g, ' ').trim();
}
const ytTitle = l => String(l || '').replace(/참고\s*영상|참고영상/g, '').replace(/['‘’"“”]/g, '').replace(/\s+-.*$/, '').trim();
