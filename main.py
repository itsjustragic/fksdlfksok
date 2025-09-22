# main.py - FastAPI backend with Jinja templates

from fastapi import FastAPI, HTTPException, Request, Form
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import RedirectResponse
from starlette.middleware.sessions import SessionMiddleware
from typing import List, Dict
import uuid
import uvicorn
import asyncio
import httpx
import re

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

app.add_middleware(SessionMiddleware, secret_key="bb6a6c4ceefb5db3d44e67f2b0b456e3e3cd50c2c48686ddc8464ff279f6c3fe")

# In-memory storage
pending_reports: List[Dict] = []
approved_reports: List[Dict] = []

SERVICE_URL = "https://charliesmurders.onrender.com"

@app.on_event("startup")
async def schedule_ping_task():
    async def ping_loop():
        async with httpx.AsyncClient(timeout=5) as client:
            while True:
                try:
                    resp = await client.get(f"{SERVICE_URL}/ping")
                    if resp.status_code != 200:
                        print(f"Health ping returned {resp.status_code}")
                except Exception as e:
                    print(f"External ping failed: {e!r}")
                await asyncio.sleep(120)
    asyncio.create_task(ping_loop())

@app.get("/ping")
async def ping():
    return {"status": "alive"}

@app.post("/submit_report")
async def submit_report(
    full_name: str = Form(...),
    location: str = Form(None),
    occupation: str = Form(None),
    employer: str = Form(...),
    address: str = Form(None),
    employer_email: str = Form(None),
    phone: str = Form(None),
    category: str = Form(...),
    platform: str = Form(...),
    evidence_url: str = Form(...),
    image_urls: str = Form(None),
    description: str = Form(...)
):
    report = {
        'id': str(uuid.uuid4()),
        'full_name': full_name,
        'location': location,
        'occupation': occupation,
        'employer': employer,
        'address': address,
        'employer_email': employer_email,
        'phone': phone,
        'category': category,
        'platform': platform,
        'evidence_url': evidence_url,
        'image_urls': image_urls.splitlines() if image_urls else [],
        'description': description
    }
    pending_reports.append(report)
    return RedirectResponse("/admin/pending", status_code=303)

# ----------------------------
# replace the approve handler with this version
@app.post("/approve/{report_id}")
def approve(request: Request, report_id: str):
    if not request.session.get("admin"):
        raise HTTPException(status_code=404, detail="Not found")

    for i, r in enumerate(pending_reports):
        if r['id'] == report_id:
            approved = pending_reports.pop(i)

            # -------------------------
            # SANITIZE BEFORE PUBLISHING
            # remove any internal keys that indicate how the report was submitted
            for key in ("submitted_via", "source", "submit_method", "origin", "submitted_from"):
                approved.pop(key, None)

            # If description contains a submit-note like "Report submitted via ...",
            # strip that piece out so the public description doesn't include it.
            if approved.get("description"):
                # remove phrases like "Report submitted via Discord bot from text file."
                approved["description"] = re.sub(
                    r"\s*Report submitted via[^\n\r]*", "", approved["description"], flags=re.I
                ).strip()

                # If description became empty, give a neutral fallback (optional)
                if not approved["description"]:
                    approved["description"] = "No description provided."

            # also sanitize any "socials" metadata keys you don't want public (optional)
            # e.g. keep socials but remove private submitter emails if present
            if isinstance(approved.get("email"), str) and approved.get("email").lower().startswith("submitter:"):
                approved.pop("email", None)

            # -------------------------
            approved_reports.append(approved)
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
    uvicorn.run(app, host="0.0.0.0", port=8000)
