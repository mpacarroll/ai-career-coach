// End-to-end journey through the real page in Chromium.
// Run: npm run test:e2e   (needs Playwright with Chromium installed; no other dependencies)
// Optional: SHOTS=dir node tests/e2e/workspace.e2e.mjs   to save screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { start } from './serve.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules'] }))); }

const SHOTS = process.env.SHOTS;
let server, browser, base;

test.before(async () => {
  server = await start(0);
  base = `http://127.0.0.1:${server.address().port}/workspace/`;
  browser = await chromium.launch();
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
});
test.after(async () => { await browser.close(); server.close(); });

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, ...opts });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.replace(/\/workspace\/$/, '') });
  const page = await ctx.newPage();
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1') && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
  page.on('dialog', d => d.accept());
  return { ctx, page, errors, external };
}

// Type into a field and blur it, which is how the page saves inline edits.
async function editAndBlur(page, locator, text) {
  await locator.fill(text);
  await locator.evaluate(el => el.blur());
}

test('first visit opens on the demo journey', async () => {
  const { ctx, page, errors, external } = await newPage();
  await page.goto(base);
  await assert.doesNotReject(page.getByText('You are looking at a made-up candidate').waitFor());
  const interviewing = page.locator('.col', { hasText: 'Interviewing' });
  assert.match(await interviewing.innerText(), /Tallgrass Software/);
  await shot(page, '01-pipeline-demo');

  await page.goto(`${base}#/role/job_demo_tallgrass/compare`);
  await page.getByRole('heading', { name: /Changed lines/ }).waitFor();
  assert.match(await page.locator('.card', { hasText: 'Removed' }).innerText(), /Certified trainer/);
  await shot(page, '02-compare-demo');
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await ctx.close();
});

test('a new candidate goes from job description to packet, debrief and follow-up', async () => {
  const { ctx, page, errors, external } = await newPage();
  await page.goto(base);
  await page.getByRole('button', { name: 'Clear the demo and start fresh' }).click();
  await page.getByRole('heading', { name: 'Evidence library' }).waitFor();
  assert.equal(await page.locator('#banners .demo').count(), 0);

  // Profile
  await page.goto(`${base}#/data`);
  await page.getByLabel('Name').fill('Avery Test');
  await page.getByRole('button', { name: 'Save profile' }).click();

  // Evidence
  await page.goto(`${base}#/evidence`);
  await page.getByLabel('Title').fill('Front desk lead');
  await page.getByLabel('Organization').fill('Sample Clinic (fictional)');
  await page.getByLabel('What you did, in your own words').fill('Handled patient complaints and escalations, and trained 6 new front desk staff on the scheduling system.');
  await page.getByLabel('Numbers you can stand behind').fill('wait-time complaints down 25%');
  await page.getByRole('button', { name: 'Add to library' }).click();
  await page.locator('article.card').first().waitFor();
  await page.getByLabel('Title').fill('Monthly reporting');
  await page.getByLabel('What you did, in your own words').fill('Built a monthly spreadsheet report on no-show rates for the clinic manager.');
  await page.getByRole('button', { name: 'Add to library' }).click();
  await page.locator('article.card').nth(1).waitFor();
  assert.equal(await page.locator('article.card').count(), 2);

  // Role
  await page.goto(`${base}#/roles`);
  await page.getByLabel('Job title').fill('Customer Support Lead');
  await page.getByLabel('Company').fill('Example Health (fictional)');
  await page.getByLabel('Job description').fill('Lead customer support for clinic clients.\n- Handle escalations with patience.\n- Run training for new agents.\n- Track metrics in a dashboard.\n- Experience with Zendesk or another CRM.');
  await page.getByRole('button', { name: 'Add role' }).click();
  await page.getByRole('heading', { name: 'How your evidence covers this role' }).waitFor();
  const fitText = await page.locator('.card', { hasText: 'How your evidence covers' }).innerText();
  assert.match(fitText, /CRM tools/, 'the CRM gap is named');
  await shot(page, '03-fit');

  // Resume version from evidence
  await page.getByRole('link', { name: 'Resume versions' }).click();
  await page.getByRole('button', { name: 'Start a version from my evidence' }).click();
  await page.getByText('Every line traces').waitFor();

  // Overreach is caught, then fixed
  const line1 = page.locator('.bullet textarea').first();
  await editAndBlur(page, line1, 'Certified trainer who cut complaints 60% and trained 6 new staff.');
  await page.getByText('"60%" is not in the cited evidence.').waitFor();
  await page.getByText('"certified" is a credential claim').waitFor();
  await shot(page, '04-trace-flag');
  await editAndBlur(page, page.locator('.bullet textarea').first(), 'Trained 6 new front desk staff and cut wait-time complaints 25%.');
  await page.getByText('Every line traces').waitFor();

  // A second version, then compare
  await page.getByRole('button', { name: /^Duplicate/ }).click();
  await editAndBlur(page, page.getByLabel('Version name'), 'v2 support focus');
  await editAndBlur(page, page.locator('.bullet textarea').first(), 'Calmed escalations and trained 6 new front desk staff, cutting wait-time complaints 25%.');
  await page.getByRole('link', { name: 'Compare', exact: true }).click();
  await page.getByRole('heading', { name: 'Changed lines (1)' }).waitFor();
  assert.ok(await page.locator('ins').count() > 0);

  // Cover letter
  await page.getByRole('link', { name: 'Cover letter' }).click();
  await page.getByRole('button', { name: 'Draft my letter' }).click();
  await page.getByText('Every claim traces').waitFor();
  const letter = await page.locator('textarea[data-change="letter-para"]').evaluateAll(els => els.map(e => e.value).join('\n'));
  assert.match(letter, /Example Health/);
  assert.match(letter, /Avery Test/);

  // Packet
  await page.getByRole('link', { name: 'Packet' }).click();
  await page.getByText('Ready: every line traces to your evidence').waitFor();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .md' }).click()]);
  const md = await readFile(await dl.path(), 'utf8');
  assert.match(md, /# Application packet: Customer Support Lead/);
  assert.match(md, /\[E1\]/);
  await shot(page, '05-packet');

  // Stage moves
  await page.getByRole('link', { name: 'Overview and fit' }).click();
  await page.getByLabel('Stage').selectOption('interviewing');
  await page.getByLabel('Note', { exact: true }).fill('Panel interview booked');
  await page.getByRole('button', { name: 'Record' }).click();
  await page.getByText('Panel interview booked').waitFor();

  // Interview practice
  await page.getByRole('link', { name: 'Interview practice' }).click();
  await page.getByLabel('Situation').fill('At the clinic front desk we had long waits and patients complained to me every day.');
  await page.getByLabel('Task').fill('I needed to calm people down and get new staff up to speed quickly.');
  await page.getByLabel('Action').fill('I listened, apologized once, and gave each patient a real time estimate. I trained 6 new front desk staff on the scheduling system so check-in moved faster.');
  await page.getByLabel('Result').fill('Wait-time complaints went down 25% and the new staff handled check-in on their own.');
  await page.locator('input[name="evidenceIds"]').first().check();
  await page.getByRole('button', { name: 'Save and check my answer' }).click();
  await page.getByRole('heading', { name: /Coach's checklist/ }).waitFor();
  await shot(page, '06-practice');

  // Debrief and follow-up
  await page.getByText('Add a debrief').click();
  await page.getByLabel('Round').fill('Panel interview');
  await page.getByLabel("Interviewer's first name").fill('Morgan');
  await page.getByLabel('One thing worth mentioning in a thank-you').fill('Your plan to add evening support hours');
  await page.getByRole('button', { name: 'Save debrief' }).click();
  await page.getByRole('link', { name: 'Follow-ups' }).click();
  await page.getByRole('button', { name: 'Draft it' }).click();
  const body = await page.locator('textarea[data-change="fu-body"]').first().inputValue();
  assert.match(body, /Hi Morgan/);
  assert.match(body, /your plan to add evening support hours/);
  await page.getByRole('button', { name: 'Copy subject and message' }).click();
  await page.getByText('Copied, not sent by Job Coach').waitFor();
  await shot(page, '07-followup');

  // Persistence across reload
  await page.reload();
  await page.getByText('Copied, not sent by Job Coach').waitFor();
  await page.goto(`${base}#/pipeline`);
  assert.match(await page.locator('.col', { hasText: 'Interviewing' }).innerText(), /Customer Support Lead/);

  assert.deepEqual(errors, []);
  assert.deepEqual(external, [], 'nothing leaves the device');
  await ctx.close();
});

test('export, damaged storage recovery, and import round trip', async () => {
  const { ctx, page, errors } = await newPage();
  await page.goto(`${base}#/data`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export workspace (.json)' }).click()]);
  const exported = await dl.path();
  assert.equal(JSON.parse(await readFile(exported, 'utf8')).jobs.length, 2);

  await page.evaluate(() => localStorage.setItem('jobcoach.workspace.v1', '{broken'));
  await page.reload();
  await page.getByText('Your saved workspace was damaged').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('jobcoach.workspace.v1.damaged')), '{broken');

  await page.goto(`${base}#/data`);
  await page.locator('input[type=file]').setInputFiles(exported);
  await page.getByText('Workspace imported.').waitFor();
  await page.goto(`${base}#/pipeline`);
  assert.match(await page.locator('.board').innerText(), /Tallgrass Software/);

  // A file that is not a workspace is refused with a plain message.
  await page.goto(`${base}#/data`);
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('[1,2,3]') });
  await page.getByText('This file is not a Job Coach workspace.').waitFor();
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('scope check catches inflated ownership and reach, and marks added words', async () => {
  const { ctx, page, errors, external } = await newPage();
  await page.goto(`${base}#/role/job_demo_tallgrass/resume`);
  await page.getByRole('button', { name: /^v1 first pass/ }).click();
  await page.getByText('"Founded" claims more authorship than the cited evidence').waitFor();
  await page.getByText('"school-wide" claims reach or recognition').waitFor();

  await page.getByRole('button', { name: /^v2 tailored/ }).click();
  await page.getByText('Every line traces').waitFor();
  const first = page.locator('.bullet textarea').first();
  const original = await first.inputValue();
  await editAndBlur(page, first, 'Founded a district-wide onboarding program for a new attendance system, training 30 teachers.');
  await page.getByText('"Founded" claims more authorship than the cited evidence').waitFor();
  await page.getByText('"district-wide" claims reach or recognition').waitFor();
  const marks = await page.locator('.bullet').first().locator('.grounding mark').allInnerTexts();
  assert.ok(marks.includes('founded') && marks.includes('program'), `marked: ${marks.join(', ')}`);
  await shot(page, '09-scope-flag');

  // The packet lists the scope problem under "check before sending".
  await page.goto(`${base}#/role/job_demo_tallgrass/packet`);
  await page.getByText(/thing.* to fix before you send/).waitFor();
  assert.match(await page.locator('main').innerText(), /Founded/);

  // Putting the evidence's own verb back clears it.
  await page.goto(`${base}#/role/job_demo_tallgrass/resume`);
  await editAndBlur(page, page.locator('.bullet textarea').first(), original);
  await page.getByText('Every line traces').waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await ctx.close();
});

test('blocked storage still works for the session and says so', async () => {
  const { ctx, page, errors } = await newPage();
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
  });
  await page.goto(base);
  await page.getByText('This browser is not letting the page save').waitFor();
  assert.match(await page.locator('.board').innerText(), /Tallgrass Software/);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('phone width has no sideways scroll', async () => {
  const { ctx, page } = await newPage({ viewport: { width: 375, height: 800 } });
  for (const r of ['#/pipeline', '#/evidence', '#/role/job_demo_tallgrass/resume', '#/role/job_demo_tallgrass/compare', '#/role/job_demo_tallgrass/packet']) {
    await page.goto(base + r);
    await page.waitForTimeout(100);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 1, `${r} overflows by ${over}px`);
  }
  await shot(page, '08-phone-packet');
  await ctx.close();
});
