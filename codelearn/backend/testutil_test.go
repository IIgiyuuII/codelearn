package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Тестам с БД нужна отдельная база (по умолчанию codelearn_test): они очищают таблицы.
// Параметры подключения берутся из DB_HOST / DB_PORT / DB_USER / DB_PASSWORD (или файла .env),
// а имя базы — из TEST_DB_NAME. Имя обязано содержать «test», иначе тесты не запустятся.
// Недоступная база — это ОШИБКА (иначе тесты с БД молча пропускались бы, а go test писал бы «ok»).
// Запустить только тесты без БД можно явно: SKIP_DB_TESTS=1.

var dbReady bool

func TestMain(m *testing.M) {
	loadDotEnv()
	jwtSecret = []byte("test-secret-not-for-production")
	corsOrigin = "http://localhost:3000"

	name := getenv("TEST_DB_NAME", "codelearn_test")
	if !strings.Contains(strings.ToLower(name), "test") {
		fmt.Fprintf(os.Stderr, "ОТКАЗ: TEST_DB_NAME=%q не содержит «test». Тесты очищают таблицы и на рабочей базе не запускаются.\n", name)
		os.Exit(1)
	}
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		dsnQuote(getenv("TEST_DB_HOST", getenv("DB_HOST", "localhost"))),
		dsnQuote(getenv("TEST_DB_PORT", getenv("DB_PORT", "5432"))),
		dsnQuote(getenv("TEST_DB_USER", getenv("DB_USER", "postgres"))),
		dsnQuote(getenv("TEST_DB_PASSWORD", os.Getenv("DB_PASSWORD"))),
		dsnQuote(name),
	)

	conn, err := openDB(dsn)
	switch {
	case err != nil && os.Getenv("SKIP_DB_TESTS") != "":
		fmt.Fprintf(os.Stderr, "ПРОПУСК тестов с БД (задана SKIP_DB_TESTS): %v\n", err)
	case err != nil:
		fmt.Fprintf(os.Stderr, "ОШИБКА: тестовая БД %q недоступна: %v\n"+
			"  1) создайте пустую базу %q (pgAdmin → Create → Database);\n"+
			"  2) задайте пароль: DB_PASSWORD в файле .env или переменной окружения;\n"+
			"  3) чтобы запустить только тесты без БД: SKIP_DB_TESTS=1 (PowerShell: $env:SKIP_DB_TESTS=1).\n"+
			"  Подробности — README, раздел «Тесты».\n", name, err, name)
		os.Exit(1)
	default:
		db = conn
		dbReady = true
		if err := execSQLFile("schema.sql"); err != nil {
			fmt.Fprintf(os.Stderr, "не удалось применить schema.sql: %v\n", err)
			os.Exit(1)
		}
	}
	os.Exit(m.Run())
}

func requireDB(t *testing.T) {
	t.Helper()
	if !dbReady {
		t.Skip("тестовая БД недоступна")
	}
}

// execSQLFile выполняет скрипт из каталога db/ (целиком, как это делает psql -f).
func execSQLFile(name string) error {
	data, err := os.ReadFile(filepath.Join("..", "db", name))
	if err != nil {
		return err
	}
	_, err = db.Exec(string(data))
	return err
}

// resetDB возвращает базу в состояние «только системные курсы».
func resetDB(t *testing.T) {
	t.Helper()
	requireDB(t)
	if _, err := db.Exec(`TRUNCATE users, courses RESTART IDENTITY CASCADE`); err != nil {
		t.Fatalf("очистка БД: %v", err)
	}
	for _, f := range []string{"seed.sql", "seed_js.sql"} {
		if err := execSQLFile(f); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
	}
}

// ─── Клиент API ──────────────────────────────────────────────────────────────

type env struct {
	t   *testing.T
	srv *httptest.Server
}

type user struct {
	id    int
	name  string
	token string
}

func newEnv(t *testing.T) *env {
	t.Helper()
	resetDB(t)
	srv := httptest.NewServer(buildHandler())
	t.Cleanup(srv.Close)
	return &env{t: t, srv: srv}
}

// call выполняет запрос. body: nil, string (сырое тело) или любое значение (кодируется в JSON).
func (e *env) call(method, path, token string, body any) (int, map[string]any) {
	e.t.Helper()
	var rdr io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		rdr = strings.NewReader(b)
	default:
		data, err := json.Marshal(b)
		if err != nil {
			e.t.Fatal(err)
		}
		rdr = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, e.srv.URL+path, rdr)
	if err != nil {
		e.t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if rdr != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out) // не-объектное тело оставляем пустой картой
	return resp.StatusCode, out
}

func (e *env) register(name string) user {
	e.t.Helper()
	code, res := e.call("POST", "/api/register", "", map[string]string{"username": name, "password": "pw-" + name})
	if code != 200 {
		e.t.Fatalf("регистрация %s: %d %v", name, code, res)
	}
	return user{id: queryInt(e.t, `SELECT id FROM users WHERE username=$1`, name), name: name, token: res["token"].(string)}
}

func (e *env) createCourse(owner user, title, language string) (id int, code string) {
	e.t.Helper()
	status, res := e.call("POST", "/api/courses", owner.token, map[string]string{"title": title, "language": language})
	if status != 200 {
		e.t.Fatalf("создание курса: %d %v", status, res)
	}
	return int(res["id"].(float64)), res["accessCode"].(string)
}

func (e *env) addTask(owner user, courseID int, title, tests string) int {
	e.t.Helper()
	status, res := e.call("POST", fmt.Sprintf("/api/courses/%d/tasks", courseID), owner.token, map[string]any{
		"title": title, "description": "описание", "hiddenTests": tests,
		"examples": []map[string]string{{"input": "f(1)", "output": "1"}},
	})
	if status != 200 {
		e.t.Fatalf("создание задачи: %d %v", status, res)
	}
	return int(res["taskId"].(float64))
}

func (e *env) join(u user, code string) {
	e.t.Helper()
	if status, res := e.call("POST", "/api/courses/join", u.token, map[string]string{"code": code}); status != 200 {
		e.t.Fatalf("вступление %s в курс: %d %v", u.name, status, res)
	}
}

func (e *env) solve(u user, taskID int) {
	e.t.Helper()
	if status, res := e.call("POST", fmt.Sprintf("/api/tasks/%d/solved", taskID), u.token, nil); status != 200 {
		e.t.Fatalf("отметка решения: %d %v", status, res)
	}
}

// ─── Прямые запросы к БД и разбор ответов ────────────────────────────────────

func queryInt(t *testing.T, q string, args ...any) int {
	t.Helper()
	var n int
	if err := db.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return n
}

func queryStr(t *testing.T, q string, args ...any) string {
	t.Helper()
	var s string
	if err := db.QueryRow(q, args...).Scan(&s); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
	return s
}

func mustExec(t *testing.T, q string, args ...any) {
	t.Helper()
	if _, err := db.Exec(q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

// getPath достаёт значение по пути вида "course.language" или "tasks.0.title".
func getPath(v any, path string) any {
	for _, part := range strings.Split(path, ".") {
		switch cur := v.(type) {
		case map[string]any:
			v = cur[part]
		case []any:
			var i int
			fmt.Sscanf(part, "%d", &i)
			if i < 0 || i >= len(cur) {
				return nil
			}
			v = cur[i]
		default:
			return nil
		}
	}
	return v
}

func num(v any) int {
	f, _ := v.(float64)
	return int(f)
}

func errText(res map[string]any) string {
	s, _ := res["error"].(string)
	return s
}

var httpClient = http.DefaultClient

// newPreflight строит CORS-preflight запрос от разрешённого источника.
func newPreflight(url, method string) (*http.Request, error) {
	req, err := http.NewRequest(http.MethodOptions, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Origin", "http://localhost:3000")
	req.Header.Set("Access-Control-Request-Method", method)
	req.Header.Set("Access-Control-Request-Headers", "authorization,content-type")
	return req, nil
}

// pqIntArray — значение для SQL-параметра типа int[] (ANY($1)).
func pqIntArray(ids []int) string {
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = fmt.Sprint(id)
	}
	return "{" + strings.Join(parts, ",") + "}"
}
