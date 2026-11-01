package main

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ─── Конфигурация ────────────────────────────────────────────────────────────

func TestDsnQuote(t *testing.T) {
	cases := map[string]string{
		"simple":     `'simple'`,
		"with space": `'with space'`,
		"it's":       `'it\'s'`,
		`back\slash`: `'back\\slash'`,
		"":           `''`,
		`a'b\c d`:    `'a\'b\\c d'`,
	}
	for in, want := range cases {
		if got := dsnQuote(in); got != want {
			t.Errorf("dsnQuote(%q) = %s, ожидалось %s", in, got, want)
		}
	}
}

func TestGetenv(t *testing.T) {
	t.Setenv("CL_TEST_SET", "  value  ")
	t.Setenv("CL_TEST_BLANK", "   ")
	if got := getenv("CL_TEST_SET", "x"); got != "value" {
		t.Errorf("пробелы по краям должны обрезаться, получили %q", got)
	}
	if got := getenv("CL_TEST_BLANK", "fallback"); got != "fallback" {
		t.Errorf("пустое значение → значение по умолчанию, получили %q", got)
	}
	if got := getenv("CL_TEST_MISSING", "fallback"); got != "fallback" {
		t.Errorf("отсутствующая переменная → значение по умолчанию, получили %q", got)
	}
}

// chdirTemp переходит во временную папку на время теста.
func chdirTemp(t *testing.T) string {
	t.Helper()
	old, _ := os.Getwd()
	dir := t.TempDir()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Chdir(old) })
	return dir
}

// loadDotEnv выставляет переменные через os.Setenv — после теста их нужно убрать.
func cleanupEnv(t *testing.T, keys ...string) {
	t.Helper()
	for _, k := range keys {
		k := k
		old, had := os.LookupEnv(k)
		t.Cleanup(func() {
			if had {
				os.Setenv(k, old)
			} else {
				os.Unsetenv(k)
			}
		})
		os.Unsetenv(k)
	}
}

func TestLoadDotEnv(t *testing.T) {
	cleanupEnv(t, "CLT_PLAIN", "CLT_QUOTED", "CLT_SINGLE", "CLT_EQUALS", "CLT_SPACED", "CLT_PRESET", "CLT_COMMENTED")
	t.Setenv("CLT_PRESET", "from-environment")
	dir := chdirTemp(t)

	// BOM (Блокнот Windows), CRLF, комментарии, кавычки, «=» внутри значения, пустые строки
	content := "\xef\xbb\xbf# комментарий\r\n" +
		"CLT_PLAIN=abc\r\n" +
		"\r\n" +
		"CLT_QUOTED=\"в кавычках\"\r\n" +
		"CLT_SINGLE='single'\r\n" +
		"CLT_EQUALS=a=b=c\r\n" +
		"  CLT_SPACED  =  padded  \r\n" +
		"CLT_PRESET=from-file\r\n" +
		"строка без равно\r\n" +
		"# CLT_COMMENTED=no\r\n"
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	loadDotEnv()

	want := map[string]string{
		"CLT_PLAIN":  "abc",
		"CLT_QUOTED": "в кавычках",
		"CLT_SINGLE": "single",
		"CLT_EQUALS": "a=b=c",
		"CLT_SPACED": "padded",
		"CLT_PRESET": "from-environment", // переменная окружения важнее файла
	}
	for k, v := range want {
		if got := os.Getenv(k); got != v {
			t.Errorf("%s = %q, ожидалось %q", k, got, v)
		}
	}
	if _, ok := os.LookupEnv("CLT_COMMENTED"); ok {
		t.Error("закомментированная строка не должна применяться")
	}
}

func TestLoadDotEnvParentFolder(t *testing.T) {
	cleanupEnv(t, "CLT_FROM_PARENT")
	parent := chdirTemp(t)
	child := filepath.Join(parent, "backend")
	if err := os.Mkdir(child, 0o755); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(parent, ".env"), []byte("CLT_FROM_PARENT=yes\n"), 0o600)
	if err := os.Chdir(child); err != nil {
		t.Fatal(err)
	}
	loadDotEnv()
	if got := os.Getenv("CLT_FROM_PARENT"); got != "yes" {
		t.Errorf(".env из родительской папки не прочитан: %q", got)
	}
}

func TestLoadDotEnvMissingFileIsFine(t *testing.T) {
	chdirTemp(t)
	loadDotEnv() // не должно паниковать
}

// ─── Коды доступа ────────────────────────────────────────────────────────────

func TestGenerateAccessCode(t *testing.T) {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	seen := map[string]bool{}
	for i := 0; i < 2000; i++ {
		code := generateAccessCode()
		if len(code) != 8 {
			t.Fatalf("длина кода %d, ожидалось 8: %q", len(code), code)
		}
		for _, c := range code {
			if !strings.ContainsRune(alphabet, c) {
				t.Fatalf("недопустимый символ %q в коде %q", c, code)
			}
		}
		seen[code] = true
	}
	if len(seen) < 1995 {
		t.Errorf("слишком много совпадений: %d уникальных из 2000", len(seen))
	}
	if strings.ContainsAny(strings.Join(keys(seen), ""), "0O1I") {
		t.Error("в алфавите не должно быть похожих символов 0/O/1/I")
	}
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// ─── Разбор путей ────────────────────────────────────────────────────────────

func TestIDFromPath(t *testing.T) {
	tasks := []struct {
		path, suffix string
		want         int
	}{
		{"/api/tasks/5", "", 5},
		{"/api/tasks/5/", "", 5},
		{"/api/tasks/12/examples", "/examples", 12},
		{"/api/tasks/7/get-tests", "/get-tests", 7},
		{"/api/tasks/abc", "", 0},
		{"/api/tasks/5/examples", "", 0}, // суффикс не снят — это не число
		{"/api/tasks/", "", 0},
		{"/api/tasks/-3", "", -3},
	}
	for _, c := range tasks {
		if got := taskIDFromPath(c.path, c.suffix); got != c.want {
			t.Errorf("taskIDFromPath(%q,%q) = %d, ожидалось %d", c.path, c.suffix, got, c.want)
		}
	}
	courses := []struct {
		path, suffix string
		want         int
	}{
		{"/api/courses/3", "", 3},
		{"/api/courses/3/tasks", "/tasks", 3},
		{"/api/courses/9/access-code", "/access-code", 9},
		{"/api/courses/x/stats", "/stats", 0},
	}
	for _, c := range courses {
		if got := courseIDFromPath(c.path, c.suffix); got != c.want {
			t.Errorf("courseIDFromPath(%q,%q) = %d, ожидалось %d", c.path, c.suffix, got, c.want)
		}
	}
}

// ─── Проверка данных задачи и курса ──────────────────────────────────────────

func validTask() TaskInput {
	return TaskInput{Title: "T", Description: "D", HiddenTests: "assert 1", Examples: []TaskExample{{Input: "f(1)", Output: "1"}}}
}

func TestTaskInputNormalize(t *testing.T) {
	cyr := func(n int) string { return strings.Repeat("я", n) } // 1 символ = 2 байта: проверяем счёт именно символов

	type tc struct {
		name   string
		mutate func(*TaskInput)
		err    string // подстрока ожидаемой ошибки; "" — ошибки нет
	}
	cases := []tc{
		{"корректная задача", func(*TaskInput) {}, ""},
		{"пустое название", func(i *TaskInput) { i.Title = "  " }, "название"},
		{"название ровно 200 символов (кириллица)", func(i *TaskInput) { i.Title = cyr(200) }, ""},
		{"название 201 символ", func(i *TaskInput) { i.Title = cyr(201) }, "200 символов"},
		{"тема 101 символ", func(i *TaskInput) { i.Topic = cyr(101) }, "Тема"},
		{"неизвестная сложность", func(i *TaskInput) { i.Difficulty = "extreme" }, "Сложность"},
		{"пустое условие", func(i *TaskInput) { i.Description = "" }, "условие"},
		{"слишком длинное условие", func(i *TaskInput) { i.Description = cyr(maxTextLen + 1) }, "20 000"},
		{"слишком длинный стартовый код", func(i *TaskInput) { i.StarterCode = cyr(maxTextLen + 1) }, "20 000"},
		{"нет скрытых тестов", func(i *TaskInput) { i.HiddenTests = "  \n " }, "тесты"},
		{"слишком длинные тесты", func(i *TaskInput) { i.HiddenTests = cyr(maxTestsLen + 1) }, "50 000"},
		{"пример без результата", func(i *TaskInput) { i.Examples = []TaskExample{{Input: "1", Output: ""}} }, "пример"},
		{"пример без входа", func(i *TaskInput) { i.Examples = []TaskExample{{Input: "", Output: "1"}} }, "пример"},
		{"слишком длинное поле примера", func(i *TaskInput) { i.Examples = []TaskExample{{Input: cyr(maxExample + 1), Output: "1"}} }, "2000"},
		{"21 пример", func(i *TaskInput) {
			i.Examples = make([]TaskExample, 21)
			for k := range i.Examples {
				i.Examples[k] = TaskExample{Input: "a", Output: "b"}
			}
		}, "20"},
		{"20 примеров допустимо", func(i *TaskInput) {
			i.Examples = make([]TaskExample, 20)
			for k := range i.Examples {
				i.Examples[k] = TaskExample{Input: "a", Output: "b"}
			}
		}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			in := validTask()
			c.mutate(&in)
			got := in.normalize()
			switch {
			case c.err == "" && got != "":
				t.Errorf("неожиданная ошибка: %q", got)
			case c.err != "" && !strings.Contains(strings.ToLower(got), strings.ToLower(c.err)):
				t.Errorf("ошибка %q не содержит %q", got, c.err)
			}
		})
	}

	t.Run("значения по умолчанию и обрезка пробелов", func(t *testing.T) {
		in := TaskInput{Title: "  Заголовок  ", Description: "  Текст  ", HiddenTests: "  assert 1  ",
			Examples: []TaskExample{{Input: " a ", Output: " b ", Explanation: " c "}, {Input: " ", Output: ""}}}
		if msg := in.normalize(); msg != "" {
			t.Fatal(msg)
		}
		if in.Title != "Заголовок" || in.Description != "Текст" || in.HiddenTests != "assert 1" {
			t.Errorf("пробелы не обрезаны: %+v", in)
		}
		if in.Topic != "Общее" || in.Difficulty != "easy" || strings.TrimSpace(in.StarterCode) == "" {
			t.Errorf("значения по умолчанию не подставлены: topic=%q diff=%q starter=%q", in.Topic, in.Difficulty, in.StarterCode)
		}
		if len(in.Examples) != 1 || in.Examples[0] != (TaskExample{Input: "a", Output: "b", Explanation: "c"}) {
			t.Errorf("пустой пример должен отбрасываться, остальные — обрезаться: %+v", in.Examples)
		}
	})
}

func TestCourseInputNormalize(t *testing.T) {
	cases := []struct {
		name      string
		in        CourseInput
		checkLang bool
		err       string
		lang      string
	}{
		{"корректный", CourseInput{Title: "Курс", Language: "javascript"}, true, "", "javascript"},
		{"язык по умолчанию", CourseInput{Title: "Курс"}, true, "", "python"},
		{"Ruby допустим при создании", CourseInput{Title: "Курс", Language: "ruby"}, true, "", "ruby"},
		{"неизвестный язык", CourseInput{Title: "Курс", Language: "cobol"}, true, "Язык", ""},
		{"язык при изменении не проверяется", CourseInput{Title: "Курс", Language: "cobol"}, false, "", "cobol"},
		{"пустое название", CourseInput{Title: "  "}, true, "название", ""},
		{"название 201 символ", CourseInput{Title: strings.Repeat("я", 201)}, true, "200", ""},
		{"описание слишком длинное", CourseInput{Title: "К", Description: strings.Repeat("я", maxCourseDesc+1)}, true, "Описание", ""},
		{"описание ровно по лимиту", CourseInput{Title: "К", Description: strings.Repeat("я", maxCourseDesc)}, true, "", "python"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := c.in.normalize(c.checkLang)
			if c.err == "" && got != "" {
				t.Fatalf("неожиданная ошибка: %q", got)
			}
			if c.err != "" && !strings.Contains(strings.ToLower(got), strings.ToLower(c.err)) {
				t.Fatalf("ошибка %q не содержит %q", got, c.err)
			}
			if c.err == "" && c.in.Language != c.lang {
				t.Errorf("язык %q, ожидался %q", c.in.Language, c.lang)
			}
		})
	}
}

// ─── JWT ─────────────────────────────────────────────────────────────────────

func TestTokenRoundTrip(t *testing.T) {
	tok, err := generateToken(42, "alice")
	if err != nil {
		t.Fatal(err)
	}
	claims, err := parseToken(tok)
	if err != nil {
		t.Fatalf("валидный токен отклонён: %v", err)
	}
	if int(claims["id"].(float64)) != 42 || claims["username"] != "alice" {
		t.Errorf("claims испорчены: %v", claims)
	}
	exp := time.Unix(int64(claims["exp"].(float64)), 0)
	if d := time.Until(exp); d < 6*24*time.Hour || d > 7*24*time.Hour+time.Minute {
		t.Errorf("срок жизни токена должен быть ~7 суток, осталось %v", d)
	}
}

func TestParseTokenRejects(t *testing.T) {
	sign := func(method jwt.SigningMethod, claims jwt.MapClaims, key any) string {
		s, err := jwt.NewWithClaims(method, claims).SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		return s
	}
	future := time.Now().Add(time.Hour).Unix()
	cases := map[string]string{
		"чужой секрет":  sign(jwt.SigningMethodHS256, jwt.MapClaims{"id": 1, "username": "a", "exp": future}, []byte("other-secret")),
		"истёк срок":    sign(jwt.SigningMethodHS256, jwt.MapClaims{"id": 1, "username": "a", "exp": time.Now().Add(-time.Hour).Unix()}, jwtSecret),
		"алгоритм none": sign(jwt.SigningMethodNone, jwt.MapClaims{"id": 1, "username": "a", "exp": future}, jwt.UnsafeAllowNoneSignatureType),
		"мусор":         "not-a-jwt",
		"пустая строка": "",
		"обрезанный":    sign(jwt.SigningMethodHS256, jwt.MapClaims{"id": 1, "exp": future}, jwtSecret)[:20],
	}
	for name, tok := range cases {
		if _, err := parseToken(tok); err == nil {
			t.Errorf("%s: токен должен быть отклонён", name)
		}
	}
}

// ─── Ответы ──────────────────────────────────────────────────────────────────

func TestJSONHelpers(t *testing.T) {
	rec := httptest.NewRecorder()
	jsonError(rec, "ой", 418)
	if rec.Code != 418 || !strings.Contains(rec.Body.String(), `"error":"ой"`) {
		t.Errorf("jsonError: %d %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q", ct)
	}
	rec = httptest.NewRecorder()
	jsonOK(rec, map[string]int{"a": 1})
	if rec.Code != 200 || strings.TrimSpace(rec.Body.String()) != `{"a":1}` {
		t.Errorf("jsonOK: %d %s", rec.Code, rec.Body.String())
	}
}
