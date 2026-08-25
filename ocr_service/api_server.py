"""
FastAPI Microservice for Industrial OCR Service
Provides HTTP REST endpoints for web applications, mobile apps, and edge inspection devices.
"""

from typing import Optional
import os
from fastapi import FastAPI, File, UploadFile, Form, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .pipeline import OcrPipeline
from .schemas import OcrPipelineResult

app = FastAPI(
    title="VISION-PASS Industrial OCR Service",
    description="High-precision OCR service for metal nameplates and handwritten serials using Gemini Vision & OpenCV",
    version="2.0.0",
)

# Enable CORS for Next.js / Mobile web clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pipeline = OcrPipeline()


class OcrBase64Request(BaseModel):
    image_base64: str
    part_name: Optional[str] = None
    spec: Optional[str] = None
    unit_no: Optional[str] = None
    api_key: Optional[str] = None


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "VISION-PASS Industrial OCR"}


@app.post("/api/ocr/upload", response_model=OcrPipelineResult)
async def ocr_upload(
    file: UploadFile = File(...),
    part_name: Optional[str] = Form(None),
    spec: Optional[str] = Form(None),
    unit_no: Optional[str] = Form(None),
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
):
    """
    Process uploaded image file (JPEG, PNG) with full 4-stage OCR pipeline.
    """
    try:
        contents = await file.read()
        context = {
            "part_name": part_name,
            "spec": spec,
            "unit_no": unit_no,
        }
        result = pipeline.process(
            image_input=contents,
            context=context,
            override_api_key=x_gemini_api_key,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ocr/base64", response_model=OcrPipelineResult)
async def ocr_base64(
    request: OcrBase64Request,
    x_gemini_api_key: Optional[str] = Header(None, alias="X-Gemini-Api-Key"),
):
    """
    Process base64 encoded image with full 4-stage OCR pipeline.
    """
    import base64
    try:
        raw_b64 = request.image_base64
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",")[1]

        image_bytes = base64.b64decode(raw_b64)
        context = {
            "part_name": request.part_name,
            "spec": request.spec,
            "unit_no": request.unit_no,
        }
        api_key = request.api_key or x_gemini_api_key

        result = pipeline.process(
            image_input=image_bytes,
            context=context,
            override_api_key=api_key,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("ocr_service.api_server:app", host="0.0.0.0", port=8000, reload=True)
