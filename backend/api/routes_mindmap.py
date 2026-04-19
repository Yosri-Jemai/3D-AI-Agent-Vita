# backend/api/routes_mindmap.py

import os
import json
import re
import math
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter()

TOKEN_FACTORY_API_KEY  = os.getenv("TOKEN_FACTORY_API_KEY", "")
TOKEN_FACTORY_BASE_URL = os.getenv("TOKEN_FACTORY_BASE_URL", "https://tokenfactory.esprit.tn")
TOKEN_FACTORY_MODEL    = os.getenv("TOKEN_FACTORY_MODEL", "hosted_vllm/Llama-3.1-70B-Instruct")


class ConvMsg(BaseModel):
    role: str
    text: str

class MindmapRequest(BaseModel):
    conversation: List[ConvMsg]
    mode:         Optional[str] = "medical"
    lang:         Optional[str] = "fr"


# ── LLM extraction ────────────────────────────────────────────────────────────

async def extract_concepts(conversation: list, mode: str, lang: str) -> dict:
    # Garder uniquement les échanges significatifs (ignorer salutations/sélection mode)
    meaningful = [
        m for m in conversation
        if len(m.get("text", "").strip()) > 40
        and not any(kw in m.get("text", "").lower() for kw in [
            "formation médicale", "formation commerciale", "lequel de ces",
            "bienvenue", "mode de formation", "quel mode", "which mode",
        ])
    ]
    recent = meaningful[-20:] if len(meaningful) > 20 else meaningful

    # Séparer questions user et réponses agent
    user_msgs      = [m for m in recent if m["role"] == "user"]
    assistant_msgs = [m for m in recent if m["role"] in ("assistant", "ai")]

    # Texte complet de la conversation pour le contexte
    conv_text = "\n\n".join([
        f"{'[QUESTION]' if m['role'] == 'user' else '[RÉPONSE]'}: {m['text'][:400]}"
        for m in recent
    ])

    # Résumé des questions posées (pour les descriptions)
    user_summary = " | ".join([m["text"][:120] for m in user_msgs[:6]])
    # Résumé des réponses agent (pour les descriptions)
    agent_summary = " | ".join([m["text"][:200] for m in assistant_msgs[:6]])

    if lang == "ar":
        lang_instruction = "Write all labels in Arabic. Keep product names and scientific terms in French/English."
        desc_instruction = "Write descriptions in Arabic (2 sentences max). Keep product names/terms in French/English."
    elif lang == "en":
        lang_instruction = "Write all labels in English."
        desc_instruction = "Write descriptions in English (2 sentences max)."
    else:
        lang_instruction = "Write all labels in French."
        desc_instruction = "Write descriptions in French (2 sentences max)."

    prompt = f"""You are extracting a mindmap from a real pharmaceutical training conversation.

CONVERSATION:
{conv_text}

---
QUESTIONS POSÉES PAR LE DÉLÉGUÉ (résumé) :
{user_summary}

RÉPONSES DE L'AGENT (résumé) :
{agent_summary}
---

Your task: build a mindmap that summarizes EXACTLY what was discussed above — nothing else.

{lang_instruction}

MANDATORY RULES:
1. The "center" node = the PRODUCT NAME mentioned (e.g. "Guarana", "Dermalo"). If no product, use the main topic.
2. Each BRANCH = a THEME that was ACTUALLY discussed in the conversation above.
3. Each CHILD = a SPECIFIC FACT, INGREDIENT, or CONCEPT explicitly mentioned.
4. DO NOT invent or hallucinate — every branch and child must come from the conversation text.
5. Labels must be SHORT (branch: max 3 words, children: max 4 words).

DESCRIPTION RULES (IMPORTANT):
- For the "center": write a SHORT description (1-2 sentences) based on what the DELEGATE asked AND what the AGENT answered about this product/topic. Extract the key learning from both sides.
- For each BRANCH: write a SHORT description (1-2 sentences) combining what the delegate asked about this theme AND the most important thing the agent said about it.
- For each CHILD: write a SHORT description (1 sentence) — what the agent said specifically about this element, OR why the delegate asked about it.
- {desc_instruction}
- Descriptions must be SPECIFIC to this conversation, not generic definitions.

Return ONLY valid JSON:
{{
  "center": "product or topic name",
  "center_description": "What the delegate asked + key point from agent answer about this product (1-2 sentences).",
  "branches": [
    {{
      "label": "theme from conversation",
      "description": "What delegate asked about this theme + key agent explanation (1-2 sentences).",
      "color": "#hexcolor",
      "children": [
        {{
          "label": "specific fact",
          "description": "What agent said about this specific element (1 sentence)."
        }}
      ]
    }}
  ]
}}

Colors to use: #7eb8f7, #c084fc, #34d399, #f59e0b, #f87171, #60a5fa
Max 5 branches, max 3 children per branch.
JSON only, no markdown, no explanation:"""

    headers = {
        "Authorization": f"Bearer {TOKEN_FACTORY_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": TOKEN_FACTORY_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "max_tokens": 1200,
    }
    url = f"{TOKEN_FACTORY_BASE_URL}/api/chat/completions"

    async with httpx.AsyncClient(timeout=45.0, verify=False) as client:
        res = await client.post(url, headers=headers, json=payload)
        res.raise_for_status()
        data = res.json()

    raw = data["choices"][0]["message"]["content"].strip()
    raw = re.sub(r"```(?:json)?\s*", "", raw).strip().strip("`")
    match = re.search(r'\{.*\}', raw, re.DOTALL)
    if not match:
        raise ValueError(f"No JSON in response: {raw[:200]}")

    result = json.loads(match.group())

    # ── Normaliser : s'assurer que children est toujours une liste de dicts ──
    for branch in result.get("branches", []):
        normalized_children = []
        for child in branch.get("children", []):
            if isinstance(child, str):
                # Ancien format : juste un string → convertir en dict sans description
                normalized_children.append({"label": child, "description": ""})
            elif isinstance(child, dict):
                normalized_children.append(child)
        branch["children"] = normalized_children

    return result


# ── SVG generator ─────────────────────────────────────────────────────────────

def _esc(s: str) -> str:
    return (str(s)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;"))


def _wrap_words(label: str, max_chars: int = 14) -> list[str]:
    words = label.split()
    lines, current = [], ""
    for w in words:
        if current and len(current) + 1 + len(w) > max_chars:
            lines.append(current)
            current = w
        else:
            current = (current + " " + w).strip() if current else w
    if current:
        lines.append(current)
    return lines or [label]


def _pill(x: float, y: float, text: str, color: str,
          font_size: int = 11, padding_x: int = 14, padding_y: int = 8,
          is_branch: bool = False) -> tuple[str, float, float]:
    lines      = _wrap_words(text, max_chars=16 if is_branch else 18)
    line_h     = font_size + 4
    total_h    = len(lines) * line_h + padding_y * 2
    max_chars  = max(len(l) for l in lines)
    total_w    = max(max_chars * (font_size * 0.62) + padding_x * 2, 70 if is_branch else 80)

    hw = total_w / 2
    hh = total_h / 2
    rx = min(hh, 14)

    fill_opacity   = "0.20" if is_branch else "0.14"
    stroke_w       = "2"    if is_branch else "1.5"
    stroke_opacity = "1"    if is_branch else "0.6"
    fw             = "700"  if is_branch else "500"

    parts = []
    parts.append(
        f'<rect x="{x - hw:.1f}" y="{y - hh:.1f}" '
        f'width="{total_w:.1f}" height="{total_h:.1f}" rx="{rx}" '
        f'fill="{color}" fill-opacity="{fill_opacity}" '
        f'stroke="{color}" stroke-width="{stroke_w}" stroke-opacity="{stroke_opacity}"/>'
    )

    start_y = y - (len(lines) - 1) * line_h / 2
    for i, line in enumerate(lines):
        ly = start_y + i * line_h
        parts.append(
            f'<text x="{x:.1f}" y="{ly:.1f}" '
            f'text-anchor="middle" dominant-baseline="central" '
            f'fill="{color}" font-size="{font_size}" font-weight="{fw}" '
            f'letter-spacing="0.2">{_esc(line)}</text>'
        )

    return "\n".join(parts), hw, hh


def _child_pill(x: float, y: float, text: str, color: str) -> tuple[str, float, float]:
    lines   = _wrap_words(text, max_chars=16)
    font_sz = 10
    line_h  = font_sz + 4
    total_h = len(lines) * line_h + 10
    max_c   = max(len(l) for l in lines)
    total_w = max(max_c * (font_sz * 0.64) + 20, 70)

    hw = total_w / 2
    hh = total_h / 2
    rx = min(hh, 10)

    parts = []
    parts.append(
        f'<rect x="{x - hw:.1f}" y="{y - hh:.1f}" '
        f'width="{total_w:.1f}" height="{total_h:.1f}" rx="{rx}" '
        f'fill="rgba(10,14,30,0.88)" '
        f'stroke="{color}" stroke-width="1.5" stroke-opacity="0.7"/>'
    )
    start_y = y - (len(lines) - 1) * line_h / 2
    for i, line in enumerate(lines):
        ly = start_y + i * line_h
        parts.append(
            f'<text x="{x:.1f}" y="{ly:.1f}" '
            f'text-anchor="middle" dominant-baseline="central" '
            f'fill="rgba(230,234,244,0.92)" font-size="{font_sz}" font-weight="400">'
            f'{_esc(line)}</text>'
        )

    return "\n".join(parts), hw, hh


def build_mindmap_svg(data: dict, mode: str = "medical") -> str:
    W, H   = 1000, 720
    CX, CY = W // 2, H // 2

    center_label = data.get("center", "Session")
    branches     = data.get("branches", [])[:5]
    n_branches   = len(branches)

    if not branches:
        branches   = [{"label": "No concepts", "color": "#7eb8f7", "children": []}]
        n_branches = 1

    lines = []
    lines.append(
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {W} {H}" width="{W}" height="{H}" '
        f'style="background:transparent;font-family:\'Inter\',\'Jost\',system-ui,sans-serif;">'
    )

    lines.append('<defs>')
    lines.append('''
  <radialGradient id="bgGrad" cx="50%" cy="50%" r="70%">
    <stop offset="0%" stop-color="#0f1829"/>
    <stop offset="100%" stop-color="#070b14"/>
  </radialGradient>
  <radialGradient id="centerGrad" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#1a2540"/>
    <stop offset="100%" stop-color="#0a0f1e"/>
  </radialGradient>
  <filter id="shadow" x="-25%" y="-25%" width="150%" height="150%">
    <feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="rgba(0,0,0,0.5)"/>
  </filter>
  <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="4" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>''')
    lines.append('</defs>')

    lines.append(f'<rect width="{W}" height="{H}" fill="url(#bgGrad)" rx="18"/>')

    lines.append('<g opacity="0.035">')
    for gx in range(30, W, 36):
        for gy in range(30, H, 36):
            lines.append(f'<circle cx="{gx}" cy="{gy}" r="1" fill="white"/>')
    lines.append('</g>')

    lines.append(f'<circle cx="{CX}" cy="{CY}" r="295" fill="none" stroke="rgba(255,255,255,0.025)" stroke-width="1"/>')
    lines.append(f'<circle cx="{CX}" cy="{CY}" r="195" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="1" stroke-dasharray="6 4"/>')

    R_BRANCH = 175
    R_CHILD  = 295

    branch_angles = []
    for i in range(n_branches):
        deg = (360 / n_branches) * i - 90
        branch_angles.append(math.radians(deg))

    branch_positions = [
        (CX + R_BRANCH * math.cos(a), CY + R_BRANCH * math.sin(a))
        for a in branch_angles
    ]

    # Connecteurs
    for i, (branch, angle) in enumerate(zip(branches, branch_angles)):
        color    = branch.get("color", "#7eb8f7")
        bx, by   = branch_positions[i]
        children = branch.get("children", [])[:3]
        n_ch     = len(children)

        lines.append(
            f'<line x1="{CX}" y1="{CY}" x2="{bx:.1f}" y2="{by:.1f}" '
            f'stroke="{color}" stroke-width="2.5" stroke-opacity="0.55" stroke-linecap="round"/>'
        )

        if n_ch:
            spread = math.radians(22)
            start  = angle - spread * (n_ch - 1) / 2
            for j in range(n_ch):
                child_angle = start + spread * j
                r = R_CHILD + (10 if j % 2 == 0 else -10)
                cx2 = CX + r * math.cos(child_angle)
                cy2 = CY + r * math.sin(child_angle)
                lines.append(
                    f'<line x1="{bx:.1f}" y1="{by:.1f}" x2="{cx2:.1f}" y2="{cy2:.1f}" '
                    f'stroke="{color}" stroke-width="1.5" stroke-opacity="0.35" '
                    f'stroke-linecap="round" stroke-dasharray="5 4"/>'
                )

    # Noeuds branches + enfants
    for i, (branch, angle) in enumerate(zip(branches, branch_angles)):
        color    = branch.get("color", "#7eb8f7")
        label    = branch.get("label", f"Branche {i+1}")
        children = branch.get("children", [])[:3]
        n_ch     = len(children)
        bx, by   = branch_positions[i]

        svg_pill, hw, hh = _pill(bx, by, label, color, font_size=12,
                                 padding_x=16, padding_y=9, is_branch=True)
        lines.append(f'<g filter="url(#shadow)">{svg_pill}</g>')

        if n_ch:
            spread = math.radians(22)
            start  = angle - spread * (n_ch - 1) / 2
            for j, child in enumerate(children):
                child_angle = start + spread * j
                r = R_CHILD + (10 if j % 2 == 0 else -10)
                cx2 = CX + r * math.cos(child_angle)
                cy2 = CY + r * math.sin(child_angle)
                # child peut être dict ou str
                child_label = child.get("label", str(child)) if isinstance(child, dict) else str(child)
                svg_child, _, _ = _child_pill(cx2, cy2, child_label, color)
                lines.append(svg_child)

    # Noeud central
    center_lines = _wrap_words(center_label, max_chars=12)
    center_r     = 56
    line_h_c     = 16
    lines.append(
        f'<circle cx="{CX}" cy="{CY}" r="{center_r + 10}" '
        f'fill="none" stroke="rgba(126,184,247,0.12)" stroke-width="2"/>'
    )
    lines.append(
        f'<circle cx="{CX}" cy="{CY}" r="{center_r}" '
        f'fill="url(#centerGrad)" '
        f'stroke="rgba(126,184,247,0.55)" stroke-width="2.5" '
        f'filter="url(#shadow)"/>'
    )
    start_y_c = CY - (len(center_lines) - 1) * line_h_c / 2
    for k, cl in enumerate(center_lines):
        ly = start_y_c + k * line_h_c
        lines.append(
            f'<text x="{CX}" y="{ly:.1f}" '
            f'text-anchor="middle" dominant-baseline="central" '
            f'fill="white" font-size="14" font-weight="700" letter-spacing="0.4">'
            f'{_esc(cl)}</text>'
        )

    lines.append(
        f'<text x="{W - 14}" y="{H - 10}" text-anchor="end" '
        f'fill="rgba(255,255,255,0.1)" font-size="9" font-style="italic">'
        f'VitalAgent · AI Mindmap</text>'
    )

    lines.append('</svg>')
    return "\n".join(lines)


# ── API endpoint ──────────────────────────────────────────────────────────────

@router.post("/mindmap")
async def generate_mindmap(request: MindmapRequest):
    if not TOKEN_FACTORY_API_KEY:
        raise HTTPException(status_code=500, detail="TOKEN_FACTORY_API_KEY not set in .env")
    if len(request.conversation) < 2:
        raise HTTPException(status_code=400, detail="Conversation too short to generate a mindmap")

    conversation = [{"role": m.role, "text": m.text} for m in request.conversation]

    try:
        concepts = await extract_concepts(conversation, request.mode, request.lang)
    except Exception as e:
        print(f"[mindmap] concept extraction error: {e}")
        concepts = {
            "center": "Session",
            "center_description": "Session de formation VitalAgent.",
            "branches": [
                {"label": "Produits", "description": "Produits discutés lors de la session.", "color": "#7eb8f7",  "children": [{"label": "Voir historique", "description": "Consultez l'historique de la conversation."}]},
                {"label": "Concepts", "description": "Concepts abordés lors de la session.", "color": "#c084fc",  "children": [{"label": "Relire session", "description": "Relisez la session pour mémoriser."}]},
            ],
        }

    svg = build_mindmap_svg(concepts, request.mode)
    return {"success": True, "svg": svg, "concepts": concepts}