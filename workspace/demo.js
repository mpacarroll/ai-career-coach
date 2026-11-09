// Synthetic demo candidate. Every person, company and number here is invented for the demo.
// The journey: a school operations coordinator who taught for years, now targeting customer
// success roles. One role runs end to end, from job description to interview debrief; a
// second sits at "Saved" so the pipeline has more than one card.

import {
  emptyWorkspace, setProfile, addEvidence, addJob, moveStage, createResumeVersion,
  updateResumeVersion, draftCoverLetter, saveCoverLetter, savePractice, addDebrief,
  draftFollowUp, saveFollowUp, generateQuestions,
} from './core.js';

export const DEMO_JD = `Customer Success Manager, Tallgrass Software (fictional company)

Tallgrass makes scheduling software for small clinics. You will own a book of about 60 clinic accounts after onboarding.

What you'll do
- Lead onboarding for new clinics and get them to go-live in their first month.
- Own renewals and reduce churn across your accounts.
- Run training workshops for front-desk staff.
- Partner with the product team and engineering to resolve escalations.
- Track account health in our CRM and report on metrics to leadership.

What you bring
- Experience in customer success, customer support or a client-facing role.
- Strong communication: you can explain a workflow to a non-technical audience.
- Comfortable with data analysis in spreadsheets.
- You can de-escalate upset customers with patience.`;

export const DEMO_JD_2 = `Implementation Specialist, Brightwater Learning (fictional company)

You will manage onboarding projects for school districts, coordinate timelines with district staff, and deliver training to teachers. Experience with curriculum or instruction is a plus. Must be comfortable with project management and documentation.`;

export function buildDemoWorkspace() {
  const ws = emptyWorkspace();
  setProfile(ws, { name: 'Jordan Reyes', headline: 'Operations coordinator moving into customer success', location: 'Remote', email: 'jordan.reyes@example.com' });

  const e1 = addEvidence(ws, {
    id: 'ev_demo_ops', kind: 'role', title: 'Operations Coordinator', org: 'Maple Hill School (fictional)', start: '2022', end: 'present',
    text: 'Responsible for the front office schedule and supply orders for a staff of 45. Redesigned the supply order workflow with a shared spreadsheet so requests stopped getting lost.',
    metrics: ['order errors down from about 12 a month to 3', 'saved about 4 hours a week'],
    skills: ['Operations', 'Process improvement'],
  });
  const e2 = addEvidence(ws, {
    id: 'ev_demo_parents', kind: 'role', title: 'Parent liaison (part of the coordinator role)', org: 'Maple Hill School (fictional)', start: '2022', end: 'present',
    text: 'Handled parent complaints and escalations at the front desk, calming upset families and following up until the issue was resolved.',
    metrics: ['about 20 parent escalations a month'],
    skills: ['Conflict resolution', 'Customer support', 'Relationship management'],
  });
  const e3 = addEvidence(ws, {
    id: 'ev_demo_training', kind: 'project', title: 'New attendance system rollout', org: 'Maple Hill School (fictional)', start: '2023', end: '2023',
    text: 'Led onboarding for a new attendance system: wrote the how-to guide, ran training workshops for 30 teachers, and answered questions during the first month after go-live.',
    metrics: ['30 teachers trained', 'all staff using it within 3 weeks'],
    skills: ['Onboarding', 'Training', 'Communication'],
  });
  const e4 = addEvidence(ws, {
    id: 'ev_demo_teacher', kind: 'role', title: 'Grade 5 Teacher', org: 'Cedar Park Elementary (fictional)', start: '2016', end: '2022',
    text: 'Taught a class of 28 students and wrote lesson plans for the grade team. Explained new material to students and families who found it confusing.',
    metrics: ['class of 28'],
    skills: ['Training', 'Communication', 'Curriculum design'],
  });
  const e5 = addEvidence(ws, {
    id: 'ev_demo_data', kind: 'project', title: 'Attendance follow-up report', org: 'Maple Hill School (fictional)', start: '2024', end: '2024',
    text: 'Built a weekly spreadsheet report of students with repeated absences and shared it with counselors, who used it to decide which families to call first.',
    metrics: ['weekly report to 3 counselors'],
    skills: ['Data analysis', 'Cross-functional collaboration'],
  });
  const e6 = addEvidence(ws, {
    id: 'ev_demo_vendor', kind: 'project', title: 'Vendor contract renewal', org: 'Maple Hill School (fictional)', start: '2024', end: '2024',
    text: 'Coordinated the renewal of the copier and supply vendor contracts, comparing three quotes and presenting a recommendation to the principal.',
    metrics: ['3 quotes compared'],
    skills: ['Budgeting', 'Project management', 'Communication'],
  });

  const job = addJob(ws, { id: 'job_demo_tallgrass', title: 'Customer Success Manager', company: 'Tallgrass Software', location: 'Remote', source: 'Company careers page', jd: DEMO_JD, contact: 'Sam (recruiter)', createdAt: '2026-10-19' });
  addJob(ws, { id: 'job_demo_brightwater', title: 'Implementation Specialist', company: 'Brightwater Learning', location: 'Hybrid', source: 'Referral from a former colleague', jd: DEMO_JD_2, createdAt: '2026-10-27' });

  moveStage(ws, job.id, 'tailoring', { date: '2026-10-20', note: 'Started tailoring from the evidence library' });

  // v1: the first pass, before the trace check. One line overreaches: "40%" and "certified"
  // are not in any evidence the user wrote. The trace report flags both.
  const v1 = createResumeVersion(ws, job.id, {
    label: 'v1 first pass',
    summary: 'Organized school operations coordinator with a background in teaching.',
    bullets: [
      { text: 'Responsible for the front office schedule and supply orders for a staff of 45.', evidenceIds: [e1.id] },
      { text: 'Handled parent complaints and escalations at the front desk.', evidenceIds: [e2.id] },
      { text: 'Certified trainer who ran workshops that improved adoption 40%.', evidenceIds: [e3.id] },
      { text: 'Taught a class of 28 students.', evidenceIds: [e4.id] },
    ],
  });

  // v2: tailored to the job description and cleaned up. Every number is the user's own.
  const v2 = createResumeVersion(ws, job.id, {
    label: 'v2 tailored for Tallgrass',
    summary: 'Operations coordinator and former teacher who onboards people to new systems, calms upset customers, and keeps the numbers honest.',
    basedOn: v1.id,
    bullets: [
      { text: 'Led onboarding for a new attendance system, training 30 teachers and getting all staff using it within 3 weeks.', evidenceIds: [e3.id] },
      { text: 'De-escalated about 20 parent escalations a month at the front desk, following up until each issue was resolved.', evidenceIds: [e2.id] },
      { text: 'Redesigned the supply order workflow for a staff of 45, cutting order errors from about 12 a month to 3.', evidenceIds: [e1.id] },
      { text: 'Built a weekly spreadsheet report that 3 counselors used to decide which families to call first.', evidenceIds: [e5.id] },
      { text: 'Explained new material to students and families who found it confusing, across 6 years of teaching.', evidenceIds: [e4.id] },
    ],
  });
  // The "6 years" in the last line is not written in the evidence (2016 to 2022 is, but as dates).
  // Leave it so the demo shows a subtle catch, then fix it the way a user would.
  updateResumeVersion(ws, v2.id, {
    bullets: v2.bullets.map(b => (b.text.includes('6 years') ? { ...b, text: 'Explained new material to students and families who found it confusing, as a Grade 5 teacher.' } : b)),
  });

  const draft = draftCoverLetter(ws, job.id, v2.id);
  draft.paras[1].text = draft.paras[1].text.replace('[Add one specific reason this company, in your own words.]', 'Small clinics are run by front-desk staff a lot like the ones I work beside every day, and I want to help them get more out of their tools.');
  saveCoverLetter(ws, job.id, v2.id, draft.paras);

  moveStage(ws, job.id, 'ready', { date: '2026-10-23', note: 'Packet checked: every line traces' });
  moveStage(ws, job.id, 'applied', { date: '2026-10-24', note: 'Applied through the careers page' });
  moveStage(ws, job.id, 'screening', { date: '2026-10-30', note: 'Recruiter screen booked' });
  moveStage(ws, job.id, 'interviewing', { date: '2026-11-04', note: 'Hiring manager interview' });

  const qs = generateQuestions(ws, job.id);
  const q = qs.find(x => x.skill === 'Conflict resolution') || qs[0];
  savePractice(ws, {
    jobId: job.id, questionId: q.id, question: q.text, evidenceIds: [e2.id], confidence: 4,
    situation: 'At Maple Hill I run the front desk, and about 20 times a month a parent arrives upset about something that has gone wrong.',
    task: 'One father was angry that his daughter had been marked absent three days in a row when she had been on a school trip.',
    action: 'I listened first and repeated back what he told me so he knew I understood. I checked the trip list while he was still there, found the error, and fixed the record. I called him two days later to confirm the letter home had been withdrawn.',
    result: 'The issue was resolved the same day and he thanked the principal for how it was handled. I now check trip lists against attendance every Friday.',
  });

  addDebrief(ws, {
    jobId: job.id, date: '2026-11-04', round: 'Hiring manager interview', interviewer: 'Priya',
    asked: 'Tell me about an upset customer. How would you onboard a clinic that is behind schedule? What would you do in your first 30 days?',
    wentWell: 'The upset parent story landed. Priya said the attendance rollout was very close to their clinic onboarding.',
    improve: 'My first 30 days answer was vague. I did not ask enough about how they measure account health.',
    followUpPoint: 'Your point that most clinic churn starts in the first month after go-live',
  });

  const fu = draftFollowUp(ws, job.id, 'thank-you');
  saveFollowUp(ws, { jobId: job.id, kind: 'thank-you', subject: fu.subject, body: fu.body });

  return ws;
}
