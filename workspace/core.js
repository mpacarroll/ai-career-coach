// Job Coach workspace: core logic.
// Pure functions over a plain JSON workspace object. No DOM, no network, no model calls.
// Runs unchanged in the browser (ES module) and in Node (node --test).
//
// The rule this module enforces: every claim on a resume, cover letter or interview answer
// points at evidence the user wrote. Numbers and credentials that are not in the cited
// evidence are flagged, never silently kept.

export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'jobcoach.workspace.v1';

export const STAGES = [
  { id: 'saved', label: 'Saved' },
  { id: 'tailoring', label: 'Tailoring' },
  { id: 'ready', label: 'Packet ready' },
  { id: 'applied', label: 'Applied' },
  { id: 'screening', label: 'Screening' },
  { id: 'interviewing', label: 'Interviewing' },
  { id: 'offer', label: 'Offer' },
  { id: 'closed', label: 'Closed' },
];
const STAGE_IDS = STAGES.map(s => s.id);

// ---------------------------------------------------------------- ids and time

let counter = 0;
export function uid(prefix) {
  counter = (counter + 1) % 1e6;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}

// The person's local calendar date. toISOString would give the UTC date, which rolls over to
// tomorrow during a US evening.
export function today(now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function clean(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

function cleanBlock(s) {
  return String(s == null ? '' : s).replace(/\r\n?/g, '\n').trim();
}

// ---------------------------------------------------------------- workspace

export function emptyWorkspace() {
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: { name: '', headline: '', location: '', email: '' },
    evidence: [],
    jobs: [],
    resumeVersions: [],
    coverLetters: [],
    practice: [],
    debriefs: [],
    followUps: [],
    updatedAt: null,
  };
}

function touch(ws) {
  ws.updatedAt = new Date().toISOString();
  return ws;
}

export function findById(list, id) {
  return list.find(x => x.id === id) || null;
}

export function setProfile(ws, patch) {
  ws.profile = { ...ws.profile };
  for (const k of ['name', 'headline', 'location', 'email']) {
    if (k in patch) ws.profile[k] = clean(patch[k]);
  }
  return touch(ws);
}

// ---------------------------------------------------------------- skill lexicon

// Canonical skill -> phrases that signal it. Matching is whole-word and case-insensitive.
// Deliberately plain-language: the people using this are not all in tech.
export const SKILL_LEXICON = {
  'Customer success': ['customer success', 'client success', 'account health', 'customer health'],
  'Customer support': ['customer support', 'customer service', 'support tickets', 'help desk', 'helpdesk', 'ticket queue', 'escalations', 'escalation'],
  'Onboarding': ['onboarding', 'onboard', 'onboarded', 'implementation', 'go-live'],
  'Retention': ['retention', 'renewal', 'renewals', 'churn', 'renew'],
  'Relationship management': ['relationship', 'relationships', 'stakeholder', 'stakeholders', 'account management', 'accounts'],
  'Training': ['training', 'trained', 'train', 'workshops', 'workshop', 'coaching', 'coached', 'teach', 'taught', 'teaching', 'instruction'],
  'Process improvement': ['process improvement', 'streamlined', 'streamline', 'redesigned', 'workflow', 'workflows', 'efficiency', 'standardized', 'process'],
  'Operations': ['operations', 'logistics', 'scheduling', 'schedule', 'inventory', 'orders', 'order', 'fulfillment', 'dispatch'],
  'Data analysis': ['data analysis', 'analyze', 'analyzed', 'analysis', 'metrics', 'reporting', 'dashboard', 'dashboards', 'spreadsheet', 'spreadsheets', 'excel', 'sql', 'kpi', 'kpis'],
  'Project management': ['project management', 'project plan', 'projects', 'project', 'timeline', 'timelines', 'deadlines', 'milestones', 'coordinated', 'coordinate', 'coordination'],
  'Team leadership': ['led', 'lead', 'leadership', 'managed a team', 'supervised', 'supervise', 'mentored', 'mentor', 'team of', 'hired'],
  'Communication': ['communication', 'communicate', 'presented', 'presentations', 'presentation', 'writing', 'wrote', 'written', 'newsletter', 'documentation'],
  'Cross-functional collaboration': ['cross-functional', 'collaborated', 'collaborate', 'collaboration', 'partnered', 'partner with', 'product team', 'engineering'],
  'Problem solving': ['problem solving', 'troubleshoot', 'troubleshooting', 'resolved', 'resolve', 'root cause', 'diagnosed'],
  'CRM tools': ['crm', 'salesforce', 'hubspot', 'zendesk', 'ticketing system'],
  'Budgeting': ['budget', 'budgets', 'budgeting', 'cost', 'costs', 'spend', 'savings'],
  'Sales': ['sales', 'upsell', 'upsells', 'expansion', 'quota', 'pipeline', 'prospects'],
  'Curriculum design': ['curriculum', 'lesson plans', 'lesson plan', 'course design', 'learning materials'],
  'Conflict resolution': ['de-escalate', 'de-escalated', 'conflict', 'upset customers', 'difficult conversations', 'complaints', 'complaint'],
  'Compliance': ['compliance', 'regulations', 'regulatory', 'audit', 'audits', 'policy', 'policies', 'safety'],
};

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LEXICON_RES = Object.entries(SKILL_LEXICON).map(([skill, phrases]) => ({
  skill,
  re: new RegExp(`(^|[^a-z0-9])(${phrases.map(escapeRe).sort((a, b) => b.length - a.length).join('|')})(?=$|[^a-z0-9])`, 'gi'),
}));

// Returns [{ skill, count }] sorted by count desc, then name.
export function extractSkills(text) {
  const t = String(text || '');
  const out = [];
  for (const { skill, re } of LEXICON_RES) {
    re.lastIndex = 0;
    const hits = t.match(re);
    if (hits && hits.length) out.push({ skill, count: hits.length });
  }
  return out.sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill));
}

const REQ_CUES = /\b(you will|you'll|you have|you bring|experience|ability|able to|responsib|require|must|should|proficien|familiar|comfortable|skills?|knowledge|own|manage|lead|partner|build|drive|track|support)\b/i;

// Splits a job description into requirement lines, each tagged with the skills it signals.
export function extractRequirements(jdText) {
  const lines = cleanBlock(jdText)
    .split(/\n+|(?<=[.;])\s+(?=[A-Z])/)
    .map(l => l.replace(/^[\s\-*•\d.)]+/, '').trim())
    .filter(l => l.length >= 12);
  const reqs = [];
  for (const line of lines) {
    const skills = extractSkills(line).map(s => s.skill);
    if (skills.length || REQ_CUES.test(line)) reqs.push({ text: line, skills });
  }
  return reqs;
}

// ---------------------------------------------------------------- evidence library

export function evidenceSkills(ev) {
  const fromText = extractSkills(`${ev.title} ${ev.text} ${(ev.metrics || []).join(' ')}`).map(s => s.skill);
  const tagged = (ev.skills || []).filter(Boolean);
  return [...new Set([...tagged, ...fromText])];
}

export function addEvidence(ws, input) {
  const ev = normalizeEvidence({ ...input, id: input.id || uid('ev') });
  if (!ev.title) throw new Error('Evidence needs a short title.');
  if (!ev.text) throw new Error('Evidence needs a description of what you did.');
  ws.evidence = [...ws.evidence, ev];
  touch(ws);
  return ev;
}

export function updateEvidence(ws, id, patch) {
  const cur = findById(ws.evidence, id);
  if (!cur) throw new Error('That evidence item no longer exists.');
  const next = normalizeEvidence({ ...cur, ...patch, id });
  if (!next.title || !next.text) throw new Error('Evidence needs a title and a description.');
  ws.evidence = ws.evidence.map(e => (e.id === id ? next : e));
  touch(ws);
  return next;
}

// Removing evidence never deletes the claims that cited it. Those claims become untraced
// and the trace report says so, which is the honest outcome.
export function removeEvidence(ws, id) {
  ws.evidence = ws.evidence.filter(e => e.id !== id);
  return touch(ws);
}

function normalizeEvidence(e) {
  return {
    id: e.id,
    kind: ['role', 'project', 'education', 'certification', 'volunteer', 'other'].includes(e.kind) ? e.kind : 'role',
    title: clean(e.title),
    org: clean(e.org),
    start: clean(e.start),
    end: clean(e.end),
    text: cleanBlock(e.text),
    metrics: (Array.isArray(e.metrics) ? e.metrics : String(e.metrics || '').split(/;|\n/)).map(clean).filter(Boolean),
    skills: (Array.isArray(e.skills) ? e.skills : String(e.skills || '').split(/,|;/)).map(clean).filter(Boolean),
  };
}

// Words that assert a credential. If one appears in a claim, the cited evidence must hold it too.
export const CREDENTIAL_TERMS = [
  'certified', 'certification', 'certificate', 'licensed', 'license', 'degree', 'bachelor', "bachelor's",
  'master', "master's", 'mba', 'phd', 'doctorate', 'accredited', 'credential', 'diploma', 'pmp', 'cpa',
];
// Plurals count too: "two certifications" asserts a credential as much as "certified" does.
const CRED_RE = new RegExp(`\\b(${CREDENTIAL_TERMS.map(escapeRe).join('|')})(?:s|es)?\\b`, 'gi');

// The credential words a text asserts, reduced to their singular form.
function credentialStems(text) {
  return [...new Set((String(text || '').match(CRED_RE) || []).map(credStem))];
}

function credStem(w) {
  const l = w.toLowerCase();
  if (CREDENTIAL_TERMS.includes(l)) return l;
  for (const suf of ['es', 's']) {
    const base = l.slice(0, -suf.length);
    if (l.endsWith(suf) && CREDENTIAL_TERMS.includes(base)) return base;
  }
  return l;
}

// Pulls quantities out of text: 30%, $1.2M, 1,200, 8, 12 weeks. A plain four-digit year is
// skipped only when the words around it mark it as a date ("since 2019", "2019 to 2022",
// "March 2021"). Without that context it is a count, so "served 2000 customers" is checked.
const DATE_BEFORE = /(?:\b(?:in|since|from|to|until|till|through|by|during|of|circa|early|late|mid|spring|summer|fall|autumn|winter|q[1-4]|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)|[-\u2013\/'(])\s*$/i;
const DATE_AFTER = /^\s*(?:[-\u2013\/):]|(?:to|through|until|till|and)\s+(?:19|20)\d\d\b|(?:to|until)\s+(?:present|now|today)\b)/i;

export function extractNumbers(text) {
  const t = String(text || '');
  const re = /\$?\d[\d,]*(?:\.\d+)?\s?(?:%|percent|k\b|m\b|million\b|thousand\b)?/gi;
  const out = [];
  let m;
  while ((m = re.exec(t))) {
    const raw = m[0].trim().replace(/,+$/, '');
    const norm = normalizeNumber(raw);
    if (!norm) continue;
    if (/^(19|20)\d\d$/.test(raw)) {
      const before = t.slice(Math.max(0, m.index - 24), m.index);
      const after = t.slice(m.index + raw.length, m.index + raw.length + 24);
      if (DATE_BEFORE.test(before) || DATE_AFTER.test(after)) continue;
    }
    out.push({ raw, norm });
  }
  return out;
}

function normalizeNumber(raw) {
  let s = raw.toLowerCase().replace(/\s+/g, '').replace(/,/g, '').replace(/^\$/, '');
  s = s.replace(/percent$/, '%');
  let mult = 1;
  if (/million$|m$/.test(s)) { mult = 1e6; s = s.replace(/million$|m$/, ''); }
  else if (/thousand$|k$/.test(s)) { mult = 1e3; s = s.replace(/thousand$|k$/, ''); }
  const pct = s.endsWith('%');
  if (pct) s = s.slice(0, -1);
  const n = Number(s);
  if (!Number.isFinite(n)) return '';
  const v = Math.round(n * mult * 1000) / 1000;
  return pct ? `${v}%` : String(v);
}

function evidenceCorpus(items) {
  return items.map(e => `${e.title} ${e.org} ${e.start} ${e.end} ${e.text} ${(e.metrics || []).join(' ')}`).join(' \n ');
}

// Checks one claim against the evidence it cites.
// status: 'traced' (all good), 'unsupported' (cites evidence, but a number or credential is not in it),
//         'untraced' (cites nothing, or cites evidence that has been deleted).
export function checkClaim(claimText, evidenceIds, ws) {
  const ids = (evidenceIds || []).filter(Boolean);
  const cited = ids.map(id => findById(ws.evidence, id)).filter(Boolean);
  const missing = ids.filter(id => !findById(ws.evidence, id));
  const issues = [];
  if (!ids.length) issues.push({ kind: 'no-evidence', detail: 'This line does not cite any evidence.' });
  if (missing.length) issues.push({ kind: 'missing-evidence', detail: `Cites ${missing.length} evidence item${missing.length > 1 ? 's' : ''} that no longer exist${missing.length > 1 ? '' : 's'}.` });
  if (!cited.length) return { status: 'untraced', issues, cited: [] };

  const corpus = evidenceCorpus(cited);
  const have = new Set(extractNumbers(corpus).map(n => n.norm));
  for (const n of extractNumbers(claimText)) {
    if (!have.has(n.norm)) issues.push({ kind: 'number', detail: `"${n.raw}" is not in the cited evidence.` });
  }
  const have2 = new Set(credentialStems(corpus));
  for (const c of credentialStems(claimText)) {
    if (!have2.has(c)) issues.push({ kind: 'credential', detail: `"${c}" is a credential claim that the cited evidence does not mention.` });
  }
  return { status: issues.length ? 'unsupported' : 'traced', issues, cited: cited.map(e => e.id) };
}

// ---------------------------------------------------------------- jobs and fit

export function addJob(ws, input) {
  const job = {
    id: input.id || uid('job'),
    title: clean(input.title),
    company: clean(input.company),
    location: clean(input.location),
    source: clean(input.source),
    jd: cleanBlock(input.jd),
    notes: cleanBlock(input.notes),
    contact: clean(input.contact),
    stage: STAGE_IDS.includes(input.stage) ? input.stage : 'saved',
    history: [],
    createdAt: input.createdAt || today(),
  };
  if (!job.title) throw new Error('A target role needs a job title.');
  if (!job.company) throw new Error('A target role needs a company name.');
  job.history.push({ stage: job.stage, date: job.createdAt, note: 'Added to the workspace' });
  ws.jobs = [...ws.jobs, job];
  touch(ws);
  return job;
}

export function updateJob(ws, id, patch) {
  const cur = findById(ws.jobs, id);
  if (!cur) throw new Error('That role no longer exists.');
  const next = { ...cur };
  for (const k of ['title', 'company', 'location', 'source', 'contact']) if (k in patch) next[k] = clean(patch[k]);
  for (const k of ['jd', 'notes']) if (k in patch) next[k] = cleanBlock(patch[k]);
  if (!next.title || !next.company) throw new Error('A target role needs a title and a company.');
  ws.jobs = ws.jobs.map(j => (j.id === id ? next : j));
  touch(ws);
  return next;
}

// Removes a role and everything hanging off it. Evidence is kept: it belongs to the person, not the role.
export function removeJob(ws, id) {
  const versionIds = new Set(ws.resumeVersions.filter(v => v.jobId === id).map(v => v.id));
  ws.jobs = ws.jobs.filter(j => j.id !== id);
  ws.resumeVersions = ws.resumeVersions.filter(v => v.jobId !== id);
  ws.coverLetters = ws.coverLetters.filter(c => c.jobId !== id && !versionIds.has(c.versionId));
  ws.practice = ws.practice.filter(p => p.jobId !== id);
  ws.debriefs = ws.debriefs.filter(d => d.jobId !== id);
  ws.followUps = ws.followUps.filter(f => f.jobId !== id);
  return touch(ws);
}

export function moveStage(ws, jobId, stage, { date, note } = {}) {
  if (!STAGE_IDS.includes(stage)) throw new Error(`Unknown stage "${stage}".`);
  const job = findById(ws.jobs, jobId);
  if (!job) throw new Error('That role no longer exists.');
  if (job.stage === stage) return job;
  const next = { ...job, stage, history: [...job.history, { stage, date: date || today(), note: clean(note) }] };
  ws.jobs = ws.jobs.map(j => (j.id === jobId ? next : j));
  touch(ws);
  return next;
}

export function stageLabel(id) {
  const s = STAGES.find(x => x.id === id);
  return s ? s.label : id;
}

// Maps each skill the job asks for to the evidence that supports it.
export function fitReport(ws, jobId) {
  const job = findById(ws.jobs, jobId);
  if (!job) return null;
  const wanted = extractSkills(`${job.title}\n${job.jd}`);
  const evSkills = ws.evidence.map(e => ({ ev: e, skills: evidenceSkills(e) }));
  const rows = wanted.map(({ skill, count }) => {
    const support = evSkills.filter(x => x.skills.includes(skill)).map(x => x.ev.id);
    return { skill, weight: count, evidence: support, covered: support.length > 0 };
  });
  const total = rows.reduce((a, r) => a + r.weight, 0);
  const covered = rows.filter(r => r.covered).reduce((a, r) => a + r.weight, 0);
  return {
    jobId,
    rows,
    coverage: total ? Math.round((covered / total) * 100) : 0,
    gaps: rows.filter(r => !r.covered).map(r => r.skill),
    requirements: extractRequirements(job.jd),
  };
}

// Ranks evidence for a job by weighted skill overlap. Ties go to the item listed first.
export function rankEvidence(ws, jobId) {
  const fit = fitReport(ws, jobId);
  if (!fit) return [];
  const weight = Object.fromEntries(fit.rows.map(r => [r.skill, r.weight]));
  return ws.evidence
    .map((ev, i) => {
      const skills = evidenceSkills(ev).filter(s => weight[s]);
      return { ev, i, skills, score: skills.reduce((a, s) => a + weight[s], 0) };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ ev, skills, score }) => ({ evidenceId: ev.id, skills, score }));
}

// ---------------------------------------------------------------- resume versions

const WEAK_OPENERS = /^(i\s+)?(was\s+)?(responsible for|in charge of|helped( with)?|assisted( with)?|worked on|tasked with|duties included)\s+/i;

// Turns one evidence item into a draft bullet using only the words the user wrote.
// No new facts: it trims weak openers, keeps the first sentence, and appends the user's own
// metric when the sentence does not already carry a number.
const OPENER_SWAPS = [
  [/^(i\s+)?(was\s+)?(responsible for|in charge of|tasked with|duties included)\s+/i, 'Ran '],
  [/^(i\s+)?(helped( with)?|assisted( with)?)\s+/i, 'Supported '],
];

export function draftBulletFromEvidence(ev) {
  const sentences = ev.text.split(/(?<=[.!?])\s+/).map(x => x.replace(/[.!?]+$/, '')).filter(Boolean);
  // Prefer the user's own strongest sentence: the first one that does not open weakly.
  let line = sentences.find(x => !WEAK_OPENERS.test(x)) || sentences[0] || ev.text;
  for (const [re, verb] of OPENER_SWAPS) if (re.test(line)) { line = line.replace(re, verb); break; }
  line = line.charAt(0).toUpperCase() + line.slice(1);
  if (!extractNumbers(line).length && ev.metrics && ev.metrics.length) line += ` (${ev.metrics[0]})`;
  return { text: `${line}.`, evidenceIds: [ev.id] };
}

export function suggestBullets(ws, jobId, limit = 6) {
  return rankEvidence(ws, jobId)
    .slice(0, limit)
    .map(r => ({ ...draftBulletFromEvidence(findById(ws.evidence, r.evidenceId)), skills: r.skills }));
}

export function createResumeVersion(ws, jobId, { label, summary, bullets, basedOn } = {}) {
  const job = findById(ws.jobs, jobId);
  if (!job) throw new Error('Pick a role before making a resume version.');
  // Next free "vN" for this role, so deleting v1 and adding another never yields two v2s.
  const taken = new Set(ws.resumeVersions.filter(v => v.jobId === jobId).map(v => v.label));
  let n = ws.resumeVersions.filter(v => v.jobId === jobId).length + 1;
  while (taken.has(`v${n}`)) n++;
  const v = {
    id: uid('rv'),
    jobId,
    label: clean(label) || `v${n}`,
    summary: cleanBlock(summary),
    bullets: (bullets || suggestBullets(ws, jobId)).map(b => ({ id: uid('b'), text: clean(b.text), evidenceIds: [...(b.evidenceIds || [])] })),
    basedOn: basedOn || null,
    createdAt: new Date().toISOString(),
  };
  ws.resumeVersions = [...ws.resumeVersions, v];
  touch(ws);
  return v;
}

export function duplicateResumeVersion(ws, versionId, label) {
  const src = findById(ws.resumeVersions, versionId);
  if (!src) throw new Error('That resume version no longer exists.');
  return createResumeVersion(ws, src.jobId, { label, summary: src.summary, bullets: src.bullets, basedOn: src.id });
}

export function updateResumeVersion(ws, versionId, patch) {
  const cur = findById(ws.resumeVersions, versionId);
  if (!cur) throw new Error('That resume version no longer exists.');
  const next = { ...cur };
  if ('label' in patch) next.label = clean(patch.label) || cur.label;
  if ('summary' in patch) next.summary = cleanBlock(patch.summary);
  if ('bullets' in patch) next.bullets = patch.bullets.map(b => ({ id: b.id || uid('b'), text: clean(b.text), evidenceIds: [...(b.evidenceIds || [])] })).filter(b => b.text);
  ws.resumeVersions = ws.resumeVersions.map(v => (v.id === versionId ? next : v));
  touch(ws);
  return next;
}

export function removeResumeVersion(ws, versionId) {
  ws.resumeVersions = ws.resumeVersions.filter(v => v.id !== versionId);
  ws.coverLetters = ws.coverLetters.filter(c => c.versionId !== versionId);
  return touch(ws);
}

// Every line of a version, checked. The summary is checked against all evidence the bullets cite.
export function traceReport(ws, versionId) {
  const v = findById(ws.resumeVersions, versionId);
  if (!v) return null;
  const lines = v.bullets.map(b => ({ bulletId: b.id, text: b.text, ...checkClaim(b.text, b.evidenceIds, ws) }));
  const allIds = [...new Set(v.bullets.flatMap(b => b.evidenceIds))];
  const summary = v.summary ? { text: v.summary, ...checkClaim(v.summary, allIds, ws) } : null;
  const counts = { traced: 0, unsupported: 0, untraced: 0 };
  for (const l of lines) counts[l.status]++;
  if (summary) counts[summary.status]++;
  const total = lines.length + (summary ? 1 : 0);
  return { versionId, lines, summary, counts, total, clean: counts.unsupported === 0 && counts.untraced === 0 };
}

// Word-level diff (LCS) on words only, so whitespace never pairs unrelated words.
// Returns [{ op: 'same'|'add'|'del', text }]; each text carries its own spacing.
export function wordDiff(a, b) {
  const A = String(a || '').split(/\s+/).filter(Boolean);
  const B = String(b || '').split(/\s+/).filter(Boolean);
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  const push = (op, word) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += ` ${word}`;
    else { if (last) last.text += ' '; out.push({ op, text: word }); }
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push('same', A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', A[i]); i++; }
    else { push('add', B[j]); j++; }
  }
  while (i < n) push('del', A[i++]);
  while (j < m) push('add', B[j++]);
  return out;
}

function similarity(a, b) {
  const ta = new Set(String(a).toLowerCase().match(/[a-z0-9%$]+/g) || []);
  const tb = new Set(String(b).toLowerCase().match(/[a-z0-9%$]+/g) || []);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

// Compares two resume versions bullet by bullet. A bullet carried across (same id from a
// duplicate, or similar wording, or the same evidence) is "changed"; the rest are added or removed.
export function compareVersions(ws, aId, bId) {
  const A = findById(ws.resumeVersions, aId);
  const B = findById(ws.resumeVersions, bId);
  if (!A || !B) return null;
  const usedB = new Set();
  const pairs = [];
  const removed = [];
  for (const a of A.bullets) {
    let best = null, bestScore = 0;
    for (const b of B.bullets) {
      if (usedB.has(b.id)) continue;
      const sameEv = a.evidenceIds.length && a.evidenceIds.some(id => b.evidenceIds.includes(id));
      const score = similarity(a.text, b.text) + (sameEv ? 0.35 : 0);
      if (score > bestScore) { best = b; bestScore = score; }
    }
    if (best && bestScore >= 0.4) { usedB.add(best.id); pairs.push({ a, b: best }); }
    else removed.push(a);
  }
  const added = B.bullets.filter(b => !usedB.has(b.id));
  const trA = traceReport(ws, aId), trB = traceReport(ws, bId);
  const statusOf = (tr, id) => (tr.lines.find(l => l.bulletId === id) || {}).status;
  return {
    a: { id: A.id, label: A.label, trace: trA.counts },
    b: { id: B.id, label: B.label, trace: trB.counts },
    summary: A.summary === B.summary ? null : wordDiff(A.summary, B.summary),
    unchanged: pairs.filter(p => p.a.text === p.b.text).map(p => ({ text: p.b.text, status: statusOf(trB, p.b.id) })),
    changed: pairs.filter(p => p.a.text !== p.b.text).map(p => ({
      from: p.a.text, to: p.b.text, diff: wordDiff(p.a.text, p.b.text),
      statusFrom: statusOf(trA, p.a.id), statusTo: statusOf(trB, p.b.id),
    })),
    added: added.map(b => ({ text: b.text, status: statusOf(trB, b.id) })),
    removed: removed.map(b => ({ text: b.text, status: statusOf(trA, b.id) })),
  };
}

// ---------------------------------------------------------------- cover letters

// A deterministic draft built only from the user's evidence. Each proof sentence carries the
// evidence it came from, so the same trace check applies.
export function draftCoverLetter(ws, jobId, versionId) {
  const job = findById(ws.jobs, jobId);
  if (!job) throw new Error('Pick a role first.');
  const v = versionId ? findById(ws.resumeVersions, versionId) : null;
  const fit = fitReport(ws, jobId);
  const name = ws.profile.name || '[Your name]';
  const top = fit.rows.filter(r => r.covered).slice(0, 3).map(r => r.skill.toLowerCase());
  let proofs;
  if (v && v.bullets.length) proofs = v.bullets.slice(0, 3).map(b => ({ text: b.text, evidenceIds: b.evidenceIds }));
  else proofs = suggestBullets(ws, jobId, 3).map(b => ({ text: b.text, evidenceIds: b.evidenceIds }));
  const paras = [
    { text: `Dear hiring team at ${job.company},`, evidenceIds: [], kind: 'greeting' },
    { text: `I am applying for the ${job.title} role. ${top.length ? `The work you describe leans on ${listJoin(top)}, and that is the work I have been doing.` : 'The work you describe is close to the work I have been doing.'} [Add one specific reason this company, in your own words.]`, evidenceIds: [], kind: 'hook' },
    ...proofs.map((p, i) => ({ text: proofSentence(p.text, i, p.evidenceIds, ws), evidenceIds: p.evidenceIds, kind: 'proof' })),
    { text: fit.gaps.length ? `I would be newer to ${listJoin(fit.gaps.slice(0, 2).map(softLower))}, and I would ask early who on the team I can learn ${fit.gaps.length > 1 ? 'them' : 'it'} from.` : 'I would welcome a conversation about where I can help first.', evidenceIds: [], kind: 'gap' },
    { text: `Thank you for reading. I would be glad to talk about the role.\n\n${name}`, evidenceIds: [], kind: 'close' },
  ];
  return { paras };
}

// Lowercases a skill name for use mid-sentence, keeping acronyms such as CRM.
function softLower(s) {
  return s.split(' ').map(w => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');
}

function proofSentence(t, i, evidenceIds, ws) {
  const verbPhrase = `${t.charAt(0).toLowerCase()}${t.slice(1)}`;
  const ev = findById(ws.evidence, (evidenceIds || [])[0]);
  const org = ev && ev.org ? ev.org.replace(/\s*\([^)]*\)\s*/g, ' ').trim() : '';
  if (i === 0) return org ? `At ${org}, I ${verbPhrase}` : `In my current work, I ${verbPhrase}`;
  if (i === 1) return `I also ${verbPhrase}`;
  return `Beyond that, I ${verbPhrase}`;
}

function listJoin(xs) {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

export function saveCoverLetter(ws, jobId, versionId, paras, existingId) {
  const letter = { id: existingId || uid('cl'), jobId, versionId: versionId || null, paras: paras.map(p => ({ text: cleanBlock(p.text), evidenceIds: [...(p.evidenceIds || [])], kind: p.kind || 'proof' })), updatedAt: new Date().toISOString() };
  ws.coverLetters = existingId ? ws.coverLetters.map(c => (c.id === existingId ? letter : c)) : [...ws.coverLetters, letter];
  touch(ws);
  return letter;
}

// Only the proof paragraphs make factual claims; greeting, hook, gap and close are checked for
// numbers and credentials, which they should never contain.
export function coverLetterTrace(ws, letter) {
  return letter.paras.map(p => {
    if (p.kind === 'proof' || p.evidenceIds.length) return { ...checkClaim(p.text, p.evidenceIds, ws), kind: p.kind };
    const issues = [];
    for (const n of extractNumbers(p.text)) issues.push({ kind: 'number', detail: `"${n.raw}" has no evidence behind it.` });
    for (const c of credentialStems(p.text)) issues.push({ kind: 'credential', detail: `"${c}" has no evidence behind it.` });
    return { status: issues.length ? 'unsupported' : 'traced', issues, cited: [], kind: p.kind };
  });
}

export function letterText(letter) {
  return letter.paras.map(p => p.text).join('\n\n');
}

// ---------------------------------------------------------------- interview practice

const QUESTION_BANK = {
  'Customer success': 'Tell me about a customer who was at risk of leaving. What did you do?',
  'Customer support': 'Walk me through how you handled your toughest support case.',
  'Onboarding': 'Describe a time you got someone new up and running quickly.',
  'Retention': 'Tell me about a time you kept a customer or client who was about to leave.',
  'Relationship management': 'Tell me about a working relationship you rebuilt after it went wrong.',
  'Training': 'Tell me about a time you taught someone a skill they were struggling with.',
  'Process improvement': 'Tell me about a process you made better. How did you know it worked?',
  'Operations': 'Describe a time something broke in day-to-day operations and you fixed it.',
  'Data analysis': 'Tell me about a decision you made because of what the numbers showed.',
  'Project management': 'Tell me about a project you kept on track when the timeline slipped.',
  'Team leadership': 'Tell me about a time you led a team through a hard stretch.',
  'Communication': 'Tell me about a time you had to explain something complicated to a non-expert.',
  'Cross-functional collaboration': 'Tell me about working with another team that had different priorities.',
  'Problem solving': 'Tell me about a problem with no obvious answer. How did you work it out?',
  'CRM tools': 'How have you used a customer system to keep track of accounts or cases?',
  'Budgeting': 'Tell me about a time you saved money or worked within a tight budget.',
  'Sales': 'Tell me about a time you found more value for an existing customer.',
  'Curriculum design': 'Tell me about a learning program or material you designed from scratch.',
  'Conflict resolution': 'Tell me about a time you calmed down an upset customer or colleague.',
  'Compliance': 'Tell me about a time you had to follow a rule that slowed you down.',
};

// Questions come from the skills the job asks for. Gaps get a question too, framed so the
// candidate can answer honestly about how they would learn.
export function generateQuestions(ws, jobId) {
  const fit = fitReport(ws, jobId);
  if (!fit) return [];
  const qs = [];
  for (const r of fit.rows.slice(0, 6)) {
    if (!QUESTION_BANK[r.skill]) continue;
    qs.push({ id: `q_${slug(r.skill)}`, skill: r.skill, text: QUESTION_BANK[r.skill], kind: r.covered ? 'strength' : 'gap', suggestedEvidence: r.evidence.slice(0, 2) });
  }
  for (const g of fit.gaps.slice(0, 2)) {
    qs.push({ id: `q_gap_${slug(g)}`, skill: g, text: `This role needs ${softLower(g)}. What have you done that comes closest, and how would you get up to speed?`, kind: 'gap', suggestedEvidence: [] });
  }
  qs.push({ id: 'q_why', skill: 'Motivation', text: `Why ${findById(ws.jobs, jobId).company}, and why this role now?`, kind: 'motivation', suggestedEvidence: [] });
  const seen = new Set();
  return qs.filter(q => (seen.has(q.id) ? false : seen.add(q.id)));
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// A rubric, not a grade: plain checks a coach would make on a STAR answer.
export function scoreStar(ans, ws) {
  const parts = ['situation', 'task', 'action', 'result'];
  const checks = parts.map(p => ({ id: p, label: `${p.charAt(0).toUpperCase()}${p.slice(1)} written`, pass: clean(ans[p]).length >= 15 }));
  const action = clean(ans.action);
  const we = (action.match(/\bwe\b/gi) || []).length, i = (action.match(/\bI\b/g) || []).length;
  checks.push({ id: 'ownership', label: 'Action says what you did ("I"), not only "we"', pass: action.length > 0 && i >= we });
  checks.push({ id: 'measurable', label: 'Result has a number or a clear outcome', pass: extractNumbers(ans.result).length > 0 || /\b(cut|reduced|increased|grew|saved|kept|renewed|won|finished|launched|resolved)\b/i.test(ans.result || '') });
  const words = parts.map(p => clean(ans[p])).join(' ').split(' ').filter(Boolean).length;
  checks.push({ id: 'length', label: 'Fits in about two minutes spoken (60 to 300 words)', pass: words >= 60 && words <= 300 });
  const trace = checkClaim(`${ans.action} ${ans.result}`, ans.evidenceIds, ws);
  checks.push({ id: 'evidence', label: 'Backed by evidence from your library', pass: trace.status === 'traced' });
  return { checks, passed: checks.filter(c => c.pass).length, total: checks.length, words, trace };
}

export function savePractice(ws, input) {
  const entry = {
    id: input.id || uid('pr'),
    jobId: input.jobId,
    questionId: input.questionId,
    question: clean(input.question),
    situation: cleanBlock(input.situation),
    task: cleanBlock(input.task),
    action: cleanBlock(input.action),
    result: cleanBlock(input.result),
    evidenceIds: [...(input.evidenceIds || [])],
    confidence: Math.max(1, Math.min(5, Number(input.confidence) || 3)),
    updatedAt: new Date().toISOString(),
  };
  if (!findById(ws.jobs, entry.jobId)) throw new Error('Pick a role first.');
  ws.practice = input.id && findById(ws.practice, input.id) ? ws.practice.map(p => (p.id === input.id ? entry : p)) : [...ws.practice, entry];
  touch(ws);
  return entry;
}

// ---------------------------------------------------------------- debriefs and follow-ups

export function addDebrief(ws, input) {
  if (!findById(ws.jobs, input.jobId)) throw new Error('Pick a role first.');
  const d = {
    id: input.id || uid('db'),
    jobId: input.jobId,
    date: clean(input.date) || today(),
    round: clean(input.round) || 'Interview',
    interviewer: clean(input.interviewer),
    asked: cleanBlock(input.asked),
    wentWell: cleanBlock(input.wentWell),
    improve: cleanBlock(input.improve),
    followUpPoint: cleanBlock(input.followUpPoint),
  };
  ws.debriefs = [...ws.debriefs, d];
  touch(ws);
  return d;
}

export const FOLLOW_UP_KINDS = [
  { id: 'thank-you', label: 'Thank-you after an interview' },
  { id: 'status-check', label: 'Polite status check' },
  { id: 'after-rejection', label: 'Gracious reply to a no' },
];

// Drafts only. Nothing in this workspace sends anything; the user copies the text.
export function draftFollowUp(ws, jobId, kind, debriefId) {
  const job = findById(ws.jobs, jobId);
  if (!job) throw new Error('Pick a role first.');
  const d = debriefId ? findById(ws.debriefs, debriefId) : ws.debriefs.filter(x => x.jobId === jobId).slice(-1)[0];
  const who = (d && d.interviewer) || job.contact || 'there';
  const name = ws.profile.name || '[Your name]';
  let subject, body;
  if (kind === 'thank-you') {
    subject = `Thank you: ${job.title} conversation`;
    const point = d && d.followUpPoint ? `I keep thinking about ${lowerStart(d.followUpPoint.replace(/[.]$/, ''))}.` : '[Name one thing from the conversation you keep thinking about.]';
    body = `Hi ${who},\n\nThank you for your time${d && d.round ? ` in the ${d.round.toLowerCase()}` : ''} for the ${job.title} role. ${point}\n\nIt made me more interested in the role. If anything else would help your decision, I am glad to send it.\n\nBest,\n${name}`;
  } else if (kind === 'status-check') {
    subject = `Checking in: ${job.title} application`;
    body = `Hi ${who},\n\nI applied for the ${job.title} role at ${job.company} and wanted to check whether there is an update on timing. I am still very interested.\n\nThank you,\n${name}`;
  } else if (kind === 'after-rejection') {
    subject = `Re: ${job.title}`;
    body = `Hi ${who},\n\nThank you for letting me know, and for the time your team spent with me. If a role like this opens again, I would be glad to be considered.\n\nBest,\n${name}`;
  } else {
    throw new Error(`Unknown follow-up type "${kind}".`);
  }
  return { subject, body };
}

function lowerStart(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export function saveFollowUp(ws, input) {
  if (!findById(ws.jobs, input.jobId)) throw new Error('Pick a role first.');
  const f = {
    id: input.id || uid('fu'),
    jobId: input.jobId,
    kind: input.kind,
    subject: clean(input.subject),
    body: cleanBlock(input.body),
    status: 'draft', // only ever "draft" or "copied"; this app cannot send
    updatedAt: new Date().toISOString(),
  };
  if (input.copied) f.status = 'copied';
  ws.followUps = input.id && findById(ws.followUps, input.id) ? ws.followUps.map(x => (x.id === input.id ? f : x)) : [...ws.followUps, f];
  touch(ws);
  return f;
}

// ---------------------------------------------------------------- packet

function fmtEv(ev) {
  return `${ev.title}${ev.org ? `, ${ev.org}` : ''}${ev.start || ev.end ? ` (${[ev.start, ev.end].filter(Boolean).join(' to ')})` : ''}`;
}

// The application packet as Markdown: resume version, cover letter, and a trace appendix that
// shows the evidence behind every line. Unsupported lines are listed at the top, not hidden.
export function buildPacket(ws, jobId, versionId, letterId) {
  const job = findById(ws.jobs, jobId);
  if (!job) throw new Error('Pick a role first.');
  const v = findById(ws.resumeVersions, versionId) || ws.resumeVersions.filter(x => x.jobId === jobId).slice(-1)[0];
  const letter = findById(ws.coverLetters, letterId) || ws.coverLetters.filter(x => x.jobId === jobId).slice(-1)[0];
  const p = ws.profile;
  const out = [];
  out.push(`# Application packet: ${job.title} at ${job.company}`, '');
  out.push(`Prepared ${today()} in Job Coach. Every resume line below cites the evidence it came from.`, '');
  const tr = v ? traceReport(ws, v.id) : null;
  const lt = letter ? coverLetterTrace(ws, letter) : [];
  const problems = [];
  if (tr) for (const l of tr.lines) if (l.status !== 'traced') problems.push(`Resume: "${l.text}": ${l.issues.map(i => i.detail).join(' ')}`);
  lt.forEach((l, i) => { if (l.status !== 'traced') problems.push(`Cover letter paragraph ${i + 1}: ${l.issues.map(x => x.detail).join(' ')}`); });
  if (!v) problems.push('No resume version yet.');
  if (!letter) problems.push('No cover letter yet.');
  out.push('## Check before sending', '');
  out.push(problems.length ? problems.map(x => `- ${x}`).join('\n') : '- Every line traces to your evidence.', '');
  if (v) {
    out.push(`## Resume (${v.label})`, '');
    out.push(`**${p.name || '[Your name]'}**${p.headline ? `  \n${p.headline}` : ''}${p.location || p.email ? `  \n${[p.location, p.email].filter(Boolean).join(' | ')}` : ''}`, '');
    if (v.summary) out.push(v.summary, '');
    const refs = new Map();
    v.bullets.forEach(b => b.evidenceIds.forEach(id => { if (!refs.has(id)) refs.set(id, refs.size + 1); }));
    for (const b of v.bullets) out.push(`- ${b.text}${b.evidenceIds.length ? ` [${b.evidenceIds.map(id => `E${refs.get(id)}`).join(', ')}]` : ' [no evidence]'}`);
    out.push('');
    if (letter) {
      out.push('## Cover letter', '', letterText(letter), '');
    }
    out.push('## Evidence behind each line', '');
    for (const [id, n] of refs) {
      const ev = findById(ws.evidence, id);
      out.push(ev ? `- **E${n}** ${fmtEv(ev)}: ${ev.text}${ev.metrics.length ? ` Metrics: ${ev.metrics.join('; ')}.` : ''}` : `- **E${n}** deleted evidence item`);
    }
    out.push('');
  } else if (letter) {
    out.push('## Cover letter', '', letterText(letter), '');
  }
  out.push('## Stage history', '');
  for (const h of job.history) out.push(`- ${h.date}: ${stageLabel(h.stage)}${h.note ? `. ${h.note}` : ''}`);
  out.push('', '_Nothing in this packet was sent by Job Coach. You choose where it goes._', '');
  return { markdown: out.join('\n'), problems };
}

// ---------------------------------------------------------------- dashboard

export function pipelineSummary(ws) {
  const by = Object.fromEntries(STAGES.map(s => [s.id, []]));
  for (const j of ws.jobs) (by[j.stage] || (by[j.stage] = [])).push(j);
  const nextSteps = [];
  for (const j of ws.jobs) {
    const versions = ws.resumeVersions.filter(v => v.jobId === j.id);
    const letters = ws.coverLetters.filter(c => c.jobId === j.id);
    const label = `${j.title} at ${j.company}`;
    if (j.stage === 'closed' || j.stage === 'offer') continue;
    if (!versions.length) nextSteps.push({ jobId: j.id, text: `${label}: make a tailored resume version.` });
    else {
      const tr = traceReport(ws, versions[versions.length - 1].id);
      if (!tr.clean) nextSteps.push({ jobId: j.id, text: `${label}: ${tr.counts.unsupported + tr.counts.untraced} resume line${tr.counts.unsupported + tr.counts.untraced > 1 ? 's' : ''} not backed by evidence.` });
    }
    if (versions.length && !letters.length) nextSteps.push({ jobId: j.id, text: `${label}: draft a cover letter.` });
    if (j.stage === 'interviewing' && !ws.practice.some(p => p.jobId === j.id)) nextSteps.push({ jobId: j.id, text: `${label}: practice at least one answer.` });
    const deb = ws.debriefs.filter(d => d.jobId === j.id);
    if (deb.length && !ws.followUps.some(f => f.jobId === j.id)) nextSteps.push({ jobId: j.id, text: `${label}: draft a thank-you note from your debrief.` });
  }
  return { byStage: by, nextSteps, counts: { roles: ws.jobs.length, evidence: ws.evidence.length, versions: ws.resumeVersions.length } };
}

// ---------------------------------------------------------------- persistence

const ARRAY_KEYS = ['evidence', 'jobs', 'resumeVersions', 'coverLetters', 'practice', 'debriefs', 'followUps'];

// Validates and repairs a parsed workspace. Returns { ws, warnings } or throws if it is not a
// workspace at all. Bad records are dropped with a warning rather than failing the whole load.
export function validateWorkspace(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('This file is not a Job Coach workspace.');
  if (typeof data.schemaVersion !== 'number') throw new Error('This file is not a Job Coach workspace (no schema version).');
  if (data.schemaVersion > SCHEMA_VERSION) throw new Error(`This workspace was saved by a newer version of Job Coach (schema ${data.schemaVersion}). Update the page and try again.`);
  const migrated = migrate(data);
  const ws = emptyWorkspace();
  const warnings = [];
  ws.profile = { ...ws.profile, ...(migrated.profile && typeof migrated.profile === 'object' ? pick(migrated.profile, ['name', 'headline', 'location', 'email']) : {}) };
  for (const k of ARRAY_KEYS) {
    const list = Array.isArray(migrated[k]) ? migrated[k] : [];
    const good = list.filter(x => x && typeof x === 'object' && typeof x.id === 'string');
    if (good.length !== list.length) warnings.push(`Dropped ${list.length - good.length} damaged ${k} record${list.length - good.length > 1 ? 's' : ''}.`);
    ws[k] = good;
  }
  // Every field the interface reads is coerced to the type it expects, so a hand-edited or
  // damaged file can lose a value but can never crash the page.
  ws.evidence = ws.evidence.map(e => normalizeEvidence({ ...e, ...strs(e, ['kind', 'title', 'org', 'start', 'end', 'text']) }));
  ws.jobs = ws.jobs.map(j => ({
    ...j, ...strs(j, ['title', 'company', 'location', 'source', 'jd', 'notes', 'contact', 'createdAt']),
    stage: STAGE_IDS.includes(j.stage) ? j.stage : 'saved',
    history: objs(j.history).map(h => ({ stage: STAGE_IDS.includes(h.stage) ? h.stage : 'saved', ...strs(h, ['date', 'note']) })),
  }));
  ws.resumeVersions = ws.resumeVersions.map(v => ({
    ...v, ...strs(v, ['jobId', 'label', 'summary', 'createdAt']), basedOn: typeof v.basedOn === 'string' ? v.basedOn : null,
    bullets: objs(v.bullets).map(b => ({ id: typeof b.id === 'string' ? b.id : uid('b'), ...strs(b, ['text']), evidenceIds: ids(b.evidenceIds) })),
  }));
  ws.coverLetters = ws.coverLetters.map(c => ({
    ...c, ...strs(c, ['jobId', 'updatedAt']), versionId: typeof c.versionId === 'string' ? c.versionId : null,
    paras: objs(c.paras).map(p => ({ ...strs(p, ['text']), kind: typeof p.kind === 'string' ? p.kind : 'proof', evidenceIds: ids(p.evidenceIds) })),
  }));
  ws.practice = ws.practice.map(p => ({ ...p, ...strs(p, ['jobId', 'questionId', 'question', 'situation', 'task', 'action', 'result']), evidenceIds: ids(p.evidenceIds) }));
  ws.debriefs = ws.debriefs.map(d => ({ ...d, ...strs(d, ['jobId', 'date', 'round', 'interviewer', 'asked', 'wentWell', 'improve', 'followUpPoint']) }));
  ws.followUps = ws.followUps.map(f => ({ ...f, ...strs(f, ['jobId', 'kind', 'subject', 'body']), status: f.status === 'copied' ? 'copied' : 'draft' }));
  ws.updatedAt = migrated.updatedAt || null;
  return { ws, warnings };
}

function strs(o, keys) {
  const r = {};
  for (const k of keys) r[k] = typeof o[k] === 'string' ? o[k] : o[k] == null ? '' : String(o[k]);
  return r;
}

function objs(list) {
  return Array.isArray(list) ? list.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : [];
}

function ids(list) {
  return Array.isArray(list) ? list.filter(x => typeof x === 'string') : [];
}

function pick(o, keys) {
  const r = {};
  for (const k of keys) if (typeof o[k] === 'string') r[k] = o[k];
  return r;
}

function migrate(data) {
  // Schema 1 is the first; future migrations chain here.
  return data;
}

export function serialize(ws) {
  return JSON.stringify(ws);
}

// A storage wrapper with explicit failure states. `storage` is anything with getItem/setItem/removeItem.
// Load states: 'empty', 'ok', 'recovered' (damaged data set aside, with warnings), 'unavailable'.
export function createStore(storage, key = STORAGE_KEY) {
  function safeGet(k) {
    try { return { value: storage.getItem(k) }; } catch (e) { return { error: e }; }
  }
  return {
    load() {
      if (!storage) return { state: 'unavailable', ws: emptyWorkspace(), warnings: ['This browser is not letting the page save. Your work lasts until you close the tab; use Export to keep it.'] };
      const got = safeGet(key);
      if (got.error) return { state: 'unavailable', ws: emptyWorkspace(), warnings: ['This browser is blocking saved data (private mode or a privacy setting). Your work lasts until you close the tab; use Export to keep it.'] };
      if (got.value == null) return { state: 'empty', ws: emptyWorkspace(), warnings: [] };
      let parsed;
      try { parsed = JSON.parse(got.value); } catch {
        try { storage.setItem(`${key}.damaged`, got.value); } catch { /* best effort */ }
        return { state: 'recovered', ws: emptyWorkspace(), warnings: ['Your saved workspace was damaged and could not be read. A copy was set aside, and you are starting fresh. If you exported a backup, import it now.'] };
      }
      try {
        const { ws, warnings } = validateWorkspace(parsed);
        return { state: warnings.length ? 'recovered' : 'ok', ws, warnings };
      } catch (e) {
        try { storage.setItem(`${key}.damaged`, got.value); } catch { /* best effort */ }
        return { state: 'recovered', ws: emptyWorkspace(), warnings: [`${e.message} A copy was set aside, and you are starting fresh.`] };
      }
    },
    save(ws) {
      if (!storage) return { ok: false, error: 'Saving is not available in this browser. Use Export to keep your work.' };
      try {
        storage.setItem(key, serialize(ws));
        return { ok: true };
      } catch (e) {
        const quota = e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message)));
        return { ok: false, error: quota ? 'This browser is out of room for saved data. Export your workspace, then remove old roles.' : 'Could not save just now. Your changes are still on screen; use Export to keep them.' };
      }
    },
    clear() {
      try { storage.removeItem(key); return { ok: true }; } catch { return { ok: false }; }
    },
  };
}

// Import from a user-chosen file. Never merges silently: returns a fresh validated workspace.
export function importWorkspace(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('That file is not valid JSON. Pick a file you exported from Job Coach.'); }
  return validateWorkspace(parsed);
}

export function exportWorkspace(ws) {
  return JSON.stringify({ ...ws, exportedAt: new Date().toISOString() }, null, 2);
}
