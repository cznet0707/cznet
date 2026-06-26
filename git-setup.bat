@echo off
cd /d C:\CZnET
echo =============================
echo   Verificando Git...
echo =============================
git --version
echo.
echo =============================
echo   Iniciando repositorio Git
echo =============================
git init
git config user.email "urelha8@gmail.com"
git config user.name "CZnET"
git add .
git commit -m "Deploy inicial CZnET no Railway"
echo.
echo =============================
echo   CONCLUIDO! 
echo =============================
echo.
pause