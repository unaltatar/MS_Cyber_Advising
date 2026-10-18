"""Build the data files the advising page reads.

Fetches every term the registrar lists, for every subject the programs use,
keeps only sections that matter to the programs, and writes:

    <out>/schedule.json   sections per term, plus exclusion rules found in descriptions
    <out>/programs.json   programs.toml, validated

Nothing is written unless every check passes, so a failed run leaves the
previously published data in place.
"""

import datetime
import json
import pathlib
import re
import tomllib

from . import soc

CODE = re.compile(r"^[A-Z]{3,5} \d{3}$")
SEASONS = {"Winter": 0, "Spring": 1, "Summer": 2, "Fall": 3}
# The canary query: graduate CYBR in the newest term. Every query shares the
# same form serialization, so if this one comes back healthy the column
# mapping is sound for the whole run.
CANARY_SUBJECT = "CYBR"
CANARY_MIN_SECTIONS = 20


class ConfigError(Exception):
    """programs.toml is malformed."""


def term_sort_key(label):
    m = re.match(r"(\w+)\s+(\d{4})$", label.strip())
    if not m or m[1] not in SEASONS:
        return (0, 0)
    return (int(m[2]), SEASONS[m[1]])


def _check_code(code, where):
    if not CODE.match(code):
        raise ConfigError(f"{where}: {code!r} is not a course code like 'CYBR 503'")


def load_programs(path):
    """Read and validate programs.toml. Returns the parsed dict."""
    with open(path, "rb") as f:
        cfg = tomllib.load(f)
    settings = cfg.get("settings", {})
    for code in settings.get("repeatable", []):
        _check_code(code, "settings.repeatable")
    for code, blockers in cfg.get("exclusions", {}).items():
        _check_code(code, "exclusions")
        for b in blockers:
            _check_code(b, f"exclusions[{code}]")
    if not all(isinstance(p, str) and p.strip() for p in settings.get("hide_sections_noting", [])):
        raise ConfigError("settings.hide_sections_noting must be a list of non-empty strings")
    for table in ("course_notes", "legacy_courses"):
        for code, note in settings.get(table, {}).items():
            _check_code(code, f"settings.{table}")
            if not isinstance(note, str) or not note.strip():
                raise ConfigError(f"settings.{table}[{code}] must be a non-empty string")
    aliases = cfg.get("aliases", {})
    for code, target in aliases.items():
        _check_code(code, "aliases")
        _check_code(target, f"aliases[{code}]")
        if target in aliases or code == target:
            raise ConfigError(f"aliases[{code}]: {target!r} must be a course code, not another alias")

    programs = cfg.get("programs", [])
    if not programs:
        raise ConfigError("no [[programs]] defined")
    ids = set()
    for p in programs:
        for key in ("id", "name", "total_credits", "seat_groups", "requirements"):
            if key not in p:
                raise ConfigError(f"program {p.get('id', '?')}: missing {key!r}")
        if p["id"] in ids:
            raise ConfigError(f"duplicate program id {p['id']!r}")
        ids.add(p["id"])
        total = 0
        for r in p["requirements"]:
            where = f"{p['id']}.{r.get('id', '?')}"
            for key in ("id", "label", "name", "type", "credits"):
                if key not in r:
                    raise ConfigError(f"{where}: missing {key!r}")
            if r["type"] == "all":
                if not r.get("slots"):
                    raise ConfigError(f"{where}: type 'all' needs slots")
                for slot in r["slots"]:
                    for code in slot:
                        _check_code(code, where)
            elif r["type"] == "choose":
                if not r.get("courses") and not r.get("any_graduate"):
                    raise ConfigError(f"{where}: type 'choose' needs courses or any_graduate")
                for code in r.get("courses", []):
                    _check_code(code, where)
            else:
                raise ConfigError(f"{where}: unknown type {r['type']!r}")
            total += r["credits"]
        if total != p["total_credits"]:
            raise ConfigError(f"{p['id']}: requirements add up to {total}, not {p['total_credits']}")
        for r in p["requirements"]:
            for code in [*r.get("courses", []), *(c for slot in r.get("slots", []) for c in slot)]:
                if code in aliases:
                    raise ConfigError(f"{p['id']}.{r['id']}: use {aliases[code]!r}, not its alias {code!r}")
        if sum(bool(r.get("receives_replaced_credits")) for r in p["requirements"]) != 1:
            raise ConfigError(f"{p['id']}: exactly one requirement must set receives_replaced_credits")
        order = settings.get("label_order")
        if order is not None:
            for r in p["requirements"]:
                for label in [r["label"], *r.get("course_labels", {}).values()]:
                    if label not in order:
                        raise ConfigError(f"{p['id']}.{r['id']}: label {label!r} is not in settings.label_order")
    return cfg


def is_hidden(section, phrases):
    """True if the section's description or prerequisite contains one of the configured phrases.

    The whole description is checked: some put the note after a "Recommended
    Prerequisites" line or at the very end, outside the prerequisite sentence.
    """
    note = f"{section.get('description', '')} {section['prerequisite']}".lower()
    return any(p.lower() in note for p in phrases)


def referenced(cfg):
    """Return (course codes named anywhere, subjects whose every graduate course matters).

    Legacy courses count only if already taken, so their sections are never kept.
    """
    codes, any_subjects = set(), set()
    for p in cfg["programs"]:
        for r in p["requirements"]:
            codes.update(r.get("courses", []))
            for slot in r.get("slots", []):
                codes.update(slot)
            any_subjects.update(r.get("any_graduate", []))
    return codes - set(cfg.get("settings", {}).get("legacy_courses", {})), any_subjects


def fetch_all(cfg, log=print):
    """Return (terms, restricted_codes).

    restricted_codes lists program courses with no section open to CEHC students
    in any listed term (every section hidden, or none scheduled), so the page can
    leave them out of "choose from" lists. They still count if already taken.
    """
    codes, any_subjects = referenced(cfg)
    phrases = cfg.get("settings", {}).get("hide_sections_noting", [])
    visible_codes = set()
    subjects = sorted(any_subjects | {c.split()[0] for c in codes})
    fields, terms, info = soc.load_form()
    log(info)
    ordered = sorted(terms.items(), key=lambda kv: term_sort_key(kv[1]), reverse=True)
    newest = ordered[0][0]

    out_terms = []
    for term_id, label in ordered:
        sections = []
        for subject in subjects:
            html, info = soc.search(fields, term_id, "G", subject)
            declared, records = soc.parse_results(html)
            found = soc.validate(declared, records, "G", subject)
            if term_id == newest and subject == CANARY_SUBJECT and len(found) < CANARY_MIN_SECTIONS:
                raise soc.DataError(
                    f"canary failed: {label} graduate {subject} returned {len(found)} sections, "
                    f"expected at least {CANARY_MIN_SECTIONS}"
                )
            relevant = [s for s in found if s["code"] in codes or s["subject"] in any_subjects]
            kept = [s for s in relevant if not is_hidden(s, phrases)]
            visible_codes.update(s["code"] for s in kept)
            log(f"  {label:12} {subject}: {len(found):3d} graduate sections, {len(kept):3d} kept"
                f"{f', {len(relevant) - len(kept)} hidden' if len(relevant) > len(kept) else ''}")
            sections.extend(kept)
        out_terms.append({"id": term_id, "label": label, "sections": sections})
    return out_terms, sorted(codes - visible_codes)


def write(cfg, terms, restricted, out_dir):
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    found = {}
    for t in terms:
        for s in t["sections"]:
            s.pop("description", None)
            if s["excluded_by"]:
                found.setdefault(s["code"], set()).update(s["excluded_by"])
    schedule = {
        "fetched_at": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds"),
        "source": soc.PAGE_URL,
        "terms": terms,
        "exclusions_found": {k: sorted(v) for k, v in sorted(found.items())},
        "restricted_codes": restricted,
    }
    (out_dir / "schedule.json").write_text(json.dumps(schedule, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (out_dir / "programs.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")
    return schedule
