package main

import (
	"strings"
	"testing"
)

// Скрипты db/*.sql применяются повторно без ошибок и без дублей — на этом держится
// и docker-compose, и «доудобрение» существующей базы.

func TestSchemaIsIdempotent(t *testing.T) {
	resetDB(t)
	before := queryInt(t, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'`)
	for i := 0; i < 2; i++ {
		if err := execSQLFile("schema.sql"); err != nil {
			t.Fatalf("повторный запуск schema.sql: %v", err)
		}
	}
	if after := queryInt(t, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'`); after != before || before != 8 {
		t.Errorf("таблиц было %d, стало %d (ожидалось 8)", before, after)
	}
}

func TestSeedsAreIdempotent(t *testing.T) {
	resetDB(t)
	snapshot := func() string {
		return queryStr(t, `SELECT (SELECT COUNT(*) FROM courses)||'/'||(SELECT COUNT(*) FROM tasks)||'/'||
			(SELECT COUNT(*) FROM task_examples)||'/'||(SELECT COUNT(*) FROM task_hidden_tests)`)
	}
	first := snapshot()
	for i := 0; i < 2; i++ {
		for _, f := range []string{"seed.sql", "seed_js.sql"} {
			if err := execSQLFile(f); err != nil {
				t.Fatalf("повторный запуск %s: %v", f, err)
			}
		}
	}
	if got := snapshot(); got != first || first != "2/12/24/12" {
		t.Errorf("курсов/задач/примеров/тестов: было %s, стало %s (ожидалось 2/12/24/12)", first, got)
	}
}

// seed_js.sql не должен ломаться на базе, где уже есть чужие курсы с «занятыми» id,
// и должен записывать уже существующих пользователей на новый публичный курс.
func TestSeedJSOnDatabaseWithUserData(t *testing.T) {
	requireDB(t)
	mustExec(t, `TRUNCATE users, courses RESTART IDENTITY CASCADE`)
	if err := execSQLFile("seed.sql"); err != nil {
		t.Fatal(err)
	}
	mustExec(t, `INSERT INTO users (username, password_hash) VALUES ('old1','x'), ('old2','x')`)
	mustExec(t, `INSERT INTO course_enrollments SELECT id, 1 FROM users`)
	mustExec(t, `INSERT INTO courses (id, title, language, access_code, owner_id) VALUES (2,'Свой','python','ABCDEFGH',1),(3,'Ещё','javascript','HGFEDCBA',1)`)
	mustExec(t, `SELECT setval('courses_id_seq', 3)`)

	if err := execSQLFile("seed_js.sql"); err != nil {
		t.Fatalf("seed_js.sql на базе с чужими курсами: %v", err)
	}
	if got := queryStr(t, `SELECT string_agg(id||':'||title, ',' ORDER BY id) FROM courses`); !strings.HasPrefix(got, "1:Python — основы,2:Свой,3:Ещё,") || !strings.Contains(got, "JavaScript — основы") {
		t.Errorf("курсы: %s", got)
	}
	jsID := queryInt(t, `SELECT id FROM courses WHERE title='JavaScript — основы'`)
	if jsID <= 3 {
		t.Errorf("новый курс получил занятый id %d", jsID)
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM course_enrollments WHERE course_id=$1`, jsID); n != 2 {
		t.Errorf("существующие пользователи должны быть записаны на новый публичный курс: %d из 2", n)
	}
}

func TestSeedContent(t *testing.T) {
	resetDB(t)
	for _, lang := range []string{"python", "javascript"} {
		var owner *int
		var code *string
		if err := db.QueryRow(`SELECT owner_id, access_code FROM courses WHERE language=$1 AND owner_id IS NULL`, lang).Scan(&owner, &code); err != nil {
			t.Fatalf("системный курс %s: %v", lang, err)
		}
		if owner != nil || code != nil {
			t.Errorf("%s: системный курс публичный и без владельца", lang)
		}
		if n := queryInt(t, `SELECT COUNT(*) FROM tasks t JOIN courses c ON c.id=t.course_id WHERE c.language=$1 AND c.owner_id IS NULL`, lang); n != 6 {
			t.Errorf("%s: задач %d, ожидалось 6", lang, n)
		}
		// у каждой задачи есть минимум 2 примера и непустые скрытые тесты
		bad := queryInt(t, `SELECT COUNT(*) FROM tasks t JOIN courses c ON c.id=t.course_id
			WHERE c.language=$1 AND c.owner_id IS NULL AND (
			  (SELECT COUNT(*) FROM task_examples e WHERE e.task_id=t.id) < 2 OR
			  NOT EXISTS (SELECT 1 FROM task_hidden_tests h WHERE h.task_id=t.id AND LENGTH(TRIM(h.test_code)) > 0))`, lang)
		if bad != 0 {
			t.Errorf("%s: задач без примеров или тестов: %d", lang, bad)
		}
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM task_hidden_tests h JOIN tasks t ON t.id=h.task_id JOIN courses c ON c.id=t.course_id
		WHERE c.language='python' AND h.test_code NOT LIKE '%assert%'`); n != 0 {
		t.Errorf("в Python-тестах нет assert: %d", n)
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM task_hidden_tests h JOIN tasks t ON t.id=h.task_id JOIN courses c ON c.id=t.course_id
		WHERE c.language='javascript' AND h.test_code NOT LIKE '%assert%'`); n != 0 {
		t.Errorf("в JS-тестах нет assert*: %d", n)
	}
}

func TestSequencesAfterSeed(t *testing.T) {
	resetDB(t)
	maxTask := queryInt(t, `SELECT MAX(id) FROM tasks`)
	mustExec(t, `INSERT INTO courses (title, owner_id) VALUES ('X', NULL)`)
	cid := queryInt(t, `SELECT MAX(id) FROM courses`)
	mustExec(t, `INSERT INTO tasks (title, description, starter_code, topic, course_id) VALUES ('t','d','c','т',$1)`, cid)
	if newID := queryInt(t, `SELECT MAX(id) FROM tasks`); newID <= maxTask {
		t.Errorf("новая задача получила id %d ≤ %d (счётчик не выровнен)", newID, maxTask)
	}
	if cid != 3 {
		t.Errorf("следующий курс после двух системных должен получить id 3, получил %d", cid)
	}
}

func TestSchemaConstraints(t *testing.T) {
	resetDB(t)
	uid := func(name string) int {
		mustExec(t, `INSERT INTO users (username, password_hash) VALUES ($1,'h')`, name)
		return queryInt(t, `SELECT id FROM users WHERE username=$1`, name)
	}
	u := uid("u")

	rejects := map[string]string{
		"повтор имени пользователя":         `INSERT INTO users (username, password_hash) VALUES ('u','h')`,
		"повтор кода доступа":               `INSERT INTO courses (title, access_code) SELECT 'x', 'SAMECODE' WHERE NOT EXISTS (SELECT 1 FROM courses WHERE access_code='SAMECODE') UNION ALL SELECT 'y', 'SAMECODE'`,
		"недопустимая сложность":            `INSERT INTO tasks (title, description, starter_code, topic, difficulty, course_id) VALUES ('t','d','c','т','extreme',1)`,
		"пустое название курса (NULL)":      `INSERT INTO courses (title) VALUES (NULL)`,
		"прогресс по несуществующей задаче": `INSERT INTO user_progress (user_id, task_id) VALUES (1, 999999)`,
	}
	for name, q := range rejects {
		if _, err := db.Exec(q); err == nil {
			t.Errorf("%s: БД должна отклонять", name)
		}
	}

	// составные первичные ключи не дают дублей
	mustExec(t, `INSERT INTO user_progress (user_id, task_id) VALUES ($1, 1)`, u)
	if _, err := db.Exec(`INSERT INTO user_progress (user_id, task_id) VALUES ($1, 1)`, u); err == nil {
		t.Error("дубль прогресса должен отклоняться")
	}
	mustExec(t, `INSERT INTO course_enrollments (user_id, course_id) VALUES ($1, 1)`, u)
	if _, err := db.Exec(`INSERT INTO course_enrollments (user_id, course_id) VALUES ($1, 1)`, u); err == nil {
		t.Error("дубль записи на курс должен отклоняться")
	}
}

func TestCascadeOnUserDeletion(t *testing.T) {
	e := newEnv(t)
	owner, student := e.register("owner"), e.register("student")
	cid, code := e.createCourse(owner, "Курс", "python")
	tid := e.addTask(owner, cid, "Т", "assert 1")
	e.join(student, code)
	e.solve(student, tid)

	mustExec(t, `DELETE FROM users WHERE id=$1`, student.id)
	if n := queryInt(t, `SELECT COUNT(*) FROM user_progress WHERE user_id=$1`, student.id); n != 0 {
		t.Error("прогресс удалённого пользователя должен исчезнуть")
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM course_enrollments WHERE user_id=$1`, student.id); n != 0 {
		t.Error("записи удалённого пользователя должны исчезнуть")
	}
	// удаление владельца уносит его курсы вместе с задачами
	mustExec(t, `DELETE FROM users WHERE id=$1`, owner.id)
	if n := queryInt(t, `SELECT COUNT(*) FROM courses WHERE id=$1`, cid); n != 0 {
		t.Error("курс удалённого владельца должен исчезнуть")
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM tasks WHERE id=$1`, tid); n != 0 {
		t.Error("задачи удалённого курса должны исчезнуть")
	}
}
