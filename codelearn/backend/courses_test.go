package main

import (
	"fmt"
	"strings"
	"testing"
)

func TestCreateCourse(t *testing.T) {
	e := newEnv(t)
	alice := e.register("alice")
	bob := e.register("bob")

	long := strings.Repeat("я", 201)
	bad := []struct {
		name string
		body any
		sub  string
	}{
		{"пустое название", map[string]string{"title": "  "}, "название"},
		{"длинное название", map[string]string{"title": long}, "200"},
		{"неизвестный язык", map[string]string{"title": "К", "language": "cobol"}, "Язык"},
		{"невалидный JSON", "{{", "Неверный запрос"},
	}
	for _, c := range bad {
		if status, res := e.call("POST", "/api/courses", alice.token, c.body); status != 400 || !strings.Contains(errText(res), c.sub) {
			t.Errorf("%s: %d %v", c.name, status, res)
		}
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM courses WHERE owner_id IS NOT NULL`); n != 0 {
		t.Fatalf("отказы не должны создавать курсы: %d", n)
	}

	status, res := e.call("POST", "/api/courses", alice.token, map[string]string{"title": "  Алгоритмы  ", "description": " о курсе ", "language": "javascript"})
	if status != 200 {
		t.Fatal(status, res)
	}
	id := num(res["id"])
	code := res["accessCode"].(string)
	if len(code) != 8 {
		t.Errorf("код доступа: %q", code)
	}
	if got := queryStr(t, `SELECT title||'|'||description||'|'||language FROM courses WHERE id=$1`, id); got != "Алгоритмы|о курсе|javascript" {
		t.Errorf("курс сохранён неверно: %q", got)
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM course_enrollments WHERE course_id=$1 AND user_id=$2`, id, alice.id); n != 1 {
		t.Error("владелец должен быть записан на свой курс")
	}

	// язык по умолчанию
	_, res = e.call("POST", "/api/courses", alice.token, map[string]string{"title": "Без языка"})
	if lang := queryStr(t, `SELECT language FROM courses WHERE id=$1`, num(res["id"])); lang != "python" {
		t.Errorf("язык по умолчанию: %q", lang)
	}

	// владелец видит код доступа, другие — нет
	_, list := e.call("GET", "/api/courses", alice.token, nil)
	var seen bool
	for _, c := range list["courses"].([]any) {
		m := c.(map[string]any)
		if num(m["id"]) == id {
			seen = true
			if m["isOwner"] != true || m["accessCode"] != code {
				t.Errorf("владелец: isOwner=%v accessCode=%v", m["isOwner"], m["accessCode"])
			}
		}
	}
	if !seen {
		t.Error("созданный курс не появился в списке владельца")
	}
	_, list = e.call("GET", "/api/courses", bob.token, nil)
	for _, c := range list["courses"].([]any) {
		if num(c.(map[string]any)["id"]) == id {
			t.Error("чужой курс виден посторонним до вступления")
		}
	}
	e.join(bob, code)
	_, list = e.call("GET", "/api/courses", bob.token, nil)
	for _, c := range list["courses"].([]any) {
		m := c.(map[string]any)
		if num(m["id"]) == id && (m["isOwner"] != false || m["accessCode"] != nil) {
			t.Errorf("участник не должен видеть код доступа: %v", m)
		}
	}
}

func TestJoinCourse(t *testing.T) {
	e := newEnv(t)
	owner, student := e.register("owner"), e.register("student")
	cid, code := e.createCourse(owner, "Курс", "python")

	cases := []struct {
		name   string
		body   any
		status int
		sub    string
	}{
		{"пустой код", map[string]string{"code": ""}, 400, "код"},
		{"невалидный JSON", "{", 400, "код"},
		{"неизвестный код", map[string]string{"code": "ZZZZZZZZ"}, 404, "не найден"},
		{"код в нижнем регистре и с пробелами", map[string]string{"code": "  " + strings.ToLower(code) + "  "}, 200, "Курс"},
		{"повторное вступление", map[string]string{"code": code}, 400, "уже записаны"},
	}
	for _, c := range cases {
		status, res := e.call("POST", "/api/courses/join", student.token, c.body)
		if status != c.status {
			t.Fatalf("%s: статус %d, ожидался %d (%v)", c.name, status, c.status, res)
		}
		if c.status != 200 && !strings.Contains(errText(res), c.sub) {
			t.Errorf("%s: ошибка %q не содержит %q", c.name, errText(res), c.sub)
		}
		if c.status == 200 && num(res["courseId"]) != cid {
			t.Errorf("%s: courseId = %v", c.name, res["courseId"])
		}
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM course_enrollments WHERE course_id=$1 AND user_id=$2`, cid, student.id); n != 1 {
		t.Errorf("записей о вступлении: %d", n)
	}
}

func TestCourseTasksPage(t *testing.T) {
	e := newEnv(t)
	owner, student, outsider := e.register("owner"), e.register("student"), e.register("outsider")
	cid, code := e.createCourse(owner, "Курс", "javascript")
	t1 := e.addTask(owner, cid, "Первая", "assertEqual(1, 1)")
	e.addTask(owner, cid, "Вторая", "assertEqual(2, 2)")
	e.join(student, code)
	e.solve(student, t1)

	path := fmt.Sprintf("/api/courses/%d/tasks", cid)
	if status, _ := e.call("GET", path, outsider.token, nil); status != 403 {
		t.Errorf("не записанный пользователь: %d, ожидался 403", status)
	}

	_, res := e.call("GET", path, student.token, nil)
	tasks := res["tasks"].([]any)
	if len(tasks) != 2 || getPath(res, "tasks.0.title") != "Первая" {
		t.Errorf("задачи в порядке создания: %v", tasks)
	}
	if res["isOwner"] != false {
		t.Error("студент не владелец")
	}
	if solved := res["solvedTasks"].([]any); len(solved) != 1 || num(solved[0]) != t1 {
		t.Errorf("solvedTasks = %v", solved)
	}
	if getPath(res, "course.language") != "javascript" || getPath(res, "course.title") != "Курс" {
		t.Errorf("данные курса: %v", res["course"])
	}
	// скрытые тесты в списке задач не раскрываются
	if strings.Contains(fmt.Sprint(res), "assertEqual") {
		t.Error("список задач не должен содержать скрытые тесты")
	}

	_, res = e.call("GET", path, owner.token, nil)
	if res["isOwner"] != true {
		t.Error("владелец должен видеть isOwner=true")
	}
	if solved := res["solvedTasks"].([]any); len(solved) != 0 {
		t.Error("у владельца нет решённых задач — прогресс студента не должен смешиваться")
	}

	// пустой курс — пустой массив, не null
	cid2, _ := e.createCourse(owner, "Пустой", "python")
	_, res = e.call("GET", fmt.Sprintf("/api/courses/%d/tasks", cid2), owner.token, nil)
	if tasks, ok := res["tasks"].([]any); !ok || len(tasks) != 0 {
		t.Errorf("пустой курс должен отдавать []: %v", res["tasks"])
	}
}

func TestUpdateCourse(t *testing.T) {
	e := newEnv(t)
	owner, student := e.register("owner"), e.register("student")
	cid, code := e.createCourse(owner, "Старое", "python")
	e.join(student, code)
	path := fmt.Sprintf("/api/courses/%d", cid)

	if status, _ := e.call("PUT", path, student.token, map[string]string{"title": "Взлом"}); status != 403 {
		t.Errorf("студент: %d, ожидался 403", status)
	}
	if status, _ := e.call("PUT", "/api/courses/99999", owner.token, map[string]string{"title": "Х"}); status != 404 {
		t.Errorf("несуществующий курс: %d", status)
	}
	if status, _ := e.call("PUT", "/api/courses/1", owner.token, map[string]string{"title": "Х"}); status != 403 {
		t.Errorf("системный курс изменять нельзя: %d", status)
	}
	for name, body := range map[string]any{
		"пустое название": map[string]string{"title": " "},
		"длинное":         map[string]string{"title": strings.Repeat("я", 201)},
		"мусор":           "[",
	} {
		if status, _ := e.call("PUT", path, owner.token, body); status != 400 {
			t.Errorf("%s: %d, ожидался 400", name, status)
		}
	}

	status, res := e.call("PUT", path, owner.token, map[string]string{"title": " Новое ", "description": "Описание", "language": "ruby"})
	if status != 200 || getPath(res, "course.title") != "Новое" {
		t.Fatalf("изменение: %d %v", status, res)
	}
	if got := queryStr(t, `SELECT title||'|'||description||'|'||language FROM courses WHERE id=$1`, cid); got != "Новое|Описание|python" {
		t.Errorf("сохранено %q (язык изменяться не должен)", got)
	}
}

func TestRegenerateAccessCode(t *testing.T) {
	e := newEnv(t)
	owner, student, late := e.register("owner"), e.register("student"), e.register("late")
	cid, oldCode := e.createCourse(owner, "Курс", "python")
	e.join(student, oldCode)
	path := fmt.Sprintf("/api/courses/%d/access-code", cid)

	if status, _ := e.call("POST", path, student.token, nil); status != 403 {
		t.Errorf("студент: %d, ожидался 403", status)
	}
	if status, _ := e.call("GET", path, owner.token, nil); status != 404 {
		t.Errorf("GET на access-code: %d", status)
	}

	status, res := e.call("POST", path, owner.token, nil)
	newCode, _ := res["accessCode"].(string)
	if status != 200 || len(newCode) != 8 || newCode == oldCode {
		t.Fatalf("новый код: %d %v", status, res)
	}
	if status, _ := e.call("POST", "/api/courses/join", late.token, map[string]string{"code": oldCode}); status != 404 {
		t.Errorf("старый код должен перестать работать: %d", status)
	}
	if status, _ := e.call("POST", "/api/courses/join", late.token, map[string]string{"code": newCode}); status != 200 {
		t.Errorf("новый код должен работать: %d", status)
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM course_enrollments WHERE course_id=$1`, cid); n != 3 {
		t.Errorf("прежние участники должны остаться: записей %d, ожидалось 3", n)
	}
}

func TestCourseStats(t *testing.T) {
	e := newEnv(t)
	owner := e.register("owner")
	bob, carol, dave := e.register("bob"), e.register("carol"), e.register("dave")
	outsider := e.register("outsider")
	cid, code := e.createCourse(owner, "Алгоритмы", "python")
	t1 := e.addTask(owner, cid, "T1", "assert 1")
	t2 := e.addTask(owner, cid, "T2", "assert 1")
	t3 := e.addTask(owner, cid, "T3", "assert 1")
	for _, u := range []user{bob, carol, dave} {
		e.join(u, code)
	}
	e.solve(bob, t1)
	e.solve(bob, t2)
	for _, id := range []int{t1, t2, t3} {
		e.solve(carol, id)
	}
	e.solve(owner, t1) // решение владельца в статистику входить не должно

	path := fmt.Sprintf("/api/courses/%d/stats", cid)
	for name, u := range map[string]user{"студент": bob, "посторонний": outsider} {
		if status, _ := e.call("GET", path, u.token, nil); status != 403 {
			t.Errorf("%s: %d, ожидался 403", name, status)
		}
	}
	if status, _ := e.call("GET", "/api/courses/99999/stats", owner.token, nil); status != 404 {
		t.Errorf("несуществующий курс: %d", status)
	}
	if status, _ := e.call("GET", "/api/courses/1/stats", owner.token, nil); status != 403 {
		t.Errorf("системный курс: %d", status)
	}

	status, res := e.call("GET", path, owner.token, nil)
	if status != 200 {
		t.Fatal(status, res)
	}
	var order []string
	for _, m := range res["members"].([]any) {
		mm := m.(map[string]any)
		order = append(order, fmt.Sprintf("%s:%d", mm["username"], num(mm["solvedCount"])))
	}
	if got := strings.Join(order, " "); got != "carol:3 bob:2 dave:0" {
		t.Errorf("участники (по убыванию прогресса, владельца нет): %q", got)
	}
	if getPath(res, "members.2.lastActiveAt") != nil {
		t.Error("у участника без решений lastActiveAt должен быть null")
	}
	if getPath(res, "members.0.lastActiveAt") == nil {
		t.Error("у carol должна быть дата активности")
	}
	var perTask []int
	for _, tk := range res["tasks"].([]any) {
		perTask = append(perTask, num(tk.(map[string]any)["solvedCount"]))
	}
	if fmt.Sprint(perTask) != "[2 2 1]" {
		t.Errorf("решаемость задач %v, ожидалось [2 2 1] (решение владельца не считается)", perTask)
	}
	sum := res["summary"].(map[string]any)
	if num(sum["memberCount"]) != 3 || num(sum["avgProgress"]) != 56 || num(sum["completedCount"]) != 1 {
		t.Errorf("сводка: %v", sum)
	}
	if num(res["totalTasks"]) != 3 || getPath(res, "course.accessCode") != code {
		t.Errorf("totalTasks/accessCode: %v / %v", res["totalTasks"], getPath(res, "course.accessCode"))
	}

	// пустой курс: нули, без деления на ноль
	cid2, _ := e.createCourse(owner, "Пустой", "python")
	_, res = e.call("GET", fmt.Sprintf("/api/courses/%d/stats", cid2), owner.token, nil)
	sum = res["summary"].(map[string]any)
	if num(sum["memberCount"]) != 0 || num(sum["avgProgress"]) != 0 || num(sum["completedCount"]) != 0 {
		t.Errorf("пустой курс: %v", sum)
	}
	if len(res["members"].([]any)) != 0 || len(res["tasks"].([]any)) != 0 {
		t.Error("пустой курс должен отдавать пустые массивы")
	}
}

func TestDeleteCourse(t *testing.T) {
	e := newEnv(t)
	owner, student := e.register("owner"), e.register("student")
	cid, code := e.createCourse(owner, "Алгоритмы 2", "python")
	otherID, _ := e.createCourse(owner, "Соседний", "python")
	e.addTask(owner, otherID, "Чужая задача", "assert 1")
	var taskIDs []int
	for i := 0; i < 3; i++ {
		taskIDs = append(taskIDs, e.addTask(owner, cid, fmt.Sprintf("Задача %d", i), "assert 1"))
	}
	e.join(student, code)
	e.solve(student, taskIDs[0])
	path := fmt.Sprintf("/api/courses/%d", cid)

	denied := []struct {
		name  string
		token string
		body  any
		want  int
	}{
		{"студент с верным названием", student.token, map[string]string{"confirmTitle": "Алгоритмы 2"}, 403},
		{"без тела", owner.token, nil, 400},
		{"пустое подтверждение", owner.token, map[string]string{"confirmTitle": ""}, 400},
		{"неполное название", owner.token, map[string]string{"confirmTitle": "Алгоритмы"}, 400},
		{"другой регистр", owner.token, map[string]string{"confirmTitle": "алгоритмы 2"}, 400},
		{"невалидный JSON", owner.token, "{", 400},
	}
	for _, c := range denied {
		if status, _ := e.call("DELETE", path, c.token, c.body); status != c.want {
			t.Errorf("%s: %d, ожидался %d", c.name, status, c.want)
		}
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM tasks WHERE course_id=$1`, cid); n != 3 {
		t.Fatalf("после отказов курс должен остаться целым: задач %d", n)
	}
	if status, _ := e.call("DELETE", "/api/courses/1", owner.token, map[string]string{"confirmTitle": "Python — основы"}); status != 403 {
		t.Errorf("системный курс удалять нельзя: %d", status)
	}

	// удаление с названием, у которого пробелы по краям
	if status, res := e.call("DELETE", path, owner.token, map[string]string{"confirmTitle": "  Алгоритмы 2 "}); status != 200 {
		t.Fatalf("удаление: %d %v", status, res)
	}
	left := queryStr(t, `SELECT (SELECT COUNT(*) FROM courses WHERE id=$1)||'/'||
		(SELECT COUNT(*) FROM tasks WHERE course_id=$1)||'/'||
		(SELECT COUNT(*) FROM course_enrollments WHERE course_id=$1)||'/'||
		(SELECT COUNT(*) FROM user_progress WHERE task_id = ANY($2))||'/'||
		(SELECT COUNT(*) FROM task_hidden_tests WHERE task_id = ANY($2))||'/'||
		(SELECT COUNT(*) FROM task_examples WHERE task_id = ANY($2))`, cid, pqIntArray(taskIDs))
	if left != "0/0/0/0/0/0" {
		t.Errorf("курс/задач/записей/прогресса/тестов/примеров осталось: %s", left)
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM tasks WHERE course_id=$1`, otherID); n != 1 {
		t.Error("соседний курс не должен пострадать")
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM users`); n != 2 {
		t.Error("пользователи удаляться не должны")
	}
	if status, _ := e.call("GET", path+"/stats", owner.token, nil); status != 404 {
		t.Error("удалённый курс должен отвечать 404")
	}
	if status, _ := e.call("DELETE", path, owner.token, map[string]string{"confirmTitle": "Алгоритмы 2"}); status != 404 {
		t.Error("повторное удаление → 404")
	}
}

// База, созданная до появления ON DELETE CASCADE у tasks.course_id, тоже должна удалять курсы.
func TestDeleteCourseWithoutCascadeConstraint(t *testing.T) {
	e := newEnv(t)
	owner := e.register("owner")
	cid, _ := e.createCourse(owner, "Старая схема", "python")
	e.addTask(owner, cid, "Задача", "assert 1")

	mustExec(t, `ALTER TABLE tasks DROP CONSTRAINT tasks_course_id_fkey,
		ADD CONSTRAINT tasks_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id)`)
	t.Cleanup(func() {
		db.Exec(`ALTER TABLE tasks DROP CONSTRAINT tasks_course_id_fkey,
			ADD CONSTRAINT tasks_course_id_fkey FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE`)
	})

	if status, res := e.call("DELETE", fmt.Sprintf("/api/courses/%d", cid), owner.token, map[string]string{"confirmTitle": "Старая схема"}); status != 200 {
		t.Fatalf("удаление на схеме без каскада: %d %v", status, res)
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM tasks WHERE course_id=$1`, cid); n != 0 {
		t.Error("задачи курса должны быть удалены")
	}
}
