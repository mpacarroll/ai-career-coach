// Job Search Workspace: the interface. All logic lives in core.js; this file renders and wires events.
import * as C from './core.js';
import { buildDemoWorkspace } from './demo.js';

const view = document.getElementById('view');
const bannersEl = document.getElementById('banners');

let storage = null;
try { storage = window.localStorage; } catch { storage = null; }
const store = C.createStore(storage);

let ws;
const banners = []; // { kind, text, id }
const ui = { version: {}, compare: {}, question: {}, letterVersion: {} };

// ---------------------------------------------------------------- boot

function boot() {
  const got = store.load();
  ws = got.ws;
  for (const w of got.warnings) addBanner(got.state === 'unavailable' ? 'warn' : 'err', w);
  if (got.state === 'empty' || (got.state === 'unavailable' && !ws.jobs.length)) {
    ws = buildDemoWorkspace();
    if (got.state === 'empty') persist();
  }
  window.addEventListener('hashchange', render);
  render();
}

function isDemo() {
  return ws.evidence.some(e => e.id.startsWith('ev_demo_')) || ws.jobs.some(j => j.id.startsWith('job_demo_'));
}

function persist() {
  const r = store.save(ws);
  const id = 'save-error';
  const i = banners.findIndex(b => b.id === id);
  if (!r.ok) { if (i < 0) banners.push({ kind: 'err', text: r.error, id }); else banners[i].text = r.error; }
  else if (i >= 0) banners.splice(i, 1);
  return r.ok;
}

function addBanner(kind, text, id) {
  banners.push({ kind, text, id: id || `b${banners.length}` });
}

// A change event fires on blur, which happens on pointerdown. Re-rendering then would detach the
// button the person is clicking and swallow the click, so renders wait until the pointer is up.
let pointerDown = false;
let pendingRender = false;
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
document.addEventListener('pointerup', () => {
  setTimeout(() => { pointerDown = false; if (pendingRender) { pendingRender = false; render(); } }, 0);
}, true);

function scheduleRender() {
  if (pointerDown) pendingRender = true; else render();
}

// Every mutation goes through here: run, save, re-render, report errors in plain words.
function act(fn, okMsg) {
  try {
    const out = fn();
    persist();
    scheduleRender();
    if (okMsg) toast(okMsg);
    return out;
  } catch (e) {
    toast(e.message || 'Something went wrong.');
    return null;
  }
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------------------------------------------------------------- helpers

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const evTitle = id => { const e = C.findById(ws.evidence, id); return e ? e.title : 'Deleted evidence'; };
const statusBadge = s => `<span class="status ${s}">${{ traced: 'Traced', unsupported: 'Check this', untraced: 'No evidence' }[s] || esc(s)}</span>`;
const issuesList = issues => (issues && issues.length ? `<ul class="issues">${issues.map(i => `<li>${esc(i.detail)}</li>`).join('')}</ul>` : '');
const roleLabel = j => `${esc(j.title)} at ${esc(j.company)}`;

function evidenceOptions(exclude = []) {
  return ws.evidence.filter(e => !exclude.includes(e.id)).map(e => `<option value="${esc(e.id)}">${esc(e.title)}${e.org ? `, ${esc(e.org)}` : ''}</option>`).join('');
}

function citeChips(ids, act, extra) {
  return `<div class="chips">${ids.map(id => `<span class="chip ${C.findById(ws.evidence, id) ? 'ok' : 'gap'}">${esc(evTitle(id))}${act ? `<button type="button" aria-label="Remove citation ${esc(evTitle(id))}" data-act="${act}" data-ev="${esc(id)}" ${extra || ''}>&times;</button>` : ''}</span>`).join('')}</div>`;
}

function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') { (o[el.name] = o[el.name] || []); if (el.checked) o[el.name].push(el.value); }
    else o[el.name] = el.value;
  }
  return o;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function mdToHtml(md) {
  const lines = md.split('\n');
  let html = '', inList = false, para = [];
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/_(.+?)_/g, '<i>$1</i>').replace(/ {2}$/, '<br>');
  const flush = () => { if (para.length) { html += `<p>${para.map(inline).join('\n')}</p>`; para = []; } };
  for (const l of lines) {
    if (/^- /.test(l)) { flush(); if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(l.slice(2))}</li>`; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    const h = l.match(/^(#{1,3}) (.*)/);
    if (h) { flush(); html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
    if (!l.trim()) { flush(); continue; }
    para.push(l);
  }
  flush(); if (inList) html += '</ul>';
  return html;
}

// ---------------------------------------------------------------- routing and render

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'pipeline', parts };
}

function render() {
  // Keep focus on the same logical field across re-renders.
  const active = document.activeElement;
  const focusKey = active && active.dataset ? active.dataset.k : null;
  const r = route();
  document.querySelectorAll('[data-nav]').forEach(a => {
    const on = a.dataset.nav === r.name || (a.dataset.nav === 'roles' && r.name === 'role');
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  renderBanners();
  let html;
  if (r.name === 'evidence') html = viewEvidence(r.parts[1]);
  else if (r.name === 'roles') html = viewRoles();
  else if (r.name === 'role') html = viewRole(r.parts[1], r.parts[2] || 'overview');
  else if (r.name === 'data') html = viewData();
  else html = viewPipeline();
  view.innerHTML = html;
  if (focusKey) { const el = view.querySelector(`[data-k="${CSS.escape(focusKey)}"]`); if (el) el.focus(); }
}

function renderBanners() {
  let html = banners.map(b => `<p class="banner ${b.kind}">${esc(b.text)} <button class="linkbtn" data-act="dismiss-banner" data-id="${esc(b.id)}">Dismiss</button></p>`).join('');
  if (isDemo()) html += `<p class="banner demo"><b>You are looking at a made-up candidate, Jordan Reyes.</b> Look around, change anything, then clear it and start your own. <button class="linkbtn" data-act="start-fresh">Clear the demo and start fresh</button></p>`;
  bannersEl.innerHTML = html;
}

// ---------------------------------------------------------------- pipeline

function viewPipeline() {
  const s = C.pipelineSummary(ws);
  const cols = C.STAGES.map(st => `<div class="col"><h3>${esc(st.label)} <span class="muted">${s.byStage[st.id].length}</span></h3>${s.byStage[st.id].map(j => {
    const last = j.history[j.history.length - 1];
    return `<a class="jobcard" href="#/role/${encodeURIComponent(j.id)}"><b>${esc(j.title)}</b>${esc(j.company)}<br><span class="muted small">${esc(last ? last.date : j.createdAt)}</span></a>`;
  }).join('')}</div>`).join('');
  return `<div class="spread"><h2>Pipeline</h2><a class="btn" href="#/roles">Add a target role</a></div>
    <p class="muted small">${s.counts.roles} role${s.counts.roles === 1 ? '' : 's'}, ${s.counts.evidence} evidence item${s.counts.evidence === 1 ? '' : 's'}, ${s.counts.versions} resume version${s.counts.versions === 1 ? '' : 's'}.</p>
    ${s.nextSteps.length ? `<div class="card accent"><h3>Next steps</h3><ul>${s.nextSteps.map(n => `<li><a href="#/role/${encodeURIComponent(n.jobId)}">${esc(n.text)}</a></li>`).join('')}</ul></div>` : ''}
    ${ws.evidence.length ? '' : `<div class="card accent"><h3>Start with your evidence</h3><p>Write down what you have actually done: roles, projects, numbers you can stand behind. Every resume line you build later points back to these. <a href="#/evidence">Add your first item</a>.</p></div>`}
    <div class="board" aria-label="Applications by stage">${cols}</div>`;
}

// ---------------------------------------------------------------- evidence

function citingLines(evId) {
  let n = 0;
  for (const v of ws.resumeVersions) for (const b of v.bullets) if (b.evidenceIds.includes(evId)) n++;
  return n;
}

function viewEvidence(editId) {
  const editing = editId && editId !== 'new' ? C.findById(ws.evidence, editId) : null;
  const e = editing || { kind: 'role', title: '', org: '', start: '', end: '', text: '', metrics: [], skills: [] };
  const list = ws.evidence.length ? ws.evidence.map(ev => `<article class="card" id="ev-${esc(ev.id)}">
      <div class="spread"><div><b>${esc(ev.title)}</b>${ev.org ? `, ${esc(ev.org)}` : ''} <span class="muted small">${esc([ev.start, ev.end].filter(Boolean).join(' to '))}</span></div><span class="tag muted">${esc(ev.kind)}</span></div>
      <p>${esc(ev.text)}</p>
      ${ev.metrics.length ? `<p class="small"><b>Numbers you can stand behind:</b> ${ev.metrics.map(esc).join('; ')}</p>` : ''}
      <div class="chips">${C.evidenceSkills(ev).map(s => `<span class="chip">${esc(s)}</span>`).join('')}</div>
      <div class="spread" style="margin-top:8px"><span class="muted small">Cited by ${citingLines(ev.id)} resume line${citingLines(ev.id) === 1 ? '' : 's'}</span>
      <span class="row"><a class="btn ghost small" href="#/evidence/${encodeURIComponent(ev.id)}">Edit</a><button class="btn danger small" data-act="delete-evidence" data-id="${esc(ev.id)}">Delete</button></span></div>
    </article>`).join('') : '<p class="muted">No evidence yet. Add the first thing you are proud of.</p>';
  const kinds = ['role', 'project', 'education', 'certification', 'volunteer', 'other'];
  return `<h2>Evidence library</h2>
    <p class="muted">The facts every application is built from. Resume lines, cover letters and interview answers cite these, and any number or credential that is not here gets flagged.</p>
    <div class="grid2"><div>${list}</div>
    <form class="card accent" data-form="evidence" data-id="${esc(editing ? editing.id : '')}">
      <h3>${editing ? 'Edit evidence' : 'Add evidence'}</h3>
      <label for="ev-title">Title</label><input id="ev-title" name="title" required value="${esc(e.title)}" placeholder="Operations Coordinator, or a project name">
      <div class="row"><div style="flex:2;min-width:160px"><label for="ev-org">Organization</label><input id="ev-org" name="org" value="${esc(e.org)}"></div>
      <div style="flex:1;min-width:120px"><label for="ev-kind">Kind</label><select id="ev-kind" name="kind">${kinds.map(k => `<option ${k === e.kind ? 'selected' : ''}>${k}</option>`).join('')}</select></div></div>
      <div class="row"><div style="flex:1"><label for="ev-start">From</label><input id="ev-start" name="start" value="${esc(e.start)}" placeholder="2022"></div><div style="flex:1"><label for="ev-end">To</label><input id="ev-end" name="end" value="${esc(e.end)}" placeholder="present"></div></div>
      <label for="ev-text">What you did, in your own words</label><textarea id="ev-text" name="text" required rows="4">${esc(e.text)}</textarea>
      <label for="ev-metrics">Numbers you can stand behind <span class="muted small">(separate with semicolons)</span></label><input id="ev-metrics" name="metrics" value="${esc(e.metrics.join('; '))}" placeholder="30 teachers trained; errors down from 12 a month to 3">
      <label for="ev-skills">Skills it shows <span class="muted small">(optional, comma separated; others are detected)</span></label><input id="ev-skills" name="skills" value="${esc(e.skills.join(', '))}">
      <div class="row" style="margin-top:12px"><button class="btn" type="submit">${editing ? 'Save changes' : 'Add to library'}</button>${editing ? '<a class="btn ghost" href="#/evidence">Cancel</a>' : ''}</div>
    </form></div>`;
}

// ---------------------------------------------------------------- roles

function viewRoles() {
  const rows = ws.jobs.map(j => `<tr><td><a href="#/role/${encodeURIComponent(j.id)}">${roleLabel(j)}</a></td><td>${esc(C.stageLabel(j.stage))}</td><td>${(C.fitReport(ws, j.id) || {}).coverage || 0}%</td><td>${ws.resumeVersions.filter(v => v.jobId === j.id).length}</td></tr>`).join('');
  return `<h2>Target roles</h2>
    <div class="grid2"><div>${ws.jobs.length ? `<table><thead><tr><th>Role</th><th>Stage</th><th>Evidence fit</th><th>Versions</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">No roles yet.</p>'}</div>
    <form class="card accent" data-form="job">
      <h3>Add a target role</h3>
      <p class="muted small">Paste the job description yourself. Job Coach does not fetch or scrape job sites.</p>
      <label for="job-title">Job title</label><input id="job-title" name="title" required>
      <label for="job-company">Company</label><input id="job-company" name="company" required>
      <div class="row"><div style="flex:1"><label for="job-location">Location</label><input id="job-location" name="location"></div><div style="flex:1"><label for="job-source">Where you found it</label><input id="job-source" name="source"></div></div>
      <label for="job-contact">Contact name <span class="muted small">(optional)</span></label><input id="job-contact" name="contact">
      <label for="job-jd">Job description</label><textarea id="job-jd" name="jd" rows="7"></textarea>
      <button class="btn" type="submit" style="margin-top:12px">Add role</button>
    </form></div>`;
}

const ROLE_TABS = [
  ['overview', 'Overview and fit'], ['resume', 'Resume versions'], ['compare', 'Compare'], ['letter', 'Cover letter'],
  ['interview', 'Interview practice'], ['followups', 'Follow-ups'], ['packet', 'Packet'],
];

function viewRole(id, tab) {
  const job = C.findById(ws.jobs, id);
  if (!job) return `<p>That role is not in this workspace. <a href="#/roles">See all roles</a>.</p>`;
  const sub = ROLE_TABS.map(([t, l]) => `<a href="#/role/${encodeURIComponent(id)}/${t}" ${t === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('');
  const body = { overview: roleOverview, resume: roleResume, compare: roleCompare, letter: roleLetter, interview: roleInterview, followups: roleFollowups, packet: rolePacket }[tab] || roleOverview;
  return `<div class="spread"><h2 style="margin:0">${roleLabel(job)}</h2><span class="tag" style="color:var(--green)">${esc(C.stageLabel(job.stage))}</span></div>
    <nav class="subnav" aria-label="Role sections">${sub}</nav>${body(job)}`;
}

function roleOverview(job) {
  const fit = C.fitReport(ws, job.id);
  const stageOpts = C.STAGES.map(s => `<option value="${s.id}" ${s.id === job.stage ? 'selected' : ''}>${esc(s.label)}</option>`).join('');
  return `<div class="grid2"><div>
    <form class="card accent" data-form="stage" data-job="${esc(job.id)}">
      <h3>Move this application</h3>
      <div class="row"><div style="flex:1;min-width:140px"><label for="st-stage">Stage</label><select id="st-stage" name="stage">${stageOpts}</select></div>
      <div style="flex:1;min-width:140px"><label for="st-date">Date</label><input id="st-date" type="date" name="date" value="${C.today()}"></div></div>
      <label for="st-note">Note</label><input id="st-note" name="note" placeholder="Recruiter screen booked">
      <button class="btn" style="margin-top:10px">Record</button>
    </form>
    <div class="card"><h3>History</h3><ul>${job.history.slice().reverse().map(h => `<li><b>${esc(h.date)}</b> ${esc(C.stageLabel(h.stage))}${h.note ? `: ${esc(h.note)}` : ''}</li>`).join('')}</ul></div>
    <details class="card"><summary><b>Edit role details and job description</b></summary>
      <form data-form="job-edit" data-job="${esc(job.id)}">
        <label for="je-title">Job title</label><input id="je-title" name="title" value="${esc(job.title)}">
        <label for="je-company">Company</label><input id="je-company" name="company" value="${esc(job.company)}">
        <label for="je-contact">Contact</label><input id="je-contact" name="contact" value="${esc(job.contact)}">
        <label for="je-jd">Job description</label><textarea id="je-jd" name="jd" rows="10">${esc(job.jd)}</textarea>
        <label for="je-notes">Notes</label><textarea id="je-notes" name="notes">${esc(job.notes)}</textarea>
        <div class="row" style="margin-top:10px"><button class="btn">Save</button><button class="btn danger" type="button" data-act="delete-job" data-job="${esc(job.id)}">Delete role</button></div>
      </form></details>
  </div><div>
    <div class="card accent"><h3>How your evidence covers this role</h3>
      <div class="spread"><b>${fit.coverage}% of what the description asks for</b><span class="muted small">${fit.rows.length} skills found in the description</span></div>
      <div class="meter" role="img" aria-label="${fit.coverage} percent covered"><i style="width:${fit.coverage}%"></i></div>
      ${fit.gaps.length ? `<p><b>Gaps:</b> ${fit.gaps.map(g => `<span class="chip gap">${esc(g)}</span>`).join(' ')}</p><p class="muted small">A gap is not a lie to cover. Add evidence if you have it, or prepare an honest answer in Interview practice.</p>` : '<p>Every skill in the description has evidence behind it.</p>'}
      <table><thead><tr><th>Skill asked for</th><th>Your evidence</th></tr></thead><tbody>${fit.rows.map(r => `<tr><td>${esc(r.skill)} <span class="muted small">x${r.weight}</span></td><td>${r.evidence.length ? r.evidence.map(id => `<a href="#/evidence/${encodeURIComponent(id)}">${esc(evTitle(id))}</a>`).join(', ') : '<span class="status unsupported">Gap</span>'}</td></tr>`).join('')}</tbody></table>
    </div>
    ${fit.requirements.length ? `<div class="card"><h3>Requirements pulled from the description</h3><ul class="small">${fit.requirements.map(q => `<li>${esc(q.text)}${q.skills.length ? ` <span class="muted">(${q.skills.map(esc).join(', ')})</span>` : ''}</li>`).join('')}</ul></div>` : ''}
  </div></div>`;
}

function versionsFor(jobId) {
  return ws.resumeVersions.filter(v => v.jobId === jobId);
}

function currentVersion(jobId) {
  const vs = versionsFor(jobId);
  return C.findById(vs, ui.version[jobId]) || vs[vs.length - 1] || null;
}

function roleResume(job) {
  const vs = versionsFor(job.id);
  const v = currentVersion(job.id);
  const picker = vs.map(x => { const t = C.traceReport(ws, x.id); return `<button class="btn ${x === v ? '' : 'ghost'} small" data-act="pick-version" data-job="${esc(job.id)}" data-id="${esc(x.id)}">${esc(x.label)} ${t.clean ? '' : `<span class="status unsupported">${t.counts.unsupported + t.counts.untraced}</span>`}</button>`; }).join('');
  const sugg = C.suggestBullets(ws, job.id);
  const suggHtml = `<div class="card"><h3>Lines drafted from your evidence</h3><p class="muted small">Built only from words you wrote, ranked by how well they match this role. Edit freely after adding.</p>
    ${sugg.length ? sugg.map((s, i) => `<div class="bullet"><p style="margin:0 0 4px">${esc(s.text)}</p><div class="spread"><span class="muted small">${s.skills.map(esc).join(', ')}</span>${v ? `<button class="btn ghost small" data-act="add-suggested" data-job="${esc(job.id)}" data-i="${i}">Add to ${esc(v.label)}</button>` : ''}</div></div>`).join('') : '<p class="muted">Add evidence that matches this role to get suggestions.</p>'}</div>`;
  if (!v) {
    return `<div class="grid2"><div class="card accent"><h3>No resume version yet</h3><p>Start one from your best-matching evidence. You can edit every line.</p><button class="btn" data-act="new-version" data-job="${esc(job.id)}">Start a version from my evidence</button></div>${suggHtml}</div>`;
  }
  const tr = C.traceReport(ws, v.id);
  const bullets = v.bullets.map((b, i) => {
    const line = tr.lines[i];
    return `<div class="bullet">
      <div class="spread"><span class="muted small">Line ${i + 1}</span>${statusBadge(line.status)}</div>
      <label class="small" for="b-${esc(b.id)}" style="position:absolute;left:-9999px">Resume line ${i + 1}</label>
      <textarea id="b-${esc(b.id)}" data-k="b-${esc(b.id)}" data-change="bullet-text" data-v="${esc(v.id)}" data-b="${esc(b.id)}">${esc(b.text)}</textarea>
      ${issuesList(line.issues)}
      ${citeChips(b.evidenceIds, 'uncite', `data-v="${esc(v.id)}" data-b="${esc(b.id)}"`)}
      <div class="row" style="margin-top:6px">
        <select aria-label="Cite evidence for line ${i + 1}" data-change="cite" data-v="${esc(v.id)}" data-b="${esc(b.id)}" style="flex:1;min-width:160px"><option value="">Cite evidence...</option>${evidenceOptions(b.evidenceIds)}</select>
        <button class="btn ghost small" data-act="move-bullet" data-v="${esc(v.id)}" data-b="${esc(b.id)}" data-d="-1" aria-label="Move line ${i + 1} up" ${i === 0 ? 'disabled' : ''}>Up</button>
        <button class="btn ghost small" data-act="move-bullet" data-v="${esc(v.id)}" data-b="${esc(b.id)}" data-d="1" aria-label="Move line ${i + 1} down" ${i === v.bullets.length - 1 ? 'disabled' : ''}>Down</button>
        <button class="btn danger small" data-act="remove-bullet" data-v="${esc(v.id)}" data-b="${esc(b.id)}" aria-label="Remove line ${i + 1}">Remove</button>
      </div></div>`;
  }).join('');
  return `<div class="row" style="margin-bottom:10px">${picker}<button class="btn ghost small" data-act="new-version" data-job="${esc(job.id)}">New from evidence</button><button class="btn ghost small" data-act="dup-version" data-id="${esc(v.id)}">Duplicate ${esc(v.label)}</button></div>
    <div class="grid2"><div>
      <div class="card accent">
        <div class="spread"><h3 style="margin:0">Trace check</h3><span>${tr.clean ? '<span class="status traced">Every line traces</span>' : `<span class="status unsupported">${tr.counts.unsupported + tr.counts.untraced} of ${tr.total} need attention</span>`}</span></div>
        <p class="muted small">A line passes when it cites evidence and every number and credential in it appears in that evidence.</p>
        <label for="v-label">Version name</label><input id="v-label" data-k="v-label" data-change="version-label" data-v="${esc(v.id)}" value="${esc(v.label)}">
        <label for="v-summary">Summary</label><textarea id="v-summary" data-k="v-summary" data-change="version-summary" data-v="${esc(v.id)}">${esc(v.summary)}</textarea>
        ${tr.summary ? `<div style="margin-top:4px">${statusBadge(tr.summary.status)}${issuesList(tr.summary.issues)}</div>` : ''}
        ${v.basedOn ? `<p class="muted small">Based on ${esc((C.findById(ws.resumeVersions, v.basedOn) || { label: 'a deleted version' }).label)}. <a href="#/role/${encodeURIComponent(job.id)}/compare">Compare them</a>.</p>` : ''}
      </div>
      ${bullets}
      <div class="row"><button class="btn ghost" data-act="add-bullet" data-v="${esc(v.id)}">Add a blank line</button><button class="btn danger" data-act="delete-version" data-v="${esc(v.id)}">Delete ${esc(v.label)}</button></div>
    </div>${suggHtml}</div>`;
}

function diffHtml(parts) {
  return parts.map(p => (p.op === 'add' ? `<ins>${esc(p.text)}</ins>` : p.op === 'del' ? `<del>${esc(p.text)}</del>` : esc(p.text))).join('');
}

function roleCompare(job) {
  const vs = versionsFor(job.id);
  if (vs.length < 2) return `<p class="card">Compare needs two versions. <a href="#/role/${encodeURIComponent(job.id)}/resume">Duplicate a version</a> and edit it.</p>`;
  const sel = ui.compare[job.id] || { a: (C.findById(vs, (currentVersion(job.id) || {}).basedOn) || vs[vs.length - 2]).id, b: vs[vs.length - 1].id };
  const cmp = C.compareVersions(ws, sel.a, sel.b) || C.compareVersions(ws, vs[0].id, vs[vs.length - 1].id);
  const opts = cur => vs.map(v => `<option value="${esc(v.id)}" ${v.id === cur ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
  const traceLine = t => `${t.traced} traced, ${t.unsupported + t.untraced} need attention`;
  return `<div class="card accent"><div class="row">
      <div style="flex:1;min-width:150px"><label for="cmp-a">From</label><select id="cmp-a" data-change="compare" data-side="a" data-job="${esc(job.id)}">${opts(cmp.a.id)}</select><p class="muted small">${traceLine(cmp.a.trace)}</p></div>
      <div style="flex:1;min-width:150px"><label for="cmp-b">To</label><select id="cmp-b" data-change="compare" data-side="b" data-job="${esc(job.id)}">${opts(cmp.b.id)}</select><p class="muted small">${traceLine(cmp.b.trace)}</p></div>
    </div></div>
    ${cmp.summary ? `<div class="card"><h3>Summary</h3><p>${diffHtml(cmp.summary)}</p></div>` : ''}
    <div class="card"><h3>Changed lines (${cmp.changed.length})</h3>${cmp.changed.map(c => `<div class="bullet"><p style="margin:0">${diffHtml(c.diff)}</p><p class="small muted" style="margin:4px 0 0">${statusBadge(c.statusFrom)} to ${statusBadge(c.statusTo)}</p></div>`).join('') || '<p class="muted">None.</p>'}</div>
    <div class="grid2">
      <div class="card"><h3>Added (${cmp.added.length})</h3>${cmp.added.map(a => `<div class="bullet"><ins>${esc(a.text)}</ins> ${statusBadge(a.status)}</div>`).join('') || '<p class="muted">None.</p>'}</div>
      <div class="card"><h3>Removed (${cmp.removed.length})</h3>${cmp.removed.map(a => `<div class="bullet"><del>${esc(a.text)}</del> ${statusBadge(a.status)}</div>`).join('') || '<p class="muted">None.</p>'}</div>
    </div>
    ${cmp.unchanged.length ? `<details class="card"><summary>Unchanged lines (${cmp.unchanged.length})</summary><ul>${cmp.unchanged.map(u => `<li>${esc(u.text)}</li>`).join('')}</ul></details>` : ''}`;
}

function letterFor(jobId) {
  return ws.coverLetters.filter(c => c.jobId === jobId).slice(-1)[0] || null;
}

function roleLetter(job) {
  const vs = versionsFor(job.id);
  const letter = letterFor(job.id);
  const vOpts = vs.map(v => `<option value="${esc(v.id)}" ${letter && letter.versionId === v.id ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
  const draftForm = `<form class="row" data-form="draft-letter" data-job="${esc(job.id)}" style="align-items:flex-end">
      <div style="flex:1;min-width:180px"><label for="lt-v">Build from</label><select id="lt-v" name="versionId">${vOpts}<option value="">Best evidence (no version)</option></select></div>
      <button class="btn ${letter ? 'ghost' : ''}">${letter ? 'Redraft (replaces this letter)' : 'Draft my letter'}</button></form>`;
  if (!letter) return `<div class="card accent"><h3>No cover letter yet</h3><p>The draft uses only your evidence: a hook, three proof paragraphs that cite their source, and an honest line about any gap. You then make it sound like you.</p>${draftForm}</div>`;
  const tr = C.coverLetterTrace(ws, letter);
  const paras = letter.paras.map((p, i) => `<div class="bullet"><div class="spread"><span class="tag muted">${esc(p.kind)}</span>${statusBadge(tr[i].status)}</div>
      <label for="lp-${i}" style="position:absolute;left:-9999px">Paragraph ${i + 1}</label>
      <textarea id="lp-${i}" data-k="lp-${i}" data-change="letter-para" data-l="${esc(letter.id)}" data-i="${i}" rows="${Math.min(8, Math.ceil(p.text.length / 70) + 1)}">${esc(p.text)}</textarea>
      ${issuesList(tr[i].issues)}${p.evidenceIds.length ? citeChips(p.evidenceIds) : ''}</div>`).join('');
  const bad = tr.filter(t => t.status !== 'traced').length;
  return `<div class="grid2"><div>${paras}</div><div>
    <div class="card accent"><h3>Check</h3>${bad ? `<p><span class="status unsupported">${bad} paragraph${bad > 1 ? 's' : ''} need attention</span></p>` : '<p><span class="status traced">Every claim traces</span></p>'}
      <ul class="small"><li>Replace any text in [square brackets] with your own words.</li><li>Name one specific thing about the company.</li><li>Read it aloud. Cut anything that could appear on anyone's letter.</li></ul>
      <button class="btn" data-act="copy-letter" data-l="${esc(letter.id)}">Copy the letter</button></div>
    <div class="card">${draftForm}</div></div></div>`;
}

function roleInterview(job) {
  const qs = C.generateQuestions(ws, job.id);
  const qid = ui.question[job.id] || (qs[0] && qs[0].id);
  const q = qs.find(x => x.id === qid) || qs[0];
  const saved = ws.practice.filter(p => p.jobId === job.id);
  const ans = (q && saved.find(p => p.questionId === q.id)) || { situation: '', task: '', action: '', result: '', evidenceIds: q ? q.suggestedEvidence : [], confidence: 3 };
  const score = q && ans.id ? C.scoreStar(ans, ws) : null;
  const qList = qs.map(x => `<li><button class="linkbtn" data-act="pick-question" data-job="${esc(job.id)}" data-q="${esc(x.id)}" ${x.id === (q && q.id) ? 'aria-current="true" style="font-weight:700"' : ''}>${esc(x.text)}</button> <span class="chip ${x.kind === 'gap' ? 'gap' : x.kind === 'strength' ? 'ok' : ''}">${esc(x.kind)}</span>${saved.some(p => p.questionId === x.id) ? ' <span class="status traced">Practiced</span>' : ''}</li>`).join('');
  const debriefs = ws.debriefs.filter(d => d.jobId === job.id);
  const evChecks = ws.evidence.map(e => `<label class="small" style="font-weight:400;display:flex;gap:6px;align-items:flex-start;margin:2px 0"><input type="checkbox" name="evidenceIds" value="${esc(e.id)}" ${ans.evidenceIds.includes(e.id) ? 'checked' : ''} style="width:auto;margin-top:3px">${esc(e.title)}</label>`).join('');
  return `<div class="grid2"><div>
    <div class="card"><h3>Likely questions for this role</h3><p class="muted small">From the skills in the description. Gap questions help you answer honestly about what you have not done yet.</p><ol>${qList}</ol></div>
    <div class="card"><h3>Debriefs</h3>
      ${debriefs.map(d => `<div class="bullet"><b>${esc(d.date)}: ${esc(d.round)}</b>${d.interviewer ? ` with ${esc(d.interviewer)}` : ''}
        ${d.asked ? `<p class="small"><b>Asked:</b> ${esc(d.asked)}</p>` : ''}${d.wentWell ? `<p class="small"><b>Went well:</b> ${esc(d.wentWell)}</p>` : ''}${d.improve ? `<p class="small"><b>Do better:</b> ${esc(d.improve)}</p>` : ''}${d.followUpPoint ? `<p class="small"><b>To mention in a thank-you:</b> ${esc(d.followUpPoint)}</p>` : ''}</div>`).join('') || '<p class="muted">After each interview, write down what happened while it is fresh.</p>'}
      <details><summary><b>Add a debrief</b></summary><form data-form="debrief" data-job="${esc(job.id)}">
        <div class="row"><div style="flex:1"><label for="db-date">Date</label><input id="db-date" type="date" name="date" value="${C.today()}"></div><div style="flex:2"><label for="db-round">Round</label><input id="db-round" name="round" placeholder="Recruiter screen"></div></div>
        <label for="db-who">Interviewer's first name</label><input id="db-who" name="interviewer">
        <label for="db-asked">What they asked</label><textarea id="db-asked" name="asked"></textarea>
        <label for="db-well">What went well</label><textarea id="db-well" name="wentWell"></textarea>
        <label for="db-imp">What to do better</label><textarea id="db-imp" name="improve"></textarea>
        <label for="db-fu">One thing worth mentioning in a thank-you</label><input id="db-fu" name="followUpPoint">
        <button class="btn" style="margin-top:10px">Save debrief</button></form></details>
    </div>
  </div><div>
    ${q ? `<form class="card accent" data-form="practice" data-job="${esc(job.id)}" data-q="${esc(q.id)}" data-id="${esc(ans.id || '')}">
      <h3>${esc(q.text)}</h3><p class="muted small">Answer with STAR. Say what <i>you</i> did, and finish with how it turned out.</p>
      <label for="pr-s">Situation</label><textarea id="pr-s" name="situation">${esc(ans.situation)}</textarea>
      <label for="pr-t">Task</label><textarea id="pr-t" name="task">${esc(ans.task)}</textarea>
      <label for="pr-a">Action</label><textarea id="pr-a" name="action" rows="4">${esc(ans.action)}</textarea>
      <label for="pr-r">Result</label><textarea id="pr-r" name="result">${esc(ans.result)}</textarea>
      <fieldset style="border:1px solid var(--line);border-radius:6px;margin:10px 0 0;padding:6px 10px"><legend class="small"><b>Evidence this answer draws on</b></legend>${evChecks || '<p class="muted small">Add evidence first.</p>'}</fieldset>
      <label for="pr-c">How confident do you feel? (1 to 5)</label><input id="pr-c" type="number" min="1" max="5" name="confidence" value="${esc(ans.confidence)}" style="max-width:90px">
      <button class="btn" style="margin-top:10px">Save and check my answer</button>
      ${score ? `<h3>Coach's checklist: ${score.passed} of ${score.total}</h3><ul class="checks">${score.checks.map(c => `<li class="${c.pass ? 'pass' : 'fail'}">${esc(c.label)}</li>`).join('')}</ul>${issuesList(score.trace.issues)}<p class="muted small">${score.words} words.</p>` : ''}
    </form>` : '<p class="card">Add a job description to get practice questions.</p>'}
  </div></div>`;
}

function roleFollowups(job) {
  const list = ws.followUps.filter(f => f.jobId === job.id);
  return `<div class="card accent"><h3>Draft a follow-up</h3><p class="muted small">Job Coach writes drafts only. Copy one and send it from your own email when you are ready.</p>
    <form class="row" data-form="followup" data-job="${esc(job.id)}" style="align-items:flex-end"><div style="flex:1;min-width:200px"><label for="fu-kind">Type</label><select id="fu-kind" name="kind">${C.FOLLOW_UP_KINDS.map(k => `<option value="${k.id}">${esc(k.label)}</option>`).join('')}</select></div><button class="btn">Draft it</button></form></div>
    ${list.slice().reverse().map(f => `<div class="card"><div class="spread"><span class="tag muted">${esc((C.FOLLOW_UP_KINDS.find(k => k.id === f.kind) || { label: f.kind }).label)}</span><span class="status ${f.status === 'copied' ? 'traced' : 'unsupported'}">${f.status === 'copied' ? 'Copied, not sent by Job Coach' : 'Draft'}</span></div>
      <label for="fs-${esc(f.id)}">Subject</label><input id="fs-${esc(f.id)}" data-k="fs-${esc(f.id)}" data-change="fu-subject" data-id="${esc(f.id)}" value="${esc(f.subject)}">
      <label for="fb-${esc(f.id)}">Message</label><textarea id="fb-${esc(f.id)}" data-k="fb-${esc(f.id)}" data-change="fu-body" data-id="${esc(f.id)}" rows="9">${esc(f.body)}</textarea>
      <div class="row" style="margin-top:8px"><button class="btn" data-act="copy-followup" data-id="${esc(f.id)}">Copy subject and message</button><button class="btn danger small" data-act="delete-followup" data-id="${esc(f.id)}">Delete</button></div></div>`).join('') || '<p class="muted">No drafts yet.</p>'}`;
}

function rolePacket(job) {
  const vs = versionsFor(job.id);
  const v = currentVersion(job.id);
  const letter = letterFor(job.id);
  let packet;
  try { packet = C.buildPacket(ws, job.id, v && v.id, letter && letter.id); } catch (e) { return `<p class="card">${esc(e.message)}</p>`; }
  return `<div class="card accent noprint"><div class="spread"><div><h3 style="margin:0">Application packet</h3><p class="muted small" style="margin:4px 0 0">Resume ${v ? esc(v.label) : '(none)'}, cover letter, and the evidence behind every line. ${vs.length > 1 ? `Change the version on <a href="#/role/${encodeURIComponent(job.id)}/resume">Resume versions</a>.` : ''}</p></div>
      <div class="row"><button class="btn" data-act="copy-packet" data-job="${esc(job.id)}">Copy as Markdown</button><button class="btn ghost" data-act="download-packet" data-job="${esc(job.id)}">Download .md</button><button class="btn ghost" data-act="print">Print or save as PDF</button></div></div>
      ${packet.problems.length ? `<p><span class="status unsupported">${packet.problems.length} thing${packet.problems.length > 1 ? 's' : ''} to fix before you send</span></p>` : '<p><span class="status traced">Ready: every line traces to your evidence</span></p>'}
      ${job.stage === 'tailoring' || job.stage === 'saved' ? `<button class="btn ghost small" data-act="mark-ready" data-job="${esc(job.id)}">Mark packet ready</button>` : ''}
    </div>
    <article class="packet">${mdToHtml(packet.markdown)}</article>`;
}

// ---------------------------------------------------------------- data

function viewData() {
  const p = ws.profile;
  return `<div class="grid2"><form class="card accent" data-form="profile"><h2>Your profile</h2><p class="muted small">Used on the resume header and to sign letters.</p>
      <label for="pf-name">Name</label><input id="pf-name" name="name" value="${esc(p.name)}">
      <label for="pf-headline">Headline</label><input id="pf-headline" name="headline" value="${esc(p.headline)}">
      <label for="pf-loc">Location</label><input id="pf-loc" name="location" value="${esc(p.location)}">
      <label for="pf-email">Email</label><input id="pf-email" name="email" type="email" value="${esc(p.email)}">
      <button class="btn" style="margin-top:10px">Save profile</button></form>
    <div><div class="card"><h2>Your data</h2>
      <p>Your workspace is saved in this browser on this device, and nowhere else. Clearing browser data erases it. Export a copy now and then.</p>
      <div class="row"><button class="btn" data-act="export">Export workspace (.json)</button>
      <label class="btn ghost" style="margin:0;font-size:.92rem">Import a workspace<input type="file" accept="application/json,.json" data-change="import" style="position:absolute;left:-9999px"></label></div>
      <p class="muted small">Importing replaces what is here. Export first if you want to keep it.</p></div>
      <div class="card"><h3>Start over</h3><div class="row"><button class="btn ghost" data-act="load-demo">Load the demo candidate</button><button class="btn danger" data-act="erase">Erase everything</button></div></div>
    </div></div>`;
}

// ---------------------------------------------------------------- events

function bulletsOf(vId) {
  return C.findById(ws.resumeVersions, vId).bullets.map(b => ({ ...b, evidenceIds: [...b.evidenceIds] }));
}

const ACTIONS = {
  'dismiss-banner': el => { const i = banners.findIndex(b => b.id === el.dataset.id); if (i >= 0) banners.splice(i, 1); render(); },
  'start-fresh': () => { if (confirm('Clear the demo candidate and start an empty workspace? Export first if you changed anything you want to keep.')) { ws = C.emptyWorkspace(); persist(); location.hash = '#/evidence'; render(); toast('Empty workspace ready. Start with your evidence.'); } },
  'delete-evidence': el => { const n = citingLines(el.dataset.id); if (confirm(n ? `This evidence is cited by ${n} resume line${n > 1 ? 's' : ''}. Those lines will be flagged as having no evidence. Delete it?` : 'Delete this evidence item?')) act(() => C.removeEvidence(ws, el.dataset.id), 'Deleted.'); },
  'delete-job': el => { if (confirm('Delete this role and its resume versions, letters, practice, debriefs and drafts? Your evidence stays.')) { act(() => C.removeJob(ws, el.dataset.job), 'Role deleted.'); location.hash = '#/roles'; } },
  'pick-version': el => { ui.version[el.dataset.job] = el.dataset.id; render(); },
  'new-version': el => act(() => { const v = C.createResumeVersion(ws, el.dataset.job, {}); ui.version[el.dataset.job] = v.id; }, 'New version started from your evidence.'),
  'dup-version': el => act(() => { const v = C.duplicateResumeVersion(ws, el.dataset.id); ui.version[v.jobId] = v.id; }, 'Duplicated. Edit the copy; compare them any time.'),
  'delete-version': el => { if (confirm('Delete this resume version? A cover letter built from it is deleted too.')) act(() => C.removeResumeVersion(ws, el.dataset.v), 'Version deleted.'); },
  'add-bullet': el => act(() => C.updateResumeVersion(ws, el.dataset.v, { bullets: [...bulletsOf(el.dataset.v), { text: 'New line: say what you did and how it turned out.', evidenceIds: [] }] })),
  'remove-bullet': el => act(() => C.updateResumeVersion(ws, el.dataset.v, { bullets: bulletsOf(el.dataset.v).filter(b => b.id !== el.dataset.b) })),
  'move-bullet': el => act(() => {
    const bs = bulletsOf(el.dataset.v); const i = bs.findIndex(b => b.id === el.dataset.b); const j = i + Number(el.dataset.d);
    if (j < 0 || j >= bs.length) return; [bs[i], bs[j]] = [bs[j], bs[i]]; C.updateResumeVersion(ws, el.dataset.v, { bullets: bs });
  }),
  'uncite': el => act(() => C.updateResumeVersion(ws, el.dataset.v, { bullets: bulletsOf(el.dataset.v).map(b => (b.id === el.dataset.b ? { ...b, evidenceIds: b.evidenceIds.filter(x => x !== el.dataset.ev) } : b)) })),
  'add-suggested': el => act(() => { const v = currentVersion(el.dataset.job); const s = C.suggestBullets(ws, el.dataset.job)[Number(el.dataset.i)]; C.updateResumeVersion(ws, v.id, { bullets: [...bulletsOf(v.id), s] }); }, 'Line added.'),
  'pick-question': el => { ui.question[el.dataset.job] = el.dataset.q; render(); },
  'copy-letter': async el => { const l = C.findById(ws.coverLetters, el.dataset.l); toast((await copyText(C.letterText(l))) ? 'Letter copied.' : 'Could not copy. Select the text and copy it.'); },
  'copy-followup': async el => {
    const f = C.findById(ws.followUps, el.dataset.id);
    if (await copyText(`Subject: ${f.subject}\n\n${f.body}`)) act(() => C.saveFollowUp(ws, { ...f, copied: true }), 'Copied. Send it from your own email.');
    else toast('Could not copy. Select the text and copy it.');
  },
  'delete-followup': el => act(() => { ws.followUps = ws.followUps.filter(f => f.id !== el.dataset.id); }, 'Draft deleted.'),
  'copy-packet': async el => { const j = el.dataset.job; const v = currentVersion(j); const l = letterFor(j); toast((await copyText(C.buildPacket(ws, j, v && v.id, l && l.id).markdown)) ? 'Packet copied as Markdown.' : 'Could not copy.'); },
  'download-packet': el => { const j = el.dataset.job; const job = C.findById(ws.jobs, j); const v = currentVersion(j); const l = letterFor(j); download(`packet-${(job.company + '-' + job.title).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`, C.buildPacket(ws, j, v && v.id, l && l.id).markdown, 'text/markdown'); },
  'mark-ready': el => act(() => C.moveStage(ws, el.dataset.job, 'ready', { note: 'Packet checked' }), 'Moved to Packet ready.'),
  'print': () => window.print(),
  'export': () => { download(`job-coach-workspace-${C.today()}.json`, C.exportWorkspace(ws), 'application/json'); toast('Exported. Keep the file somewhere safe.'); },
  'load-demo': () => { if (confirm('Replace this workspace with the demo candidate? Export first if you want to keep your work.')) { ws = buildDemoWorkspace(); persist(); location.hash = '#/pipeline'; render(); } },
  'erase': () => { if (confirm('Erase everything in this workspace? This cannot be undone unless you exported a copy.')) { ws = C.emptyWorkspace(); persist(); location.hash = '#/evidence'; render(); toast('Workspace erased.'); } },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  e.preventDefault();
  const fn = ACTIONS[el.dataset.act];
  if (fn) fn(el);
});

const CHANGES = {
  'bullet-text': el => act(() => C.updateResumeVersion(ws, el.dataset.v, { bullets: bulletsOf(el.dataset.v).map(b => (b.id === el.dataset.b ? { ...b, text: el.value } : b)) })),
  'cite': el => { if (el.value) act(() => C.updateResumeVersion(ws, el.dataset.v, { bullets: bulletsOf(el.dataset.v).map(b => (b.id === el.dataset.b ? { ...b, evidenceIds: [...b.evidenceIds, el.value] } : b)) })); },
  'version-label': el => act(() => C.updateResumeVersion(ws, el.dataset.v, { label: el.value })),
  'version-summary': el => act(() => C.updateResumeVersion(ws, el.dataset.v, { summary: el.value })),
  'compare': el => { const j = el.dataset.job; const cur = ui.compare[j] || { a: document.getElementById('cmp-a').value, b: document.getElementById('cmp-b').value }; ui.compare[j] = { ...cur, [el.dataset.side]: el.value }; render(); },
  'letter-para': el => act(() => { const l = C.findById(ws.coverLetters, el.dataset.l); const paras = l.paras.map((p, i) => (i === Number(el.dataset.i) ? { ...p, text: el.value } : p)); C.saveCoverLetter(ws, l.jobId, l.versionId, paras, l.id); }),
  'fu-subject': el => act(() => { const f = C.findById(ws.followUps, el.dataset.id); C.saveFollowUp(ws, { ...f, subject: el.value }); }),
  'fu-body': el => act(() => { const f = C.findById(ws.followUps, el.dataset.id); C.saveFollowUp(ws, { ...f, body: el.value }); }),
  'import': el => {
    const file = el.files && el.files[0];
    if (!file) return;
    file.text().then(text => {
      try {
        const { ws: next, warnings } = C.importWorkspace(text);
        if (!confirm(`Replace this workspace with "${file.name}"? It has ${next.jobs.length} role${next.jobs.length === 1 ? '' : 's'} and ${next.evidence.length} evidence item${next.evidence.length === 1 ? '' : 's'}.`)) return;
        ws = next; persist();
        for (const w of warnings) addBanner('warn', w);
        location.hash = '#/pipeline'; render(); toast('Workspace imported.');
      } catch (err) { toast(err.message); }
    }).catch(() => toast('Could not read that file.'));
  },
};

document.addEventListener('change', e => {
  const el = e.target.closest('[data-change]');
  if (!el) return;
  const fn = CHANGES[el.dataset.change];
  if (fn) fn(el);
});

const FORMS = {
  evidence: (f, d) => act(() => { if (f.dataset.id) C.updateEvidence(ws, f.dataset.id, d); else C.addEvidence(ws, d); location.hash = '#/evidence'; }, f.dataset.id ? 'Saved.' : 'Added to your library.'),
  job: (f, d) => { const j = act(() => C.addJob(ws, d), 'Role added.'); if (j) location.hash = `#/role/${encodeURIComponent(j.id)}`; },
  'job-edit': (f, d) => act(() => C.updateJob(ws, f.dataset.job, d), 'Saved.'),
  stage: (f, d) => act(() => C.moveStage(ws, f.dataset.job, d.stage, d), 'Recorded.'),
  'draft-letter': (f, d) => {
    const existing = letterFor(f.dataset.job);
    if (existing && !confirm('Redraft replaces your current letter, including your edits. Continue?')) return;
    act(() => { const draft = C.draftCoverLetter(ws, f.dataset.job, d.versionId || null); C.saveCoverLetter(ws, f.dataset.job, d.versionId || null, draft.paras, existing && existing.id); }, 'Drafted from your evidence.');
  },
  practice: (f, d) => {
    const q = C.generateQuestions(ws, f.dataset.job).find(x => x.id === f.dataset.q);
    act(() => C.savePractice(ws, { ...d, id: f.dataset.id || undefined, jobId: f.dataset.job, questionId: f.dataset.q, question: q ? q.text : '' }), 'Saved. See the checklist below.');
  },
  debrief: (f, d) => act(() => C.addDebrief(ws, { ...d, jobId: f.dataset.job }), 'Debrief saved.'),
  followup: (f, d) => act(() => { const dr = C.draftFollowUp(ws, f.dataset.job, d.kind); C.saveFollowUp(ws, { jobId: f.dataset.job, kind: d.kind, ...dr }); }, 'Draft ready. Edit it, then copy.'),
  profile: (f, d) => act(() => C.setProfile(ws, d), 'Profile saved.'),
};

document.addEventListener('submit', e => {
  const f = e.target.closest('[data-form]');
  if (!f) return;
  e.preventDefault();
  const fn = FORMS[f.dataset.form];
  if (fn) fn(f, formData(f));
});

boot();
