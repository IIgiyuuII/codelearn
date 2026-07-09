# CodeLearn — Go + React + WebAssembly

React + **Go (бэкенд)** + **WebAssembly (Pyodide)**.

## Быстрый старт (Windows)

1. Двойной клик → `start-backend.bat` (Go сервер на порту 4000)
2. Двойной клик → `start-frontend.bat` (React на порту 3000)
3. Открыть http://localhost:3000

## Требования
- Go 1.21+ (https://go.dev/dl/)
- Node.js 18+ (https://nodejs.org)

## Запуск вручную

```bash
# Терминал 1 — бэкенд
cd backend
go mod download
go run main.go

# Терминал 2 — фронтенд
cd frontend
npm install
npm start
```

## Как добавить задачу

В `backend/main.go` в массив `tasks`:

```go
{
    ID: 7, Title: "Название", 
    Description: "Напишите функцию `f(x)`...",
    StarterCode: "def f(x):\n    pass",
    Difficulty: "easy", Topic: "Тема",
    HiddenTests: `
assert f(1) == 42
print("✓ Все тесты пройдены!")
`,
},
```

## Примеры решений задач

```python
# 1. Сумма
def sum(a, b): return a + b

# 2. Факториал  
def factorial(n): return 1 if n == 0 else n * factorial(n-1)

# 3. Разворот строки
def reverse_string(s): return s[::-1]

# 4. Фибоначчи
def fibonacci(n): return n if n <= 1 else fibonacci(n-1) + fibonacci(n-2)

# 5. Палиндром
def is_palindrome(s): return s.lower() == s.lower()[::-1]

# 6. Максимум в списке
def find_max(lst):
    m = lst[0]
    for x in lst:
        if x > m: m = x
    return m
```
