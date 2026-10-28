-- CodeLearn — схема БД (PostgreSQL 14+)
-- Идемпотентна: можно запускать повторно, существующие таблицы не трогает.
-- Построена по реальной БД (pg_dump 17.2) + индексы и ON DELETE CASCADE у tasks.course_id.

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(50) NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMP   DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courses (
    id          SERIAL PRIMARY KEY,
    title       VARCHAR(200) NOT NULL,
    description TEXT,
    language    VARCHAR(50)  DEFAULT 'python',
    access_code VARCHAR(20)  UNIQUE,                          -- NULL = публичный курс
    owner_id    INT REFERENCES users(id) ON DELETE CASCADE,   -- NULL = системный курс
    created_at  TIMESTAMP    DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
    id           SERIAL PRIMARY KEY,
    title        VARCHAR(200) NOT NULL,
    description  TEXT         NOT NULL,
    starter_code TEXT         NOT NULL,
    difficulty   VARCHAR(10)  DEFAULT 'easy'
                 CONSTRAINT tasks_difficulty_check CHECK (difficulty IN ('easy', 'medium', 'hard')),
    topic        VARCHAR(100) NOT NULL,
    created_at   TIMESTAMP    DEFAULT now(),
    course_id    INT REFERENCES courses(id) ON DELETE CASCADE
);

-- Видимые примеры (показываются студенту во вкладках «Тест N»)
CREATE TABLE IF NOT EXISTS task_examples (
    id          SERIAL PRIMARY KEY,
    task_id     INT REFERENCES tasks(id) ON DELETE CASCADE,
    input       TEXT NOT NULL,
    output      TEXT NOT NULL,
    explanation TEXT
);

-- Скрытые тесты (Python-код с assert; отдаются только в момент «Проверить»)
CREATE TABLE IF NOT EXISTS task_hidden_tests (
    id        SERIAL PRIMARY KEY,
    task_id   INT REFERENCES tasks(id) ON DELETE CASCADE,
    test_code TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_progress (
    user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id   INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    solved_at TIMESTAMP DEFAULT now(),
    PRIMARY KEY (user_id, task_id)
);

CREATE TABLE IF NOT EXISTS course_enrollments (
    user_id     INT NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    course_id   INT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMP DEFAULT now(),
    PRIMARY KEY (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_course       ON tasks(course_id);
CREATE INDEX IF NOT EXISTS idx_examples_task      ON task_examples(task_id);
CREATE INDEX IF NOT EXISTS idx_hidden_tests_task  ON task_hidden_tests(task_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_course ON course_enrollments(course_id);
