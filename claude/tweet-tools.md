# Stix tweet drafting: helper code (tested 2026-11-09)

Save the block below as `~/tweet-tools/stix_app.py` in the session, then `sys.path.insert(0, os.path.expanduser("~/tweet-tools")); from stix_app import *`. It clones main of mvpeterson0-netizen/NFL-Odds-Tracker (public; plain `git clone`, no add_repo needed), serves `site/` locally, and renders the real app at iPhone width (390x844 @3x) in **dark mode** with the signed-in gate stubbed so all 13 leads show (the gate is front-end only; data.json is public). Network is blocked except localhost, so no outside fonts or images (player headshots won't load; that's fine, the row crops don't use them).

Tested on 2026-11-09 against real data: `App().lead(12)` returned the Research lead 12 record line and every row's "Model estimate X% win · +Y% estimated ROI"; `shoot_rows(12, [("Aaron Jones","Receptions"),("Khalil Shakir","Receptions")], out)` produced a clean stitched dark-mode crop.

Notes:
- Lead rows show the tag "Watchlist" and "line from provisional weekly snapshot" until the game's pregame capture (~3 h before kickoff) locks them. Locked = the game's gid is in `data()["frozen_research"]["records"]` (`locked_gids`).
- Leads 1–8 rows use the latest line until the pregame capture exists (labelled "line from Sun AM" etc.).
- `lead(n)` summary is the first "Weeks a–b: W–L · hit · units · ROI" line on the page. Check which lead it belongs to (it is the open lead's own record).
- For player pages use `goto("/player/<pid>")` (pid from `data()["players"]`) and `pg.screenshot(...)` / `locator(...).screenshot(...)`; hide boxes that must not appear (FanDuel box, pick-saving box) with `pg.add_style_tag(content=...)` after inspecting their class names.
- `built()` returns "Data built N min ago (...)"; refuse to draft if the build is older than ~2 h.

```python
"""Stix tweet helper: renders the REAL app from a fresh clone of main (iPhone width, dark mode),
reads numbers off its screens and crops screenshots."""
import os, subprocess, time, re, socket
from playwright.sync_api import sync_playwright
REPO = os.path.expanduser("~/stix-main")
PORT = 8765
def ensure_repo():
    if not os.path.isdir(REPO + "/.git"):
        subprocess.run(["git", "clone", "--depth", "1", "https://github.com/mvpeterson0-netizen/nfl-odds-tracker", REPO], check=True,
                       env={**os.environ, "GIT_LFS_SKIP_SMUDGE": "1"})
    else:
        subprocess.run(["git", "-C", REPO, "fetch", "--depth", "1", "origin", "main"], check=False)
        subprocess.run(["git", "-C", REPO, "reset", "--hard", "origin/main"], check=False)
def serve():
    ensure_repo()
    s = socket.socket()
    if s.connect_ex(("127.0.0.1", PORT)) != 0:
        subprocess.Popen(["python3", "-m", "http.server", str(PORT)], cwd=REPO + "/site", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1)
    s.close()
INIT = """Object.defineProperty(window,'STIX_ACCOUNT',{configurable:true,set(v){v.signedIn=()=>true;v.ready=()=>true;this._a=v},get(){return this._a}});
try{localStorage.setItem('stix_seen_before','1');localStorage.setItem('stix_signin_prompt','2026-10-28-signin');localStorage.setItem('stix_notrack','1')}catch(e){}"""
class App:
    """Context manager. dark=True uses iPhone dark mode. signed_in=True shows all 13 leads (front-end gate only)."""
    def __init__(self, dark=True, signed_in=True):
        self.dark, self.signed_in = dark, signed_in
    def __enter__(self):
        serve(); self.p = sync_playwright().start()
        self.b = self.p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        self.c = self.b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True,
                                    color_scheme="dark" if self.dark else "light")
        self.c.add_init_script(INIT if self.signed_in else INIT.split("\n")[1])
        self.pg = self.c.new_page()
        self.pg.route("**/*", lambda r: r.continue_() if r.request.url.startswith("http://localhost") else r.abort())
        return self
    def __exit__(self, *a):
        self.b.close(); self.p.stop()
    def goto(self, route, wait=3500):
        self.pg.goto(f"http://localhost:{PORT}/index.html#{route}"); self.pg.wait_for_timeout(wait)
        self.pg.evaluate("document.querySelectorAll('.share-ov').forEach(e=>e.remove())")  # What's new / sign-in pop-ups
    def built(self):  # "Data built N min ago (...)" line
        return self.pg.evaluate("(document.body.innerText.match(/Data built[^\\n]*/)||[''])[0]")
    def lead(self, n):
        """Open Research > lead n (1-13). Returns {'summary': record line, 'rows': [...]}."""
        self.goto("/search"); self.pg.click(f"[data-rtab=t{n}]"); self.pg.wait_for_timeout(1200)
        return self.pg.evaluate("""()=>({
          summary:(document.body.innerText.match(/Weeks? [\\d–-]+:[^\\n]*/)||[''])[0],
          rows:[...document.querySelectorAll('.rlrow')].map(r=>({name:r.querySelector('.pname')?.innerText,stat:r.querySelector('.rlstat')?.innerText,
            tag:r.querySelector('.rlsize')?.innerText,meta:r.querySelector('.muted.small')?.innerText,cells:r.querySelector('.rlcells')?.innerText,text:r.innerText}))})""")
    def shoot_rows(self, tab_n, wanted, out):
        """Screenshot the lead-n rows whose text contains every string in each tuple of `wanted` (e.g. [('Ray Davis','Rush yds')]),
        stitched into one tall PNG at `out`. Row checkboxes hidden."""
        from PIL import Image
        self.goto("/search"); self.pg.click(f"[data-rtab=t{tab_n}]"); self.pg.wait_for_timeout(1200)
        self.pg.add_style_tag(content=".rl-ck{display:none!important}")
        imgs = []
        for i, w in enumerate(wanted):
            loc = self.pg.locator(".rlrow")
            for s in w: loc = loc.filter(has_text=s)
            f = f"/tmp/_row{i}.png"; loc.first.screenshot(path=f); imgs.append(Image.open(f))
        W = max(i.width for i in imgs); H = sum(i.height for i in imgs)
        canvas = Image.new("RGB", (W, H), imgs[0].getpixel((2, 2)))
        y = 0
        for im in imgs: canvas.paste(im, (0, y)); y += im.height
        canvas.save(out); return out

import json, datetime as dt
def data():
    return json.load(open(REPO + "/site/data/data.json"))
def week_games(d, wk):
    return {g: v for g, v in d["games"].items() if g.startswith(f"2026_{wk:02d}_")}
def locked_gids(d):
    """Games whose model decisions (leads 11/12) are locked = a pregame capture was observed before kickoff."""
    return {r["gid"] for r in d["frozen_research"]["records"].values()}
def ko(v):
    return dt.datetime.fromisoformat(v["ko"].replace("Z", "+00:00"))
```
