import os
import json
import time
from typing import List, Dict, Any
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

class GroqExtractor:
    def __init__(self):
        self.client = Groq(api_key=os.getenv("GROQ_API_KEY"))
        self.model = "llama-3.1-8b-instant"  
    
    def extract(self, conversation: List[Dict[str, str]]) -> Dict[str, Any]:
        """Extract structured data from conversation using Groq"""
        
        # Take last 20 messages for speed
        recent = conversation[-20:] if len(conversation) > 20 else conversation
        
        # Format conversation
        conv_text = "\n".join([
            f"{msg['role'].upper()}: {msg['text'][:300]}"
            for msg in recent
        ])
        
        prompt = f"""You are a pharmaceutical COMMERCIAL sales analyst. Analyze this sales conversation between a doctor (USER) and Vita (ASSISTANT) - Vita is the pharmaceutical delegate.

CONVERSATION:
{conv_text}

Return ONLY valid JSON. Focus on SALES insights.

{{

  "engagement_score": 1-5,
  "language": "french|english|arabic|mixed",
  "topics": ["topic1", "topic2", "topic3"],
  "recommendations": ["specific training recommendation 1", "specific training recommendation 2"],

  "products": [
    {{
      "name": "product name",
      "doctor_interest": "very_high|high|medium|low|none",
      "doctor_familiarity": "expert|familiar|unfamiliar",
      "prescription_intent": "definitely|probably|unsure|probably_not",
      "key_concerns": ["concern1", "concern2"],
      "what_doctor_liked": ["liked aspect1", "liked aspect2"]
    }}
  ],
  
  "objections": [
    {{
      "objection_exact_quote": "exact words the doctor said",
      "type": "price|efficacy|safety|competition|reimbursement|trust",
      "severity": "severe|moderate|mild",
      "how_vita_responded": "summary of how Vita responded",
      "resolution": "resolved|partially_resolved|unresolved",
      "what_worked": "specific technique or argument that helped",
      "what_didnt_work": "what Vita said that failed"
    }}
  ],
  
  "vita_performance": {{
    "strengths": ["strength1", "strength2"],
    "weaknesses": ["weakness1", "weakness2"],
    "objection_handling_skill": 1-5,
    "rapport_building": 1-5,
    "closing_ability": 1-5,
    "specific_coaching_needed": ["coaching point1", "coaching point2"]
  }},
  
  "sales_techniques": {{
    "what_worked_well": ["technique1", "technique2"],
    "what_failed": ["approach1", "approach2"],
    "missed_opportunities": ["opportunity1", "opportunity2"]
  }},
  
  "competitors": [
    {{
      "name": "competitor name",
      "doctor_perception": "prefers|considering|neutral|against",
      "how_vita_responded": "what Vita said about competitor"
    }}
  ],
  
  "business_insights": {{
    "doctor_convinced": true/false,
    "price_sensitivity": "high|medium|low",
    "decision_factors": ["factor1", "factor2"],
    "follow_up_needed": true/false,
    "winning_arguments": ["argument that worked"],
    "lost_arguments": ["argument that failed"]
  }},
  
}}

JSON:"""

        try:
            start_time = time.time()
            
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,  # Deterministic output
                max_tokens=1000,
                response_format={"type": "json_object"}
            )
            
            elapsed_ms = int((time.time() - start_time) * 1000)
            
            # Parse JSON response
            result = json.loads(response.choices[0].message.content)
            result["_metadata"] = {
                "extraction_time_ms": elapsed_ms,
                "model": self.model,
                "provider": "groq"
            }
            
            return result
            
        except Exception as e:
            print(f"Groq extraction error: {e}")
            return self._default_extraction()
    
    def _default_extraction(self):
        return {
            "products": [],
            "objections": [],
            "engagement_score": 3,
            "topics": [],
            "language": "unknown",
            "recommendations": ["Unable to analyze conversation"],
            "_metadata": {"error": "extraction_failed"}
        }

# Singleton instance
extractor = GroqExtractor()