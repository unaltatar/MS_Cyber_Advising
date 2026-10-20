# MS Cyber Advising

Course planner for UAlbany MS in Cybersecurity and Risk students and advisors.
Live at https://unaltatar.github.io/MS_Cyber_Advising/. The repo is public.

## Commands

On Windows run Python as `py`; `python` and `python3` are Microsoft Store stubs.

```
py -m unittest discover -s tests && node --test tests/advising.test.mjs   # check command, run before every commit
py -m scraper check                       # validate programs.toml only
py -m scraper build                       # fetch every term into docs/data/ (live, about a minute)
py -m http.server 8000 --directory docs   # preview at http://localhost:8000 (needs docs/data/ from build)
py -m scraper fetch --term "Spring 2027" --subject CYBR
```

Always name the Node test file. The CI runner's Node treats `node --test tests/` as a module path and fails.

## Layout

- `programs.toml`: requirements, reserved-seat groups, 400/500 exclusions, hidden-section phrases. Rule changes go here, not in code.
- `scraper/soc.py`: registrar client and parsers. `scraper/build.py`: data build and validation.
- `docs/`: the published website. `advising.js` holds the pure rules (tested in Node); `app.js` renders. `docs/data/` is generated and gitignored.
- `tests/`: `test_soc.py` (unittest) and `advising.test.mjs` (node:test).
- `.github/workflows/pages.yml`: scheduled four times an hour (GitHub drops many scheduled runs, so about hourly in practice), on push and on demand: test, build, deploy to Pages. Any failure means no deploy, so the last good site stays up.
  - Data is never committed.
  - At deploy, `style.css`, `app.js` and the `advising.js` import are tagged `?v=<commit>` so a reload never mixes old and new code (Pages caches files for 10 minutes). A new file the page loads must be added to that step and its grep.
  - A `keepalive` job commits `.github/keepalive` when the newest commit is over 30 days old, because GitHub disables scheduled runs after 60 quiet days.
  - The bot may have pushed, so run `git pull` before pushing.

## Student privacy (FERPA): hard rules

- Never commit student data, not even anonymized. Tests use synthetic histories only.
- `docs/` is published to the web exactly as committed. Never put documents there. `docs/*.txt|pdf|xlsx|docx` are gitignored only as a backstop.
- Stage files by path and check `git diff --cached --name-only` before every commit. Never `git add -A` or `git add .`.
- A real transcript shared for a format check goes only in the session scratchpad and is deleted after use. Never in the repo, memory or screenshots.
- The page processes pasted history only in the browser. Keep it that way:
  - The CSP allows `connect-src 'self'` only. No third-party scripts and no analytics.
  - No localStorage.
  - No innerHTML: build the DOM with `h()`.
  - The textarea keeps spellcheck and Grammarly off.
- No LLM calls and no API keys, because the site is static and public.

## Registrar scraping gotchas

- `search.pl` maps POSTed fields to data columns by position. Read the live form on every run and send fields in document order. Out of order, filters silently return 0 rows and labels shift onto the wrong values.
- The term is the hidden `USER` field. Read the ids from the page's hidden `<ul>` ("0007 | Spring 2027"); never hard-code them.
- Validation must fail loudly. Every record is checked against the requested subject and level. A canary query (graduate CYBR in the newest term) must return at least 20 sections.
- "Seats remaining" is the sum of the reserved pools and the open pool. A restriction of "None" means every seat is open.

## Advising rules (confirmed with the maintainer, October 2026)

Requirements follow the 2026-27 Graduate Bulletin (cybersecurity-risk-ms.php); the rules below are the confirmed additions.

- Grades follow the Graduate Bulletin:
  - C- and below, I, U, W, Z, V and N (audit) earn no graduate credit. S and M pass; R (thesis research) is in progress.
  - B-, C+ and C count only if the degree GPA stays at 3.0 or higher.
  - For a repeated course, the higher grade counts.
- 400/500 exclusions: the 500-level course is never counted as taken.
  - In a required slot: show a note, and add one extra elective (+3 credits).
  - In a choose list: show a note, and the student picks another course.
- Sections whose description says "Graduate Business Students Only" anywhere (not only in the prerequisite) are hidden. Courses with no section open to CEHC students in any listed term are dropped from "choose from" lists, but still count if taken.
- A concentration's old code (DFC-MS-RISKPCC) and new name (Cyber Risk Mgmt & Cmpl MS conc) are one program, so their seat pools are added. The Health pair works the same way.
- CYBR 540 and CYBR 555 are Tools courses.
- Only CYBR 678 and CYBR 699 fill Thesis or Internship.
  - CYBR 578 (an internship with no credit minimum) and CYBR 627 count only as electives.
  - CYBR 678 counts once and is not repeatable, so a student takes at most two internships: 678 (capstone) and 578 (elective). CYBR 699 (1 to 6 credits) is repeatable and may be suggested as an elective after the capstone.
  - Per-course notes live in `settings.course_notes`.
  - Supervised courses are shown as one row per course. That changes only the display, never which requirement a course fills.
- CINF 523 is three 1-credit modules and is repeatable. If the student already has a module, the page reminds them to check that the new topic is different.
- Cross-listed codes with the same title count as the CYBR course (`[aliases]`: CEHC, RPAD, CINF). Same number is not enough: CEHC 553, 554 and 555 are different courses.
- Pairs block each other both ways (core alternatives 503/BFOR 525, 553/BCYB 644, 554/BCYB 645; 551/552; 540/BFOR 615). If both courses of any exclusion are on the transcript, the earlier counts and the later is flagged. This applies to 400/500 pairs too.
- HHPM 580 and HHPM 669 (2025-26 Health core) are `settings.legacy_courses`: they count if taken, are flagged for the advisor, and are never fetched or recommended.
- "New student" (step 4) plans with an empty history: every requirement open, no history panel. The textarea is disabled, not cleared. A student with related 400-level undergraduate courses should paste the history instead, because of the 400/500 exclusions.

## Writing

- Never use em dashes, in site copy, comments, docs or commit messages.
- The site UI is in English and is used by both students and advisors.
  - Use neutral wording: "student", never "you" or "your".
  - Requirement labels carry no numbers. Their order comes from `settings.label_order`.
- The maintainer writes in Turkish or English. Reply in the language of each message.
- Use the standard library only, in both Python and the browser. There is no package.json; add no dependencies without approval.
- Match the comment density of neighbouring code.
- Pushing to `main` deploys the public site, so confirm with the maintainer before pushing.
