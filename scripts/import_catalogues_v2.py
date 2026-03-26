"""
import_catalogues_v2.py
=======================
Lit tous les fichiers PPTX du dossier catalogue,
extrait TOUT le texte du PPTX en un seul bloc,
et insère UNE SEULE LIGNE par gamme dans la table `catalogues`.

Structure de la table:
  id    | gamme   | contenu
  1     | BACTOL  | tout le texte du pptx concatené...
  2     | HYDRA   | tout le texte du pptx concatené...
  ...

Usage:
    python scripts/import_catalogues_v2.py

Prérequis:
    pip install "markitdown[pptx]" pymysql python-dotenv
"""

import os
import re
import sys
import pymysql
from dotenv import load_dotenv

try:
    from markitdown import MarkItDown
except ImportError:
    print("❌ markitdown non installé. Lance : pip install markitdown[pptx]")
    sys.exit(1)

load_dotenv()

# ══════════════════════════════════════════════════════════════════════════════
# ⚙️  CONFIGURATION — Modifie ce chemin si nécessaire
# ══════════════════════════════════════════════════════════════════════════════
CATALOGUE_DIR = r"C:\Users\ASUS\OneDrive\Bureau\ESPRIT\4EME\Semestre 2\Projet DS\data\catalogue"


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


def fix_table(conn):
    """Recrée la table catalogues avec la nouvelle structure simplifiée."""
    with conn.cursor() as cur:
        # Supprimer l'ancienne table
        cur.execute("DROP TABLE IF EXISTS `catalogues`;")

        # Créer la nouvelle structure : une ligne par gamme
        cur.execute("""
            CREATE TABLE `catalogues` (
              `id`      INT NOT NULL AUTO_INCREMENT,
              `gamme`   VARCHAR(150) NOT NULL,
              `contenu` LONGTEXT,
              PRIMARY KEY (`id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """)
        conn.commit()
    print("   ✓ Table `catalogues` recréée (id, gamme, contenu)")


def extract_gamme_name(filename):
    """Ex: 'Gamme BACTOL.pptx' → 'BACTOL'"""
    name = os.path.splitext(filename)[0]
    name = re.sub(r'^Gamme\s*', '', name, flags=re.IGNORECASE).strip()
    return name


def clean_text(raw):
    """Nettoie le markdown extrait : enlève images, commentaires, notes."""
    text = re.sub(r'!\[.*?\]\(.*?\)', '', raw)              # images
    text = re.sub(r'<!--.*?-->', '', text, flags=re.DOTALL) # commentaires HTML
    text = re.sub(r'###\s*Notes:.*?(?=\n\n|\Z)', '', text, flags=re.DOTALL)  # notes
    text = re.sub(r'\n{3,}', '\n\n', text)                  # lignes vides multiples
    return text.strip()


def main():
    print("\n=== Import Catalogues PPTX → MySQL (v2 — 1 ligne par gamme) ===\n")

    # 1. Connexion
    print("1. Connexion à MySQL...")
    try:
        conn = get_connection()
        print("   ✓ Connecté")
    except Exception as e:
        print(f"   ✗ Erreur: {e}")
        sys.exit(1)

    # 2. Recréer la table
    print("\n2. Recréation de la table...")
    fix_table(conn)

    # 3. Vérifier le dossier
    print(f"\n3. Lecture du dossier...")
    if not os.path.exists(CATALOGUE_DIR):
        print(f"   ✗ Dossier introuvable: {CATALOGUE_DIR}")
        print("   → Modifie CATALOGUE_DIR dans le script")
        sys.exit(1)

    pptx_files = sorted([f for f in os.listdir(CATALOGUE_DIR) if f.endswith('.pptx')])
    print(f"   ✓ {len(pptx_files)} fichiers PPTX trouvés")

    # 4. Traiter chaque PPTX → 1 ligne par fichier
    print("\n4. Extraction et import...\n")
    md = MarkItDown()

    for filename in pptx_files:
        filepath = os.path.join(CATALOGUE_DIR, filename)
        gamme    = extract_gamme_name(filename)

        print(f"  📂 {filename}  →  Gamme: {gamme}", end="", flush=True)

        try:
            result  = md.convert(filepath)
            contenu = clean_text(result.text_content)

            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO `catalogues` (`gamme`, `contenu`) VALUES (%s, %s)",
                    (gamme, contenu)
                )
            conn.commit()

            # Afficher la taille du contenu extrait
            print(f"  ✓  ({len(contenu)} caractères)")

        except Exception as e:
            print(f"  ✗ Erreur: {e}")

    conn.close()

    # 5. Résumé
    print(f"\n{'='*50}")
    print(f"✓ Import terminé ! {len(pptx_files)} gammes insérées.")
    print(f"\nProchaines étapes:")
    print(f"  1. Vérifier dans Workbench : SELECT gamme, LENGTH(contenu) FROM catalogues;")
    print(f"  2. Ajouter dans backend/rag/config.py :")
    print(f"       {{")
    print(f'           "table": "catalogues",')
    print(f'           "id_column": "id",')
    print(f'           "name_column": "gamme",')
    print(f'           "text_columns": ["gamme", "contenu"],')
    print(f"       }}")
    print(f"  3. python scripts/ingest.py --reset")


if __name__ == "__main__":
    main()
