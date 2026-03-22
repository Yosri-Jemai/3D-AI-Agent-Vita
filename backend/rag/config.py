"""
mysql_columns.py
================
EDIT THIS FILE to match your MySQL database schema.

Tell the system:
  1. Which tables to read from
  2. Which columns contain useful text for the AI
  3. How to label/identify each product (for source citations)

The system will concatenate the columns you specify into a single text
document per row, which gets embedded and stored in the vector DB.
"""

# ─── TABLE DEFINITIONS ──────────────────────────────────────────────────────
# Each entry in this list defines one MySQL table to ingest.
#
# Fields:
#   table       : exact table name in MySQL
#   id_column   : primary key column (used to track updates)
#   name_column : human-readable name shown in source citations
#   text_columns: list of columns whose text will be fed to the AI
#                 Order matters — put the most important columns first.

TABLES = [
    {
        "table": "products",
        "id_column": "id",
        "name_column": "name",
        "text_columns": [
            "name",
            "description",
            "code_article",
        ],
    },

    # ── Add more tables below if needed ──────────────────────────────────
    # {
    #     "table": "clinical_studies",
    #     "id_column": "study_id",
    #     "name_column": "study_title",
    #     "text_columns": [
    #         "study_title",
    #         "objective",
    #         "results",
    #         "conclusions",
    #     ],
    # },
]

# ─── CHUNKING SETTINGS ──────────────────────────────────────────────────────
# How to split long text into pieces for the vector DB.
# Each "chunk" is one searchable unit.
CHUNK_SIZE    = 800   # characters per chunk (800 works well for medical text)
CHUNK_OVERLAP = 150   # overlap between chunks (keeps context at boundaries)
