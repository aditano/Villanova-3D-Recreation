/**
 * Capture preset views once the campus reports ready.
 *   node scripts/shoot.mjs <baseUrl> <outDir> [view ...]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const base = process.argv[2] || 'http://127.0.0.1:5173/';
const outDir = process.argv[3] || '/tmp/vu-shots';
const views = process.argv.slice(4);
const wanted = views.length ? views : ['aerial', 'church', 'stadium'];
const WIDTH = Number(process.env.SHOT_WIDTH || 1280);
const HEIGHT = Number(process.env.SHOT_HEIGHT || 720);

mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launch(profile) {
  return spawn(
    'google-chrome',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--hide-scrollbars',
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      `--window-size=${WIDTH},${HEIGHT}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
}

async function endpoint(profile) {
  const portFile = `${profile}/DevToolsActivePort`;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    if (!existsSync(portFile)) continue;
    const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
    if (!port) continue;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch {
      /* chrome still booting */
    }
  }
  throw new Error('Chrome never exposed a debugging port');
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function shoot(view) {
  const profile = `/tmp/vu-chrome-${view}-${process.pid}`;
  rmSync(profile, { recursive: true, force: true });
  const proc = launch(profile);
  try {
    const browser = new Cdp(new WebSocket(await endpoint(profile)));
    await new Promise((resolve, reject) => {
      browser.ws.addEventListener('open', resolve, { once: true });
      browser.ws.addEventListener('error', reject, { once: true });
    });
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    // Flattened sessions deliver responses on the browser socket with sessionId.
    const calls = new Map();
    let seq = 0;
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        calls.set(id, { resolve, reject });
        browser.ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    browser.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (!msg.sessionId || !msg.id || !calls.has(msg.id)) return;
      const pending = calls.get(msg.id);
      calls.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error.message));
      else pending.resolve(msg.result);
    });

    await call('Page.enable');
    await call('Runtime.enable');
    await call('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const url = new URL(base);
    url.searchParams.set('view', view);
    await call('Page.navigate', { url: url.toString() });
    const started = Date.now();
    let ready = false;
    let lastNote = '';
    while (Date.now() - started < Number(process.env.SHOT_READY_MS || 90000)) {
      const result = await call('Runtime.evaluate', {
        expression: `({
          ready: document.body && document.body.dataset.ready === "1",
          err: window.__campusError || "",
          boot: window.__boot || "",
          text: (document.querySelector(".eyebrow") || {}).textContent || ""
        })`,
        returnByValue: true,
      });
      const value = result.result?.value;
      lastNote = JSON.stringify(value);
      if (value?.ready) {
        ready = true;
        break;
      }
      if (value?.err) break;
      await sleep(400);
    }
    if (!ready) throw new Error(`${view} never became ready ${lastNote}`);
    await call('Runtime.evaluate', {
      expression: `document.querySelectorAll('.hud-tl,.hud-tr,.hud-nav,.tools,.walk-help,.walk-pad,.loader').forEach((el)=>{el.style.visibility='hidden';});`,
    });
    await sleep(Number(process.env.SHOT_SETTLE_MS || 900));
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    const file = `${outDir}/${view}.png`;
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log(`wrote ${file}`);
  } finally {
    proc.kill('SIGKILL');
    await sleep(300);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* chrome profile can linger */
    }
  }
}

for (const view of wanted) {
  await shoot(view);
}
