"""Client for the UAlbany Schedule of Classes.

The registrar page posts a form to search.pl, and search.pl maps the submitted
fields to data columns by position. Fields must therefore be sent in the same
order the browser would send them (document order). Out of order, filters
silently match nothing and result labels shift onto the wrong values. To stay
safe against registrar edits, the live form is read on every run and every
parsed record is validated.
"""

import re
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

PAGE_URL = "https://www.albany.edu/registrar/schedule-classes"
SEARCH_URL = "https://www.albany.edu/cgi-bin/general-search/search.pl"
FORM_ID = "coursesearchform"
USER_AGENT = (
    "Mozilla/5.0 (compatible; MS-Cyber-Advising/0.1; "
    "+https://github.com/unaltatar/MS_Cyber_Advising)"
)

# Fields this client overrides. If one disappears from the form, the registrar
# changed the form and the column mapping can no longer be trusted.
TERM_FIELD = "USER"
LEVEL_FIELD = "Level"
SUBJECT_FIELD = "Course_Subject"
MODALITY_FIELD = "Course_Delivery_Method"

LEVELS = {"G": "Graduate", "U": "Undergraduate"}
COURSE_INFO = re.compile(r"^([A-Z]{3,5})\s+(\d{3}[A-Z]?)\s+(.*)$")


class FetchError(Exception):
    """A request failed or was challenged by Cloudflare."""


class FormChangedError(Exception):
    """The registrar form no longer looks like the one this client expects."""


class DataError(Exception):
    """Parsed records failed validation."""


def _request(url, data=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return resp.status, resp.headers, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read().decode("utf-8", errors="replace")


def _checked(label, status, headers, body):
    """Return a one-line diagnostic, raising FetchError if the response is unusable."""
    mitigated = headers.get("cf-mitigated")
    challenged = bool(mitigated) or "Just a moment" in body or "challenge-platform" in body
    info = (
        f"{label}: HTTP {status}, {len(body)} chars, "
        f"cf-ray={headers.get('cf-ray')}, cf-mitigated={mitigated}"
    )
    if status != 200 or challenged:
        raise FetchError(info + (" [Cloudflare challenge]" if challenged else ""))
    return info


class _FormParser(HTMLParser):
    """Collects the fields of one form in the order a browser would submit them."""

    def __init__(self, form_id):
        super().__init__(convert_charrefs=True)
        self.form_id = form_id
        self.in_form = False
        self.fields = []
        self._select = None
        self._option = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "form" and a.get("id") == self.form_id:
            self.in_form = True
        if not self.in_form or "disabled" in a:
            return
        if tag == "input":
            kind = (a.get("type") or "text").lower()
            name = a.get("name")
            if not name or kind in ("submit", "reset", "button", "image", "file"):
                return
            if kind in ("radio", "checkbox") and "checked" not in a:
                return
            self.fields.append((name, a.get("value") or ""))
        elif tag == "select" and a.get("name"):
            self._select = {"name": a["name"], "first": None, "selected": None}
        elif tag == "option" and self._select is not None:
            self._close_option()
            self._option = {"value": a.get("value"), "text": "", "selected": "selected" in a}

    def handle_data(self, data):
        if self._option is not None:
            self._option["text"] += data

    def handle_endtag(self, tag):
        if tag == "form" and self.in_form:
            self.in_form = False
        elif tag == "option" and self._option is not None:
            self._close_option()
        elif tag == "select" and self._select is not None:
            self._close_option()
            s = self._select
            value = s["selected"] if s["selected"] is not None else s["first"]
            self.fields.append((s["name"], value or ""))
            self._select = None

    def _close_option(self):
        o, s = self._option, self._select
        if o is None or s is None:
            return
        value = o["value"] if o["value"] is not None else o["text"].strip()
        if s["first"] is None:
            s["first"] = value
        if o["selected"]:
            s["selected"] = value
        self._option = None


def load_form():
    """Fetch the registrar page. Returns (form_fields, terms, diagnostic).

    terms maps term id to label, e.g. {"0007": "Spring 2027"}. The registrar
    keeps this list in a hidden <ul> on the page as "0007 | Spring 2027".
    """
    status, headers, html = _request(PAGE_URL)
    info = _checked("GET schedule-classes", status, headers, html)

    parser = _FormParser(FORM_ID)
    parser.feed(html)
    names = {n for n, _ in parser.fields}
    missing = {TERM_FIELD, LEVEL_FIELD, SUBJECT_FIELD, MODALITY_FIELD} - names
    if missing:
        raise FormChangedError(f"form #{FORM_ID} is missing fields: {sorted(missing)}")

    terms = dict(re.findall(r"<li[^>]*>\s*(\d{4})\s*\|\s*([^<]+?)\s*</li>", html))
    if not terms:
        raise FormChangedError("semester list (hidden '<id> | <label>' items) not found")
    return parser.fields, terms, info


def resolve_term(terms, term):
    """Accept a term id ("0007") or label ("Spring 2027", case-insensitive)."""
    if term in terms:
        return term
    for tid, label in terms.items():
        if label.lower() == term.lower():
            return tid
    raise KeyError(f"unknown term {term!r}; available: {terms}")


def search(form_fields, term_id, level="G", subject="", modality=""):
    """POST the form with the given filters. Returns (html, diagnostic)."""
    overrides = {
        TERM_FIELD: term_id,
        LEVEL_FIELD: level,
        SUBJECT_FIELD: subject,
        MODALITY_FIELD: modality,
    }
    fields = [(n, overrides.get(n, v)) for n, v in form_fields]
    body = urllib.parse.urlencode(fields).encode()
    status, headers, html = _request(SEARCH_URL, data=body)
    return html, _checked("POST search.pl", status, headers, html)


_LINE = re.compile(r"^([^:<\n]+):\s*<B>(.*?)</B>", re.M | re.S)


def parse_results(html):
    """Return (declared_count, records). Each record maps result label to value."""
    if "no classes were found" in html:
        return 0, []
    m = re.search(r"Number of matches:\s*<B>\s*(\d+)\s*</B>", html)
    if not m:
        raise DataError("result page has no 'Number of matches' line")
    records = []
    for block in re.split(r"<HR>", html, flags=re.I)[1:]:
        rec = {k.strip(): " ".join(v.split()) for k, v in _LINE.findall(block)}
        if rec:
            records.append(rec)
    return int(m.group(1)), records


_MEETING = re.compile(
    r"^(?:(?P<days>[A-Z]+)\s+)?(?P<start>\d{1,2}:\d{2}_[AP]M)-(?P<end>\d{1,2}:\d{2}_[AP]M)\s*(?P<rest>.*)$"
)
_PLACE_WORDS = {"Online", "Arranged", "TBA"}


def _to_24h(t):
    hhmm, ampm = t.split("_")
    h, m = (int(x) for x in hhmm.split(":"))
    return f"{h % 12 + (12 if ampm == 'PM' else 0):02d}:{m:02d}"


def parse_meeting(text):
    """Split Meeting Info such as "TH 04:30_PM-07:20_PM Pine Bush 132 Bace,Brianna".

    Async online and arranged sections show 12:00_AM-12:00_AM. Online sections
    with real days and times are synchronous. The instructor may be missing.
    """
    m = _MEETING.match(text)
    if not m:
        return {"days": [], "start": None, "end": None, "location": text, "instructor": "", "parsed": False}
    timed = not (m["start"] == m["end"] == "12:00_AM")
    tokens = m["rest"].split()
    # The location ends at "Online"/"Arranged" or at the room number (first token with a digit).
    cut = next((i + 1 for i, t in enumerate(tokens) if t in _PLACE_WORDS or any(c.isdigit() for c in t)), None)
    if cut is None:
        cut = next((i for i, t in enumerate(tokens) if "," in t), len(tokens))
    return {
        "days": re.findall(r"TH|SA|SU|M|T|W|F", m["days"] or ""),
        "start": _to_24h(m["start"]) if timed else None,
        "end": _to_24h(m["end"]) if timed else None,
        "location": " ".join(tokens[:cut]),
        "instructor": " ".join(tokens[cut:]),
        "parsed": True,
    }


def parse_seats(text):
    """Split Special Restriction into reserved pools and the open pool.

    "None" means every remaining seat is open (open=None, pools=[]). When the
    text names pools but no open pool, students outside those groups get 0.
    """
    text = (text or "").strip()
    if not text or text == "None":
        return {"pools": [], "open": None, "parsed": True}
    pools = [
        {"group": g.strip(), "seats": int(n)}
        for g, n in re.findall(r"Seats Remaining for:\s*(.+?)\s+-\s+(\d+)", text)
    ]
    m = re.search(r"Seats Remaining for any students:\s*(\d+)", text)
    return {"pools": pools, "open": int(m[1]) if m else 0, "parsed": bool(pools or m)}


def delivery_category(method):
    if method.startswith("INPERSON"):
        return "in_person"
    if "ONLBLEND" in method:
        return "blended"
    if "ONLFULL" in method:
        return "online"
    if method.startswith("ARRANGED"):
        return "arranged"
    return "other"


_CODE_LIST = re.compile(r"((?:[A-Za-z]{2,5}/)*[A-Za-z]{2,5})\s?(\d{3})[A-Z]?\b")
_PREFIX_ALIASES = {"PAD": "RPAD"}


def course_codes(text):
    """Expand "CEHC445/CYBR445" or "Cybr/CEHC/Pad 449" into ["CEHC 445", ...]."""
    codes = []
    for prefixes, number in _CODE_LIST.findall(text):
        for p in prefixes.upper().split("/"):
            code = f"{_PREFIX_ALIASES.get(p, p)} {number}"
            if code not in codes:
                codes.append(code)
    return codes


def excluded_by(description, own_code):
    """Courses whose credit rules out this one, from the course description."""
    found = []
    for m in re.finditer(
        r"received? credit for (.+?) (?:cannot|may not) receive credit"
        r"|can only earn credit for (.+?)\."
        r"|Only one of (.+?) may be taken for credit",
        description,
        flags=re.I,
    ):
        for code in course_codes(next(g for g in m.groups() if g)):
            if code != own_code and code not in found:
                found.append(code)
    return found


def prerequisite(description):
    m = re.search(r"Prerequisites?\(?s?\)?:\s*([^.]+\.)", description)
    return m[1].strip() if m else ""


def to_section(rec):
    """Turn one raw record into a section dict. Raises KeyError/ValueError if malformed."""
    course = COURSE_INFO.match(rec["Course Info"])
    if not course:
        raise ValueError(f"unexpected Course Info {rec['Course Info']!r}")
    code = f"{course[1]} {course[2]}"
    credits = re.findall(r"\d+(?:\.\d+)?", rec["Credit Range"])
    description = rec.get("Course Description", "")
    return {
        "class_number": int(rec["Class Number"]),
        "subject": course[1],
        "catalog_number": course[2],
        "code": code,
        "title": course[3],
        "topic": rec["Topic if applicable"],
        "level": rec["Level"],
        "credits_min": float(credits[0]) if credits else None,
        "credits_max": float(credits[-1]) if credits else None,
        "session": rec["Session"],
        "meeting_info": rec["Meeting Info"],
        "meeting": parse_meeting(rec["Meeting Info"]),
        "delivery_method": rec["Course Delivery Method"],
        "delivery": delivery_category(rec["Course Delivery Method"]),
        "delivery_description": rec["Comments"],
        "seats_remaining": int(rec["Seats remaining as of last update"]),
        "special_restriction": rec["Special Restriction"],
        "seats": parse_seats(rec["Special Restriction"]),
        "excluded_by": excluded_by(description, code),
        "prerequisite": prerequisite(description),
    }


def validate(declared, records, level="", subject=""):
    """Convert records to sections, failing loudly on anything that suggests a column shift."""
    problems = []
    if declared != len(records):
        problems.append(f"page declares {declared} matches but {len(records)} records parsed")
    sections = []
    for i, rec in enumerate(records):
        try:
            s = to_section(rec)
        except (KeyError, ValueError) as e:
            problems.append(f"record {i}: {type(e).__name__}: {e}")
            continue
        if s["level"] not in LEVELS.values():
            problems.append(f"record {i}: Level is {s['level']!r}")
        if level and s["level"] != LEVELS[level]:
            problems.append(f"record {i}: asked for level {level}, got {s['level']!r}")
        if subject and s["subject"] != subject:
            problems.append(f"record {i}: asked for subject {subject}, got {s['subject']!r}")
        sections.append(s)
    if problems:
        shown = "\n  ".join(problems[:20])
        more = f"\n  ... and {len(problems) - 20} more" if len(problems) > 20 else ""
        raise DataError(f"{len(problems)} validation problem(s):\n  {shown}{more}")
    return sections
