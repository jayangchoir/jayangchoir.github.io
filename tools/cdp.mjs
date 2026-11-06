// 개발용: 정적 서버 + 헤드리스 Edge 를 DevTools 프로토콜로 움직인다 (npm 설치 필요 없음, Node 22+).
// run-tests.mjs · shots.mjs 가 쓴다. 사이트는 이 파일을 쓰지 않는다.
import { createServer } from 'node:http';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, extname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.pdf': 'application/pdf',
};

export function serve(root, port = 0) {
  root = resolve(root);
  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      let p = resolve(join(root, decodeURIComponent(u.pathname)));
      if (p !== root && !p.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      if ((await stat(p).catch(() => null))?.isDirectory()) p = join(p, 'index.html');
      const body = await readFile(p);
      res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise(ok => server.listen(port, '127.0.0.1', () => ok({ server, port: server.address().port })));
}

const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];

export async function launch() {
  let exe;
  for (const e of EDGE) if (await stat(e).catch(() => null)) { exe = e; break; }
  if (!exe) throw new Error('Edge 를 찾지 못했어요');
  const dir = await mkdtemp(join(tmpdir(), 'jc-edge-'));
  const proc = spawn(exe, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-features=msEdgeSidebarV2', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  // Edge 는 user-data-dir/DevToolsActivePort 에 포트와 주소를 적는다
  let wsUrl;
  let err = '';
  proc.stderr.on('data', d => { err += d; });
  for (let i = 0; i < 200 && !wsUrl; i++) {
    await new Promise(r => setTimeout(r, 100));
    const t = await readFile(join(dir, 'DevToolsActivePort'), 'utf8').catch(() => '');
    const [port, path] = t.split(/\s+/);
    if (port && path) wsUrl = `ws://127.0.0.1:${port}${path}`;
  }
  if (!wsUrl) throw new Error(`Edge 가 시작되지 않았어요 ${err.slice(0, 500)}`);
  const browser = await connect(wsUrl);
  const close = async () => {
    try { await browser.send('Browser.close'); } catch {}
    proc.kill();
    await new Promise(r => setTimeout(r, 500));
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  };
  return { browser, close };
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const wait = new Map();
  const handlers = new Set();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && wait.has(m.id)) {
      const { ok, bad } = wait.get(m.id);
      wait.delete(m.id);
      if (m.error) bad(new Error(`${m.error.message} ${m.error.data || ''}`)); else ok(m.result);
    } else for (const h of handlers) h(m);
  };
  const ready = new Promise(ok => { ws.onopen = ok; });
  const send = async (method, params = {}, sessionId) => {
    await ready;
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((ok, bad) => wait.set(n, { ok, bad }));
  };
  return { send, on: h => handlers.add(h), off: h => handlers.delete(h) };
}

// 새 탭 하나. 콘솔 오류·예외·CSP 위반을 모은다
export async function newPage(browser, { width = 1280, height = 900, mobile = false } = {}) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => browser.send(m, p, sessionId);
  const problems = [];
  const logs = [];
  browser.on(m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
      logs.push(`[${m.params.type}] ${text}`);
      if (m.params.type === 'error' || m.params.type === 'assert') problems.push(`console.${m.params.type}: ${text}`);
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      problems.push(`exception: ${d.exception?.description || d.text}`);
    } else if (m.method === 'Log.entryAdded') {
      const e = m.params.entry;
      logs.push(`[log ${e.level}/${e.source}] ${e.text}`);
      if (/favicon.ico/.test(e.url || '')) return;
      if (e.level === 'error' || /Content Security Policy|Refused to/i.test(e.text)) problems.push(`log ${e.source}: ${e.text} ${e.url || ''}`);
    }
  });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  const page = {
    send, problems, logs,
    async size(w, h, mob = false) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: mob });
      await send('Emulation.setTouchEmulationEnabled', { enabled: mob });
    },
    async goto(url) {
      await send('Page.navigate', { url });
      await page.waitFor('document.readyState === "complete"', 20000);
    },
    async eval(expr, { awaitPromise = true } = {}) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`eval 실패: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n  ${expr.slice(0, 200)}`);
      return r.result.value;
    },
    async waitFor(expr, timeout = 15000) {
      const t0 = Date.now();
      for (;;) {
        try { if (await page.eval(`!!(${expr})`)) return; } catch {}
        if (Date.now() - t0 > timeout) throw new Error(`기다림 시간 초과: ${expr}`);
        await new Promise(r => setTimeout(r, 100));
      }
    },
    async shot(path, { full = true } = {}) {
      const { writeFile } = await import('node:fs/promises');
      let clip;
      if (full) {
        const m = await send('Page.getLayoutMetrics');
        const c = m.cssContentSize || m.contentSize;
        const vw = m.cssLayoutViewport?.clientWidth || c.width;
        clip = { x: 0, y: 0, width: vw, height: Math.min(c.height, 6000), scale: 1 };
      }
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, ...(clip ? { clip } : {}) });
      await writeFile(path, Buffer.from(r.data, 'base64'));
    },
    async setFiles(selector, files) {
      const { root } = await send('DOM.getDocument', { depth: 1 });
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error(`없음: ${selector}`);
      await send('DOM.setFileInputFiles', { nodeId, files });
    },
    close: () => browser.send('Target.closeTarget', { targetId }),
  };
  await page.size(width, height, mobile);
  return page;
}
