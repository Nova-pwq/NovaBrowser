@echo off
chcp 65001 >nul
title NovaBrowser
cd /d "%~dp0"

if not exist package.json (
  echo Не знайдено package.json. Покладіть start.bat у папку NovaBrowser.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не встановлено. Зараз відкриється сайт для завантаження.
  echo Встановіть версію LTS і запустіть start.bat знову.
  start https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Перший запуск: встановлюю залежності, зачекайте 1-3 хвилини...
  call npm install
  if errorlevel 1 (
    echo Помилка під час npm install. Перевірте інтернет і спробуйте ще раз.
    pause
    exit /b 1
  )
)

echo Запускаю NovaBrowser...
call npm start
if errorlevel 1 pause
