@echo off
chcp 65001 > nul
echo === Запуск синхронизации с GitHub ===

:: Добавляем все изменения в папке
git add .

:: Формируем имя коммита с текущей датой и временем
set commit_msg=Auto-commit: %date% %time%

:: Делаем коммит
git commit -m "%commit_msg%"

:: Отправляем файлы на GitHub
echo Отправка файлов на сервер...
git push origin main

echo === Готово! Нажмите любую клавишу для выхода ===
pause
