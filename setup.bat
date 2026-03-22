@echo off
echo.
echo ========================================
echo   VitalAgent - Setup Script
echo ========================================
echo.

:: Check Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Download from https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [1/4] Creating virtual environment...
python -m venv venv
if errorlevel 1 (
    echo [ERROR] Failed to create venv
    pause
    exit /b 1
)
echo       Done.

echo.
echo [2/4] Activating virtual environment...
call venv\Scripts\activate.bat

echo.
echo [3/4] Upgrading pip...
python -m pip install --upgrade pip --quiet

echo.
echo [4/4] Installing all dependencies...
pip install ^
    langchain==0.2.16 ^
    langchain-community==0.2.16 ^
    langchain-ollama==0.1.3 ^
    chromadb==0.5.5 ^
    pymysql==1.1.1 ^
    cryptography==42.0.8 ^
    fastapi==0.112.2 ^
    uvicorn==0.30.6 ^
    pydantic==2.8.2 ^
    python-multipart==0.0.9 ^
    faster-whisper==1.0.3 ^
    python-dotenv==1.0.1 ^
    sqlalchemy==2.0.32

if errorlevel 1 (
    echo.
    echo [ERROR] Some packages failed to install. Check the output above.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Setup complete!
echo ========================================
echo.
echo Next steps:
echo   1. Copy .env.example to .env and fill in your MySQL credentials
echo   2. Run: venv\Scripts\activate
echo   3. Run: python scripts/ingest.py
echo   4. Run: python backend/main.py
echo   5. Open frontend/index.html in your browser
echo.
pause
