---
name: new-feature
description: Build a new feature for the MS Cyber course planner in its own git worktree, following CLAUDE.md
argument-hint: <feature description>
disable-model-invocation: true
---

# New Feature: $ARGUMENTS

## Context

Recent commits:
!`git log --oneline -5`

Uncommitted changes:
!`git status --short`

Current branch: !`git branch --show-current`

## Task

Implement the feature described below with strict adherence to `CLAUDE.md`.

**Feature description:** $ARGUMENTS

## Guardrails

0. **Never use em dashes** in any text you write: site copy, comments, docs or commit messages. Use a comma, a colon, brackets or a full stop.
1. **Read before write.** Read `CLAUDE.md` and every file you are about to change before editing it.
2. **No dependencies.** Python and browser code use the standard library only, and there is no `package.json`. Do not add a dependency without the user's approval.
3. **Follow existing patterns.** Look at neighbouring files for code style, naming, imports and structure, and mimic them.
4. **Comments** match the density of neighbouring code and explain why, not what.
5. **Never read, print or copy `.env`.**
6. **Student privacy.** Never put student data in the repo, tests, screenshots or memory. Tests use synthetic course histories. `docs/` is published to the web, so never place documents there. The page must not send anything off the browser (see CLAUDE.md).
7. **Rules live in `programs.toml`.** Requirement and course-list changes go there, not in code.

## Workflow

### 1. Isolate with a worktree

Work in a dedicated git worktree so `main` stays untouched.

Pick a short kebab-case slug of two to four words from the feature description (for example `evening-filter`). If a branch with that name already exists (`git branch --list "feature/<slug>"`), pick another.

```bash
SLUG="<slug>"
MAIN_ROOT="$(git rev-parse --show-toplevel)"
BRANCH="feature/${SLUG}"
WORKTREE="${MAIN_ROOT}/.claude/worktrees/${SLUG}"
git worktree add -b "${BRANCH}" "${WORKTREE}" main
echo "MAIN_ROOT=${MAIN_ROOT} BRANCH=${BRANCH} WORKTREE=${WORKTREE}"
```

Each Bash call starts a fresh shell, so these variables do not survive. Note the three printed values and use them literally in every later step.

There are no packages to install. `docs/data/` is generated and not in git, so a new worktree has none. To preview the site, run `cd "<WORKTREE>" && py -m scraper build`.

All later work happens inside `<WORKTREE>`. **Never edit files in `<MAIN_ROOT>`.**

### 2. Understand the codebase

Inside the worktree:

1. Read `CLAUDE.md`.
2. Search the codebase to locate files relevant to the feature.
3. Read neighbouring files to understand code style, naming, imports and structure.

### 3. Plan

List every file to create or edit, the tests you will add, and any `programs.toml` or workflow changes. Flag trade-offs.

**Present the plan and wait for the user's go-ahead before editing anything.**

### 4. Implement

Apply changes inside the worktree, following existing conventions.

- Logic in `docs/advising.js` gets tests in `tests/advising.test.mjs`.
- Logic in `scraper/` gets tests in `tests/test_soc.py`.
- If you change `programs.toml`, run `py -m scraper check`.

### 5. Verify

Run the check command inside the worktree:

```bash
cd "<WORKTREE>" && py -m unittest discover -s tests && node --test tests/advising.test.mjs
```

Fix any failures before going on. Then tell the user exactly how to see the feature working:

1. `cd "<WORKTREE>" && py -m scraper build && py -m http.server 8000 --directory docs`
2. Open http://localhost:8000 and choose a concentration.
3. Paste a synthetic course history and say what to look for.

### 6. Commit

Stage files by path, never with `-A` or `.`, and check the list before committing:

```bash
git -C "<WORKTREE>" add <file> <file> ...
git -C "<WORKTREE>" diff --cached --name-only
git -C "<WORKTREE>" commit -m "<short imperative subject, e.g. Add evening-only filter>"
```

### 7. Merge back (requires user confirmation)

**Do NOT merge automatically.** Present a summary and wait for explicit confirmation.

Once the user confirms, check that the main checkout is on `main` with no uncommitted changes, then merge:

```bash
git -C "<MAIN_ROOT>" branch --show-current
git -C "<MAIN_ROOT>" status --short
git -C "<MAIN_ROOT>" merge --no-ff "<BRANCH>" -m "Merge <BRANCH>"
```

If the merge has conflicts, resolve them in `<MAIN_ROOT>`, run the check command there, and ask the user to confirm again before committing.

Pushing `main` deploys the public site. Push only after the user says so.

### 8. Clean up the worktree

After a successful merge:

```bash
git -C "<MAIN_ROOT>" worktree remove "<WORKTREE>"
git -C "<MAIN_ROOT>" branch -d "<BRANCH>"
```

If the user declines the merge, leave the worktree intact and report its path so they can inspect it.

## Output

- List every file created or modified.
- Note any `programs.toml` or workflow changes.
- Flag any trade-offs or deferred items.
- State the worktree path and branch name.
