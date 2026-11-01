package main

import (
	"fmt"
	"strings"
	"testing"
)

// Матрица доступа: кто какие эндпоинты задачи может вызвать.
func TestTaskAccessMatrix(t *testing.T) {
	e := newEnv(t)
	owner, member, outsider := e.register("owner"), e.register("member"), e.register("outsider")
	cid, code := e.createCourse(owner, "Курс", "python")
	tid := e.addTask(owner, cid, "Задача", "assert secret()")
	e.join(member, code)

	endpoints := []struct {
		name, method, path string
		owner, member, out int // ожидаемые статусы
	}{
		{"задача", "GET", "/api/tasks/%d", 200, 200, 403},
		{"примеры", "GET", "/api/tasks/%d/examples", 200, 200, 403},
		{"скрытые тесты", "POST", "/api/tasks/%d/get-tests", 200, 200, 403},
		{"отметка решения", "POST", "/api/tasks/%d/solved", 200, 200, 403},
		{"полная (для правки)", "GET", "/api/tasks/%d/full", 200, 403, 403},
		{"изменение", "PUT", "/api/tasks/%d", 200, 403, 403},
		{"удаление", "DELETE", "/api/tasks/%d", 200, 403, 403},
	}
	valid := map[string]any{"title": "Т", "description": "Д", "hiddenTests": "assert 1"}
	for _, ep := range endpoints {
		path := fmt.Sprintf(ep.path, tid)
		for _, who := range []struct {
			name  string
			token string
			want  int
		}{{"студент", member.token, ep.member}, {"посторонний", outsider.token, ep.out}, {"без токена", "", 401}} {
			if status, _ := e.call(ep.method, path, who.token, valid); status != who.want {
				t.Errorf("%s / %s: %d, ожидался %d", ep.name, who.name, status, who.want)
			}
		}
	}
	// владельцу проверяем в самом конце: DELETE удаляет задачу
	for _, ep := range endpoints {
		if status, _ := e.call(ep.method, fmt.Sprintf(ep.path, tid), owner.token, valid); status != ep.owner {
			t.Errorf("%s / владелец: %d, ожидался %d", ep.name, status, ep.owner)
		}
		if ep.method == "DELETE" {
			break
		}
	}
	// несуществующая задача и мусорный id
	for _, p := range []string{"/api/tasks/99999", "/api/tasks/99999/examples", "/api/tasks/0"} {
		if status, _ := e.call("GET", p, owner.token, nil); status != 404 {
			t.Errorf("GET %s → %d, ожидался 404", p, status)
		}
	}
}

func TestTaskResponses(t *testing.T) {
	e := newEnv(t)
	owner := e.register("owner")
	cid, _ := e.createCourse(owner, "JS", "javascript")
	_, res := e.call("POST", fmt.Sprintf("/api/courses/%d/tasks", cid), owner.token, map[string]any{
		"title": "Сумма", "description": "Сложить", "starterCode": "function sum(a, b) {}", "difficulty": "hard", "topic": "Основы",
		"hiddenTests": "assertEqual(sum(1, 2), 3);\nassertEqual(sum(0, 0), 0);",
		"examples":    []map[string]string{{"input": "sum(1, 2)", "output": "3", "explanation": "сложение"}},
	})
	tid := num(res["taskId"])

	_, task := e.call("GET", fmt.Sprintf("/api/tasks/%d", tid), owner.token, nil)
	if task["title"] != "Сумма" || task["difficulty"] != "hard" || task["topic"] != "Основы" || task["starterCode"] != "function sum(a, b) {}" {
		t.Errorf("поля задачи: %v", task)
	}
	if task["language"] != "javascript" {
		t.Errorf("язык задачи = язык курса: %v", task["language"])
	}
	if strings.Contains(fmt.Sprint(task), "assertEqual") {
		t.Error("GET /tasks/:id не должен раскрывать скрытые тесты")
	}

	_, tests := e.call("POST", fmt.Sprintf("/api/tasks/%d/get-tests", tid), owner.token, nil)
	if tests["tests"] != "assertEqual(sum(1, 2), 3);\nassertEqual(sum(0, 0), 0);" {
		t.Errorf("get-tests: %v", tests["tests"])
	}
	_, ex := e.call("GET", fmt.Sprintf("/api/tasks/%d/examples", tid), owner.token, nil)
	if getPath(ex, "examples.0.input") != "sum(1, 2)" || getPath(ex, "examples.0.explanation") != "сложение" {
		t.Errorf("examples: %v", ex)
	}

	// Python-курс и системные задачи отдают свой язык
	_, py := e.call("GET", "/api/tasks/1", owner.token, nil)
	if py["language"] != "python" {
		t.Errorf("системная Python-задача: %v", py["language"])
	}
	jsTask := queryInt(t, `SELECT MIN(t.id) FROM tasks t JOIN courses c ON c.id=t.course_id WHERE c.language='javascript' AND c.owner_id IS NULL`)
	_, js := e.call("GET", fmt.Sprintf("/api/tasks/%d", jsTask), owner.token, nil)
	if js["language"] != "javascript" {
		t.Errorf("системная JS-задача: %v", js["language"])
	}

	// задача без скрытых тестов → 404 «Тесты не найдены», а не пустой успех
	mustExec(t, `DELETE FROM task_hidden_tests WHERE task_id=$1`, tid)
	if status, r := e.call("POST", fmt.Sprintf("/api/tasks/%d/get-tests", tid), owner.token, nil); status != 404 {
		t.Errorf("задача без тестов: %d %v", status, r)
	}
	// несколько строк тестов склеиваются по порядку
	mustExec(t, `INSERT INTO task_hidden_tests (task_id, test_code) VALUES ($1,'a'),($1,'b')`, tid)
	_, tests = e.call("POST", fmt.Sprintf("/api/tasks/%d/get-tests", tid), owner.token, nil)
	if tests["tests"] != "a\nb" {
		t.Errorf("склейка тестов: %q", tests["tests"])
	}
}

func TestAddTaskValidationHTTP(t *testing.T) {
	e := newEnv(t)
	owner, student := e.register("owner"), e.register("student")
	cid, code := e.createCourse(owner, "Курс", "python")
	e.join(student, code)
	path := fmt.Sprintf("/api/courses/%d/tasks", cid)
	ok := map[string]any{"title": "Т", "description": "Д", "hiddenTests": "assert 1"}

	if status, _ := e.call("POST", path, student.token, ok); status != 403 {
		t.Errorf("студент: %d", status)
	}
	if status, _ := e.call("POST", "/api/courses/99999/tasks", owner.token, ok); status != 404 {
		t.Errorf("курс не найден: %d", status)
	}
	if status, _ := e.call("POST", "/api/courses/1/tasks", owner.token, ok); status != 403 {
		t.Errorf("системный курс: %d", status)
	}
	bad := []map[string]any{
		{"title": "", "description": "Д", "hiddenTests": "x"},
		{"title": "Т", "description": "", "hiddenTests": "x"},
		{"title": "Т", "description": "Д", "hiddenTests": ""},
		{"title": "Т", "description": "Д", "hiddenTests": "x", "difficulty": "extreme"},
		{"title": "Т", "description": "Д", "hiddenTests": "x", "examples": []map[string]string{{"input": "1", "output": ""}}},
	}
	for i, body := range bad {
		if status, _ := e.call("POST", path, owner.token, body); status != 400 {
			t.Errorf("невалидная задача #%d: %d, ожидался 400", i, status)
		}
	}
	if status, _ := e.call("POST", path, owner.token, "не json"); status != 400 {
		t.Error("невалидный JSON должен давать 400")
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM tasks WHERE course_id=$1`, cid); n != 0 {
		t.Errorf("отказы не должны оставлять мусор: задач %d", n)
	}
}

func TestUpdateTask(t *testing.T) {
	e := newEnv(t)
	owner := e.register("owner")
	cid, _ := e.createCourse(owner, "Курс", "python")
	tid := e.addTask(owner, cid, "Старая", "assert old()")
	path := fmt.Sprintf("/api/tasks/%d", tid)

	_, full := e.call("GET", path+"/full", owner.token, nil)
	if full["hiddenTests"] != "assert old()" || getPath(full, "task.title") != "Старая" || getPath(full, "task.language") != "python" {
		t.Fatalf("/full: %v", full)
	}

	upd := map[string]any{
		"title": "Новая", "description": "v2", "topic": "Математика", "difficulty": "easy",
		"hiddenTests": "assert new()",
		"examples":    []map[string]string{{"input": "a", "output": "1"}, {"input": "b", "output": "2"}},
	}
	if status, res := e.call("PUT", path, owner.token, upd); status != 200 {
		t.Fatalf("PUT: %d %v", status, res)
	}
	if got := queryStr(t, `SELECT title||'|'||topic FROM tasks WHERE id=$1`, tid); got != "Новая|Математика" {
		t.Errorf("поля: %q", got)
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM task_hidden_tests WHERE task_id=$1`, tid); n != 1 {
		t.Errorf("тесты заменяются, а не копятся: строк %d", n)
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM task_examples WHERE task_id=$1`, tid); n != 2 {
		t.Errorf("примеры заменяются: %d", n)
	}
	_, tests := e.call("POST", path+"/get-tests", owner.token, nil)
	if tests["tests"] != "assert new()" {
		t.Errorf("get-tests отдаёт старые тесты: %v", tests["tests"])
	}

	// невалидное изменение отклоняется и ничего не портит
	if status, _ := e.call("PUT", path, owner.token, map[string]any{"title": "Сломано"}); status != 400 {
		t.Error("невалидный PUT должен давать 400")
	}
	if got := queryStr(t, `SELECT title FROM tasks WHERE id=$1`, tid); got != "Новая" {
		t.Errorf("после отказа задача изменилась: %q", got)
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM task_examples WHERE task_id=$1`, tid); n != 2 {
		t.Error("после отказа примеры потеряны")
	}
	// изменение сохраняет прогресс студентов
	e.solve(owner, tid)
	e.call("PUT", path, owner.token, upd)
	if n := queryInt(t, `SELECT COUNT(*) FROM user_progress WHERE task_id=$1`, tid); n != 1 {
		t.Error("изменение задачи не должно сбрасывать отметки о решении")
	}
}

func TestDeleteTask(t *testing.T) {
	e := newEnv(t)
	owner, student := e.register("owner"), e.register("student")
	cid, code := e.createCourse(owner, "Курс", "python")
	tid := e.addTask(owner, cid, "Т", "assert 1")
	e.join(student, code)
	e.solve(student, tid)

	if status, _ := e.call("DELETE", fmt.Sprintf("/api/tasks/%d", tid), owner.token, nil); status != 200 {
		t.Fatal("удаление не удалось")
	}
	left := queryStr(t, `SELECT (SELECT COUNT(*) FROM tasks WHERE id=$1)||'/'||(SELECT COUNT(*) FROM task_examples WHERE task_id=$1)||'/'||
		(SELECT COUNT(*) FROM task_hidden_tests WHERE task_id=$1)||'/'||(SELECT COUNT(*) FROM user_progress WHERE task_id=$1)`, tid)
	if left != "0/0/0/0" {
		t.Errorf("задач/примеров/тестов/прогресса осталось: %s", left)
	}
	if status, _ := e.call("DELETE", fmt.Sprintf("/api/tasks/%d", tid), owner.token, nil); status != 404 {
		t.Error("повторное удаление → 404")
	}
	// системные задачи защищены
	if status, _ := e.call("DELETE", "/api/tasks/1", owner.token, nil); status != 403 {
		t.Error("системную задачу удалить нельзя")
	}
	if status, _ := e.call("PUT", "/api/tasks/1", owner.token, map[string]any{"title": "x", "description": "d", "hiddenTests": "t"}); status != 403 {
		t.Error("системную задачу изменить нельзя")
	}
}

func TestSolvedAndProgress(t *testing.T) {
	e := newEnv(t)
	owner, student := e.register("owner"), e.register("student")

	// только системные курсы: 6 Python + 6 JS = 12 доступных задач
	_, p := e.call("GET", "/api/progress", student.token, nil)
	if num(p["total"]) != 12 || num(p["solved"]) != 0 {
		t.Fatalf("прогресс нового пользователя: %v", p)
	}
	if arr, ok := p["solvedTasks"].([]any); !ok || len(arr) != 0 {
		t.Errorf("solvedTasks должен быть [], а не null: %v", p["solvedTasks"])
	}

	// чужие приватные курсы в total не попадают (раньше считались ВСЕ задачи в БД)
	cid, code := e.createCourse(owner, "Приватный", "python")
	private := e.addTask(owner, cid, "Т", "assert 1")
	_, p = e.call("GET", "/api/progress", student.token, nil)
	if num(p["total"]) != 12 {
		t.Errorf("total учитывает чужой приватный курс: %v", p["total"])
	}

	// решение: идемпотентно, ответ — отсортированный список решённых
	_, r := e.call("POST", "/api/tasks/3/solved", student.token, nil)
	e.call("POST", "/api/tasks/1/solved", student.token, nil)
	_, r = e.call("POST", "/api/tasks/1/solved", student.token, nil)
	if fmt.Sprint(r["solvedTasks"]) != "[1 3]" {
		t.Errorf("solvedTasks = %v, ожидалось [1 3]", r["solvedTasks"])
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM user_progress WHERE user_id=$1`, student.id); n != 2 {
		t.Errorf("повторная отметка не должна дублироваться: %d", n)
	}

	// вступление в курс увеличивает total; прогресс по курсу, из которого пользователь не записан, не считается
	e.join(student, code)
	e.solve(student, private)
	_, p = e.call("GET", "/api/progress", student.token, nil)
	if num(p["total"]) != 13 || num(p["solved"]) != 3 {
		t.Errorf("после вступления: %v", p)
	}
	mustExec(t, `DELETE FROM course_enrollments WHERE user_id=$1 AND course_id=$2`, student.id, cid)
	_, p = e.call("GET", "/api/progress", student.token, nil)
	if num(p["total"]) != 12 || num(p["solved"]) != 2 {
		t.Errorf("после выхода из курса прогресс по нему не считается: %v", p)
	}
	// список курсов показывает решённые по каждому курсу
	_, list := e.call("GET", "/api/courses", student.token, nil)
	for _, c := range list["courses"].([]any) {
		m := c.(map[string]any)
		if m["language"] == "python" && num(m["solvedCount"]) != 2 {
			t.Errorf("solvedCount Python-курса: %v", m["solvedCount"])
		}
	}
}
