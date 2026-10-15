# MS Cyber Advising

A course planner for UAlbany MS in Cybersecurity and Risk students and their
advisors: https://unaltatar.github.io/MS_Cyber_Advising/

A student picks a concentration, a term and the class formats they can take,
then pastes their course history. The page shows which requirements are done,
in progress or still needed, and which sections in the chosen term fill them,
with times, instructors and the seats actually open to that student. It also
shows the program-wide list of sections in the advising-sheet layout.

## Privacy

This repository never contains student data. It holds code, public registrar
schedule data and public program requirements only.

The pasted course history is processed only in the browser. The page has no
server, uses no AI service, stores nothing, and its Content Security Policy
blocks it from sending data to any other site. Tests use a synthetic history.

## How it works

The browser cannot read albany.edu directly, so a GitHub Actions workflow
(`.github/workflows/pages.yml`) runs every hour. It queries the
[Schedule of Classes](https://www.albany.edu/registrar/schedule-classes) for
every listed term, keeps the sections the programs use, validates them, and
publishes the site with fresh data. If validation fails, nothing is published
and the previous site stays up. The page warns when its data is over a day old.
To refresh by hand: Actions, "Update data and publish site", Run workflow.

| Path | What it is |
|---|---|
| `programs.toml` | Program requirements, reserved-seat groups and 400/500-level exclusions. Edit this to change rules. |
| `scraper/` | Python (standard library only) client for the registrar's search script, and the data build. |
| `docs/` | The static site. `advising.js` holds the rules; `app.js` renders the page. |
| `tests/` | Python and JavaScript tests. |

The registrar's search script maps form fields to data columns by position, so
the scraper reads the live form on every run, submits fields in page order and
validates every record.

## Rules applied

- Grades follow the Graduate Bulletin: C- and below, I, U, W, Z and V earn no
  graduate credit; B-, C+ and C count only if the degree average stays at 3.0.
  For a repeated course the higher grade counts.
- A graduate course cannot be taken after credit for its listed equivalent
  (usually the 400-level version). It is never counted as taken. If it is a
  required course, the page notes it and the student takes one more elective
  instead. In a "choose" list the page notes it and the student picks another.
- Sections whose description says "Graduate Business Students Only" are not
  shown, because CEHC students cannot register for them. Courses with no open
  section are also left out of the "choose from" lists.
- Seats for a student are the open seats plus the seats reserved for their
  concentration. Each concentration appears under its old code and its new
  name; both pools are counted.
- CINF 523 modules count each time. The transcript does not show the topic, so
  the page reminds the student to check that a new module is a different topic.

## Running locally

Python 3.12 or newer and Node 18 or newer. On Windows use `py`:

```
py -m scraper build                 # fetch all terms into docs/data/
py -m http.server 8000 --directory docs
py -m unittest discover -s tests
node --test tests/advising.test.mjs
py -m scraper fetch --term "Spring 2027" --subject CYBR
```
