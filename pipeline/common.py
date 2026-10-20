"""Shared helpers: paths, HTTP, time, team names, player-name normalization.

Standard library only, so the scheduled job has nothing to install.
"""
from __future__ import annotations

import csv
import gzip
import io
import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = ROOT / ".cache"
SITE = ROOT / "site"

SEASON = 2026
# Games kicking off before this instant were played before prop collection began.
# Their lines are shown as "not collected".
COLLECTION_START_UTC = datetime(2026, 10, 20, 4, 0, tzinfo=timezone.utc)

NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download"
ET = ZoneInfo("America/New_York")
UTC = timezone.utc

USER_AGENT = "nfl-odds-tracker/1.0 (+github actions)"


def utcnow() -> datetime:
    return datetime.now(UTC)


def iso(dt: datetime | None) -> str:
    if dt is None:
        return ""
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str) -> datetime | None:
    if not s:
        return None
    s = s.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def kickoff_utc(gameday: str, gametime: str) -> datetime | None:
    """nflverse schedule times are local US/Eastern."""
    if not gameday or not gametime:
        return None
    try:
        local = datetime.strptime(f"{gameday} {gametime}", "%Y-%m-%d %H:%M").replace(tzinfo=ET)
    except ValueError:
        return None
    return local.astimezone(UTC)


def http_get(url: str, params: dict | None = None, timeout: int = 90, retries: int = 3):
    """Return (body_bytes, headers_dict, status). Retries on network errors and 5xx/429."""
    if params:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    last_err = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
                headers = {k.lower(): v for k, v in resp.headers.items()}
                return body, headers, resp.status
        except urllib.error.HTTPError as e:
            body = e.read() if hasattr(e, "read") else b""
            headers = {k.lower(): v for k, v in (e.headers or {}).items()}
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
                last_err = e
                continue
            return body, headers, e.code
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            last_err = e
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"GET failed after {retries} attempts: {redact(url)}: {last_err}")


def redact(url: str) -> str:
    return re.sub(r"(apiKey=)[^&]+", r"\1***", url)


def read_csv_bytes(body: bytes, gz: bool = False) -> list[dict]:
    if gz:
        body = gzip.decompress(body)
    text = body.decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


def read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_csv(path: Path, rows: list[dict], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
    tmp.replace(path)


def append_csv(path: Path, rows: list[dict], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    new = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        if new:
            w.writeheader()
        for r in rows:
            w.writerow(r)


def read_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, obj, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    if compact:
        tmp.write_text(json.dumps(obj, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    else:
        tmp.write_text(json.dumps(obj, indent=1, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


def to_float(v) -> float | None:
    if v is None or v == "" or v == "NA":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# The Odds API returns full team names; nflverse uses abbreviations.
TEAM_NAME_TO_ABBR = {
    "Arizona Cardinals": "ARI", "Atlanta Falcons": "ATL", "Baltimore Ravens": "BAL",
    "Buffalo Bills": "BUF", "Carolina Panthers": "CAR", "Chicago Bears": "CHI",
    "Cincinnati Bengals": "CIN", "Cleveland Browns": "CLE", "Dallas Cowboys": "DAL",
    "Denver Broncos": "DEN", "Detroit Lions": "DET", "Green Bay Packers": "GB",
    "Houston Texans": "HOU", "Indianapolis Colts": "IND", "Jacksonville Jaguars": "JAX",
    "Kansas City Chiefs": "KC", "Los Angeles Rams": "LA", "Los Angeles Chargers": "LAC",
    "Las Vegas Raiders": "LV", "Miami Dolphins": "MIA", "Minnesota Vikings": "MIN",
    "New England Patriots": "NE", "New Orleans Saints": "NO", "New York Giants": "NYG",
    "New York Jets": "NYJ", "Philadelphia Eagles": "PHI", "Pittsburgh Steelers": "PIT",
    "Seattle Seahawks": "SEA", "San Francisco 49ers": "SF", "Tampa Bay Buccaneers": "TB",
    "Tennessee Titans": "TEN", "Washington Commanders": "WAS",
}

_SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b")


def norm_name(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    s = s.lower().replace(".", "").replace("'", "").replace("’", "")
    s = re.sub(r"[^a-z ]+", " ", s)
    s = _SUFFIX.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip()
