# backend/api/routes_questions_difficiles.py

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import pymysql
import os

router = APIRouter()


def get_db():
    return pymysql.connect(
        host=os.getenv("MYSQL_HOST", "localhost"),
        port=int(os.getenv("MYSQL_PORT", 3306)),
        user=os.getenv("MYSQL_USER"),
        password=os.getenv("MYSQL_PASSWORD"),
        database=os.getenv("MYSQL_DATABASE"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


# ── Modèles Pydantic ──────────────────────────────────────────────────────────

class QuestionDifficile(BaseModel):
    question: str

class ReponseAdmin(BaseModel):
    reponse: str


# ── Fonctions utilitaires (importées par engine.py) ───────────────────────────

def find_similar_question(question: str):
    """
    Cherche dans la BD une question similaire qui a déjà une réponse admin.
    Retourne le dict {question, reponse_admin} si trouvé, None sinon.
    Seuil de similarité : 50% des mots-clés communs.
    """
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                """SELECT question, reponse_admin 
                   FROM tbl_questions_difficiles 
                   WHERE reponse_admin IS NOT NULL AND reponse_admin != ''"""
            )
            rows = cur.fetchall()
        conn.close()

        if not rows:
            return None

        question_lower = question.lower()
        # Mots-clés = mots de plus de 3 caractères
        mots_cles = [m for m in question_lower.split() if len(m) > 3]
        if not mots_cles:
            return None

        best_match = None
        best_score = 0.0

        for row in rows:
            q_stored = row["question"].lower()
            score = sum(1 for mot in mots_cles if mot in q_stored)
            ratio = score / len(mots_cles)
            if ratio > best_score:
                best_score = ratio
                best_match = row

        if best_score >= 0.5 and best_match:
            return best_match

        return None

    except Exception as e:
        print(f"[find_similar_question] erreur: {e}")
        return None


def store_difficult_question(question: str):
    """
    Stocke une question difficile en BD.
    Ignore les doublons exacts (même texte).
    """
    try:
        conn = get_db()
        with conn.cursor() as cur:
            # Anti-doublon exact
            cur.execute(
                "SELECT id FROM tbl_questions_difficiles WHERE question = %s LIMIT 1",
                (question,)
            )
            if cur.fetchone():
                conn.close()
                return  # Déjà présente, on n'insère pas
            cur.execute(
                "INSERT INTO tbl_questions_difficiles (question) VALUES (%s)",
                (question,)
            )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"[store_difficult_question] erreur: {e}")


# ── Endpoints API ─────────────────────────────────────────────────────────────

@router.post("/add")
def add_question_difficile(req: QuestionDifficile):
    """Ajoute une question difficile (appelé par le frontend ou engine)."""
    try:
        conn = get_db()
        with conn.cursor() as cur:
            # Anti-doublon
            cur.execute(
                "SELECT id FROM tbl_questions_difficiles WHERE question = %s LIMIT 1",
                (req.question,)
            )
            if cur.fetchone():
                conn.close()
                return {"success": True, "message": "Question déjà enregistrée"}
            cur.execute(
                "INSERT INTO tbl_questions_difficiles (question) VALUES (%s)",
                (req.question,)
            )
        conn.commit()
        conn.close()
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/all")
def get_all_questions():
    """Retourne toutes les questions (pour le tableau admin)."""
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM tbl_questions_difficiles ORDER BY date_creation DESC"
            )
            rows = cur.fetchall()
        conn.close()
        # Convertir les dates en string pour JSON
        for row in rows:
            if row.get("date_creation"):
                row["date_creation"] = str(row["date_creation"])
            if row.get("date_reponse"):
                row["date_reponse"] = str(row["date_reponse"])
        return {"questions": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{question_id}/repondre")
def repondre_question(question_id: int, req: ReponseAdmin):
    """L'admin soumet sa réponse pour une question difficile."""
    try:
        conn = get_db()
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE tbl_questions_difficiles 
                   SET reponse_admin = %s, date_reponse = NOW()
                   WHERE id = %s""",
                (req.reponse, question_id)
            )
            if cur.rowcount == 0:
                conn.close()
                raise HTTPException(status_code=404, detail="Question non trouvée")
        conn.commit()
        conn.close()
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chercher-similaire")
def chercher_similaire(req: QuestionDifficile):
    """Endpoint HTTP pour chercher une question similaire (optionnel)."""
    result = find_similar_question(req.question)
    if result:
        return {
            "found": True,
            "reponse_admin": result["reponse_admin"],
            "question_originale": result["question"]
        }
    return {"found": False}