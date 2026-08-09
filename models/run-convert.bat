@echo off
chcp 65001 >nul
echo Starting conversion...
echo.

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Python is not installed or not in PATH
    echo Please install Python from https://python.org/
    pause
    exit /b 1
)

C:\Users\Administrator\AppData\Local\Python\pythoncore-3.14-64\python.exe convert-all.py

echo.
pause