"""
import_catalogues.py
====================
Lit tous les fichiers PPTX du dossier catalogue,
extrait le texte slide par slide,
et insère tout dans la table `catalogues` de MySQL.

Usage:
    python import_catalogues.py

Prérequis:
    pip install markitdown[pptx] pymysql python-dotenv
"""

import os
import re
import sys
import pymysql
from dotenv import load_dotenv

# ── markitdown pour extraire le texte des PPTX ──────────────────────────────
try:
    from markitdown import MarkItDown
except ImportError:
    print("❌ markitdown non installé. Lance : pip install markitdown[pptx]")
    sys.exit(1)

# ── Charger les variables d'environnement (.env) ─────────────────────────────
load_dotenv()

# ══════════════════════════════════════════════════════════════════════════════
# ⚙️  CONFIGURATION — Modifie ce chemin si nécessaire
# ══════════════════════════════════════════════════════════════════════════════
CATALOGUE_DIR = r"C:\Users\ASUS\OneDrive\Bureau\ESPRIT\4EME\Semestre 2\Projet DS\data\catalogue"


# ── Connexion MySQL ───────────────────────────────────────────────────────────
def get_connection():
    return pymysql.connect(
        host=os.getenv("MYSQL_HOST", "localhost"),
        port=int(os.getenv("MYSQL_PORT", 3306)),
        user=os.getenv("MYSQL_USER", "root"),
        password=os.getenv("MYSQL_PASSWORD", ""),
        database=os.getenv("MYSQL_DATABASE", "vital_crm"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


# ── Créer la table catalogues si elle n'existe pas ───────────────────────────
def create_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS `catalogues` (
              `id`           INT NOT NULL AUTO_INCREMENT,
              `gamme`        VARCHAR(150) NOT NULL,
              `slide_number` INT DEFAULT NULL,
              `titre_slide`  VARCHAR(300) DEFAULT NULL,
              `contenu`      TEXT,
              PRIMARY KEY (`id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """)
        conn.commit()
    print("   ✓ Table `catalogues` prête")


# ── Vider la table avant réimport (évite les doublons) ───────────────────────
def clear_table(conn):
    with conn.cursor() as cur:
        cur.execute("DELETE FROM `catalogues`")
        conn.commit()
    print("   ✓ Table `catalogues` vidée")


# ── Extraire le nom de la gamme depuis le nom de fichier ─────────────────────
def extract_gamme_name(filename):
    # Ex: "Gamme BACTOL.pptx" → "BACTOL"
    name = os.path.splitext(filename)[0]         # enlever .pptx
    name = re.sub(r'^Gamme\s*', '', name, flags=re.IGNORECASE).strip()
    return name


# ── Parser les slides depuis le markdown extrait ─────────────────────────────
def parse_slides(markdown_text):
    """
    Découpe le markdown en slides.
    Retourne une liste de dicts: {slide_number, titre_slide, contenu}
    """
    slides = []

    # Séparer par "<!-- Slide number: N -->"
    parts = re.split(r'<!--\s*Slide number:\s*(\d+)\s*-->', markdown_text)

    # parts = ['', '1', 'contenu slide 1', '2', 'contenu slide 2', ...]
    i = 1
    while i < len(parts) - 1:
        slide_num = int(parts[i])
        raw_content = parts[i + 1].strip()

        # Extraire le titre (première ligne non vide qui n'est pas une image)
        lines = [l.strip() for l in raw_content.split('\n') if l.strip()]
        lines = [l for l in lines if not l.startswith('![')]  # enlever images
        lines = [l for l in lines if not l.startswith('###')]  # enlever notes

        titre = ''
        if lines:
            # Nettoyer le titre des # markdown
            titre = re.sub(r'^#+\s*', '', lines[0]).strip()
            if len(titre) > 300:
                titre = titre[:297] + '...'

        # Nettoyer le contenu
        content = raw_content
        content = re.sub(r'!\[.*?\]\(.*?\)', '', content)   # enlever images
        content = re.sub(r'###\s*Notes:.*', '', content, flags=re.DOTALL)  # enlever notes
        content = re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL)      # enlever commentaires
        content = re.sub(r'\n{3,}', '\n\n', content).strip()               # nettoyer espaces

        if content:
            slides.append({
                'slide_number': slide_num,
                'titre_slide': titre,
                'contenu': content,
            })

        i += 2

    return slides


# ── Insérer les slides d'une gamme dans MySQL ─────────────────────────────────
def insert_slides(conn, gamme, slides):
    with conn.cursor() as cur:
        for slide in slides:
            cur.execute("""
                INSERT INTO `catalogues` (`gamme`, `slide_number`, `titre_slide`, `contenu`)
                VALUES (%s, %s, %s, %s)
            """, (
                gamme,
                slide['slide_number'],
                slide['titre_slide'],
                slide['contenu'],
            ))
        conn.commit()


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    print("\n=== Import Catalogues PPTX → MySQL ===\n")

    # 1. Connexion MySQL
    print("1. Connexion à MySQL...")
    try:
        conn = get_connection()
        print("   ✓ Connecté")
    except Exception as e:
        print(f"   ✗ Erreur connexion: {e}")
        sys.exit(1)

    # 2. Préparer la table
    print("\n2. Préparation de la table...")
    create_table(conn)
    clear_table(conn)

    # 3. Vérifier le dossier
    print(f"\n3. Lecture du dossier: {CATALOGUE_DIR}")
    if not os.path.exists(CATALOGUE_DIR):
        print(f"   ✗ Dossier introuvable: {CATALOGUE_DIR}")
        print("   → Modifie la variable CATALOGUE_DIR dans le script")
        sys.exit(1)

    pptx_files = [f for f in os.listdir(CATALOGUE_DIR) if f.endswith('.pptx')]
    print(f"   ✓ {len(pptx_files)} fichiers PPTX trouvés")

    # 4. Traiter chaque PPTX
    print("\n4. Extraction et import...\n")
    md = MarkItDown()
    total_slides = 0

    for filename in sorted(pptx_files):
        filepath = os.path.join(CATALOGUE_DIR, filename)
        gamme    = extract_gamme_name(filename)

        print(f"  📂 {filename}  →  Gamme: {gamme}")

        try:
            result   = md.convert(filepath)
            slides   = parse_slides(result.text_content)
            insert_slides(conn, gamme, slides)
            total_slides += len(slides)
            print(f"     ✓ {len(slides)} slides importées")

        except Exception as e:
            print(f"     ✗ Erreur: {e}")

    conn.close()

    # 5. Résumé
    print(f"\n{'='*45}")
    print(f"✓ Import terminé !")
    print(f"  {len(pptx_files)} fichiers PPTX traités")
    print(f"  {total_slides} slides insérées dans `catalogues`")
    print(f"\nProchaine étape:")
    print(f"  Ajouter `catalogues` dans backend/rag/config.py")
    print(f"  puis : python scripts/ingest.py --reset")


if __name__ == "__main__":
    main()
