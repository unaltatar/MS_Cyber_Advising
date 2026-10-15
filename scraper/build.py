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
    aliases = cfg.get("aliases", {})
    for old, new in aliases.items():
        _check_code(old, "aliases")
        _check_code(new, f"aliases[{old}]")
        if new in aliases:
            raise ConfigError(f"aliases: {old!r} points to {new!r}, which is itself an alias")

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
        if sum(bool(r.get("receives_waived_credits")) for r in p["requirements"]) != 1:
            raise ConfigError(f"{p['id']}: exactly one requirement must set receives_waived_credits")
    return cfg


def referenced(cfg):
    """Return (course codes named anywhere, subjects whose every graduate course matters)."""
    codes, any_subjects = set(), set()
    for p in cfg["programs"]:
        for r in p["requirements"]:
            codes.update(r.get("courses", []))
            for slot in r.get("slots", []):
                codes.update(slot)
            any_subjects.update(r.get("any_graduate", []))
    return codes, any_subjects


def fetch_all(cfg, log=print):
    codes, any_subjects = referenced(cfg)
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
            kept = [s for s in found if s["code"] in codes or s["subject"] in any_subjects]
            log(f"  {label:12} {subject}: {len(found):3d} graduate sections, {len(kept):3d} kept")
            sections.extend(kept)
        out_terms.append({"id": term_id, "label": label, "sections": sections})
    return out_terms


def write(cfg, terms, out_dir):
    out_dir = pathlib.Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    found = {}
    for t in terms:
        for s in t["sections"]:
            if s["excluded_by"]:
                found.setdefault(s["code"], set()).update(s["excluded_by"])
    schedule = {
        "fetched_at": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds"),
        "source": soc.PAGE_URL,
        "terms": terms,
        "exclusions_found": {k: sorted(v) for k, v in sorted(found.items())},
    }
    (out_dir / "schedule.json").write_text(json.dumps(schedule, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (out_dir / "programs.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")
    return schedule
