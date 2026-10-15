// Advising rules: transcript parsing, requirement checking, section matching.
// Pure functions with no DOM access, so they run in the browser and in Node tests.
// Nothing here sends data anywhere.

// UAlbany graduate grade scale (Graduate Bulletin, "Graduate Grades").
export const GRADE_POINTS = {
  A: 4.0, "A-": 3.7, "B+": 3.3, B: 3.0, "B-": 2.7, "C+": 2.3, C: 2.0,
  "C-": 1.7, "D+": 1.3, D: 1.0, E: 0.0,
};
// Count toward the degree only if balanced to a B (3.0) average.
const BALANCE_GRADES = new Set(["B-", "C+", "C"]);
// "Not applicable to graduate program requirements; do not earn graduate credit."
const GRAD_NO_CREDIT = new Set(["C-", "D+", "D", "E", "F", "Z", "I", "V", "U", "W", "NC"]);
const UNDERGRAD_NO_CREDIT = new Set(["E", "F", "Z", "I", "V", "U", "W", "NC"]);
const IN_PROGRESS_GRADES = new Set(["ENRL", "IP", "NG", ""]);
const GRADE_TOKEN = /^#?(?:[A-E][+-]?|F|S|U|W|I|Z|V|P|NC|ENRL|IP|NG|-)$/;

// Courses that need a faculty supervisor; the registrar lists one section per instructor.
export const SUPERVISED = new Set(["CYBR 578", "CYBR 627", "CYBR 678", "CYBR 699"]);

const TERM_LINE = /^\s*(Winter|Spring|Summer|Fall)\s+(\d{4})\s*$/i;
// "3 CYBR503|SEM Advanced Networking & Security  A", "-- (3) CYBR549|LEC ... ENRL",
// "0 (3) AENG102Z|LEC Intro to Creative Writing  W"
const COURSE_LINE =
  /^\s*(--|\d+(?:\.\d+)?)?\s*(?:\((\d+(?:\.\d+)?)\))?\s*([A-Z]{3,5})\s?(\d{3})([A-Z]?)\s*\|\s*([A-Z]{2,4})\b\s*(.*)$/;
// Other layouts: any line with a course code, e.g. "CYBR 503 Advanced Networking 3.00 A".
const LOOSE_CODE = /\b([A-Z]{3,5})\s?(\d{3})([A-Z]?)\b/;

function num(s) {
  if (s === undefined || s === "--") return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function normalizeGrade(g) {
  return (g || "").replace(/^#/, "").toUpperCase();
}

export function isGraduate(number) {
  return parseInt(number, 10) >= 500;
}

// completed | in_progress | no_credit | component | unknown
export function gradeStatus(rawGrade, graduate) {
  const g = normalizeGrade(rawGrade);
  if (g === "-") return "component";
  if (IN_PROGRESS_GRADES.has(g)) return "in_progress";
  if (g === "S" || g === "P") return "completed";
  if (graduate) {
    if (GRAD_NO_CREDIT.has(g)) return "no_credit";
    if (g in GRADE_POINTS) return "completed";
  } else {
    if (UNDERGRAD_NO_CREDIT.has(g)) return "no_credit";
    if (g in GRADE_POINTS) return "completed";
  }
  return "unknown";
}

function splitGrade(rest) {
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1];
  if (last && GRADE_TOKEN.test(last)) return { title: tokens.slice(0, -1).join(" "), grade: last };
  return { title: tokens.join(" "), grade: "" };
}

function makeCourse({ subject, number, suffix, title, component, earned, attempted, grade, term, line }) {
  const graduate = isGraduate(number);
  const status = gradeStatus(grade, graduate);
  const credits = status === "in_progress" ? (attempted ?? earned ?? 3) : (earned || attempted || 0);
  return {
    code: `${subject} ${number}`, subject, number, suffix: suffix || "", title, component: component || "",
    credits, term: term || "", grade: normalizeGrade(grade), status, graduate, line,
  };
}

// Parse pasted course history. Unrecognized lines (headers, GPA lines, school
// names) are ignored, so names or IDs in a pasted header never become data.
export function parseTranscript(text) {
  const courses = [];
  let term = "";
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/\t/g, " ").trimEnd();
    if (!line.trim()) continue;
    const t = TERM_LINE.exec(line);
    if (t) {
      term = `${t[1][0].toUpperCase()}${t[1].slice(1).toLowerCase()} ${t[2]}`;
      continue;
    }
    const m = COURSE_LINE.exec(line);
    if (m) {
      const { title, grade } = splitGrade(m[7]);
      const c = makeCourse({
        subject: m[3], number: m[4], suffix: m[5], component: m[6], title, grade, term, line,
        earned: num(m[1]), attempted: num(m[2]),
      });
      if (c.status !== "component") courses.push(c);
      continue;
    }
    const loose = LOOSE_CODE.exec(line);
    if (loose) {
      const after = line.slice(loose.index + loose[0].length);
      const tokens = after.trim().split(/\s+/);
      const grade = [...tokens].reverse().find((tok) => GRADE_TOKEN.test(tok)) || "";
      const credit = tokens.map(num).find((n) => n !== null && n > 0 && n <= 6);
      const inlineTerm = /(Winter|Spring|Summer|Fall)\s+(\d{4})/i.exec(line);
      const title = tokens.filter((tok) => !GRADE_TOKEN.test(tok) && num(tok) === null).join(" ");
      const c = makeCourse({
        subject: loose[1], number: loose[2], suffix: loose[3], title, grade, line,
        term: inlineTerm ? `${inlineTerm[1]} ${inlineTerm[2]}` : term, earned: credit ?? null, attempted: null,
      });
      if (c.status !== "component") courses.push(c);
    }
  }
  return courses;
}

function rank(c) {
  if (c.status === "completed") return 2 + (GRADE_POINTS[c.grade] ?? 3.0) / 10;
  if (c.status === "in_progress") return 1;
  return 0;
}

// For each graduate course keep the attempt that counts: the best grade wins
// (the higher grade is used when a course is repeated). Repeatable courses keep
// every attempt.
export function countableAttempts(courses, repeatable) {
  const rep = new Set(repeatable);
  const best = new Map();
  const out = [];
  for (const c of courses) {
    if (!c.graduate || (c.status !== "completed" && c.status !== "in_progress")) continue;
    if (rep.has(c.code)) {
      out.push(c);
      continue;
    }
    const prev = best.get(c.code);
    if (!prev || rank(c) > rank(prev)) best.set(c.code, c);
  }
  return [...out, ...best.values()];
}

function hasCredit(c) {
  return c.status === "completed" || c.status === "in_progress";
}

// Map of graduate course -> the course on the transcript that rules it out.
export function blockedCourses(courses, exclusions) {
  const held = new Map(courses.filter(hasCredit).map((c) => [c.code, c]));
  const blocked = new Map();
  for (const [target, blockers] of Object.entries(exclusions || {})) {
    if (held.has(target)) continue;
    const by = blockers.find((b) => held.has(b));
    if (by) blocked.set(target, held.get(by));
  }
  return blocked;
}

export function mergeExclusions(...sources) {
  const out = {};
  for (const src of sources) {
    for (const [k, v] of Object.entries(src || {})) out[k] = [...new Set([...(out[k] || []), ...v])];
  }
  return out;
}

function accepts(req, code) {
  if ((req.courses || []).includes(code)) return true;
  const [subject, number] = code.split(" ");
  return (req.any_graduate || []).includes(subject) && isGraduate(number);
}

// Fill each requirement, in order, from the student's countable graduate courses.
export function evaluate(program, courses, { exclusions = {}, repeatable = [] } = {}) {
  const rep = new Set(repeatable);
  const attempts = countableAttempts(courses, repeatable);
  const pool = attempts.map((c) => ({ course: c, used: false }));
  const blocked = blockedCourses(courses, exclusions);
  const heldCodes = new Set(attempts.map((c) => c.code));
  let waivedCredits = 0;

  const take = (pred) => {
    for (const status of ["completed", "in_progress"]) {
      const hit = pool.find((p) => !p.used && p.course.status === status && pred(p.course));
      if (hit) {
        hit.used = true;
        return hit.course;
      }
    }
    return null;
  };

  const requirements = [];
  for (const req of program.requirements) {
    const r = {
      id: req.id, label: req.label, name: req.name, note: req.note || "", type: req.type,
      anyGraduate: req.any_graduate || [],
      applied: [], waived: [], openSlots: [], options: [], needed: req.credits,
    };
    if (req.type === "all") {
      const perSlot = req.credits / req.slots.length;
      for (const slot of req.slots) {
        const hit = take((c) => slot.includes(c.code));
        if (hit) {
          r.applied.push(hit);
          continue;
        }
        const code = slot.find((s) => blocked.has(s));
        if (code) {
          r.waived.push({ codes: slot, code, by: blocked.get(code), credits: perSlot });
          r.needed -= perSlot;
          waivedCredits += perSlot;
        } else {
          r.openSlots.push(slot);
        }
      }
    } else {
      if (req.receives_waived_credits) r.needed += waivedCredits;
      let got = 0;
      while (got < r.needed) {
        const hit = take((c) => accepts(req, c.code));
        if (!hit) break;
        r.applied.push(hit);
        got += hit.credits;
      }
      r.options = (req.courses || []).filter((code) => !blocked.has(code) && (rep.has(code) || !heldCodes.has(code)));
      const short = r.needed - got;
      if (short > 0 && !(req.any_graduate || []).length) {
        const capacity = r.options.reduce((sum, code) => sum + (rep.has(code) ? Infinity : 3), 0);
        if (capacity < short) {
          const moved = short - capacity;
          r.waived.push({ codes: (req.courses || []).filter((c) => blocked.has(c)), deficit: moved, credits: moved });
          r.needed -= moved;
          waivedCredits += moved;
        }
      }
    }
    const done = r.applied.filter((c) => c.status === "completed").reduce((s, c) => s + c.credits, 0);
    const inProgress = r.applied.filter((c) => c.status === "in_progress").reduce((s, c) => s + c.credits, 0);
    r.done = Math.min(done, r.needed);
    r.inProgress = Math.min(inProgress, r.needed - r.done);
    r.remaining = r.needed - r.done - r.inProgress;
    r.status = r.done >= r.needed ? "met" : r.done + r.inProgress >= r.needed ? "in_progress" : "open";
    requirements.push(r);
  }

  const gpaCourses = attempts.filter((c) => c.status === "completed" && c.grade in GRADE_POINTS && c.credits > 0);
  const qp = gpaCourses.reduce((s, c) => s + GRADE_POINTS[c.grade] * c.credits, 0);
  const gpaCredits = gpaCourses.reduce((s, c) => s + c.credits, 0);
  const gpa = gpaCredits ? qp / gpaCredits : null;

  const warnings = [];
  for (const c of courses) {
    if (c.graduate && c.status === "no_credit" && !heldCodes.has(c.code)) {
      warnings.push({
        kind: "no_credit", course: c,
        text: `${c.code} (${c.term || "term unknown"}): a grade of ${c.grade} does not earn graduate credit. ` +
          "The course must be retaken with department approval or replaced.",
      });
    }
  }
  for (const c of attempts) {
    if (BALANCE_GRADES.has(c.grade)) {
      warnings.push({
        kind: "balance", course: c,
        text: `${c.code}: a ${c.grade} counts only if the degree average stays at B (3.0) or higher.`,
      });
    }
  }
  if (gpa !== null && gpa < 3.0) {
    warnings.push({ kind: "gpa", text: `Degree GPA is ${gpa.toFixed(2)}, below the 3.0 needed to graduate.` });
  }
  for (const c of courses) {
    if (c.status === "unknown" && c.graduate) {
      warnings.push({ kind: "unknown", course: c, text: `${c.code}: grade "${c.grade}" was not recognized; check this line.` });
    }
  }

  const unapplied = pool.filter((p) => !p.used).map((p) => p.course);
  const sum = (key) => requirements.reduce((s, r) => s + r[key], 0);
  return {
    requirements, attempts, blocked, warnings, unapplied, gpa, gpaCredits,
    totals: { done: sum("done"), inProgress: sum("inProgress"), remaining: sum("remaining") },
    heldCodes, repeatable: rep,
  };
}

// Which requirement a section would fill for this student, or why it does not fit.
export function sectionFit(program, ev, section) {
  const code = section.code;
  if (ev.heldCodes.has(code) && !ev.repeatable.has(code)) return { fits: false, reason: "taken" };
  if (ev.blocked.has(code)) return { fits: false, reason: "blocked", by: ev.blocked.get(code) };
  for (let i = 0; i < program.requirements.length; i++) {
    const req = program.requirements[i];
    const r = ev.requirements[i];
    if (r.remaining <= 0) continue;
    const ok = req.type === "all" ? r.openSlots.some((slot) => slot.includes(code)) : accepts(req, code);
    if (ok) return { fits: true, requirement: r, label: (req.course_labels || {})[code] || req.label };
  }
  return { fits: false, reason: "not_needed" };
}

// Program-wide category for a course, as in the advising sheet ("1-Core", "4-Elective"...).
export function programLabel(program, code) {
  for (const req of program.requirements) {
    const listed = req.type === "all" ? req.slots.some((s) => s.includes(code)) : accepts(req, code);
    if (listed) return (req.course_labels || {})[code] || req.label;
  }
  return null;
}

// Seats this student can actually take: open seats plus any pool reserved for their program.
export function seatsFor(program, section) {
  const total = section.seats_remaining;
  const { pools, open, parsed } = section.seats;
  if (!parsed) return { forYou: null, total, mine: [], others: [] };
  if (!pools.length && open === null) return { forYou: total, total, mine: [], others: [], open: total };
  const groups = new Set(program.seat_groups);
  const mine = pools.filter((p) => groups.has(p.group));
  const others = pools.filter((p) => !groups.has(p.group));
  const forYou = Math.max(0, Math.min(total, (open || 0) + mine.reduce((s, p) => s + p.seats, 0)));
  return { forYou, total, mine, others, open: open || 0 };
}

// prefs: { modality: "online" | "in_person" | "any", days: Set<string> | null, earliest: "HH:MM" | "" }
export function matchesPreferences(section, prefs) {
  const d = section.delivery;
  // Internships, practicum and thesis are arranged with a supervisor whatever the registrar's format code says.
  if (d !== "arranged" && !SUPERVISED.has(section.code)) {
    if (prefs.modality === "online" && d !== "online") return false;
    if (prefs.modality === "in_person" && d !== "in_person" && d !== "blended") return false;
  }
  const m = section.meeting;
  if (m && m.start) {
    if (prefs.days && m.days.some((day) => !prefs.days.has(day))) return false;
    if (prefs.earliest && m.start < prefs.earliest) return false;
  }
  return true;
}

const SEASON_ORDER = { Winter: 0, Spring: 1, Summer: 2, Fall: 3 };
export function termKey(label) {
  const m = /(\w+)\s+(\d{4})/.exec(label || "");
  return m ? Number(m[2]) * 10 + (SEASON_ORDER[m[1]] ?? 0) : 0;
}
