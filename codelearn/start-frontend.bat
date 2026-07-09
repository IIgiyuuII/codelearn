@echo off
echo === CodeLearn: запуск React-фронтенда ===
cd /d "%~dp0frontend"

echo Устанавливаем зависимости (только первый раз)...
npm install

echo Запускаем на порту 3000...
npm start
