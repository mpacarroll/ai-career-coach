// Unit tests for workspace/core.js. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../workspace/core.js';
import { buildDemoWorkspace } from '../workspace/demo.js';

function memoryStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
}

function smallWs() {
  const ws = c.emptyWorkspace();
  const ev = c.addEvidence(ws, { title: 'Support lead', org: 'Acme (fictional)', text: 'Ran the support ticket queue and trained 4 new agents.', metrics: ['response time down 25%'] });
  const job = c.addJob(ws, { title: 'Support Manager', company: 'Example Co', jd: 'Lead customer support. Run training for new hires. Track metrics in a dashboard.' });
  return { ws, ev, job };
}

test('extractSkills finds whole-word matches and ranks by count', () => {
  const s = c.extractSkills('Onboarding new clients, onboarding docs, and some training. Not "retrained" though.');
  assert.equal(s[0].skill, 'Onboarding');
  assert.equal(s[0].count, 2);
  assert.ok(s.some(x => x.skill === 'Training'));
  assert.equal(c.extractSkills('').length, 0);
});

test('extractRequirements keeps requirement-like lines and tags skills', () => {
  const reqs = c.extractRequirements('About us\n- Lead onboarding for new clinics.\n- You will own renewals.\nWe have a nice office.');
  assert.ok(reqs.find(r => /onboarding/.test(r.text)).skills.includes('Onboarding'));
  assert.ok(reqs.find(r => /renewals/.test(r.text)).skills.includes('Retention'));
});

test('extractNumbers normalizes formats and ignores years', () => {
  const n = c.extractNumbers('Cut costs $1.2M and errors 30 percent across 1,200 orders since 2021.').map(x => x.norm);
  assert.deepEqual(n, ['1200000', '30%', '1200']);
  assert.deepEqual(c.extractNumbers('grew 40%').map(x => x.norm), ['40%']);
});

test('addEvidence and addJob validate required fields', () => {
  const ws = c.emptyWorkspace();
  assert.throws(() => c.addEvidence(ws, { title: '', text: 'x' }), /title/);
  assert.throws(() => c.addEvidence(ws, { title: 'x', text: '' }), /description/);
  assert.throws(() => c.addJob(ws, { title: 'PM', company: '' }), /company/);
  const ev = c.addEvidence(ws, { title: 'A', text: 'B', metrics: 'one; two', skills: 'Training, Sales' });
  assert.deepEqual(ev.metrics, ['one', 'two']);
  assert.deepEqual(ev.skills, ['Training', 'Sales']);
});

test('checkClaim traces numbers that are in the cited evidence', () => {
  const { ws, ev } = smallWs();
  const r = c.checkClaim('Trained 4 new agents and cut response time 25%.', [ev.id], ws);
  assert.equal(r.status, 'traced');
});

test('checkClaim flags invented numbers and credentials', () => {
  const { ws, ev } = smallWs();
  const r = c.checkClaim('Certified trainer who cut response time 60%.', [ev.id], ws);
  assert.equal(r.status, 'unsupported');
  assert.ok(r.issues.some(i => i.kind === 'number' && /60%/.test(i.detail)));
  assert.ok(r.issues.some(i => i.kind === 'credential'));
});

test('checkClaim marks lines with no evidence or deleted evidence as untraced', () => {
  const { ws, ev } = smallWs();
  assert.equal(c.checkClaim('Did a thing.', [], ws).status, 'untraced');
  c.removeEvidence(ws, ev.id);
  const r = c.checkClaim('Trained 4 new agents.', [ev.id], ws);
  assert.equal(r.status, 'untraced');
  assert.ok(r.issues.some(i => i.kind === 'missing-evidence'));
});

test('a credential in evidence makes the same claim traceable', () => {
  const ws = c.emptyWorkspace();
  const ev = c.addEvidence(ws, { kind: 'certification', title: 'Certified Scrum Master', text: 'Earned a certification in Scrum in 2023.' });
  assert.equal(c.checkClaim('Certified Scrum Master.', [ev.id], ws).status, 'traced');
});

test('fitReport computes coverage and gaps from the job description', () => {
  const { ws, job } = smallWs();
  const fit = c.fitReport(ws, job.id);
  assert.ok(fit.rows.find(r => r.skill === 'Training').covered);
  assert.ok(fit.gaps.length >= 1);
  assert.ok(fit.coverage > 0 && fit.coverage < 100);
  assert.equal(c.fitReport(ws, 'nope'), null);
});

test('suggestBullets only uses the user\'s words and cites the source', () => {
  const ws = c.emptyWorkspace();
  const ev = c.addEvidence(ws, { title: 'Ops', text: 'Responsible for supply orders for 45 staff.', metrics: ['errors down to 3 a month'] });
  c.addJob(ws, { id: 'j', title: 'Ops Manager', company: 'X', jd: 'Manage orders and inventory.' });
  const [b] = c.suggestBullets(ws, 'j');
  assert.equal(b.text, 'Ran supply orders for 45 staff.');
  assert.deepEqual(b.evidenceIds, [ev.id]);
  assert.equal(c.checkClaim(b.text, b.evidenceIds, ws).status, 'traced');
});

test('draftBulletFromEvidence appends the user\'s metric when the sentence has no number', () => {
  const b = c.draftBulletFromEvidence({ id: 'e', text: 'Helped with onboarding new hires.', metrics: ['12 hires in a quarter'] });
  assert.equal(b.text, 'Supported onboarding new hires (12 hires in a quarter).');
});

test('resume versions: create, duplicate, edit, trace, remove', () => {
  const { ws, ev, job } = smallWs();
  const v1 = c.createResumeVersion(ws, job.id, { label: 'first' });
  assert.ok(v1.bullets.length >= 1);
  const v2 = c.duplicateResumeVersion(ws, v1.id, 'second');
  assert.equal(v2.basedOn, v1.id);
  c.updateResumeVersion(ws, v2.id, { bullets: [...v2.bullets, { text: 'Grew renewals 90%.', evidenceIds: [ev.id] }, { text: '', evidenceIds: [] }] });
  const tr = c.traceReport(ws, v2.id);
  assert.equal(tr.counts.unsupported, 1);
  assert.equal(tr.clean, false);
  assert.equal(c.findById(ws.resumeVersions, v2.id).bullets.length, v1.bullets.length + 1, 'blank bullets are dropped');
  c.removeResumeVersion(ws, v2.id);
  assert.equal(ws.resumeVersions.length, 1);
});

test('wordDiff marks additions and deletions', () => {
  const d = c.wordDiff('cut errors 30%', 'cut order errors 30%');
  assert.deepEqual(d.filter(x => x.op === 'add').map(x => x.text.trim()), ['order']);
  assert.equal(d.filter(x => x.op === 'del').length, 0);
  assert.equal(d.map(x => (x.op === 'del' ? '' : x.text)).join(''), 'cut order errors 30%');
});

test('compareVersions on the demo pairs edited bullets and lists added and removed', () => {
  const ws = buildDemoWorkspace();
  const [v1, v2] = ws.resumeVersions;
  const cmp = c.compareVersions(ws, v1.id, v2.id);
  assert.equal(cmp.a.trace.unsupported, 1);
  assert.equal(cmp.b.trace.unsupported, 0);
  assert.ok(cmp.removed.some(r => /Certified/.test(r.text) && r.status === 'unsupported'));
  assert.ok(cmp.changed.length >= 2);
  assert.ok(cmp.added.length >= 1);
  assert.ok(cmp.summary.some(x => x.op === 'add'));
});

test('cover letter draft cites evidence and passes the trace check', () => {
  const ws = buildDemoWorkspace();
  const job = ws.jobs[0];
  const v = ws.resumeVersions.filter(x => x.jobId === job.id).slice(-1)[0];
  const draft = c.draftCoverLetter(ws, job.id, v.id);
  assert.ok(draft.paras.filter(p => p.kind === 'proof').every(p => p.evidenceIds.length));
  const letter = c.saveCoverLetter(ws, job.id, v.id, draft.paras);
  assert.ok(c.coverLetterTrace(ws, letter).every(x => x.status === 'traced'));
  assert.match(c.letterText(letter), /Tallgrass Software/);
});

test('cover letter trace flags a number typed into an uncited paragraph', () => {
  const ws = buildDemoWorkspace();
  const letter = ws.coverLetters[0];
  const edited = { ...letter, paras: letter.paras.map(p => (p.kind === 'hook' ? { ...p, text: `${p.text} I have 10 years of experience.` } : p)) };
  const tr = c.coverLetterTrace(ws, edited);
  assert.ok(tr.some(x => x.kind === 'hook' && x.status === 'unsupported'));
});

test('moveStage records history and rejects unknown stages', () => {
  const { ws, job } = smallWs();
  c.moveStage(ws, job.id, 'applied', { date: '2026-11-01', note: 'Sent via site' });
  const j = c.findById(ws.jobs, job.id);
  assert.equal(j.stage, 'applied');
  assert.equal(j.history.length, 2);
  assert.throws(() => c.moveStage(ws, job.id, 'hired'), /Unknown stage/);
  c.moveStage(ws, job.id, 'applied');
  assert.equal(c.findById(ws.jobs, job.id).history.length, 2, 'same stage is a no-op');
});

test('removeJob cascades to its versions, letters, practice, debriefs and follow-ups but keeps evidence', () => {
  const ws = buildDemoWorkspace();
  const id = 'job_demo_tallgrass';
  const evCount = ws.evidence.length;
  c.removeJob(ws, id);
  for (const k of ['resumeVersions', 'coverLetters', 'practice', 'debriefs', 'followUps']) assert.equal(ws[k].filter(x => x.jobId === id).length, 0, k);
  assert.equal(ws.evidence.length, evCount);
});

test('generateQuestions covers strengths, gaps and motivation', () => {
  const ws = buildDemoWorkspace();
  const qs = c.generateQuestions(ws, 'job_demo_tallgrass');
  assert.ok(qs.some(q => q.kind === 'strength'));
  assert.ok(qs.some(q => q.kind === 'gap'));
  assert.ok(qs.some(q => q.kind === 'motivation'));
  assert.equal(new Set(qs.map(q => q.id)).size, qs.length);
});

test('scoreStar passes the demo answer and fails a thin one', () => {
  const ws = buildDemoWorkspace();
  const good = c.scoreStar(ws.practice[0], ws);
  assert.equal(good.passed, good.total);
  const thin = c.scoreStar({ situation: 'x', task: '', action: 'We did it.', result: 'ok', evidenceIds: [] }, ws);
  assert.ok(thin.passed <= 2);
  assert.equal(thin.checks.find(x => x.id === 'ownership').pass, false);
});

test('follow-up drafts are drafts only and use the debrief', () => {
  const ws = buildDemoWorkspace();
  const fu = c.draftFollowUp(ws, 'job_demo_tallgrass', 'thank-you');
  assert.match(fu.body, /Priya/);
  assert.match(fu.body, /your point that most clinic churn/);
  assert.throws(() => c.draftFollowUp(ws, 'job_demo_tallgrass', 'spam'), /Unknown/);
  const saved = c.saveFollowUp(ws, { jobId: 'job_demo_tallgrass', kind: 'status-check', subject: 's', body: 'b', status: 'sent' });
  assert.equal(saved.status, 'draft');
  assert.equal(c.saveFollowUp(ws, { ...saved, copied: true }).status, 'copied');
});

test('buildPacket lists problems first and includes the evidence appendix', () => {
  const ws = buildDemoWorkspace();
  const [v1] = ws.resumeVersions;
  const bad = c.buildPacket(ws, 'job_demo_tallgrass', v1.id);
  assert.ok(bad.problems.some(p => /40%/.test(p)));
  const good = c.buildPacket(ws, 'job_demo_tallgrass');
  assert.equal(good.problems.length, 0);
  assert.match(good.markdown, /## Evidence behind each line/);
  assert.match(good.markdown, /\[E1\]/);
  assert.match(good.markdown, /Nothing in this packet was sent/);
});

test('pipelineSummary suggests next steps', () => {
  const ws = buildDemoWorkspace();
  const s = c.pipelineSummary(ws);
  assert.equal(s.byStage.interviewing.length, 1);
  assert.equal(s.byStage.saved.length, 1);
  assert.ok(s.nextSteps.some(n => /Brightwater/.test(n.text)));
});

test('store: empty, save, load round trip', () => {
  const st = c.createStore(memoryStorage());
  assert.equal(st.load().state, 'empty');
  const ws = buildDemoWorkspace();
  assert.deepEqual(st.save(ws), { ok: true });
  const got = st.load();
  assert.equal(got.state, 'ok');
  assert.equal(got.ws.evidence.length, ws.evidence.length);
  assert.equal(got.ws.resumeVersions.length, 2);
});

test('store: corrupt JSON is set aside and the app starts fresh', () => {
  const mem = memoryStorage({ [c.STORAGE_KEY]: '{not json' });
  const got = c.createStore(mem).load();
  assert.equal(got.state, 'recovered');
  assert.equal(got.ws.jobs.length, 0);
  assert.equal(mem.dump()[`${c.STORAGE_KEY}.damaged`], '{not json');
});

test('store: damaged records are dropped with a warning, the rest survive', () => {
  const ws = buildDemoWorkspace();
  const raw = JSON.parse(c.serialize(ws));
  raw.evidence.push(null, { noId: true });
  const got = c.createStore(memoryStorage({ [c.STORAGE_KEY]: JSON.stringify(raw) })).load();
  assert.equal(got.state, 'recovered');
  assert.equal(got.ws.evidence.length, ws.evidence.length);
  assert.match(got.warnings[0], /Dropped 2 damaged evidence/);
});

test('store: blocked storage and quota errors are reported, not thrown', () => {
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() {} };
  assert.equal(c.createStore(blocked).load().state, 'unavailable');
  assert.equal(c.createStore(null).load().state, 'unavailable');
  const full = { getItem: () => null, setItem() { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }, removeItem() {} };
  const r = c.createStore(full).save(c.emptyWorkspace());
  assert.equal(r.ok, false);
  assert.match(r.error, /out of room/);
});

test('import rejects non-workspaces and newer schemas, accepts exports', () => {
  assert.throws(() => c.importWorkspace('nope'), /not valid JSON/);
  assert.throws(() => c.importWorkspace('[]'), /not a Job Coach workspace/);
  assert.throws(() => c.importWorkspace(JSON.stringify({ schemaVersion: 99 })), /newer version/);
  const ws = buildDemoWorkspace();
  const back = c.importWorkspace(c.exportWorkspace(ws));
  assert.equal(back.ws.jobs.length, 2);
  assert.equal(back.warnings.length, 0);
});

test('demo workspace: v2 is clean, v1 shows the overreach, nothing is sent', () => {
  const ws = buildDemoWorkspace();
  const [v1, v2] = ws.resumeVersions;
  assert.equal(c.traceReport(ws, v1.id).clean, false);
  assert.equal(c.traceReport(ws, v2.id).clean, true);
  assert.ok(ws.followUps.every(f => f.status === 'draft'));
  assert.equal(c.findById(ws.jobs, 'job_demo_tallgrass').stage, 'interviewing');
});

// ---- Review fixes (build/cc-consolidated review of PR #5)

test('a four-digit count is a claim, not a year, unless the words around it say date', () => {
  const { ws, ev } = smallWs();
  assert.equal(c.checkClaim('Supported 2000 customers in the queue.', [ev.id], ws).status, 'unsupported');
  assert.equal(c.checkClaim('Supported 2,000 customers.', [ev.id], ws).status, 'unsupported');
  for (const dated of ['Since 2019, ran the queue.', 'Ran the queue from 2019 to 2022.', 'Ran the queue in March 2021.', 'Ran the queue (2019 to present).']) {
    assert.equal(c.checkClaim(dated, [ev.id], ws).status, 'traced', dated);
  }
  assert.deepEqual(c.extractNumbers('2019 to 2022').map(n => n.norm), []);
});

test('plural credential words are credential claims too', () => {
  const { ws, ev } = smallWs();
  for (const t of ['Earned two certifications.', 'Holds degrees in operations.', 'Licenses in two states.', 'Earned certificates in support.']) {
    const r = c.checkClaim(t, [ev.id], ws);
    assert.equal(r.status, 'unsupported', t);
    assert.ok(r.issues.some(i => i.kind === 'credential'), t);
  }
  const cert = c.addEvidence(ws, { title: 'Support certification', text: 'Passed the support certification exam.' });
  assert.equal(c.checkClaim('Holds two support certifications.', [cert.id], ws).issues.filter(i => i.kind === 'credential').length, 0);
});

test('today() is the local calendar date, not the UTC date', () => {
  const late = new Date(2026, 10, 9, 23, 30); // local 11:30 pm on Nov 9
  assert.equal(c.today(late), '2026-11-09');
});

test('a new version after a delete never reuses a live label', () => {
  const { ws, job } = smallWs();
  const v1 = c.createResumeVersion(ws, job.id);
  const v2 = c.createResumeVersion(ws, job.id);
  c.removeResumeVersion(ws, v1.id);
  const v3 = c.createResumeVersion(ws, job.id);
  assert.notEqual(v3.label, v2.label);
});

test('a damaged import with null and mistyped nested records loads and renders data safely', () => {
  const bad = {
    schemaVersion: 1,
    evidence: [{ id: 'e1', title: 7, text: ['x'], metrics: null }],
    jobs: [{ id: 'j1', title: 'Role', company: 'Co', history: [null, 'x', { stage: 'nope', date: 3 }] }],
    resumeVersions: [{ id: 'r1', jobId: 'j1', bullets: [null, { id: 'b', text: 5, evidenceIds: [1, 'e1'] }] }],
    coverLetters: [{ id: 'c1', jobId: 'j1', paras: [null, { text: null }] }],
    debriefs: [{ id: 'd1', jobId: 'j1', asked: 4 }],
  };
  const { ws } = c.validateWorkspace(bad);
  assert.deepEqual(ws.jobs[0].history, [{ stage: 'saved', date: '3', note: '' }]);
  assert.deepEqual(ws.resumeVersions[0].bullets, [{ id: 'b', text: '5', evidenceIds: ['e1'] }]);
  assert.equal(c.traceReport(ws, 'r1').total, 1);
  assert.equal(c.coverLetterTrace(ws, ws.coverLetters[0]).length, 1);
  assert.ok(c.buildPacket(ws, 'j1').markdown.includes('Role at Co'));
  assert.ok(c.pipelineSummary(ws).nextSteps.length >= 1);
});
