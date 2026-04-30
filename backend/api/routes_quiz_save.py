"""
backend/api/routes_quiz_save.py
Monté sous prefix="/quizsave"  →  POST /quizsave/save-result
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
import pymysql
import os
import logging
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)
router = APIRouter()


# ── Connexion DB ──────────────────────────────────────────────────────────────
def get_db():
    return pymysql.connect(
        host        = os.getenv("MYSQL_HOST",     "localhost"),
        port        = int(os.getenv("MYSQL_PORT", 3306)),
        user        = os.getenv("MYSQL_USER"),
        password    = os.getenv("MYSQL_PASSWORD"),
        database    = os.getenv("MYSQL_DATABASE"),
        charset     = "utf8mb4",
        cursorclass = pymysql.cursors.DictCursor,
        connect_timeout = 5,
    )


# ── Nettoyage manuel du payload (pas de Pydantic) ────────────────────────────
def _parse_payload(raw: dict) -> dict:
    """
    Convertit le dict JSON brut en valeurs propres pour l'INSERT.
    Ne lève JAMAIS d'exception — met des valeurs par défaut si nécessaire.
    """
    def _float(v, default=0.0):
        try:    return float(v)
        except: return default

    def _int(v, default=0):
        try:    return int(float(v))
        except: return default

    def _str_or_none(v):
        if v is None: return None
        s = str(v).strip()
        return s if s else None

    quiz_type = _str_or_none(raw.get("quiz_type")) or "medical"
    if quiz_type not in ("medical", "commercial"):
        quiz_type = "medical"

    return {
        "quiz_type":         quiz_type,
        "score":             _float(raw.get("score"), 0.0),
        "total_questions":   _int(raw.get("total_questions"), 0),
        "percentage":        _float(raw.get("percentage"), 0.0),
        "feedback":          _str_or_none(raw.get("feedback")),
        "difficulty":        _str_or_none(raw.get("difficulty")),
        "products_selected": _str_or_none(raw.get("products_selected")),
        "id_user":           1,      # ← ID statique pour test
    }


# ── INSERT helper ─────────────────────────────────────────────────────────────
def _insert(cur, p: dict):
    cur.execute(
        """
        INSERT INTO tbl_evaluations_quiz_user
            (quiz_type, score, total_questions, percentage,
             feedback, difficulty, products_selected, id_user)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            p["quiz_type"], p["score"], p["total_questions"], p["percentage"],
            p["feedback"],  p["difficulty"], p["products_selected"], p["id_user"],
        )
    )
    return cur.lastrowid


# ── Debug : affiche le payload brut sans toucher à la DB ─────────────────────
@router.post("/save-result/debug")
async def debug_save(request: Request):
    body = await request.json()
    print("[QuizSave DEBUG]", body)
    return {"received": body}


# ── Endpoint principal ────────────────────────────────────────────────────────
@router.post("/save-result")
async def save_quiz_result(request: Request):
    """
    Accepte n'importe quel JSON, nettoie manuellement,
    puis insère dans tbl_evaluations_quiz_user.
    Aucune validation Pydantic → impossible d'avoir un 422.
    """
    # 1. Lire le body brut
    try:
        raw = await request.json()
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": f"JSON invalide : {e}"})

    print("[QuizSave] payload brut reçu :", raw)
    logger.info("[QuizSave] payload : %s", raw)

    # 2. Nettoyer
    p = _parse_payload(raw)
    logger.info("[QuizSave] payload nettoyé : %s", p)

    if p["total_questions"] == 0:
        return JSONResponse(status_code=200, content={"status": "skipped", "reason": "total_questions=0"})

    # 3. Insérer
    conn = None
    try:
        conn = get_db()
        with conn.cursor() as cur:
            inserted_id = _insert(cur, p)
        conn.commit()
        logger.info("[QuizSave] ✅ Enregistré id=%s", inserted_id)
        return {"status": "success", "message": "Résultat enregistré", "id": inserted_id}

    except pymysql.err.OperationalError as e:
        logger.error("[QuizSave] DB connexion : %s", e)
        raise HTTPException(status_code=503, detail=f"DB inaccessible : {e}")

    except Exception as e:
        logger.error("[QuizSave] Erreur INSERT : %s", e)
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        if conn:
            conn.close()