@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Vigia Datadog

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nao foi encontrado nesta maquina.
  echo Instale o Node 22 ou mais novo e abra este arquivo de novo.
  pause
  exit /b 1
)

set "PUP_EXE=%LOCALAPPDATA%\Programs\pup\pup.exe"
where pup >nul 2>nul
if errorlevel 1 if not exist "%PUP_EXE%" (
  echo Instalando o pup, o CLI do Datadog...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Install-Pup.ps1"
  if errorlevel 1 (
    echo Nao consegui instalar o pup. Veja a mensagem acima.
    pause
    exit /b 1
  )
)

if not exist "%~dp0watch\node_modules" (
  echo Baixando o SDK do Cursor, usado pelo agente. Se falhar, o painel funciona sem o agente.
  pushd "%~dp0watch"
  call npm install --no-audit --no-fund
  popd
)

node "%~dp0watch\src\main.js"
if errorlevel 1 pause
