@echo off
chcp 65001 > nul
echo === Запуск синхронизации с GitHub ===

git add .

set commit_msg=Auto-commit: %date% %time%

git commit -m "%commit_msg%"

echo Отправка файлов на сервер...
git push origin main

echo === Готово! Нажмите любую клавишу для выхода ===
pause
