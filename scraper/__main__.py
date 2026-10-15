"""Fetch one term/subject from the Schedule of Classes and print a summary.

Usage:
    py -m scraper --term "Spring 2027" --subject CYBR
    py -m scraper --term 0007 --subject CYBR --min-count 40 --out out/cybr.json
"""

import argparse
import collections
import datetime
import json
import pathlib
import sys

from . import soc


def main(argv=None):
    p = argparse.ArgumentParser(prog="scraper", description=__doc__.splitlines()[0])
    p.add_argument("--term", required=True, help='term id or label, e.g. 0007 or "Spring 2027"')
    p.add_argument("--subject", default="", help="course subject code, e.g. CYBR (default: all)")
    p.add_argument("--level", default="G", choices=["G", "U", ""], help="G, U, or empty for both")
    p.add_argument("--modality", default="", help="Course_Delivery_Method value (default: any)")
    p.add_argument("--min-count", type=int, default=1, help="fail if fewer sections are found")
    p.add_argument("--out", type=pathlib.Path, help="write sections as JSON to this file")
    args = p.parse_args(argv)

    try:
        fields, terms, info = soc.load_form()
        print(info)
        print(f"form fields: {len(fields)}; terms: {terms}")
        term_id = soc.resolve_term(terms, args.term)
        html, info = soc.search(fields, term_id, args.level, args.subject, args.modality)
        print(info)
        declared, records = soc.parse_results(html)
        sections = soc.validate(declared, records, args.level, args.subject)
    except soc.FetchError as e:
        print(f"BLOCKED OR FAILED REQUEST: {e}", file=sys.stderr)
        return 2
    except (soc.FormChangedError, soc.DataError, KeyError) as e:
        print(f"{type(e).__name__}: {e}", file=sys.stderr)
        return 3

    print(f"\n{terms[term_id]} ({term_id}), level={args.level or 'any'}, "
          f"subject={args.subject or 'all'}: {len(sections)} sections, all validated")
    for method, n in collections.Counter(s["delivery_method"] for s in sections).most_common():
        print(f"  {n:4d}  {method}")
    print()
    for s in sections[:8]:
        print(f"  {s['class_number']}  {s['subject']} {s['catalog_number']} {s['title'][:34]:34}"
              f"  seats={s['seats_remaining']:<3}  {s['meeting_info'][:48]}")

    if len(sections) < args.min_count:
        print(f"\nonly {len(sections)} sections, expected at least {args.min_count}", file=sys.stderr)
        return 3

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps({
            "fetched_at": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds"),
            "term": {"id": term_id, "label": terms[term_id]},
            "filters": {"level": args.level, "subject": args.subject, "modality": args.modality},
            "sections": sections,
        }, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
