// 일정 → .ics (내 달력에 추가). 시간이 "15:15~16:20", "11:30", "1시 30분", "3:15~4:20"(오후로 봄) 이면 그 시각, 아니면 하루 종일
const pad = n => String(n).padStart(2, '0');
const escTxt = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// 75바이트 넘는 줄은 접는다 (RFC 5545)
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > 73) { out.push(cur); cur = ' '; bytes = 1; }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

// "15:15~16:20" → [[15,15],[16,20]]
export function parseTimes(s) {
  const t = String(s || '');
  const pm = /오후|저녁|pm/i.test(t);
  const hits = [...t.matchAll(/(\d{1,2})\s*(?::|시\s*)(\d{2})?\s*분?/g)].map(m => [Number(m[1]), Number(m[2] || 0)]).filter(([h, m]) => h <= 24 && m < 60);
  if (!hits.length) return [];
  return hits.slice(0, 2).map(([h, m]) => [h < 7 || (pm && h < 12) ? h + 12 : h, m]);
}

export function eventIcs(events) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//jayangchoir//합창단 일정//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Seoul', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:KST', 'END:STANDARD', 'END:VTIMEZONE'];
  for (const e of events) {
    const d = String(e.date || '').replace(/-/g, '');
    if (!/^\d{8}$/.test(d)) continue;
    const times = parseTimes(e.time);
    L.push('BEGIN:VEVENT', `UID:${e.id}@jayangchoir.github.io`, `DTSTAMP:${stamp}`);
    if (times.length) {
      const [h, m] = times[0];
      const [h2, m2] = times[1] || [h + 1, m];
      L.push(`DTSTART;TZID=Asia/Seoul:${d}T${pad(h)}${pad(m)}00`, `DTEND;TZID=Asia/Seoul:${d}T${pad(Math.min(23, h2))}${pad(m2)}00`);
    } else {
      const end = new Date(`${(e.end || e.date)}T00:00:00`);
      end.setDate(end.getDate() + 1);
      L.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${end.getFullYear()}${pad(end.getMonth() + 1)}${pad(end.getDate())}`);
    }
    L.push(fold(`SUMMARY:${escTxt(`[합창단] ${e.title}`)}`));
    if (e.place) L.push(fold(`LOCATION:${escTxt(`자양교회 ${e.place}`)}`));
    const desc = [e.time && !times.length ? `시간: ${e.time}` : '', e.note].filter(Boolean).join('\n');
    if (desc) L.push(fold(`DESCRIPTION:${escTxt(desc)}`));
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}
