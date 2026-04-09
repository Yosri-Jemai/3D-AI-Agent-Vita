from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Optional
import json
from backend.analytics.groq_extractor import extractor

router = APIRouter()

class ConversationMessage(BaseModel):
    role: str
    text: str
    timestamp: Optional[str] = None

class ExtractRequest(BaseModel):
    conversation: List[ConversationMessage]

@router.post("/extract")
async def extract_conversation(request: ExtractRequest):
    """Extract structured data from conversation using Groq"""
    try:
        # Convert to dict for extractor
        conversation = [{"role": msg.role, "text": msg.text} for msg in request.conversation]
        
        # Extract using Groq
        extraction = extractor.extract(conversation)
        
        return {"success": True, "extraction": extraction}
    except Exception as e:
        return {"success": False, "error": str(e)}