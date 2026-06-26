@echo off
cd /d C:\CZnET
echo =============================
echo   Verificando ambiente...
echo =============================
echo.
echo [package.json]:
type package.json
echo.
echo.
echo [Git instalado?]:
git --version
echo.
pause