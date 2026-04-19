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
        

        prompt = f"""You are a pharmaceutical commercial sales analyst. Analyze the conversation below between a doctor (USER) and Vita (ASSISTANT) – Vita is the delegate.

CONVERSATION:
{conv_text}

Return ONLY valid JSON with the following structure. Include a field only if the conversation contains relevant information. Do NOT invent content. Do NOT use placeholders.

{{
  "products": [
    {{
      "name": "exact product name mentioned",
      "interest": "high|medium|low",
      "covered": [],
      "concerns": [],
      "liked": []
    }}
  ],
  "objections": [
            {{
              "quote": "exact words the doctor said",
              "response": "summary of Vita's reply",
              "resolved": true|false
            }}
          ],
  "engagement_score": 3,
  "topics": [],
  "language": "french|english|arabic|mixed",
  "recommendations": ["specific, actionable training point"]
}}

STRICT RULES (follow exactly):

1. **OBJECTIONS** – Extract ONLY from messages where the role is **USER** (doctor).  
   - NEVER extract from ASSISTANT (Vita) messages.  
   - Do NOT include polite closing phrases, simple thank‑yous, or Vita’s error messages.  
   - Only include statements where the doctor expresses disagreement (e.g., “I’m not convinced”, “That’s too expensive”).  
   - If no valid objection exists → use empty array [].

2. **CONCERNS** (inside each product) – Capture any explicit worry, risk, or negative aspect mentioned by the doctor about that product.  
   - Include hypothetical questions that express worry (e.g., “what if patients have an allergic reaction?”).  
   - Include statements like “I’m worried about side effects”, “Is it safe for long‑term use?”.  
   - Do NOT invent generic concerns (e.g., “side effects”) unless the doctor actually says them.  
   - If no concerns → use empty array [].

3. **LIKED** – Only include if the doctor explicitly says something positive (e.g., “I like that”, “That’s good”, “I’m convinced”).  
   - Do NOT infer from lack of objection.

4. **COVERED** (inside each product) – List the key information that Vita explained about the product. This includes benefits, usage, dosage, mechanism, safety, comparisons, etc. Use short phrases (5‑10 words).  
- Only include what Vita actually said; do not invent.

5. **INTEREST** – Based on the doctor’s questions:  
   - **high** → specific, detailed questions (e.g., “What’s the dosage for children?”)  
   - **medium** → general but relevant questions (e.g., “Tell me more”)  
   - **low** → vague or one‑word answers.

6. **RESOLVED** (in objections) – true if the doctor agrees or says they are convinced; false if they remain doubtful or ask for more evidence.

7. **ENGAGEMENT_SCORE** (1‑5) – Based on conversation length, number of doctor questions, and depth.

8. **TOPICS** – Short readable phrases (3‑8 words) describing each discussion point. Use the doctor’s perspective.

9. **LANGUAGE** – Detect from the **doctor’s messages only**. If the doctor uses English → “english”. Mixed → “mixed”. French → “french”. Arabic → “arabic”.

10. **No fixed number** – Output as many items as appear. Use empty arrays if none.

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
            
            #Remove duplicates in objections based on quote
            if "objections" in result and isinstance(result["objections"], list):
                seen = set()
                unique = []
                for obj in result["objections"]:
                    quote = obj.get("quote", "").strip()
                    if quote and quote not in seen:
                        seen.add(quote)
                        unique.append(obj)
                result["objections"] = unique
            
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