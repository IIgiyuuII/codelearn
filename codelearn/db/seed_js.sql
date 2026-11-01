-- CodeLearn — системный курс «JavaScript — основы» (6 задач).
-- Идемпотентен: если курс уже есть, ничего не делает. Фиксированных id не использует,
-- поэтому безопасен для базы, где уже есть свои курсы и задачи. Запускать после schema.sql.
-- Скрытые тесты — обычный JavaScript; доступны assertEqual / assertNotEqual / assert / assertThrows.
DO $seed$
DECLARE
  cid int;
  tid int;
BEGIN
  IF EXISTS (SELECT 1 FROM courses WHERE title = 'JavaScript — основы' AND owner_id IS NULL) THEN
    RETURN;
  END IF;

  INSERT INTO courses (title, description, language)
  VALUES ('JavaScript — основы', 'Базовые алгоритмы и структуры данных на JavaScript', 'javascript')
  RETURNING id INTO cid;

  -- 1
  INSERT INTO tasks (title, description, starter_code, difficulty, topic, course_id) VALUES (
    'Сумма двух чисел',
    $t$Напишите функцию `sum(a, b)`, которая принимает два числа и возвращает их сумму.$t$,
    $t$function sum(a, b) {
  // Ваш код здесь
}$t$, 'easy', 'Основы', cid) RETURNING id INTO tid;
  INSERT INTO task_examples (task_id, input, output, explanation) VALUES
    (tid, 'sum(2, 3)', '5', 'складываем два числа'),
    (tid, 'sum(-1, 1)', '0', 'отрицательное плюс положительное');
  INSERT INTO task_hidden_tests (task_id, test_code) VALUES (tid, $t$assertEqual(sum(2, 3), 5);
assertEqual(sum(-1, 1), 0);
assertEqual(sum(0, 0), 0);
assertEqual(sum(100, 200), 300);
assertEqual(sum(-5, -3), -8);$t$);

  -- 2
  INSERT INTO tasks (title, description, starter_code, difficulty, topic, course_id) VALUES (
    'Факториал числа',
    $t$Напишите функцию `factorial(n)`, которая вычисляет факториал числа n. Факториал 0 равен 1.$t$,
    $t$function factorial(n) {
  // Ваш код здесь
}$t$, 'easy', 'Рекурсия', cid) RETURNING id INTO tid;
  INSERT INTO task_examples (task_id, input, output, explanation) VALUES
    (tid, 'factorial(5)', '120', '5 × 4 × 3 × 2 × 1 = 120'),
    (tid, 'factorial(0)', '1', 'факториал нуля равен 1');
  INSERT INTO task_hidden_tests (task_id, test_code) VALUES (tid, $t$assertEqual(factorial(0), 1);
assertEqual(factorial(1), 1);
assertEqual(factorial(5), 120);
assertEqual(factorial(10), 3628800);$t$);

  -- 3
  INSERT INTO tasks (title, description, starter_code, difficulty, topic, course_id) VALUES (
    'Разворот строки',
    $t$Напишите функцию `reverseString(s)`, которая принимает строку и возвращает её в обратном порядке.$t$,
    $t$function reverseString(s) {
  // Ваш код здесь
}$t$, 'easy', 'Строки', cid) RETURNING id INTO tid;
  INSERT INTO task_examples (task_id, input, output, explanation) VALUES
    (tid, 'reverseString("hello")', '"olleh"', 'читаем строку справа налево'),
    (tid, 'reverseString("")', '""', 'пустая строка остаётся пустой');
  INSERT INTO task_hidden_tests (task_id, test_code) VALUES (tid, $t$assertEqual(reverseString("hello"), "olleh");
assertEqual(reverseString(""), "");
assertEqual(reverseString("a"), "a");
assertEqual(reverseString("привет"), "тевирп");$t$);

  -- 4
  INSERT INTO tasks (title, description, starter_code, difficulty, topic, course_id) VALUES (
    'Проверка палиндрома',
    $t$Напишите функцию `isPalindrome(s)`, которая возвращает `true`, если строка является палиндромом, иначе `false`. Регистр игнорируется.$t$,
    $t$function isPalindrome(s) {
  // Ваш код здесь
}$t$, 'medium', 'Строки', cid) RETURNING id INTO tid;
  INSERT INTO task_examples (task_id, input, output, explanation) VALUES
    (tid, 'isPalindrome("racecar")', 'true', 'читается одинаково с обеих сторон'),
    (tid, 'isPalindrome("hello")', 'false', 'не палиндром');
  INSERT INTO task_hidden_tests (task_id, test_code) VALUES (tid, $t$assertEqual(isPalindrome("racecar"), true);
assertEqual(isPalindrome("hello"), false);
assertEqual(isPalindrome("Madam"), true);
assertEqual(isPalindrome(""), true);$t$);

  -- 5
  INSERT INTO tasks (title, description, starter_code, difficulty, topic, course_id) VALUES (
    'Максимум в массиве',
    $t$Напишите функцию `findMax(arr)`, которая находит максимальный элемент массива без использования `Math.max`.$t$,
    $t$function findMax(arr) {
  // Ваш код здесь
}$t$, 'medium', 'Массивы', cid) RETURNING id INTO tid;
  INSERT INTO task_examples (task_id, input, output, explanation) VALUES
    (tid, 'findMax([1, 3, 2])', '3', 'максимальный элемент массива'),
    (tid, 'findMax([-1, -5, -2])', '-1', 'среди отрицательных максимум -1');
  INSERT INTO task_hidden_tests (task_id, test_code) VALUES (tid, $t$// Запрет Math.max: любой его вызов в решении завершит тесты ошибкой
Math.max = () => { throw new Error("Нельзя использовать Math.max"); };

assertEqual(findMax([1, 3, 2]), 3);
assertEqual(findMax([-1, -5, -2]), -1);
assertEqual(findMax([42]), 42);
assertEqual(findMax([0, 0, 0]), 0);$t$);

  -- 6
  INSERT INTO tasks (title, description, starter_code, difficulty, topic, course_id) VALUES (
    'Уникальные элементы',
    $t$Напишите функцию `unique(arr)`, которая возвращает новый массив без повторяющихся элементов. Порядок первых вхождений сохраняется.$t$,
    $t$function unique(arr) {
  // Ваш код здесь
}$t$, 'medium', 'Массивы', cid) RETURNING id INTO tid;
  INSERT INTO task_examples (task_id, input, output, explanation) VALUES
    (tid, 'unique([1, 2, 2, 3, 1])', '[1, 2, 3]', 'повторы убраны, порядок сохранён'),
    (tid, 'unique([])', '[]', 'пустой массив остаётся пустым');
  INSERT INTO task_hidden_tests (task_id, test_code) VALUES (tid, $t$assertEqual(unique([1, 2, 2, 3, 1]), [1, 2, 3]);
assertEqual(unique([]), []);
assertEqual(unique(["a", "b", "a"]), ["a", "b"]);
assertEqual(unique([3, 3, 3]), [3]);

const input = [3, 1, 3, 2];
unique(input);
assertEqual(input, [3, 1, 3, 2], "исходный массив менять нельзя");$t$);

  -- Уже зарегистрированные пользователи тоже получают публичный курс
  -- (новых записывает на все публичные курсы регистрация).
  INSERT INTO course_enrollments (user_id, course_id) SELECT id, cid FROM users ON CONFLICT DO NOTHING;
END
$seed$;
