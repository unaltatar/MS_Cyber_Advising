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
- `.github/workflows/pages.yml`: hourly, on push and on demand: test, build, deploy to Pages. Any failure means no deploy, so the last good site stays up.
  - Data is never committed.
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

- Grades follow the Graduate Bulletin:
  - C- and below, I, U, W, Z and V earn no graduate credit.
  - B-, C+ and C count only if the degree GPA stays at 3.0 or higher.
  - For a repeated course, the higher grade counts.
- 400/500 exclusions: the 500-level course is never counted as taken.
  - In a required slot: show a note, and add one extra elective (+3 credits).
  - In a choose list: show a note, and the student picks another course.
- Sections whose description says "Graduate Business Students Only" are hidden. Courses with no open section are dropped from "choose from" lists.
- A concentration's old code (DFC-MS-RISKPCC) and new name (Cyber Risk Mgmt & Cmpl MS conc) are one program, so their seat pools are added. The Health pair works the same way.
- CYBR 555 is a Tools course.
- Only CYBR 678 and CYBR 699 fill Thesis or Internship.
  - CYBR 578 (an internship with no credit minimum) and CYBR 627 count only as electives.
  - Per-course notes live in `settings.course_notes`.
  - Supervised courses are shown as one row per course. That changes only the display, never which requirement a course fills.
- CINF 523 is three 1-credit modules and is repeatable. If the student already has a module, the page reminds them to check that the new topic is different.
- Old CEHC and RPAD codes are retired, so there are no code aliases.
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
