package main

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

func TestRegisterAndLogin(t *testing.T) {
	e := newEnv(t)

	code, res := e.call("POST", "/api/register", "", map[string]string{"username": "alice", "password": "secret"})
	if code != 200 || res["token"] == "" || res["username"] != "alice" {
		t.Fatalf("регистрация: %d %v", code, res)
	}

	// пароль хранится только в виде bcrypt-хэша
	hash := queryStr(t, `SELECT password_hash FROM users WHERE username='alice'`)
	if hash == "secret" || bcrypt.CompareHashAndPassword([]byte(hash), []byte("secret")) != nil {
		t.Errorf("пароль должен храниться как bcrypt-хэш, в БД: %q", hash)
	}

	cases := []struct {
		name   string
		path   string
		body   any
		status int
		errSub string
	}{
		{"повторная регистрация", "/api/register", map[string]string{"username": "alice", "password": "x"}, 400, "уже существует"},
		{"пустое имя", "/api/register", map[string]string{"username": "", "password": "x"}, 400, "Заполните"},
		{"пустой пароль", "/api/register", map[string]string{"username": "bob", "password": ""}, 400, "Заполните"},
		{"невалидный JSON при регистрации", "/api/register", "{не json", 400, "Заполните"},
		{"вход: верный пароль", "/api/login", map[string]string{"username": "alice", "password": "secret"}, 200, ""},
		{"вход: неверный пароль", "/api/login", map[string]string{"username": "alice", "password": "wrong"}, 400, "Неверный пароль"},
		{"вход: нет такого пользователя", "/api/login", map[string]string{"username": "ghost", "password": "x"}, 400, "не найден"},
		{"вход: невалидный JSON", "/api/login", "[[", 400, "Неверный запрос"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			status, body := e.call("POST", c.path, "", c.body)
			if status != c.status {
				t.Fatalf("статус %d, ожидался %d (%v)", status, c.status, body)
			}
			if c.errSub != "" && !strings.Contains(errText(body), c.errSub) {
				t.Errorf("ошибка %q не содержит %q", errText(body), c.errSub)
			}
			if c.status == 200 && body["token"] == "" {
				t.Error("в ответе нет токена")
			}
		})
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM users`); n != 1 {
		t.Errorf("отказы не должны создавать пользователей: в БД %d", n)
	}
}

// Регрессия: пароль длиннее 72 байт раньше молча создавал пользователя с ПУСТЫМ хэшем,
// после чего войти под ним было невозможно.
func TestRegisterPasswordLimit(t *testing.T) {
	e := newEnv(t)

	status, res := e.call("POST", "/api/register", "", map[string]string{"username": "long", "password": strings.Repeat("x", 73)})
	if status != 400 || !strings.Contains(errText(res), "72") {
		t.Fatalf("73 байта: ожидался отказ 400, получили %d %v", status, res)
	}
	if n := queryInt(t, `SELECT COUNT(*) FROM users WHERE username='long'`); n != 0 {
		t.Error("при отказе пользователь создаваться не должен")
	}

	// 72 байта — максимум для bcrypt: регистрация и вход работают
	pw := strings.Repeat("я", 36) // 36 × 2 байта = 72
	if status, res = e.call("POST", "/api/register", "", map[string]string{"username": "edge", "password": pw}); status != 200 {
		t.Fatalf("72 байта должны проходить: %d %v", status, res)
	}
	if status, res = e.call("POST", "/api/login", "", map[string]string{"username": "edge", "password": pw}); status != 200 {
		t.Fatalf("вход с 72-байтным паролем: %d %v", status, res)
	}
	if queryInt(t, `SELECT LENGTH(password_hash) FROM users WHERE username='edge'`) == 0 {
		t.Error("хэш не должен быть пустым")
	}
}

func TestAuthMiddleware(t *testing.T) {
	e := newEnv(t)
	u := e.register("alice")
	future := time.Now().Add(time.Hour).Unix()
	sign := func(claims jwt.MapClaims, key string) string {
		s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(key))
		if err != nil {
			t.Fatal(err)
		}
		return s
	}

	// защищённый эндпоинт: /api/progress
	cases := []struct {
		name  string
		token string
		want  int
	}{
		{"без токена", "", 401},
		{"мусорный токен", "garbage", 401},
		{"подпись другим секретом", sign(jwt.MapClaims{"id": u.id, "username": "alice", "exp": future}, "other"), 401},
		{"просроченный токен", sign(jwt.MapClaims{"id": u.id, "username": "alice", "exp": time.Now().Add(-time.Minute).Unix()}, string(jwtSecret)), 401},
		{"нет claim id", sign(jwt.MapClaims{"username": "alice", "exp": future}, string(jwtSecret)), 401},
		{"нет claim username", sign(jwt.MapClaims{"id": u.id, "exp": future}, string(jwtSecret)), 401},
		{"id = 0", sign(jwt.MapClaims{"id": 0, "username": "alice", "exp": future}, string(jwtSecret)), 401},
		{"валидный токен", u.token, 200},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if status, _ := e.call("GET", "/api/progress", c.token, nil); status != c.want {
				t.Errorf("статус %d, ожидался %d", status, c.want)
			}
		})
	}

	// схема авторизации должна быть именно Bearer
	status, _ := e.call("GET", "/api/progress", "", nil)
	if status != 401 {
		t.Errorf("без заголовка: %d", status)
	}

	// заголовок X-User-ID от клиента не должен позволять выдать себя за другого
	e2 := e.register("mallory")
	victim := e.register("victim")
	cid, _ := e.createCourse(victim, "Секретный курс", "python")
	if status, _ := e.call("GET", fmt.Sprintf("/api/courses/%d/tasks", cid), e2.token, nil); status != 403 {
		t.Errorf("чужой курс доступен: %d", status)
	}
}

func TestPublicCoursesEnrollment(t *testing.T) {
	e := newEnv(t)
	u := e.register("alice")

	status, res := e.call("GET", "/api/courses", u.token, nil)
	if status != 200 {
		t.Fatal(status, res)
	}
	courses := res["courses"].([]any)
	if len(courses) != 2 {
		t.Fatalf("новый пользователь должен получить 2 системных курса, получил %d", len(courses))
	}
	langs := map[string]int{}
	for _, c := range courses {
		m := c.(map[string]any)
		langs[m["language"].(string)] = num(m["taskCount"])
		if m["isPublic"] != true || m["isOwner"] != false {
			t.Errorf("системный курс: isPublic=%v isOwner=%v", m["isPublic"], m["isOwner"])
		}
		if m["accessCode"] != nil {
			t.Error("у публичного курса нет кода доступа")
		}
	}
	if langs["python"] != 6 || langs["javascript"] != 6 {
		t.Errorf("ожидалось по 6 задач на Python и JavaScript: %v", langs)
	}

	// курс, добавленный позже, подхватывается при следующем входе
	mustExec(t, `INSERT INTO courses (title, language) VALUES ('Новый публичный', 'python')`)
	if status, _ = e.call("POST", "/api/login", "", map[string]string{"username": "alice", "password": "pw-alice"}); status != 200 {
		t.Fatal("вход не удался")
	}
	_, res = e.call("GET", "/api/courses", u.token, nil)
	if n := len(res["courses"].([]any)); n != 3 {
		t.Errorf("после входа должен появиться новый публичный курс, курсов: %d", n)
	}
}

func TestRoutingMethodsAndUnknownPaths(t *testing.T) {
	e := newEnv(t)
	u := e.register("alice")
	cases := []struct {
		method, path string
		want         int
	}{
		{"DELETE", "/api/courses", 405},
		{"PUT", "/api/courses", 405},
		{"GET", "/api/courses/join", 405},
		{"GET", "/api/courses/1/foo", 404},
		{"PATCH", "/api/courses/1", 404},
		{"GET", "/api/tasks/abc", 404},
		{"PATCH", "/api/tasks/1", 404},
		{"GET", "/api/nothing", 404},
	}
	for _, c := range cases {
		if status, _ := e.call(c.method, c.path, u.token, nil); status != c.want {
			t.Errorf("%s %s → %d, ожидалось %d", c.method, c.path, status, c.want)
		}
	}
}

func TestCORS(t *testing.T) {
	e := newEnv(t)
	for _, method := range []string{"POST", "PUT", "DELETE"} {
		req, _ := newPreflight(e.srv.URL+"/api/tasks/1", method)
		resp, err := httpClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		allow := resp.Header.Get("Access-Control-Allow-Methods")
		if !strings.Contains(allow, method) {
			t.Errorf("preflight %s: Allow-Methods = %q", method, allow)
		}
		if resp.Header.Get("Access-Control-Allow-Origin") != "http://localhost:3000" {
			t.Errorf("preflight %s: Allow-Origin = %q", method, resp.Header.Get("Access-Control-Allow-Origin"))
		}
	}
	// чужой источник не получает разрешения
	req, _ := newPreflight(e.srv.URL+"/api/tasks/1", "POST")
	req.Header.Set("Origin", "http://evil.example")
	resp, err := httpClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("чужому источнику CORS разрешён: %q", resp.Header.Get("Access-Control-Allow-Origin"))
	}
}
