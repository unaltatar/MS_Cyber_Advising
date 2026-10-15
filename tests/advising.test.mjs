// Tests for docs/advising.js. Run: node --test tests/advising.test.mjs
// The transcript below is synthetic. Never put a real student's history in this repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as A from "../docs/advising.js";

const SYNTHETIC = `
Spring 2027
-- (3) CYBR555|LEC Prevention Protection Strategy  ENRL
Term at a glance:
Cum GPA: 3.5
Fall 2026
3 CYBR503|SEM Advanced Networking & Security  B-
3 CYBR545|LEC Prin & Pract of Cyber Security  C-
1 CINF523|LEC Fund Info Technology  A
1 CINF523|LEC Fund Info Technology  A-
1 CINF523|LEC Fund Info Technology  B+
Spring 2026
3 CYBR545|LEC Prin & Pract of Cyber Security  A
3 CYBR547|LEC Cybersecurity Risk and Policy  B+
0 (3) CYBR569|LEC Cyber Threats and Intelligence  W
Fall 2025
3 CYBR453|LEC Information Security & Privacy  A
3 BFOR415|LEC Hacking Fundamentals  B
0 AHIS100|DIS Amr Poltcl and Social His I  -
3 AHIS100|LEC Amr Poltcl and Social His I  #S
High School: Example High School
`;

const RISK = {
  id: "risk", seat_groups: ["RISK students", "Risk conc"], total_credits: 36,
  requirements: [
    { id: "core", label: "Core", name: "Core", type: "all", credits: 12,
      slots: [["CYBR 503", "BFOR 525"], ["CYBR 553", "BCYB 644"], ["CYBR 554", "BCYB 645"], ["CYBR 536"]] },
    { id: "optional-core", label: "Optional Core", name: "3 of 5", type: "choose", credits: 9,
      courses: ["CYBR 545", "CYBR 547", "CYBR 549", "CYBR 552", "CINF 585"] },
    { id: "tools", label: "Tools", name: "Tools", type: "choose", credits: 3,
      courses: ["CINF 523", "CYBR 555", "BFOR 615", "BFOR 642", "BFOR 643"] },
    { id: "capstone", label: "Thesis or Internship", name: "Capstone", type: "choose", credits: 3,
      courses: ["CYBR 678", "CYBR 699"], course_labels: { "CYBR 678": "Internship", "CYBR 699": "Thesis" } },
    { id: "electives", label: "Elective", name: "Electives", type: "choose", credits: 9,
      any_graduate: ["CYBR"], courses: ["BFOR 650"], receives_replaced_credits: true },
  ],
};
const OPTS = {
  exclusions: { "CYBR 553": ["CYBR 453"], "BFOR 615": ["BFOR 415", "CYBR 540"] },
  repeatable: ["CINF 523", "CYBR 699", "CYBR 678"],
};

const section = (over) => ({
  code: "CYBR 547", delivery: "online", seats_remaining: 40,
  seats: { pools: [], open: null, parsed: true },
  meeting: { days: [], start: null, end: null }, ...over,
});

test("parses course lines, terms, credits and grades; ignores headers and components", () => {
  const cs = A.parseTranscript(SYNTHETIC);
  // 13 course lines, minus the AHIS 100 discussion component.
  assert.equal(cs.length, 12);
  const enrl = cs.find((c) => c.code === "CYBR 555");
  assert.deepEqual([enrl.term, enrl.status, enrl.credits], ["Spring 2027", "in_progress", 3]);
  const w = cs.find((c) => c.code === "CYBR 569");
  assert.deepEqual([w.status, w.grade], ["no_credit", "W"]);
  assert.equal(cs.find((c) => c.code === "AHIS 100").grade, "S");
  assert.equal(cs.filter((c) => c.code === "CINF 523").length, 3);
  assert.ok(!cs.some((c) => /School/.test(c.title)));
});

test("tolerates tabs and single spaces from a different paste", () => {
  const cs = A.parseTranscript("Fall 2025\n3\tCYBR536|LEC\tInfo Security Compliance Aud\tB\n3 AXYZ210W|SEM Example Writing Course A");
  assert.deepEqual(cs.map((c) => [c.code, c.grade, c.suffix]), [["CYBR 536", "B", ""], ["AXYZ 210", "A", "W"]]);
});

test("falls back to any line with a course code", () => {
  const cs = A.parseTranscript("CYBR 536 Info Security Compliance Aud 3.00 A- Spring 2026");
  assert.deepEqual([cs[0].code, cs[0].grade, cs[0].credits, cs[0].term], ["CYBR 536", "A-", 3, "Spring 2026"]);
});

test("reads an unofficial-transcript style layout", () => {
  const text = [
    "Beginning of Graduate Record",
    "2025 Fall Term",
    "Course        Description                         Attempted Earned Grade Points",
    "CYBR  503     Advanced Networking & Security      3.000     3.000  A     12.000",
    "CYBR  536     Info Security Compliance Aud        3.000     0.000  W      0.000",
    "Term GPA 4.000   Term Totals 6.000 3.000 12.000",
    "Spring 2026 Term",
    "CYBR  545     Prin & Pract of Cyber Security      3.000     0.000         0.000",
  ].join("\n");
  const cs = A.parseTranscript(text);
  assert.deepEqual(cs.map((c) => [c.term, c.code, c.grade, c.status, c.credits]), [
    ["Fall 2025", "CYBR 503", "A", "completed", 3],
    ["Fall 2025", "CYBR 536", "W", "no_credit", 3],
    ["Spring 2026", "CYBR 545", "", "in_progress", 3],
  ]);
  assert.equal(cs[0].title, "Advanced Networking & Security");
});

test("graduate grade rules follow the Graduate Bulletin", () => {
  assert.equal(A.gradeStatus("C", true), "completed");
  assert.equal(A.gradeStatus("C-", true), "no_credit");
  assert.equal(A.gradeStatus("C-", false), "completed");
  assert.equal(A.gradeStatus("I", true), "no_credit");
  assert.equal(A.gradeStatus("#S", true), "completed");
  assert.equal(A.gradeStatus("ENRL", true), "in_progress");
});

test("evaluates requirements: best repeat, replaced course, modules, in-progress", () => {
  const ev = A.evaluate(RISK, A.parseTranscript(SYNTHETIC), OPTS);
  const [core, opt, tools, cap, elect] = ev.requirements;

  // CYBR 453 rules out CYBR 553. It is not counted as taken: it is noted, and one
  // more elective (3 credits) is required instead.
  assert.deepEqual(core.replaced.map((x) => `${x.code} by ${x.by.code}`), ["CYBR 553 by CYBR 453"]);
  assert.ok(!core.applied.some((c) => c.code === "CYBR 553"));
  assert.equal(core.needed, 9);
  assert.deepEqual(core.applied.map((c) => c.code), ["CYBR 503"]);
  assert.equal(core.openSlots.length, 2);
  assert.equal(elect.needed, 12);
  assert.deepEqual(elect.extraFrom.map((x) => x.code), ["CYBR 553"]);

  // CYBR 545 was retaken: the A counts, the C- does not.
  assert.deepEqual(opt.applied.map((c) => `${c.code} ${c.grade}`), ["CYBR 545 A", "CYBR 547 B+"]);

  // Three 1-credit CINF 523 modules fill the tools requirement, so the in-progress
  // CYBR 555 goes to electives.
  assert.equal(tools.status, "met");
  assert.equal(tools.done, 3);
  // In a choose list a ruled-out course is noted and left out of the options.
  assert.deepEqual(tools.blockedOptions.map((b) => `${b.code} by ${b.by.code}`), ["BFOR 615 by BFOR 415"]);
  assert.ok(!tools.options.includes("BFOR 615"));

  assert.deepEqual(elect.applied.map((c) => c.code), ["CYBR 555"]);
  assert.equal(elect.inProgress, 3);
  assert.equal(cap.remaining, 3);
  // The degree still needs 36 credits: the replaced core course became an elective.
  assert.equal(ev.totals.done + ev.totals.inProgress + ev.totals.remaining, 36);
});

test("courses CEHC students cannot register for are left out of the choices", () => {
  const history = "Fall 2025\n3 CYBR503|SEM Advanced Networking & Security  A";
  const ev = A.evaluate(RISK, A.parseTranscript(history), { ...OPTS, unavailable: ["BCYB 645", "BFOR 643", "BFOR 650"] });
  const [core, , tools, , elect] = ev.requirements;
  assert.deepEqual(core.openSlots, [["CYBR 553", "BCYB 644"], ["CYBR 554"], ["CYBR 536"]]);
  assert.deepEqual(tools.options, ["CINF 523", "CYBR 555", "BFOR 615", "BFOR 642"]);
  assert.deepEqual(elect.options, []);
});

test("warns about B- balancing; a retaken C- is not flagged", () => {
  const ev = A.evaluate(RISK, A.parseTranscript(SYNTHETIC), OPTS);
  const kinds = ev.warnings.map((w) => `${w.kind}:${w.course?.code ?? ""}`);
  assert.ok(kinds.includes("balance:CYBR 503"));
  assert.ok(!kinds.includes("no_credit:CYBR 545"));
  // (3*2.7 + 3*4 + 3*3.3 + 1*4 + 1*3.7 + 1*3.3) / 12
  assert.equal(ev.gpa.toFixed(3), "3.417");
});

test("an unrepeated C- is flagged", () => {
  const ev = A.evaluate(RISK, A.parseTranscript("Fall 2025\n3 CYBR536|LEC Info Security Compliance Aud  C-"), OPTS);
  assert.equal(ev.warnings[0].kind, "no_credit");
  assert.equal(ev.requirements[0].applied.length, 0);
});

test("section fit is personal: taken, blocked, and which requirement it fills", () => {
  const ev = A.evaluate(RISK, A.parseTranscript(SYNTHETIC), OPTS);
  assert.equal(A.sectionFit(RISK, ev, section({ code: "CYBR 545" })).reason, "taken");
  assert.equal(A.sectionFit(RISK, ev, section({ code: "CYBR 553" })).reason, "blocked");
  assert.equal(A.sectionFit(RISK, ev, section({ code: "CYBR 554" })).label, "Core");
  assert.equal(A.sectionFit(RISK, ev, section({ code: "CYBR 549" })).label, "Optional Core");
  assert.equal(A.sectionFit(RISK, ev, section({ code: "CYBR 699" })).label, "Thesis");
  // Tools is met, so another CINF 523 module is not needed.
  assert.equal(A.sectionFit(RISK, ev, section({ code: "CINF 523" })).reason, "not_needed");
  assert.equal(A.programLabel(RISK, "CYBR 547"), "Optional Core");
  assert.equal(A.programLabel(RISK, "HHPM 669"), null);
});

test("seats: open pool plus the student's own reserved pools", () => {
  const s = section({
    seats_remaining: 40,
    seats: { parsed: true, open: 20, pools: [
      { group: "RISK students", seats: 7 }, { group: "HEALTH students", seats: 5 },
      { group: "Risk conc", seats: 5 }, { group: "Health conc", seats: 3 }] },
  });
  const r = A.seatsFor(RISK, s);
  // 20 open + both pools of this concentration (old code 7, new name 5).
  assert.deepEqual([r.forYou, r.total, r.reserved, r.others.length], [32, 40, 12, 2]);
  assert.equal(A.seatsFor(RISK, section({ seats_remaining: 12 })).forYou, 12);
  const reservedOnly = section({ seats: { parsed: true, open: 0, pools: [{ group: "SPH only", seats: 15 }] } });
  assert.equal(A.seatsFor(RISK, reservedOnly).forYou, 0);
});

test("preferences: modality, days, earliest start; async and supervised always pass time and format", () => {
  const evening = section({ delivery: "in_person", meeting: { days: ["TH"], start: "18:00", end: "20:50" } });
  const syncOnline = section({ delivery: "online", meeting: { days: ["T"], start: "15:00", end: "17:50" } });
  const async = section({ delivery: "online" });
  const internship = section({ code: "CYBR 678", delivery: "online" });
  const p = (o) => ({ modality: "any", days: null, earliest: "", ...o });
  assert.equal(A.matchesPreferences(evening, p({ modality: "online" })), false);
  assert.equal(A.matchesPreferences(evening, p({ modality: "in_person", earliest: "17:00" })), true);
  assert.equal(A.matchesPreferences(syncOnline, p({ earliest: "17:00" })), false);
  assert.equal(A.matchesPreferences(async, p({ earliest: "17:00", days: new Set(["M"]) })), true);
  assert.equal(A.matchesPreferences(evening, p({ days: new Set(["M", "T", "W"]) })), false);
  assert.equal(A.matchesPreferences(internship, p({ modality: "in_person" })), true);
});

test("left-over courses: extra when a full requirement would take them, otherwise not counted", () => {
  const history = [
    "Fall 2025",
    ...["545", "547", "549", "552"].map((n) => `3 CYBR${n}|LEC Course ${n}  A`),
    "3 HHPM525|LEC Public Health Course  A",
  ].join("\n");
  const narrow = { ...RISK, requirements: RISK.requirements.filter((r) => r.id !== "electives") };
  const program = { ...narrow, requirements: [...narrow.requirements,
    { id: "electives", label: "Elective", name: "Electives", type: "choose", credits: 0, courses: [], any_graduate: ["CYBR"], receives_replaced_credits: true }] };
  const ev = A.evaluate(program, A.parseTranscript(history), OPTS);
  const left = Object.fromEntries(ev.unapplied.map((u) => [u.course.code, u.extra]));
  assert.deepEqual(left, { "CYBR 552": true, "HHPM 525": false });
});

test("terms sort chronologically", () => {
  const labels = ["Summer 2026", "Spring 2027", "Fall 2026", "Winter 2027"];
  assert.deepEqual(labels.sort((a, b) => A.termKey(b) - A.termKey(a)), ["Spring 2027", "Winter 2027", "Fall 2026", "Summer 2026"]);
});
