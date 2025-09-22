# backend.py - FastAPI backend

from fastapi import FastAPI, HTTPException, Body
from fastapi.staticfiles import StaticFiles
from typing import List, Dict
import uvicorn
import httpx
app = FastAPI()

pending_reports: List[Dict] = []
approved_reports: List[Dict] = []
SERVICE_URL = "https://charliesmurders.onrender.com/"
@app.post("/submit_report")
def submit_report(report: Dict = Body(...)):
    pending_reports.append(report)
    return {"message": "Report submitted for review"}

@app.get("/pending_reports")
def get_pending():
    return pending_reports

@app.post("/approve/{index}")
def approve(index: int):
    if index < 0 or index >= len(pending_reports):
        raise HTTPException(status_code=404, detail="Report not found")
    report = pending_reports.pop(index)
    approved_reports.append(report)
    return {"message": "Approved"}

@app.post("/deny/{index}")
def deny(index: int):
    if index < 0 or index >= len(pending_reports):
        raise HTTPException(status_code=404, detail="Report not found")
    del pending_reports[index]
    return {"message": "Denied"}

@app.get("/approved_reports")
def get_approved():
    return approved_reports

# Mount static files
app.mount("/", StaticFiles(directory=".", html=True), name="static")

if __name__ == "__main__":

    uvicorn.run(app, host="0.0.0.0", port=8000)

