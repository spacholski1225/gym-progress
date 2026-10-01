import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';

// Real API and Git, with disposable data. Never touches the user's workout repository.
const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = resolve(frontend, '..');
const temporary = await mkdtemp(resolve(tmpdir(), 'training-journal-e2e-'));
const git = (...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: temporary, stdio: 'pipe' }).toString().trim();
let server, browser;
let logs = '';
try {
  await writeFile(resolve(temporary, 'plan.json'), await readFile(resolve(project, 'plan.json')));
  await writeFile(resolve(temporary, 'plan-b.json'), await readFile(resolve(project, 'plan-b.json')));
  await writeFile(resolve(temporary, '.gitignore'), '.runtime/\n');
  git('init', '-b', 'main'); git('add', '.'); git('commit', '-m', 'Test plan');
  const socket = createServer();
  await new Promise(done => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  const base = `http://127.0.0.1:${port}`;
  server = spawn(process.env.PYTHON ?? resolve(project, '.venv/bin/python'), ['-m', 'uvicorn', 'training_journal.main:app', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: project, env: { ...process.env, REPO_DIR: temporary, DATA_DIR: 'data' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data; });
  for (let tries = 0; tries < 80; tries++) {
    try { if ((await fetch(`${base}/api/plan`)).ok) break; } catch {}
    if (tries === 79 || server.exitCode !== null) throw Error(`Backend did not start: ${logs}`);
    await new Promise(done => setTimeout(done, 100));
  }
  assert.equal((await fetch(`${base}/`)).status, 200, 'Build the frontend before E2E tests');
  const plan = await (await fetch(`${base}/api/plan`)).json();
  const firstExercise = plan.exercises[0];
  const lastExercise = plan.exercises.at(-1);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const before = new Date(`${today}T12:00:00Z`); before.setUTCDate(before.getUTCDate() - 1);
  const yesterday = before.toISOString().slice(0, 10);
  const previous = { schema_version: 1, date: yesterday, expected_revision: null, exercises: plan.exercises.map((e, i) => ({ ...e,
    sets: Array.from({ length: 3 }, () => ({ value: e.unit === 'sec' ? 45 : i === 0 ? 22.5 : 0, reps: e.unit === 'sec' ? 1 : 8 })),
  })) };
  const seed = await fetch(`${base}/api/workouts/${yesterday}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(previous) });
  assert.equal(seed.status, 200);
  const options = { headless: true };
  if (process.env.CHROME_PATH) options.executablePath = process.env.CHROME_PATH;
  else if (existsSync('/Applications/Google Chrome.app')) options.channel = 'chrome';
  browser = await chromium.launch(options);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let writes = 0; page.on('request', request => { if (request.method() === 'PUT') writes++; });
  await page.goto(base);
  await expect(page.getByRole('button', { name: /Plan klatka/ })).toBeEnabled();
  await page.getByRole('button', { name: /Plan nogi/ }).click();
  await expect(page.locator('.exercise-card')).toHaveCount(plan.exercises.length);
  assert.deepEqual(await page.locator('.exercise-card strong').allTextContents(), plan.exercises.map(e => e.name));
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.getByRole('button', { name: firstExercise.name, exact: false }).click();
  const weight = page.getByRole('textbox', { name: `${firstExercise.name}, seria 1, ${firstExercise.unit}`, exact: true });
  await expect(weight).toHaveValue('22,5');
  await weight.fill('23,5');
  await page.getByRole('textbox', { name: `${firstExercise.name}, seria 2, powtórzenia`, exact: true }).fill('');
  await expect(page.getByRole('status')).toHaveText('Zmiany zapisane na telefonie');
  assert.equal(writes, 0, 'Opening/editing must not save to server');
  await context.setOffline(true);
  await page.reload();
  await expect(weight).toHaveValue('23,5');
  await expect(page.getByRole('textbox', { name: `${firstExercise.name}, seria 2, powtórzenia`, exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Gotowe · wróć do listy' }).click();
  await page.getByRole('button', { name: 'Synchronizuj trening', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Na telefonie · do synchronizacji');
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Synchronizuj trening', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zsynchronizowano', exact: true })).toBeVisible();
  const saved = await (await fetch(`${base}/api/workouts/${today}`)).json();
  assert.equal(saved.exercises[0].sets[0].value, 23.5);
  assert.equal(saved.exercises[0].sets[1].reps, null);

  // Another client writes a new revision while this phone keeps its older draft.
  const external = { schema_version: 1, date: today, exercises: structuredClone(saved.exercises), expected_revision: saved.revision };
  external.exercises[0].sets[0].value = 28;
  assert.equal((await fetch(`${base}/api/workouts/${today}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(external) })).status, 200);
  await page.getByRole('button', { name: firstExercise.name, exact: false }).click();
  await weight.fill('29');
  await page.getByRole('button', { name: 'Gotowe · wróć do listy' }).click();
  await page.getByRole('button', { name: 'Synchronizuj trening', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Zapisz moją wersję na serwerze' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Zsynchronizowano', exact: true })).toBeVisible();
  assert.equal((await (await fetch(`${base}/api/workouts/${today}`)).json()).exercises[0].sets[0].value, 29);
  await mkdir(resolve(frontend, 'test-results'), { recursive: true });
  await page.screenshot({ path: resolve(frontend, 'test-results/trening.png'), fullPage: true });

  await page.getByRole('link', { name: 'Historia', exact: true }).click();
  await expect(page.locator('.history-card')).toHaveCount(2);
  await page.locator('.history-card').last().click();
  await expect(page.getByLabel('Dzień treningu')).toHaveValue(yesterday);
  await page.getByRole('button', { name: lastExercise.name, exact: false }).click();
  await page.getByRole('textbox', { name: `${lastExercise.name}, seria 1, ${lastExercise.unit}`, exact: true }).fill('60');
  await page.screenshot({ path: resolve(frontend, 'test-results/plank.png'), fullPage: true });
  await page.getByRole('button', { name: 'Gotowe · wróć do listy' }).click();
  await page.getByRole('button', { name: 'Synchronizuj trening', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zsynchronizowano', exact: true })).toBeVisible();
  assert.equal((await (await fetch(`${base}/api/workouts/${yesterday}`)).json()).exercises.at(-1).sets[0].value, 60);
  await page.getByRole('link', { name: 'Postępy', exact: true }).click();
  await expect(page.getByRole('button', { name: /Plan klatka/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Plan C/ })).toBeDisabled();
  await page.getByRole('button', { name: /Plan nogi/ }).click();
  await expect(page.locator('.chart-card')).toHaveCount(plan.exercises.length);
  await page.getByRole('button', { name: 'Ostatnie 90 dni' }).click();
  await expect(page.getByRole('button', { name: 'Ostatnie 90 dni' })).toHaveAttribute('aria-pressed', 'true');
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(frontend, 'test-results/postepy.png'), fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('link', { name: 'Trening', exact: true }).click();
  await page.screenshot({ path: resolve(frontend, 'test-results/ciemny.png'), fullPage: true });
  assert.deepEqual(errors, []);
  assert.equal(git('status', '--porcelain'), '');
  console.log('PASS: prefill, local edits, offline reload, explicit sync, nulls, conflicts, history editing, charts, responsive layout, Git isolation.');
} finally {
  if (browser) await browser.close();
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(done => server.once('exit', done));
  }
  await rm(temporary, { recursive: true, force: true });
}
