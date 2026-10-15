// Page wiring: reads the form, runs advising.js, renders results.
// The only network requests are for this site's own data files (enforced by the CSP).
import * as A from "./advising.js";

const $ = (sel) => document.querySelector(sel);
const DAY_NAMES = { M: "Mon", T: "Tue", W: "Wed", TH: "Thu", F: "Fri", SA: "Sat", SU: "Sun" };
const SESSIONS = {
  "Semester Length": ["15W", "Full semester"],
  "8W1": ["8W1", "First 8 weeks"],
  "8W2": ["8W2", "Second 8 weeks"],
  WR: ["WR", "Winter session"],
};
const STATUS = {
  met: ["Complete", "chip-met"],
  in_progress: ["Complete once current courses finish", "chip-progress"],
  open: ["Still needed", "chip-open"],
};
const STALE_HOURS = 24;

let cfg = null;
let schedule = null;
let exclusions = {};

// Build DOM without innerHTML so registrar text and pasted text are never parsed as HTML.
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const fmtTime = (t) => {
  const [hh, mm] = t.split(":").map(Number);
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
};
const fmtCredits = (s) =>
  s.credits_min === s.credits_max ? `${s.credits_min}` : `${s.credits_min}-${s.credits_max}`;
const fmtGroup = (g) => g.replace(/\s+students$/i, "");

function sessionCell(s) {
  const [code, name] = SESSIONS[s.session] || [s.session, s.session];
  return h("abbr", { title: name }, code);
}

function whenText(s) {
  const m = s.meeting;
  if (A.SUPERVISED.has(s.code) || s.delivery === "arranged") return "Arranged";
  if (!m.start) return "No set meeting time";
  return `${m.days.map((d) => DAY_NAMES[d] || d).join(", ")} ${fmtTime(m.start)}-${fmtTime(m.end)}`;
}

function whereText(s) {
  if (s.delivery === "online") return s.meeting.start ? "Online, live sessions" : "Online, asynchronous";
  if (s.delivery === "blended") return `Blended: ${s.meeting.location}`;
  return s.meeting.location || "";
}

function seatCell(program, s) {
  const seat = A.seatsFor(program, s);
  if (seat.forYou === null) return h("span", { class: "seats" }, `${s.seats_remaining}`, h("span", { class: "muted" }, " (see restrictions)"));
  const cls = seat.forYou === 0 ? "seats seats-full" : seat.forYou <= 3 ? "seats seats-low" : "seats";
  const label = seat.forYou === 0 ? "Full for you" : `${seat.forYou}`;
  return h("span", { class: cls }, label, seat.forYou !== seat.total ? h("span", { class: "muted" }, ` of ${seat.total}`) : null);
}

function seatNote(program, s) {
  const seat = A.seatsFor(program, s);
  const parts = [];
  if (seat.mine.length) {
    parts.push(`${seat.reserved} reserved for your concentration` +
      (seat.mine.length > 1 ? ` (${seat.mine.map((p) => `${fmtGroup(p.group)} ${p.seats}`).join(", ")})` : ""));
  }
  const other = seat.others.reduce((n, p) => n + p.seats, 0);
  if (other) parts.push(`${other} reserved for other groups`);
  if (seat.forYou === null) parts.push(s.special_restriction);
  return parts.join("; ");
}

function prefsFromForm() {
  const days = [...document.querySelectorAll("input[name=day]")];
  const allowed = new Set(days.filter((d) => d.checked).map((d) => d.value));
  return {
    modality: document.querySelector("input[name=modality]:checked")?.value || "any",
    days: allowed.size === days.length ? null : allowed,
    earliest: $("#earliest").value,
  };
}

function relativeAge(date) {
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function showDataStatus() {
  const fetched = new Date(schedule.fetched_at);
  const when = fetched.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  $("#data-status").textContent = `Course data from the Schedule of Classes, updated ${relativeAge(fetched)} (${when}).`;
  const ageHours = (Date.now() - fetched.getTime()) / 3600000;
  if (ageHours > STALE_HOURS) {
    const banner = $("#stale-banner");
    banner.textContent = `This course data is ${Math.floor(ageHours / 24) || 1} day(s) old, so seat counts may have changed. ` +
      "Check the Schedule of Classes for current numbers.";
    banner.hidden = false;
  }
}

// ---------- rendering ----------

function requirementCard(r, ev) {
  const [statusText, statusClass] = STATUS[r.status];
  const items = [];
  for (const c of r.applied) {
    items.push(h("li", null,
      h("strong", null, c.code), ` ${c.title} `,
      h("span", { class: "muted" }, `${c.term}${c.grade && c.status === "completed" ? `, ${c.grade}` : ""}`),
      c.status === "in_progress" ? h("span", { class: "chip chip-progress" }, "In progress") : null));
  }
  for (const x of r.replaced) {
    if (x.deficit) {
      items.push(h("li", { class: "blocked" },
        `Too few courses left in this list after ${x.code}, so ${x.credits} credits are added to electives instead.`));
    } else {
      items.push(h("li", { class: "blocked" },
        h("strong", null, x.code), ": you cannot take this course because you have credit for ",
        h("strong", null, x.by.code), ` (${x.by.term || "earlier"}). Take one more elective instead.`));
    }
  }
  for (const b of r.blockedOptions) {
    items.push(h("li", { class: "blocked" },
      h("strong", null, b.code), ": not available to you because you have credit for ",
      h("strong", null, b.by.code), ` (${b.by.term || "earlier"}). Choose another course from this list.`));
  }
  for (const x of r.extraFrom) {
    items.push(h("li", { class: "muted" },
      `Includes ${x.credits} extra credits because ${x.code} cannot be taken.`));
  }
  for (const slot of r.openSlots) {
    items.push(h("li", { class: "needed" }, "Still needed: ", h("strong", null, slot.join(" or "))));
  }
  if (r.type === "choose" && r.remaining > 0) {
    const choices = [...r.options, ...r.anyGraduate.map((s) => `any ${s} graduate course`)];
    items.push(h("li", { class: "needed" }, `${r.remaining} more credit${r.remaining === 1 ? "" : "s"} needed`,
      choices.length ? `, from ${choices.join(", ")}.` : "."));
  }
  return h("article", { class: "req" },
    h("header", { class: "req-head" },
      h("span", { class: "req-label" }, r.label),
      h("h4", null, r.name),
      h("span", { class: `chip ${statusClass}` }, statusText),
      h("span", { class: "req-credits" }, `${r.done + r.inProgress} of ${r.needed} credits`)),
    h("ul", { class: "req-items" }, items),
    r.note ? h("p", { class: "hint" }, r.note) : null);
}

// For courses taken as separate modules or topics (CINF 523), remind the student to check
// that a new section is not a topic they already took; the transcript does not show topics.
function repeatNote(ev, s) {
  if (!ev.repeatable.has(s.code) || A.SUPERVISED.has(s.code)) return null;
  const before = ev.attempts.filter((c) => c.code === s.code);
  if (!before.length) return null;
  const when = before.map((c) => c.term || "earlier").join(", ");
  return h("div", { class: "prereq" },
    `You already have ${before.length} ${s.code} module${before.length === 1 ? "" : "s"} (${when}). Check that this topic is different.`);
}

function sectionRow(program, ev, s, label) {
  return h("tr", null,
    h("td", null, h("span", { class: "req-label" }, label)),
    h("td", { class: "nowrap" }, h("strong", null, s.code)),
    h("td", null, s.title, s.topic ? h("div", { class: "topic" }, s.topic) : null,
      s.prerequisite ? h("div", { class: "prereq" }, `Prerequisite: ${s.prerequisite}`) : null,
      repeatNote(ev, s)),
    h("td", null, sessionCell(s)),
    h("td", null, fmtCredits(s)),
    h("td", { class: "nowrap" }, s.class_number),
    h("td", null, whenText(s)),
    h("td", null, whereText(s)),
    h("td", null, s.meeting.instructor || h("span", { class: "muted" }, "TBA")),
    h("td", null, seatCell(program, s), h("div", { class: "muted small" }, seatNote(program, s))));
}

function sectionTable(rows) {
  return h("div", { class: "table-wrap" },
    h("table", { class: "sections" },
      h("thead", null, h("tr", null,
        ["Fills", "Course", "Title", "Session", "Cr", "Class #", "When", "Where", "Instructor", "Seats for you"].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", null, rows)));
}

function supervisedBlock(program, groups) {
  if (!groups.size) return null;
  const rows = [...groups.values()].map(({ s, label, sections }) => {
    const people = [...new Set(sections.map((x) => x.meeting.instructor).filter(Boolean))];
    const seats = sections.map((x) => A.seatsFor(program, x).forYou ?? x.seats_remaining);
    const lo = Math.min(...seats);
    const hi = Math.max(...seats);
    const seatText = hi === 0 ? "Full" : `${lo === hi ? hi : `${lo}-${hi}`} per section`;
    return h("tr", null,
      h("td", null, h("span", { class: "req-label" }, label)),
      h("td", { class: "nowrap" }, h("strong", null, s.code)),
      h("td", null, s.title, s.prerequisite ? h("div", { class: "prereq" }, `Prerequisite: ${s.prerequisite}`) : null),
      h("td", null, `${people.length || "No"} supervisor${people.length === 1 ? "" : "s"} listed: `,
        h("span", { class: "muted" }, people.join("; ") || "TBA")),
      h("td", { class: hi === 0 ? "seats seats-full" : "" }, seatText));
  });
  return h("div", null,
    h("h4", null, "Internship, practicum and thesis"),
    h("p", { class: "hint" }, "Arrange these with a faculty supervisor and your advisor first. The class number depends on your supervisor."),
    h("div", { class: "table-wrap" }, h("table", { class: "sections" },
      h("thead", null, h("tr", null, ["Fills", "Course", "Title", "Supervisors", "Seats"].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", null, rows))));
}

function recommendations(program, ev, term, prefs) {
  const regular = [];
  const supervised = new Map();
  let hidden = 0;
  for (const s of term.sections) {
    const fit = A.sectionFit(program, ev, s);
    if (!fit.fits) continue;
    if (!A.matchesPreferences(s, prefs)) {
      hidden++;
      continue;
    }
    if (A.SUPERVISED.has(s.code)) {
      const g = supervised.get(s.code) || { s, label: fit.label, sections: [] };
      g.sections.push(s);
      supervised.set(s.code, g);
    } else {
      regular.push({ s, label: fit.label });
    }
  }
  regular.sort((a, b) => a.label.localeCompare(b.label) || a.s.code.localeCompare(b.s.code) || a.s.class_number - b.s.class_number);

  const out = [h("h3", null, `Sections in ${term.label} that count toward what you still need`)];
  if (!regular.length && !supervised.size) {
    out.push(h("p", { class: "empty" }, ev.totals.remaining === 0
      ? "Your remaining requirements are covered by completed and in-progress courses."
      : `No matching sections in ${term.label}${hidden ? " with your format and time choices" : ""}.`));
  }
  if (regular.length) out.push(sectionTable(regular.map(({ s, label }) => sectionRow(program, ev, s, label))));
  out.push(supervisedBlock(program, supervised));
  if (hidden) out.push(h("p", { class: "hint" }, `${hidden} more matching section${hidden === 1 ? " is" : "s are"} hidden by your format or time choices.`));
  return h("section", { class: "panel" }, out);
}

function summary(program, ev) {
  const tile = (value, label, cls = "") => h("div", { class: `tile ${cls}` }, h("div", { class: "tile-value" }, value), h("div", { class: "tile-label" }, label));
  return h("div", { class: "tiles" },
    tile(`${ev.totals.done}`, "credits completed"),
    tile(`${ev.totals.inProgress}`, "credits in progress"),
    tile(`${ev.totals.remaining}`, `credits still needed of ${program.total_credits}`, ev.totals.remaining ? "tile-accent" : ""),
    tile(ev.gpa === null ? "n/a" : ev.gpa.toFixed(2), ev.gpa === null ? "degree GPA (no graded courses yet)" : `degree GPA over ${ev.gpaCredits} graduate credits`,
      ev.gpa !== null && ev.gpa < 3 ? "tile-warn" : ""));
}

function leftoverNote(items, text) {
  if (!items.length) return null;
  return h("p", { class: "hint" }, text, items.map((u) => u.course.code).join(", "), ".");
}

function coursesRead(courses, ev) {
  const appliedTo = new Map();
  for (const r of ev.requirements) for (const c of r.applied) appliedTo.set(c, r.label);
  const blockers = new Map([...ev.blocked].map(([target, by]) => [by, target]));
  const counted = new Set(ev.attempts);
  const leftover = new Map(ev.unapplied.map((u) => [u.course, u.extra]));
  const howItCounts = (c) => {
    if (appliedTo.has(c)) return `${c.status === "in_progress" ? "In progress toward" : "Counts toward"} ${appliedTo.get(c)}`;
    if (blockers.has(c)) return `Rules out ${blockers.get(c)}`;
    if (!c.graduate) return "Undergraduate";
    if (c.status === "no_credit") return `No graduate credit (${c.grade})`;
    if (c.status === "unknown") return "Grade not recognized";
    if (!counted.has(c)) return "Replaced by another attempt";
    if (leftover.get(c)) return `Extra credit: the requirements it could fill are already full`;
    return "Does not count toward this concentration";
  };
  const terms = [...new Set(courses.map((c) => c.term))].sort((a, b) => A.termKey(b) - A.termKey(a));
  const rows = [];
  for (const t of terms) {
    for (const c of courses.filter((x) => x.term === t)) {
      rows.push(h("tr", { class: c.graduate ? "" : "undergrad" },
        h("td", { class: "nowrap" }, c.term || "-"),
        h("td", { class: "nowrap" }, c.code + c.suffix),
        h("td", null, c.title),
        h("td", null, c.credits),
        h("td", null, c.status === "in_progress" ? "Enrolled" : c.grade || "-"),
        h("td", null, howItCounts(c))));
    }
  }
  const grad = courses.filter((c) => c.graduate).length;
  return h("details", { class: "panel" },
    h("summary", null, `Courses read from your paste: ${courses.length} (${grad} graduate). Check that nothing is missing.`),
    h("div", { class: "table-wrap" }, h("table", { class: "sections compact" },
      h("thead", null, h("tr", null, ["Term", "Course", "Title", "Cr", "Grade", "How it counts"].map((t) => h("th", { scope: "col" }, t)))),
      h("tbody", null, rows))));
}

function programTable(program, term, prefs) {
  const groups = [...new Set(cfg.programs.flatMap((p) => p.seat_groups))];
  const rows = [];
  let hidden = 0;
  const entries = term.sections
    .map((s) => ({ s, label: A.programLabel(program, s.code) }))
    .filter((e) => e.label)
    .sort((a, b) => a.label.localeCompare(b.label) || a.s.code.localeCompare(b.s.code) || a.s.class_number - b.s.class_number);
  for (const { s, label } of entries) {
    if (!A.matchesPreferences(s, prefs)) {
      hidden++;
      continue;
    }
    const { pools, open } = s.seats;
    const pool = (g) => pools.find((p) => p.group === g)?.seats ?? "";
    const other = pools.filter((p) => !groups.includes(p.group)).reduce((n, p) => n + p.seats, 0);
    const m = s.meeting;
    rows.push(h("tr", null,
      h("td", null, h("span", { class: "req-label" }, label)),
      h("td", null, sessionCell(s)),
      h("td", null, s.subject), h("td", null, s.catalog_number),
      h("td", null, s.title, s.topic ? h("div", { class: "topic" }, s.topic) : null),
      h("td", null, fmtCredits(s)),
      h("td", null, s.class_number),
      h("td", null, m.instructor),
      h("td", null, m.start ? m.days.join("") : A.SUPERVISED.has(s.code) || s.delivery === "arranged" ? "Arranged" : "Asynchronous"),
      h("td", { class: "nowrap" }, m.start ? `${fmtTime(m.start)}-${fmtTime(m.end)}` : ""),
      h("td", null, m.location),
      h("td", { class: s.seats_remaining === 0 ? "num seats-full" : "num" }, s.seats_remaining),
      groups.map((g) => h("td", { class: "num" }, pool(g))),
      h("td", { class: "num" }, other || ""),
      h("td", { class: "num" }, pools.length ? open : "")));
  }
  return h("section", { class: "panel" },
    h("h3", null, `All ${program.name} sections in ${term.label}`),
    h("p", { class: "hint" }, "The program-wide view, as on the advising sheet. Seat columns show seats remaining in each reserved group; blank means no reservation."),
    rows.length
      ? h("div", { class: "table-wrap" }, h("table", { class: "sections sheet" },
          h("thead", null, h("tr", null,
            ["Requirement", "Session", "Sbj", "Cat #", "Title", "Cr", "Class Nbr", "Instructor", "Day", "Time", "Room", "Available Seats"]
              .map((t) => h("th", { scope: "col" }, t)),
            groups.map((g) => h("th", { scope: "col", class: "group-col" }, `Reserved: ${fmtGroup(g)}`)),
            h("th", { scope: "col", class: "group-col" }, "Reserved: other groups"),
            h("th", { scope: "col", class: "group-col" }, "Any students"))),
          h("tbody", null, rows)))
      : h("p", { class: "empty" }, `No ${program.name} sections in ${term.label}${hidden ? " with your format and time choices" : ""}.`),
    hidden ? h("p", { class: "hint" }, `${hidden} section${hidden === 1 ? " is" : "s are"} hidden by your format or time choices.`) : null);
}

function render() {
  const out = $("#results");
  out.replaceChildren();
  if (!cfg || !schedule) return;
  const program = cfg.programs.find((p) => p.id === $("#program").value);
  const term = schedule.terms.find((t) => t.id === $("#term").value);
  if (!program || !term) {
    out.append(h("p", { class: "empty" }, "Choose your concentration to see courses."));
    return;
  }
  const prefs = prefsFromForm();
  const text = $("#history").value;

  if (text.trim()) {
    const courses = A.parseTranscript(text);
    if (!courses.length) {
      out.append(h("section", { class: "panel" }, h("p", { class: "banner banner-warn" },
        "No courses were recognized in the pasted text. Paste lines that include the course code, for example ",
        h("code", null, "3 CYBR503|SEM Advanced Networking & Security  A"), ".")));
    } else {
      const ev = A.evaluate(program, courses, { exclusions, repeatable: cfg.settings.repeatable, unavailable: schedule.restricted_codes || [] });
      out.append(h("section", { class: "panel" },
        h("h3", null, `Your progress: ${program.name}`),
        summary(program, ev),
        ev.warnings.length ? h("ul", { class: "warnings" }, ev.warnings.map((w) => h("li", null, w.text))) : null,
        h("div", { class: "reqs" }, ev.requirements.map((r) => requirementCard(r, ev))),
        leftoverNote(ev.unapplied.filter((u) => u.extra),
          "Extra graduate credits, beyond what the requirements they could fill need: "),
        leftoverNote(ev.unapplied.filter((u) => !u.extra),
          "Graduate courses that do not count toward this concentration: ")));
      out.append(recommendations(program, ev, term, prefs));
      out.append(coursesRead(courses, ev));
    }
  }
  out.append(programTable(program, term, prefs));
}

let timer = null;
const renderSoon = () => {
  clearTimeout(timer);
  timer = setTimeout(render, 250);
};

async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function init() {
  try {
    [cfg, schedule] = await Promise.all([fetchJson("data/programs.json"), fetchJson("data/schedule.json")]);
  } catch (e) {
    $("#data-status").textContent = `Could not load course data (${e.message}). Try reloading the page.`;
    return;
  }
  exclusions = A.mergeExclusions(cfg.exclusions, schedule.exclusions_found);
  for (const p of cfg.programs) $("#program").append(h("option", { value: p.id }, p.name));
  const terms = [...schedule.terms].sort((a, b) => A.termKey(b.label) - A.termKey(a.label));
  for (const t of terms) $("#term").append(h("option", { value: t.id }, t.label));
  showDataStatus();

  for (const el of document.querySelectorAll("#program, #term, #earliest, input[name=modality], input[name=day]")) {
    el.addEventListener("change", render);
  }
  const history = $("#history");
  history.addEventListener("input", renderSoon);
  history.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      render();
    }
  });
  $("#analyze").addEventListener("click", render);
  $("#clear").addEventListener("click", () => {
    history.value = "";
    render();
    history.focus();
  });
  render();
}

init();
