-- CodeLearn — начальные данные: системный курс «Python — основы» и 6 задач.
-- Идемпотентен (ON CONFLICT DO NOTHING). Запускать после schema.sql.
-- Пользовательские курсы и сами пользователи сюда намеренно не входят.

-- Системный курс (публичный, без владельца)
INSERT INTO courses (id, title, description, language, access_code, owner_id, created_at) VALUES (1, 'Python — основы', 'Базовые алгоритмы и структуры данных на Python', 'python', NULL, NULL, '2026-06-29 03:11:30.17301')
ON CONFLICT (id) DO NOTHING;

-- Задачи
INSERT INTO tasks (id, title, description, starter_code, difficulty, topic, created_at, course_id) VALUES (1, 'Сумма двух чисел', 'Напишите функцию `sum(a, b)`, которая принимает два числа и возвращает их сумму.', 'def sum(a, b):
    # Ваш код здесь
    pass', 'easy', 'Основы', '2026-05-20 14:54:42.621575', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks (id, title, description, starter_code, difficulty, topic, created_at, course_id) VALUES (2, 'Факториал числа', 'Напишите функцию `factorial(n)`, которая вычисляет факториал числа n. Факториал 0 равен 1.', 'def factorial(n):
    # Ваш код здесь
    pass', 'easy', 'Рекурсия', '2026-05-20 14:54:42.621575', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks (id, title, description, starter_code, difficulty, topic, created_at, course_id) VALUES (3, 'Разворот строки', 'Напишите функцию `reverse_string(s)`, которая принимает строку и возвращает её в обратном порядке.', 'def reverse_string(s):
    # Ваш код здесь
    pass', 'easy', 'Строки', '2026-05-20 14:54:42.621575', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks (id, title, description, starter_code, difficulty, topic, created_at, course_id) VALUES (4, 'Число Фибоначчи', 'Напишите функцию `fibonacci(n)`, которая возвращает n-е число Фибоначчи. fibonacci(0) = 0, fibonacci(1) = 1.', 'def fibonacci(n):
    # Ваш код здесь
    pass', 'medium', 'Рекурсия', '2026-05-20 14:54:42.621575', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks (id, title, description, starter_code, difficulty, topic, created_at, course_id) VALUES (5, 'Проверка палиндрома', 'Напишите функцию `is_palindrome(s)`, которая возвращает True если строка является палиндромом, иначе False. Регистр игнорируется.', 'def is_palindrome(s):
    # Ваш код здесь
    pass', 'medium', 'Строки', '2026-05-20 14:54:42.621575', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks (id, title, description, starter_code, difficulty, topic, created_at, course_id) VALUES (6, 'Максимум в списке', 'Напишите функцию `find_max(lst)`, которая находит максимальный элемент в списке без использования встроенной функции max().', 'def find_max(lst):
    # Ваш код здесь
    pass', 'medium', 'Списки', '2026-05-20 14:54:42.621575', 1)
ON CONFLICT (id) DO NOTHING;

-- Видимые примеры
INSERT INTO task_examples (id, task_id, input, output, explanation) VALUES (1, 1, 'sum(2, 3)', '5', 'складываем два числа')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_examples (id, task_id, input, output, explanation) VALUES (2, 1, 'sum(-1, 1)', '0', 'отрицательное плюс положительное')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_examples (id, task_id, input, output, explanation) VALUES (3, 2, 'factorial(5)', '120', '5 × 4 × 3 × 2 × 1 = 120')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_examples (id, task_id, input, output, explanation) VALUES (4, 2, 'factorial(0)', '1', 'факториал нуля равен 1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_examples (id, task_id, input, output, explanation) VALUES (5, 3, 'reverse_string("hello")', '"olleh"', 'читаем строку справа налево')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_examples (id, task_id, input, output, explanation) VALUES (6, 3, 'reverse_string("")', '""', 'пустая строка остаётся пустой')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_examples (id, task_id, input, output, explanation) VALUES (7, 4, 'fibonacci(6)', '8', '0,1,1,2,3,5,8 — шестой элемент')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_examples (id, task_id, input, output, explanation) VALUES (8, 4, 'fibonacci(0)', '0', 'нулевой элемент последовательности')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_examples (id, task_id, input, output, explanation) VALUES (9, 5, 'is_palindrome("racecar")', 'True', 'читается одинаково с обеих сторон')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_examples (id, task_id, input, output, explanation) VALUES (10, 5, 'is_palindrome("hello")', 'False', 'не палиндром')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_examples (id, task_id, input, output, explanation) VALUES (11, 6, 'find_max([1, 3, 2])', '3', 'максимальный элемент списка')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_examples (id, task_id, input, output, explanation) VALUES (12, 6, 'find_max([-1, -5, -2])', '-1', 'среди отрицательных максимум -1')
ON CONFLICT (id) DO NOTHING;

-- Скрытые тесты
INSERT INTO task_hidden_tests (id, task_id, test_code) VALUES (7, 1, 'assert sum(2, 3) == 5
assert sum(-1, 1) == 0
assert sum(0, 0) == 0
assert sum(100, 200) == 300
assert sum(-5, -3) == -8
print("✓ Все тесты пройдены!")')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_hidden_tests (id, task_id, test_code) VALUES (8, 2, 'assert factorial(0) == 1
assert factorial(1) == 1
assert factorial(5) == 120
assert factorial(10) == 3628800
print("✓ Все тесты пройдены!")')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_hidden_tests (id, task_id, test_code) VALUES (9, 3, 'assert reverse_string("hello") == "olleh"
assert reverse_string("") == ""
assert reverse_string("a") == "a"
print("✓ Все тесты пройдены!")')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_hidden_tests (id, task_id, test_code) VALUES (10, 4, 'assert fibonacci(0) == 0
assert fibonacci(1) == 1
assert fibonacci(6) == 8
assert fibonacci(10) == 55
print("✓ Все тесты пройдены!")')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_hidden_tests (id, task_id, test_code) VALUES (11, 5, 'assert is_palindrome("racecar") == True
assert is_palindrome("hello") == False
assert is_palindrome("Madam") == True
assert is_palindrome("") == True
print("✓ Все тесты пройдены!")')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_hidden_tests (id, task_id, test_code) VALUES (12, 6, 'assert find_max([1, 3, 2]) == 3
assert find_max([-1, -5, -2]) == -1
assert find_max([42]) == 42
assert find_max([0, 0, 0]) == 0
print("✓ Все тесты пройдены!")')
ON CONFLICT (id) DO NOTHING;

-- Выравниваем счётчики SERIAL, чтобы новые записи не конфликтовали с seed-id
SELECT setval(pg_get_serial_sequence('courses', 'id'),           GREATEST((SELECT COALESCE(MAX(id), 1) FROM courses), 1));
SELECT setval(pg_get_serial_sequence('tasks', 'id'),             GREATEST((SELECT COALESCE(MAX(id), 1) FROM tasks), 1));
SELECT setval(pg_get_serial_sequence('task_examples', 'id'),     GREATEST((SELECT COALESCE(MAX(id), 1) FROM task_examples), 1));
SELECT setval(pg_get_serial_sequence('task_hidden_tests', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM task_hidden_tests), 1));
