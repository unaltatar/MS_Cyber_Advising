"""Schedule of Classes tools.

Usage:
    py -m scraper build                      fetch all terms, write docs/data/
    py -m scraper fetch --term "Spring 2027" --subject CYBR
    py -m scraper check                      validate programs.toml only
"""

import argparse
import collections
import sys

from . import build, soc


def cmd_fetch(args):
    fields, terms, info = soc.load_form()
    print(info)
    print(f"form fields: {len(fields)}; terms: {terms}")
    term_id = soc.resolve_term(terms, args.term)
    html, info = soc.search(fields, term_id, args.level, args.subject, args.modality)
    print(info)
    declared, records = soc.parse_results(html)
    sections = soc.validate(declared, records, args.level, args.subject)

    print(f"\n{terms[term_id]} ({term_id}), level={args.level or 'any'}, "
          f"subject={args.subject or 'all'}: {len(sections)} sections, all validated")
    for method, n in collections.Counter(s["delivery_method"] for s in sections).most_common():
        print(f"  {n:4d}  {method}")
    print()
    for s in sections[:8]:
        m = s["meeting"]
        when = f"{'/'.join(m['days'])} {m['start']}-{m['end']}" if m["start"] else "no set time"
        print(f"  {s['class_number']}  {s['code']} {s['title'][:30]:30}  seats={s['seats_remaining']:<3}"
              f"  {when:18} {m['location'][:22]:22} {m['instructor']}")
    if len(sections) < args.min_count:
        print(f"\nonly {len(sections)} sections, expected at least {args.min_count}", file=sys.stderr)
        return 3
    return 0


def cmd_build(args):
    cfg = build.load_programs(args.programs)
    terms = build.fetch_all(cfg)
    schedule = build.write(cfg, terms, args.out)
    total = sum(len(t["sections"]) for t in schedule["terms"])
    print(f"\nwrote {args.out}: {len(schedule['terms'])} terms, {total} sections, "
          f"{len(schedule['exclusions_found'])} exclusion rules from descriptions")
    return 0


def cmd_check(args):
    cfg = build.load_programs(args.programs)
    for p in cfg["programs"]:
        print(f"{p['id']}: {p['name']}, {len(p['requirements'])} requirements, {p['total_credits']} credits")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(prog="scraper", description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="command", required=True)

    f = sub.add_parser("fetch", help="query one term and subject and print a summary")
    f.add_argument("--term", required=True, help='term id or label, e.g. 0007 or "Spring 2027"')
    f.add_argument("--subject", default="", help="course subject code, e.g. CYBR (default: all)")
    f.add_argument("--level", default="G", choices=["G", "U", ""], help="G, U, or empty for both")
    f.add_argument("--modality", default="", help="Course_Delivery_Method value (default: any)")
    f.add_argument("--min-count", type=int, default=1, help="fail if fewer sections are found")
    f.set_defaults(run=cmd_fetch)

    b = sub.add_parser("build", help="fetch every term and write the site data")
    b.add_argument("--programs", default="programs.toml")
    b.add_argument("--out", default="docs/data")
    b.set_defaults(run=cmd_build)

    c = sub.add_parser("check", help="validate programs.toml")
    c.add_argument("--programs", default="programs.toml")
    c.set_defaults(run=cmd_check)

    args = p.parse_args(argv)
    try:
        return args.run(args)
    except soc.FetchError as e:
        print(f"BLOCKED OR FAILED REQUEST: {e}", file=sys.stderr)
        return 2
    except (soc.FormChangedError, soc.DataError, build.ConfigError, KeyError) as e:
        print(f"{type(e).__name__}: {e}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
