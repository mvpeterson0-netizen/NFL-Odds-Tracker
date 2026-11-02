"""Free balance check: GET /v4/sports does not use credits. Writes probe/cfb_probe_result.json. Never prints the key."""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

KEY = os.environ.get("ODDS_API_KEY_20K", "")
OUT = {"checked_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
try:
    req = urllib.request.Request("https://api.the-odds-api.com/v4/sports/?" + urllib.parse.urlencode({"apiKey": KEY}),
                                 headers={"User-Agent": "stix-probe"})
    with urllib.request.urlopen(req, timeout=60) as r:
        h = {k.lower(): v for k, v in r.headers.items()}
        OUT.update({"http": r.status, "x-requests-remaining": h.get("x-requests-remaining"),
                    "x-requests-used": h.get("x-requests-used"), "x-requests-last": h.get("x-requests-last")})
except urllib.error.HTTPError as e:
    OUT.update({"http": e.code})
with open("probe/cfb_probe_result.json", "w") as f:
    json.dump(OUT, f, indent=1)
