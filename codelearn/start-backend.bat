@echo off
echo === CodeLearn: запуск Go-бэкенда ===
cd /d "%~dp0backend"

echo Загружаем зависимости...
go mod download

echo Запускаем сервер на порту 4000...
go run main.go
