# main.py - FastAPI backend with Jinja templates

from fastapi import FastAPI, HTTPException, Body, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict
import uuid
import uvicorn
import httpx
import asyncio


# CORS for JS fetches
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

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
def submit_report(report: Dict = Body(...)):
    report['id'] = str(uuid.uuid4())
    pending_reports.append(report)
    return {"message": "Report submitted for review"}

@app.get("/pending_reports")
def get_pending():
    return pending_reports

@app.post("/approve/{report_id}")
def approve(report_id: str):
    for i, r in enumerate(pending_reports):
        if r['id'] == report_id:
            approved = pending_reports.pop(i)
            approved_reports.append(approved)
            return {"message": "Approved"}
    raise HTTPException(status_code=404, detail="Report not found")

@app.post("/deny/{report_id}")
def deny(report_id: str):
    for i, r in enumerate(pending_reports):
        if r['id'] == report_id:
            del pending_reports[i]
            return {"message": "Denied"}
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

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)

