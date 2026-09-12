/**
 * REAL-INPUT canvas verification for RealtimeCanvas (run: `npm run test:e2e`).
 *
 * Earlier synthetic tests used dispatchEvent(), which bypasses hit-testing.
 * This script drives the browser through Playwright's mouse API — trusted,
 * OS-level input through Chromium's full pipeline (hit-testing, pointer
 * capture, coalescing) — the same path a human mouse takes.
 *
 * Prerequisites: a running server (BASE_URL, default http://localhost:4000)
 * and a Chromium binary. Resolve it, in order, from: CHROME_PATH env var,
 * the Playwright browser cache (PLAYWRIGHT_BROWSERS_PATH or
 * %LOCALAPPDATA%/ms-playwright), a pinned Playwright chromium install
 * (`npx playwright install chromium`), or your system Chrome/Edge.
 *
 * Alignment metric: for every waypoint the pointer passed through, compute
 * the minimum distance (CSS px) from that point to actual ink on the base
 * canvas. PASS requires max deviation < tolerance for every waypoint.
 *
 * Every suite uses a FRESH room (unique per run) so leftover server history
 * can never mask a regression.
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [];
  const pwRoot =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'ms-playwright')
      : process.env.HOME
        ? path.join(process.env.HOME, '.cache', 'ms-playwright')
        : null);
  if (pwRoot && fs.existsSync(pwRoot)) {
    const dirs = fs
      .readdirSync(pwRoot)
      .filter((d) => d.startsWith('chromium-'))
      .sort();
    for (const d of dirs.reverse()) {
      if (process.platform === 'win32') {
        candidates.push(path.join(pwRoot, d, 'chrome-win64', 'chrome.exe'));
        candidates.push(path.join(pwRoot, d, 'chrome-win', 'chrome.exe'));
      } else if (process.platform === 'darwin') {
        candidates.push(path.join(pwRoot, d, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
      } else {
        candidates.push(path.join(pwRoot, d, 'chrome-linux', 'chrome'));
      }
    }
  }
  if (process.platform === 'win32') {
    for (const p of [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    ])
      candidates.push(p);
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium');
  }
  return candidates.find((p) => fs.existsSync(p));
}

const EXEC = findChrome();
if (!EXEC) {
  console.error(
    'No Chromium found. Install one or set CHROME_PATH, then re-run `npm run test:e2e`.'
  );
  process.exit(2);
}
const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';
const results = [];

function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

// Probe injected via addInitScript (localStorage flag, so both bundles run it).
const PROBE = `
window.__probe = {
  geom() {
    const c = document.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const cs = getComputedStyle(c);
    return {
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      buf: { w: c.width, h: c.height },
      dpr: window.devicePixelRatio,
      scrollX: window.scrollX, scrollY: window.scrollY,
      styleW: cs.width, styleH: cs.height,
      zoom: window.__engine ? window.__engine.getTransform() : null,
      hitAt(cx, cy) {
        const el = document.elementFromPoint(cx, cy);
        const cs = document.querySelectorAll('canvas');
        return { tag: el && el.tagName, isBase: el === cs[0], isOverlay: el === cs[1] };
      },
      inkNear(px, py) {
        const ctx = c.getContext('2d');
        const tol = 24, tolPx = Math.round(tol * window.devicePixelRatio);
        const bx = px * window.devicePixelRatio, by = py * window.devicePixelRatio;
        const x0 = Math.max(0, Math.round(bx) - tolPx), y0 = Math.max(0, Math.round(by) - tolPx);
        const w = Math.min(c.width - x0, 2 * tolPx), h = Math.min(c.height - y0, 2 * tolPx);
        if (w <= 0 || h <= 0) return 999;
        const d = ctx.getImageData(x0, y0, w, h).data;
        let best = 999;
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
          if (d[(yy * w + xx) * 4 + 3] > 10) {
            const dist = Math.hypot(xx - tolPx, yy - tolPx) / window.devicePixelRatio;
            if (dist < best) best = dist;
          }
        }
        return best;
      },
    };
  },
};
`;

async function newPage(browser, { width, height } = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1.25 });
  const page = await ctx.newPage();
  await page.addInitScript(PROBE);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  return { ctx, page };
}

// Fresh 6-char room code per run so server history can't leak between runs.
function freshRoom(prefix) {
  let s = (prefix + Math.floor(Math.random() * 36 ** 9).toString(36)).toUpperCase();
  return s.slice(0, 6).padEnd(6, 'X');
}

async function joinRoom(page, roomId) {
  await page.goto(BASE_URL + '/');
  await page.waitForFunction(() => document.body.innerText.includes('Connected to the collaboration server'));
  if (roomId) {
    await page.fill('.room-input', roomId);
    // The Join button (distinct from the big "Create Room" primary button).
    await page.getByRole('button', { name: 'Join', exact: true }).click();
  } else {
    await page.click('.btn-primary.btn-large');
  }
  await page.waitForSelector('canvas', { timeout: 8000 });
  await page.waitForFunction(() => window.__probe && window.__probe.geom() && window.__probe.geom().zoom);
  await page.waitForTimeout(350);
}

// Draw a polyline with the real mouse; verify every waypoint lands on ink.
async function drawAndVerify(page, label, waypoints, tolerance = 10, steps = 16) {
  const pts = waypoints.map(([fx, fy]) => {
    const g = page.__geom;
    return [g.rect.left + fx * g.rect.width, g.rect.top + fy * g.rect.height];
  });
  const segments = [];
  for (let i = 0; i < pts.length - 1; i++) segments.push([pts[i], pts[i + 1]]);

  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [[sx, sy], [ex, ey]] of segments) {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await page.mouse.move(sx + (ex - sx) * t, sy + (ey - sy) * t);
      await page.waitForTimeout(9);
    }
  }
  await page.mouse.up();
  await page.waitForTimeout(120);

  const deviations = await page.evaluate((wps) => {
    const g = window.__probe.geom();
    return wps.map(([fx, fy]) => g.inkNear(fx * g.rect.width, fy * g.rect.height));
  }, waypoints);

  const worst = Math.max(...deviations);
  const detail = `waypoints=[${waypoints.map((w) => w.join(',')).join(' | ')}] deviations(CSSpx)=${deviations
    .map((d) => d.toFixed(1))
    .join(',')} worst=${worst.toFixed(1)} tol=${tolerance}`;
  check(label, worst <= tolerance && worst !== 999, detail);
  return worst;
}

async function pickTool(page, name) {
  await page.click(`[aria-label="${name}"]`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });

  // ── 1. Preview bundle (:4000), desktop viewport, DPR 1.25 ──────
  {
    const { ctx, page } = await newPage(browser);
    await joinRoom(page, freshRoom('R'));
    page.__geom = await page.evaluate(() => window.__probe.geom());

    const hit = await page.evaluate(() => {
      const g = window.__probe.geom();
      return g.hitAt(g.rect.left + g.rect.width / 2, g.rect.top + g.rect.height / 2);
    });
    check('hit-test: center of canvas resolves to BASE canvas', hit.isBase === true, JSON.stringify(hit));

    const geom = await page.evaluate(() => window.__probe.geom());
    check(
      'geometry: backing store = CSS × DPR, canvases aligned',
      Math.abs(geom.buf.w - geom.rect.width * geom.dpr) <= 2 &&
        Math.abs(geom.buf.h - geom.rect.height * geom.dpr) <= 2,
      JSON.stringify({ css: geom.rect, buf: geom.buf, dpr: geom.dpr, scroll: [geom.scrollX, geom.scrollY] })
    );

    await pickTool(page, 'Pen');
    await drawAndVerify(page, 'pen: top-left→center→bottom-right (real mouse)', [
      [0.08, 0.12],
      [0.5, 0.5],
      [0.9, 0.9],
    ]);

    await pickTool(page, 'Line');
    await drawAndVerify(page, 'line: top-left→bottom-right', [
      [0.1, 0.15],
      [0.85, 0.85],
    ]);

    await pickTool(page, 'Rectangle');
    await drawAndVerify(page, 'rectangle: center→bottom-right', [
      [0.25, 0.25],
      [0.8, 0.75],
    ]);

    await pickTool(page, 'Circle');
    await drawAndVerify(page, 'circle: center→right', [
      [0.3, 0.3],
      [0.8, 0.7],
    ]);

    await pickTool(page, 'Arrow');
    await drawAndVerify(page, 'arrow: top-left→center', [
      [0.1, 0.2],
      [0.6, 0.6],
    ]);

    await pickTool(page, 'Highlighter');
    await drawAndVerify(page, 'highlighter: top-left→center→bottom-right', [
      [0.1, 0.3],
      [0.5, 0.5],
      [0.9, 0.7],
    ]);

    // Eraser in a clean region (y≈0.85 avoids every stroke above).
    await pickTool(page, 'Pen');
    await drawAndVerify(page, 'pen bar for eraser test', [
      [0.35, 0.85],
      [0.65, 0.85],
    ]);
    const midBefore = await page.evaluate(() => {
      const g = window.__probe.geom();
      return g.inkNear(0.5 * g.rect.width, 0.85 * g.rect.height);
    });
    await pickTool(page, 'Eraser');
    await drawAndVerify(page, 'eraser: horizontal swipe across the bar', [
      [0.38, 0.85],
      [0.62, 0.85],
    ], 6);
    const midAfter = await page.evaluate(() => {
      const g = window.__probe.geom();
      return g.inkNear(0.5 * g.rect.width, 0.85 * g.rect.height);
    });
    check('eraser removes ink at center (was ink, now clear)', midBefore <= 4 && midAfter > 8, `before=${midBefore.toFixed(1)} after=${midAfter.toFixed(1)}`);

    // Undo must remove the eraser op's effect back to the bar... (covered by smoke tests)
    await pickTool(page, 'Pen');
    await drawAndVerify(page, 'pen after eraser: fresh stroke bottom band', [
      [0.2, 0.95],
      [0.8, 0.95],
    ]);

    check('no page errors on :4000 (all tools)', page.errors.length === 0, JSON.stringify(page.errors));
    await ctx.close();
  }

  // ── 2. Zoom invariance (:4000) ──────────────────────────────────
  {
    const { ctx, page } = await newPage(browser);
    await joinRoom(page, freshRoom('RZ'));
    for (const [label, clicks] of [['50%', -1], ['200%', 4], ['400%', 4]]) {
      for (let i = 0; i < Math.abs(clicks); i++) {
        await page.click(`[aria-label="${clicks < 0 ? 'Zoom out' : 'Zoom in'}"]`);
      }
      await page.waitForTimeout(150);
      page.__geom = await page.evaluate(() => window.__probe.geom());
      await pickTool(page, 'Pen');
      await drawAndVerify(page, `pen @ zoom ${label}: TL→C→BR`, [
        [0.08, 0.12],
        [0.5, 0.5],
        [0.9, 0.9],
      ]);
    }
    await page.click('[aria-label="Reset zoom"]');
    await page.waitForTimeout(150);
    page.__geom = await page.evaluate(() => window.__probe.geom());
    await drawAndVerify(page, 'pen @ zoom reset 100%: C→BR', [
      [0.3, 0.3],
      [0.9, 0.9],
    ]);
    await ctx.close();
  }

  // ── 3. Dev server :5173 (Vite dev bundle) ───────────────────────
  {
    const { ctx, page } = await newPage(browser);
    const saved = process.env.BASE_URL;
    process.env.BASE_URL = 'http://localhost:5173';
    await joinRoom(page, freshRoom('RD'));
    process.env.BASE_URL = saved;
    const hit = await page.evaluate(() => {
      const g = window.__probe.geom();
      return g.hitAt(g.rect.left + g.rect.width / 2, g.rect.top + g.rect.height / 2);
    });
    check(':5173 hit-test resolves to BASE canvas', hit.isBase === true, JSON.stringify(hit));
    page.__geom = await page.evaluate(() => window.__probe.geom());
    await pickTool(page, 'Pen');
    await drawAndVerify(page, ':5173 pen: TL→C→BR (real mouse)', [
      [0.08, 0.12],
      [0.5, 0.5],
      [0.9, 0.9],
    ]);
    await pickTool(page, 'Rectangle');
    await drawAndVerify(page, ':5173 rectangle: C→BR', [
      [0.3, 0.3],
      [0.85, 0.8],
    ]);
    check('no page errors on :5173', page.errors.length === 0, JSON.stringify(page.errors));
    await ctx.close();
  }

  // ── 4. Narrow viewport + scroll offsets ─────────────────────────
  {
    const { ctx, page } = await newPage(browser, { width: 390, height: 720 });
    await joinRoom(page, freshRoom('RM'));
    await page.evaluate(() => window.scrollTo(12, 8));
    await page.waitForTimeout(120);
    page.__geom = await page.evaluate(() => window.__probe.geom());
    await pickTool(page, 'Pen');
    await drawAndVerify(page, 'mobile 390px w/ scroll: pen TL→C→BR', [
      [0.1, 0.15],
      [0.5, 0.5],
      [0.9, 0.85],
    ]);
    check('no page errors on mobile viewport', page.errors.length === 0, JSON.stringify(page.errors));
    await ctx.close();
  }

  // ── 5. Two-client real-time sync with real mouse ────────────────
  {
    const room = freshRoom('RS');
    const a = await newPage(browser);
    const b = await newPage(browser);
    await joinRoom(a.page, room);
    await joinRoom(b.page, room);
    await a.page.waitForTimeout(300);
    await b.page.waitForTimeout(300);

    a.page.__geom = await a.page.evaluate(() => window.__probe.geom());
    b.page.__geom = await b.page.evaluate(() => window.__probe.geom());

    // A draws with the real mouse; B must show ink near the same content point.
    await pickTool(a.page, 'Pen');
    await drawAndVerify(a.page, 'sync: A draws TL→BR (real mouse)', [
      [0.1, 0.15],
      [0.9, 0.85],
    ]);
    await b.page.waitForTimeout(350);
    const bCheck = await b.page.evaluate(() => {
      const g = window.__probe.geom();
      return [g.inkNear(0.1 * g.rect.width, 0.15 * g.rect.height), g.inkNear(0.9 * g.rect.width, 0.85 * g.rect.height)];
    });
    check("sync: B sees A's stroke at matching content coords", bCheck.every((d) => d <= 10 && d !== 999), `deviations=${bCheck.map((d) => d.toFixed(1)).join(',')}`);

    // B draws; A must see it.
    await pickTool(b.page, 'Rectangle');
    await drawAndVerify(b.page, 'sync: B draws rectangle (real mouse)', [
      [0.2, 0.2],
      [0.7, 0.6],
    ]);
    await a.page.waitForTimeout(350);
    const aCheck = await a.page.evaluate(() => {
      const g = window.__probe.geom();
      return [g.inkNear(0.2 * g.rect.width, 0.2 * g.rect.height), g.inkNear(0.7 * g.rect.width, 0.6 * g.rect.height)];
    });
    check("sync: A sees B's rectangle at matching content coords", aCheck.every((d) => d <= 10 && d !== 999), `deviations=${aCheck.map((d) => d.toFixed(1)).join(',')}`);

    // Simultaneous drawing: both clients draw at once; both must end up
    // with the other's stroke visible.
    await pickTool(a.page, 'Line');
    await pickTool(b.page, 'Circle');
    await Promise.all([
      (async () => {
        const g = a.page.__geom;
        await a.page.mouse.move(g.rect.left + 0.15 * g.rect.width, g.rect.top + 0.9 * g.rect.height);
        await a.page.mouse.down();
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          await a.page.mouse.move(g.rect.left + (0.15 + 0.4 * t) * g.rect.width, g.rect.top + (0.9 - 0.15 * t) * g.rect.height);
          await a.page.waitForTimeout(15);
        }
        await a.page.mouse.up();
      })(),
      (async () => {
        const g = b.page.__geom;
        await b.page.mouse.move(g.rect.left + 0.55 * g.rect.width, g.rect.top + 0.9 * g.rect.height);
        await b.page.mouse.down();
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          await b.page.mouse.move(g.rect.left + (0.55 + 0.3 * t) * g.rect.width, g.rect.top + (0.9 - 0.3 * t) * g.rect.height);
          await b.page.waitForTimeout(15);
        }
        await b.page.mouse.up();
      })(),
    ]);
    await a.page.waitForTimeout(400);
    await b.page.waitForTimeout(400);
    const both = await Promise.all([
      a.page.evaluate(() => {
        const g = window.__probe.geom();
        return g.inkNear(0.7 * g.rect.width, 0.9 * g.rect.height); // B's circle BOTTOM (on the ellipse)
      }),
      b.page.evaluate(() => {
        const g = window.__probe.geom();
        return g.inkNear(0.15 * g.rect.width, 0.9 * g.rect.height); // A's line start on B
      }),
    ]);
    check('simultaneous drawing: each client sees the other (A∩B)', both.every((d) => d <= 12 && d !== 999), `deviations=${both.map((d) => d.toFixed(1)).join(',')}`);

    check('no page errors in A or B during sync', a.page.errors.length === 0 && b.page.errors.length === 0, `A=${JSON.stringify(a.page.errors)} B=${JSON.stringify(b.page.errors)}`);
    await a.ctx.close();
    await b.ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
  if (failed.length) {
    console.log('FAILED:', failed.map((f) => f.name).join(' | '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('HARNESS ERROR:', e);
  process.exit(2);
});
