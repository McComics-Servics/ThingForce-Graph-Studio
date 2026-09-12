@echo off
title ThingForce™ Graph Studio v4.0
cd /d "%~dp0"
echo.
echo   ===================================================
echo    ThingForce™ Graph Studio v4.0
echo    Grafo multiproyecto ^| indices aislados ^| API/MCP local
echo   ===================================================
echo.

:: Verificar que node existe
where node >nul 2>nul
if errorlevel 1 (
    echo   [ERROR] Node.js no encontrado en PATH
    echo   Instala Node.js desde https://nodejs.org
    pause
    exit /b 1
)

:: Verificar que node_modules existe
if not exist "node_modules" (
    echo   [SETUP] Instalando dependencias...
    call npm install
    if errorlevel 1 (
        echo   [ERROR] npm install fallo
        pause
        exit /b 1
    )
)

echo   Iniciando Dashboard y MCP bajo un solo supervisor...
echo.
echo   ===================================================
echo    Dashboard: http://localhost:5173
echo    MCP API multiproyecto en http://127.0.0.1:3098
echo    Ctrl+C o cerrar esta ventana detiene ambos procesos.
echo   ===================================================
echo.
call npm run start:dashboard
if errorlevel 1 (
    echo.
    echo   [ERROR] El Dashboard o MCP no pudo iniciar.
    echo   Revisa que los puertos 5173 y 3098 no esten ocupados.
    pause
)
