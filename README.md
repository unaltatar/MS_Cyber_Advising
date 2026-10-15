# MS Cyber Advising

A helper for advising UAlbany MS Cybersecurity students. It reads the public
[Schedule of Classes](https://www.albany.edu/registrar/schedule-classes), shows
open sections with seats, times, instructors and reserved-seat groups, and
compares them with a student's completed courses and the program requirements.

## Privacy

This repository never contains student data. It holds code, public registrar
schedule data and public program requirements only. When the web page is
built, a pasted course history will be processed only in the advisor's
browser. It will not be sent anywhere or stored.

## Running the scraper locally

Python 3.12 or newer, standard library only. On Windows use `py`:

```
py -m scraper --term "Spring 2027" --subject CYBR
py -m scraper --term 0007 --subject CYBR --out out/cybr.json
```

The registrar's search script maps form fields to data columns by position,
so the scraper reads the live form on every run and validates every record.
