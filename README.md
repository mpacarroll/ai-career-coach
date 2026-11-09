# Career Coach: "Job Coach"

Two free, private tools in your browser, part of Mick Cairn's free tools.

- **Quick Job Coach** (`tool/index.html`): improve a resume bullet, draft a cover-letter request, or build an interview prep pack. It builds a request you paste into any AI. Nothing is saved or sent.
- **Job Search Workspace** (`workspace/index.html`): a local-first workspace for a whole search. Keep an evidence library of what you have actually done, add target roles with their job descriptions, build tailored resume versions where every line cites your evidence, compare versions, draft a cover letter, track each application's stage, practice interview answers with a STAR checklist, record debriefs, draft follow-ups, and export an application packet. Saved only in this browser's storage; export and import a JSON copy any time.

**Live:** mpacarroll.github.io/ai-career-coach/

## The trace rule

Every resume line, cover-letter proof paragraph and practice answer cites evidence items. A line is flagged when it cites nothing, cites deleted evidence, or contains a number or credential word (certified, licensed, degree, MBA and similar) that does not appear in the evidence it cites. Drafted lines and letters are assembled only from the user's own words. There is no model call, no scraping, and nothing is ever sent: follow-ups are drafts the user copies.

## Layout

```
index.html               landing page
tool/index.html          Quick Job Coach (self-contained, nothing stored)
workspace/index.html     Job Search Workspace page and styles
workspace/app.js         workspace interface (rendering and events)
workspace/core.js        workspace logic: pure functions, no DOM, no network
workspace/demo.js        synthetic demo candidate (all names and numbers invented)
tests/core.test.mjs      unit tests for core.js
tests/e2e/               Playwright journey test and a tiny static server
```

No build step and no dependencies. `package.json` only names the commands.

## Try it locally

```
node tests/e2e/serve.mjs 8787
# open http://localhost:8787/workspace/
```

The first visit opens on a made-up candidate, Jordan Reyes, partway through a search: a role at Interviewing with two resume versions (v1 has a flagged overreach, v2 is clean), a cover letter, a practiced answer, a debrief and a thank-you draft. "Clear the demo and start fresh" gives an empty workspace.

## Tests

```
npm test            # unit tests (node --test), no install needed
npm run test:e2e    # Playwright end-to-end journey; needs Playwright with Chromium
```

A coaching aid, not a guarantee of employment. No finance advice. Not affiliated with any employer.

## License
MIT, see [LICENSE](LICENSE).
