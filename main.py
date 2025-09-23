# main.py - FastAPI backend with Jinja templates

from fastapi import FastAPI, HTTPException, Body, Request, Form
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import RedirectResponse, Response
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware
from typing import List, Dict, Optional, Tuple
import uuid
import uvicorn
import httpx
import asyncio
import os
import re
import time
import random
from urllib.parse import urlencode
from datetime import datetime

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# CORS for JS fetches
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# session secret is preserved from your original; rotate if needed
app.add_middleware(SessionMiddleware, secret_key="bb6a6c4ceefb5db3d44e67f2b0b456e3e3cd50c2c48686ddc8464ff279f6c3fe")

# In-memory storage
pending_reports: List[Dict] = []
approved_reports: List[Dict] = []

SERVICE_URL = "https://charliesmurders.onrender.com"

# ---------------------------
# State parsing helper
# ---------------------------
# Returns (abbr, full_name) or (None, None) if not found.
def parse_state_from_location(loc: str) -> Tuple[Optional[str], Optional[str]]:
    if not loc:
        return None, None

    # canonical mapping: abbr -> full
    STATES_MAP = {
        'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
        'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
        'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
        'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
        'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
        'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
        'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
        'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
        'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
        'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
        'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
        'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
        'WI': 'Wisconsin', 'WY': 'Wyoming'
    }

    text = re.sub(r'\s+', ' ', (loc or '')).strip()
    low = text.lower()

    # 1) Full-name match (e.g., "Utah", "new york")
    for abbr, fullname in STATES_MAP.items():
        if fullname.lower() in low:
            return abbr, fullname

    # 2) Parentheses-style "City, ST (AK)" or "City, State (AK)"
    m = re.search(r'\(([A-Za-z]{2})\)', text)
    if m:
        maybe = m.group(1).upper()
        if maybe in STATES_MAP:
            return maybe, STATES_MAP[maybe]

    # 3) Two-letter token in common formats:
    #    - trailing "City, ST"  - match last token if it's 2 letters
    #    - anywhere in line as isolated token
    parts = re.split(r'[,\s]+', text)
    for p in reversed(parts):
        if re.fullmatch(r'[A-Za-z]{2}', p):
            token = p.upper()
            if token in STATES_MAP:
                return token, STATES_MAP[token]

    # 4) final defensive check: look for any 2-letter token anywhere as a word boundary
    for abbr in STATES_MAP.keys():
        if re.search(r'\b' + re.escape(abbr) + r'\b', text, flags=re.I):
            return abbr, STATES_MAP[abbr]

    return None, None

# ---------------------------


@app.get("/ping")
async def ping(request: Request):
    """
    Health endpoint:
    - If browser (Accept includes text/html) -> render tiny template if available.
    - Otherwise -> return machine JSON.
    """
    accept = request.headers.get("accept", "")
    if "text/html" in accept:
        try:
            return templates.TemplateResponse("ping.html", {"request": request, "status": "alive"})
        except Exception:
            return {"status": "alive"}
    return {"status": "alive"}

# HEAD handlers so load-balancer health checks using HEAD succeed (avoid 405)
@app.head("/ping")
async def head_ping():
    return Response(status_code=200)

@app.head("/")
async def head_root():
    return Response(status_code=200)

@app.on_event("startup")
async def schedule_ping_task():
    """
    Startup ping loop that:
      - Respects DISABLE_EXTERNAL_PING=1 to disable in env.
      - Uses PING_TARGET (public) then LOCAL_PING_TARGET (fallback).
      - If Render (or other host) supplies PORT, the default local target will use it.
      - Uses httpx AsyncClient and sends realistic headers, cache-busting query params,
        slight jitter, and backoff on failure.
    """
    if os.getenv("DISABLE_EXTERNAL_PING", "0") == "1":
        print("External health pings disabled via DISABLE_EXTERNAL_PING.")
        return

    PING_TARGET = os.getenv("PING_TARGET", SERVICE_URL).rstrip("/")

    # Use the container PORT if provided by the host (e.g. Render sets $PORT).
    container_port = os.getenv("PORT")
    default_local = f"http://127.0.0.1:{container_port}" if container_port else "http://127.0.0.1:8000"
    LOCAL_PING_TARGET = os.getenv("LOCAL_PING_TARGET", default_local).rstrip("/")

    candidate_paths = ["/", "/ping", "/reports"]

    async def ping_loop():
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            backoff_seconds = 1
            headers = {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36"
            }

            while True:
                # order: public target then local fallback (if different)
                targets = [PING_TARGET]
                if LOCAL_PING_TARGET and LOCAL_PING_TARGET not in targets:
                    targets.append(LOCAL_PING_TARGET)

                success = False
                attempts = []

                for base in targets:
                    # pick a plausible "page" and add a small cache-buster
                    path = random.choice(candidate_paths)
                    qs = urlencode({"_ts": int(time.time()), "r": random.randint(1, 999999)})
                    url = f"{base.rstrip('/')}{path}?{qs}"
                    try:
                        # use GET with HTML headers to mimic a real browser page view
                        resp = await client.get(url, headers=headers)
                        status = resp.status_code
                        body_snip = (resp.text or "")[:400]
                        attempts.append((url, status, body_snip))
                        if status == 200:
                            success = True
                            backoff_seconds = 1
                            break
                        else:
                            continue
                    except Exception as exc:
                        attempts.append((url, "ERR", repr(exc)))
                        continue

                if not success:
                    # log attempts for debugging
                    for u, st, body in attempts:
                        print(f"[PING] {u} -> {st}; body: {body}")
                    backoff_seconds = min(backoff_seconds * 2, 300)

                # base delay + backoff + small jitter to avoid perfectly regular pattern
                jitter = random.uniform(0, 15)
                await asyncio.sleep(120 + backoff_seconds + jitter)

    asyncio.create_task(ping_loop())


@app.post("/submit_report")
def submit_report(report: Dict = Body(...)):
    report['id'] = str(uuid.uuid4())

    # Derive canonical state fields if possible and store them on the report object.
    try:
        st_abbr, st_name = parse_state_from_location(report.get('location') or '')
        if st_abbr:
            # only set if not already present, but overwrite if existing value is falsy
            report['state'] = report.get('state') or st_abbr
            report['state_full'] = report.get('state_full') or st_name
    except Exception:
        # don't fail submission for parsing failures
        pass

    pending_reports.append(report)
    return {"message": "Report submitted for review"}


# ----------------------------
@app.post("/approve/{report_id}")
async def approve(request: Request, report_id: str):
    # require admin session
    if not request.session.get("admin"):
        raise HTTPException(status_code=404, detail="Not found")

    # Try to read posted state if sent (either form-data or JSON)
    posted_state = ''
    try:
        content_type = (request.headers.get("content-type") or "").lower()
        if content_type.startswith("application/json"):
            body = await request.json()
            if isinstance(body, dict):
                posted_state = (body.get("state") or "").strip().upper()
        else:
            form = await request.form()
            posted_state = (form.get("state") or "").strip().upper()
    except Exception:
        posted_state = ''

    # Allowed states set for validation
    ALLOWED_STATES = {
        'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
        'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
        'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'
    }
    if posted_state and posted_state not in ALLOWED_STATES:
        # invalid posted state -> ignore it
        posted_state = ''

    for i, r in enumerate(pending_reports):
        if r['id'] == report_id:
            approved = pending_reports.pop(i)

            # -------------------------
            # SANITIZE BEFORE PUBLISHING
            for key in ("submitted_via", "source", "submit_method", "origin", "submitted_from"):
                approved.pop(key, None)

            if approved.get("description"):
                approved["description"] = re.sub(
                    r"\s*Report submitted via[^\n\r]*", "", approved["description"], flags=re.I
                ).strip()
                if not approved["description"]:
                    approved["description"] = "No description provided."

            if isinstance(approved.get("email"), str) and approved.get("email").lower().startswith("submitter:"):
                approved.pop("email", None)

            # Ensure canonical state fields exist (re-derive if missing)
            try:
                st_abbr, st_name = parse_state_from_location(approved.get('location') or '')
                if st_abbr and not approved.get('state'):
                    approved['state'] = st_abbr
                if st_name and not approved.get('state_full'):
                    approved['state_full'] = st_name
            except Exception:
                # ignore parse failures
                st_abbr, st_name = None, None

            # If client posted a state, prefer it (override or set)
            if posted_state:
                approved['state'] = posted_state
                # set full name if possible
                # build simple map for lookup
                REVERSE_MAP = {
                    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
                    'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
                    'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
                    'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
                    'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
                    'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
                    'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
                    'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
                    'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
                    'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
                    'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
                    'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
                    'WI': 'Wisconsin', 'WY': 'Wyoming'
                }
                approved['state_full'] = approved.get('state_full') or REVERSE_MAP.get(posted_state)

            # Stamp approved metadata
            approved['approved_at'] = datetime.utcnow().isoformat() + 'Z'
            approved_reports.append(approved)

            # If this looks like an AJAX/Fetch call, return JSON so front-end can update without redirect.
            accept = (request.headers.get("accept") or "").lower()
            xreq = request.headers.get("x-requested-with", "").lower()
            if request.headers.get("content-type", "").lower().startswith("application/json") or "application/json" in accept or xreq == "xmlhttprequest":
                return JSONResponse({"ok": True, "id": report_id, "state": approved.get('state', '')})
            # Otherwise redirect back to admin pending page (existing behavior)
            return RedirectResponse("/admin/pending", status_code=303)

    raise HTTPException(status_code=404, detail="Report not found")


@app.post("/deny/{report_id}")
def deny(request: Request, report_id: str):
    if not request.session.get("admin"):
        raise HTTPException(status_code=404, detail="Not found")
    for i, r in enumerate(pending_reports):
        if r['id'] == report_id:
            del pending_reports[i]
            return RedirectResponse("/admin/pending", status_code=303)
    raise HTTPException(status_code=404, detail="Report not found")

@app.get("/approved_reports")
def get_approved():
    return approved_reports

# Serve all templates
@app.get("/", include_in_schema=False)
def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/report", include_in_schema=False)
def report_form(request: Request):
    return templates.TemplateResponse("report.html", {"request": request})

@app.get("/reports", include_in_schema=False)
def reports_list(request: Request):
    return templates.TemplateResponse("reports.html", {"request": request, "reports": approved_reports})

@app.get("/reports/{report_id}", include_in_schema=False)
def report_detail(report_id: str, request: Request):
    for r in approved_reports:
        if r['id'] == report_id:
            return templates.TemplateResponse("report_detail.html", {"request": request, "report": r})
    raise HTTPException(status_code=404, detail="Report not found")

@app.get("/memories", include_in_schema=False)
def memories(request: Request):
    return templates.TemplateResponse("memories.html", {"request": request})

@app.get("/admin/login", include_in_schema=False)
def admin_login_page(request: Request):
    return templates.TemplateResponse("admin_login.html", {"request": request})

@app.post("/admin/login")
async def do_admin_login(request: Request, password: str = Form(...)):
    obfuscated_codes = [105, 66, 75, 88, 70, 67, 79, 97, 67, 88, 65, 103, 79, 71, 69, 88, 67, 75, 70, 107, 78, 71, 67, 68, 121, 79, 73, 95, 88, 79, 122, 75, 89, 89, 24, 26, 24, 31, 11, 106, 9, 102, 69, 68, 77, 107, 108]
    key = 42
    expected_password = ''.join(chr(c ^ key) for c in obfuscated_codes)
    if password == expected_password:
        request.session["admin"] = True
        return RedirectResponse("/admin/pending", status_code=303)
    else:
        raise HTTPException(status_code=401, detail="Invalid password")

@app.get("/admin/pending", include_in_schema=False)
def admin_pending(request: Request):
    if not request.session.get("admin"):
        raise HTTPException(status_code=404, detail="Not found")
    return templates.TemplateResponse("pending.html", {"request": request, "reports": pending_reports})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
