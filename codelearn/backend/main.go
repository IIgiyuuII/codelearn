package main

import (
	crand "crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	_ "github.com/lib/pq"
	"github.com/rs/cors"
	"golang.org/x/crypto/bcrypt"
)

// ─── Конфигурация (переменные окружения / файл .env) ────────────────────────

var (
	jwtSecret  []byte
	serverPort string
	corsOrigin string
)

// loadDotEnv читает .env из текущей или родительской папки.
// Уже заданные переменные окружения имеют приоритет над файлом.
func loadDotEnv() {
	for _, path := range []string{".env", "../.env"} {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		log.Printf("⚙️  Конфигурация загружена из %s", path)
		text := strings.TrimPrefix(string(data), "\ufeff") // BOM из Блокнота Windows
		for _, line := range strings.Split(text, "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			key, val, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			key = strings.TrimSpace(key)
			val = strings.Trim(strings.TrimSpace(val), `"'`)
			if _, exists := os.LookupEnv(key); !exists {
				os.Setenv(key, val)
			}
		}
		return
	}
}

func getenv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// dsnQuote экранирует значение для key=value DSN библиотеки lib/pq.
func dsnQuote(v string) string {
	v = strings.ReplaceAll(v, `\`, `\\`)
	v = strings.ReplaceAll(v, `'`, `\'`)
	return "'" + v + "'"
}

func loadConfig() (dsn string) {
	loadDotEnv()

	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		log.Fatal("❌ Не задан JWT_SECRET. Скопируйте .env.example в .env и заполните его (см. README)")
	}
	if len(secret) < 16 {
		log.Println("⚠️  JWT_SECRET короче 16 символов — для реального использования возьмите длиннее")
	}
	jwtSecret = []byte(secret)

	serverPort = getenv("PORT", "4000")
	corsOrigin = getenv("CORS_ORIGIN", "http://localhost:3000")

	password := os.Getenv("DB_PASSWORD")
	if password == "" {
		log.Fatal("❌ Не задан DB_PASSWORD (файл .env или переменная окружения)")
	}
	return fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		dsnQuote(getenv("DB_HOST", "localhost")),
		dsnQuote(getenv("DB_PORT", "5432")),
		dsnQuote(getenv("DB_USER", "postgres")),
		dsnQuote(password),
		dsnQuote(getenv("DB_NAME", "CodeLearn")),
		dsnQuote(getenv("DB_SSLMODE", "disable")),
	)
}

type Task struct {
	ID          int    `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	StarterCode string `json:"starterCode"`
	Difficulty  string `json:"difficulty"`
	Topic       string `json:"topic"`
	CourseID    int    `json:"courseId"`
}

type Example struct {
	ID          int    `json:"id"`
	Input       string `json:"input"`
	Output      string `json:"output"`
	Explanation string `json:"explanation"`
}

type Course struct {
	ID          int    `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Language    string `json:"language"`
	AccessCode  string `json:"accessCode,omitempty"`
	OwnerID     *int   `json:"ownerId,omitempty"`
	IsOwner     bool   `json:"isOwner"`
	IsPublic    bool   `json:"isPublic"`
	TaskCount   int    `json:"taskCount"`
	SolvedCount int    `json:"solvedCount"`
}

var db *sql.DB

func initDB(dsn string) {
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("❌ Ошибка подключения к БД: %v", err)
	}
	if err = db.Ping(); err != nil {
		log.Fatalf("❌ БД недоступна: %v", err)
	}
	log.Println("✅ Подключение к PostgreSQL успешно")
}

func generateToken(userID int, username string) (string, error) {
	claims := jwt.MapClaims{
		"id":       userID,
		"username": username,
		"exp":      time.Now().Add(7 * 24 * time.Hour).Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(jwtSecret)
}

func parseToken(tokenStr string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("неверный метод подписи")
		}
		return jwtSecret, nil
	})
	if err != nil || !token.Valid {
		return nil, fmt.Errorf("токен недействителен")
	}
	return token.Claims.(jwt.MapClaims), nil
}

func authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "Bearer ") {
			jsonError(w, "Нет токена", http.StatusUnauthorized)
			return
		}
		claims, err := parseToken(strings.TrimPrefix(authHeader, "Bearer "))
		if err != nil {
			jsonError(w, "Токен недействителен", http.StatusUnauthorized)
			return
		}
		idFloat, ok1 := claims["id"].(float64)
		username, ok2 := claims["username"].(string)
		if !ok1 || !ok2 || idFloat <= 0 {
			jsonError(w, "Токен недействителен", http.StatusUnauthorized)
			return
		}
		r.Header.Set("X-User-ID", strconv.Itoa(int(idFloat)))
		r.Header.Set("X-Username", username)
		next(w, r)
	}
}

func jsonOK(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func getUserID(r *http.Request) int {
	id, _ := strconv.Atoi(r.Header.Get("X-User-ID"))
	return id
}

func taskIDFromPath(path, suffix string) int {
	trimmed := strings.TrimPrefix(path, "/api/tasks/")
	trimmed = strings.TrimSuffix(trimmed, suffix)
	id, _ := strconv.Atoi(strings.Trim(trimmed, "/"))
	return id
}

func courseIDFromPath(path, suffix string) int {
	trimmed := strings.TrimPrefix(path, "/api/courses/")
	trimmed = strings.TrimSuffix(trimmed, suffix)
	id, _ := strconv.Atoi(strings.Trim(trimmed, "/"))
	return id
}

func generateAccessCode() string {
	// 32 символа: 256 делится на 32 без остатка, поэтому смещения распределения нет
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	buf := make([]byte, 8)
	if _, err := crand.Read(buf); err != nil {
		log.Fatalf("❌ crypto/rand недоступен: %v", err)
	}
	code := make([]byte, 8)
	for i, b := range buf {
		code[i] = chars[int(b)%len(chars)]
	}
	return string(code)
}

// ─── Проверка доступа к задаче ───────────────────────────────────────────────

// taskAccess: exists — задача существует, allowed — пользователь записан на её курс.
func taskAccess(uid, taskID int) (exists, allowed bool, err error) {
	err = db.QueryRow(`
		SELECT ce.user_id IS NOT NULL
		FROM tasks t
		LEFT JOIN course_enrollments ce ON ce.course_id = t.course_id AND ce.user_id = $1
		WHERE t.id = $2`, uid, taskID).Scan(&allowed)
	if err == sql.ErrNoRows {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	return true, allowed, nil
}

// requireTaskAccess пишет ответ с ошибкой и возвращает false, если задачи нет
// или пользователь не записан на её курс. Владелец курса записан автоматически.
func requireTaskAccess(w http.ResponseWriter, r *http.Request, taskID int) bool {
	exists, allowed, err := taskAccess(getUserID(r), taskID)
	switch {
	case err != nil:
		jsonError(w, "Ошибка БД", http.StatusInternalServerError)
	case !exists:
		jsonError(w, "Задача не найдена", http.StatusNotFound)
	case !allowed:
		jsonError(w, "Нет доступа к этой задаче", http.StatusForbidden)
	default:
		return true
	}
	return false
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

func handleRegister(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Username == "" || body.Password == "" {
		jsonError(w, "Заполните все поля", http.StatusBadRequest)
		return
	}
	var exists bool
	db.QueryRow(`SELECT EXISTS(SELECT 1 FROM users WHERE username=$1)`, body.Username).Scan(&exists)
	if exists {
		jsonError(w, "Пользователь уже существует", http.StatusBadRequest)
		return
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	var id int
	err := db.QueryRow(`INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id`,
		body.Username, string(hash)).Scan(&id)
	if err != nil {
		jsonError(w, "Ошибка создания пользователя", http.StatusInternalServerError)
		return
	}
	// Записываем на все публичные курсы
	db.Exec(`INSERT INTO course_enrollments (user_id, course_id)
		SELECT $1, id FROM courses WHERE access_code IS NULL ON CONFLICT DO NOTHING`, id)
	token, _ := generateToken(id, body.Username)
	jsonOK(w, map[string]any{"token": token, "username": body.Username})
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		jsonError(w, "Неверный запрос", http.StatusBadRequest)
		return
	}
	var id int
	var hash string
	err := db.QueryRow(`SELECT id, password_hash FROM users WHERE username=$1`, body.Username).Scan(&id, &hash)
	if err == sql.ErrNoRows {
		jsonError(w, "Пользователь не найден", http.StatusBadRequest)
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(body.Password)); err != nil {
		jsonError(w, "Неверный пароль", http.StatusBadRequest)
		return
	}
	db.Exec(`INSERT INTO course_enrollments (user_id, course_id)
		SELECT $1, id FROM courses WHERE access_code IS NULL ON CONFLICT DO NOTHING`, id)
	token, _ := generateToken(id, body.Username)
	jsonOK(w, map[string]any{"token": token, "username": body.Username})
}

// ─── Courses ──────────────────────────────────────────────────────────────────

// GET /api/courses
func handleGetCourses(w http.ResponseWriter, r *http.Request) {
	uid := getUserID(r)

	rows, err := db.Query(`
		SELECT c.id, c.title, COALESCE(c.description,''), c.language,
		       COALESCE(c.access_code,''), c.owner_id
		FROM courses c
		JOIN course_enrollments ce ON ce.course_id = c.id AND ce.user_id = $1
		ORDER BY c.id
	`, uid)
	if err != nil {
		jsonError(w, "Ошибка БД: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var courses []Course
	for rows.Next() {
		var c Course
		var ownerID sql.NullInt64
		rows.Scan(&c.ID, &c.Title, &c.Description, &c.Language, &c.AccessCode, &ownerID)
		if ownerID.Valid {
			id := int(ownerID.Int64)
			c.OwnerID = &id
			c.IsOwner = id == uid
		}
		c.IsPublic = c.AccessCode == ""
		if !c.IsOwner {
			c.AccessCode = ""
		}
		courses = append(courses, c)
	}
	if courses == nil {
		courses = []Course{}
	}

	// Считаем задачи и прогресс отдельно для каждого курса
	for i := range courses {
		db.QueryRow(`SELECT COUNT(*) FROM tasks WHERE course_id=$1`, courses[i].ID).
			Scan(&courses[i].TaskCount)
		db.QueryRow(`
			SELECT COUNT(*) FROM user_progress up
			JOIN tasks t ON t.id = up.task_id
			WHERE t.course_id=$1 AND up.user_id=$2
		`, courses[i].ID, uid).Scan(&courses[i].SolvedCount)
	}

	jsonOK(w, map[string]any{"courses": courses})
}

// POST /api/courses
func handleCreateCourse(w http.ResponseWriter, r *http.Request) {
	uid := getUserID(r)
	var body struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		Language    string `json:"language"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Title == "" {
		jsonError(w, "Укажите название курса", http.StatusBadRequest)
		return
	}
	if body.Language == "" {
		body.Language = "python"
	}
	var code string
	for {
		code = generateAccessCode()
		var exists bool
		db.QueryRow(`SELECT EXISTS(SELECT 1 FROM courses WHERE access_code=$1)`, code).Scan(&exists)
		if !exists {
			break
		}
	}
	var courseID int
	err := db.QueryRow(`
		INSERT INTO courses (title, description, language, access_code, owner_id)
		VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		body.Title, body.Description, body.Language, code, uid,
	).Scan(&courseID)
	if err != nil {
		jsonError(w, "Ошибка создания курса", http.StatusInternalServerError)
		return
	}
	db.Exec(`INSERT INTO course_enrollments (user_id, course_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, uid, courseID)
	jsonOK(w, map[string]any{"id": courseID, "accessCode": code, "message": "Курс создан"})
}

// POST /api/courses/join
func handleJoinCourse(w http.ResponseWriter, r *http.Request) {
	uid := getUserID(r)
	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Code == "" {
		jsonError(w, "Укажите код доступа", http.StatusBadRequest)
		return
	}
	var courseID int
	var title string
	err := db.QueryRow(`SELECT id, title FROM courses WHERE access_code=$1`,
		strings.ToUpper(strings.TrimSpace(body.Code))).Scan(&courseID, &title)
	if err == sql.ErrNoRows {
		jsonError(w, "Курс с таким кодом не найден", http.StatusNotFound)
		return
	}
	var enrolled bool
	db.QueryRow(`SELECT EXISTS(SELECT 1 FROM course_enrollments WHERE user_id=$1 AND course_id=$2)`,
		uid, courseID).Scan(&enrolled)
	if enrolled {
		jsonError(w, "Вы уже записаны на этот курс", http.StatusBadRequest)
		return
	}
	db.Exec(`INSERT INTO course_enrollments (user_id, course_id) VALUES ($1,$2)`, uid, courseID)
	jsonOK(w, map[string]any{"message": "Вы успешно записаны на курс «" + title + "»", "courseId": courseID})
}

// GET /api/courses/:id/tasks
func handleGetCourseTasks(w http.ResponseWriter, r *http.Request) {
	uid := getUserID(r)
	courseID := courseIDFromPath(r.URL.Path, "/tasks")

	var enrolled bool
	db.QueryRow(`SELECT EXISTS(SELECT 1 FROM course_enrollments WHERE user_id=$1 AND course_id=$2)`,
		uid, courseID).Scan(&enrolled)
	if !enrolled {
		jsonError(w, "Нет доступа к курсу", http.StatusForbidden)
		return
	}

	rows, err := db.Query(`
		SELECT id, title, description, starter_code, difficulty,
		       COALESCE(topic,''), COALESCE(course_id,0)
		FROM tasks WHERE course_id=$1 ORDER BY id`, courseID)
	if err != nil {
		jsonError(w, "Ошибка БД", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var tasks []Task
	for rows.Next() {
		var t Task
		rows.Scan(&t.ID, &t.Title, &t.Description, &t.StarterCode, &t.Difficulty, &t.Topic, &t.CourseID)
		tasks = append(tasks, t)
	}
	if tasks == nil {
		tasks = []Task{}
	}

	srows, err := db.Query(`
		SELECT up.task_id FROM user_progress up
		JOIN tasks t ON t.id = up.task_id
		WHERE up.user_id=$1 AND t.course_id=$2`, uid, courseID)
	if err != nil {
		jsonError(w, "Ошибка БД", http.StatusInternalServerError)
		return
	}
	defer srows.Close()
	var solved []int
	for srows.Next() {
		var tid int
		srows.Scan(&tid)
		solved = append(solved, tid)
	}
	if solved == nil {
		solved = []int{}
	}

	// Данные курса и признак владельца
	var ownerID sql.NullInt64
	var courseTitle, courseLang string
	db.QueryRow(`SELECT owner_id, title, COALESCE(language,'python') FROM courses WHERE id=$1`, courseID).
		Scan(&ownerID, &courseTitle, &courseLang)
	isOwner := ownerID.Valid && int(ownerID.Int64) == uid

	jsonOK(w, map[string]any{
		"tasks":       tasks,
		"solvedTasks": solved,
		"isOwner":     isOwner,
		"course":      map[string]any{"id": courseID, "title": courseTitle, "language": courseLang},
	})
}

// ─── Управление задачами курса (только владелец) ─────────────────────────────

type TaskExample struct {
	Input       string `json:"input"`
	Output      string `json:"output"`
	Explanation string `json:"explanation"`
}

// TaskInput — тело запросов на создание и изменение задачи.
type TaskInput struct {
	Title       string        `json:"title"`
	Description string        `json:"description"`
	StarterCode string        `json:"starterCode"`
	Difficulty  string        `json:"difficulty"`
	Topic       string        `json:"topic"`
	HiddenTests string        `json:"hiddenTests"`
	Examples    []TaskExample `json:"examples"`
}

const (
	maxTextLen  = 20000
	maxTestsLen = 50000
	maxExamples = 20
	maxExample  = 2000
)

// normalize приводит данные к каноническому виду и возвращает текст ошибки ("" если всё хорошо).
func (t *TaskInput) normalize() string {
	t.Title = strings.TrimSpace(t.Title)
	t.Topic = strings.TrimSpace(t.Topic)
	t.Description = strings.TrimSpace(t.Description)
	t.HiddenTests = strings.TrimSpace(t.HiddenTests)

	if t.Topic == "" {
		t.Topic = "Общее"
	}
	if t.Difficulty == "" {
		t.Difficulty = "easy"
	}
	if strings.TrimSpace(t.StarterCode) == "" {
		t.StarterCode = "# Ваш код здесь\n"
	}

	switch {
	case t.Title == "":
		return "Укажите название задачи"
	case utf8.RuneCountInString(t.Title) > 200:
		return "Название не длиннее 200 символов"
	case utf8.RuneCountInString(t.Topic) > 100:
		return "Тема не длиннее 100 символов"
	case t.Difficulty != "easy" && t.Difficulty != "medium" && t.Difficulty != "hard":
		return "Сложность: easy, medium или hard"
	case t.Description == "":
		return "Заполните условие задачи"
	case utf8.RuneCountInString(t.Description) > maxTextLen, utf8.RuneCountInString(t.StarterCode) > maxTextLen:
		return "Условие и стартовый код — не более 20 000 символов"
	case t.HiddenTests == "":
		return "Добавьте скрытые тесты — без них задачу нельзя проверить"
	case utf8.RuneCountInString(t.HiddenTests) > maxTestsLen:
		return "Скрытые тесты — не более 50 000 символов"
	}

	// Пустые примеры отбрасываем, остальные ограничиваем по размеру
	kept := make([]TaskExample, 0, len(t.Examples))
	for _, ex := range t.Examples {
		ex.Input = strings.TrimSpace(ex.Input)
		ex.Output = strings.TrimSpace(ex.Output)
		ex.Explanation = strings.TrimSpace(ex.Explanation)
		if ex.Input == "" && ex.Output == "" {
			continue
		}
		if ex.Input == "" || ex.Output == "" {
			return "В каждом примере должны быть и входные данные, и ожидаемый результат"
		}
		if utf8.RuneCountInString(ex.Input) > maxExample || utf8.RuneCountInString(ex.Output) > maxExample ||
			utf8.RuneCountInString(ex.Explanation) > maxExample {
			return "Поля примера — не более 2000 символов"
		}
		kept = append(kept, ex)
	}
	if len(kept) > maxExamples {
		return "Примеров не больше 20"
	}
	t.Examples = kept
	return ""
}

// readTaskInput читает и проверяет тело запроса; при ошибке сам отвечает клиенту.
func readTaskInput(w http.ResponseWriter, r *http.Request) (TaskInput, bool) {
	var in TaskInput
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		jsonError(w, "Неверный запрос", http.StatusBadRequest)
		return in, false
	}
	if msg := in.normalize(); msg != "" {
		jsonError(w, msg, http.StatusBadRequest)
		return in, false
	}
	return in, true
}

// saveTaskContent записывает скрытые тесты и видимые примеры задачи.
func saveTaskContent(tx *sql.Tx, taskID int, in TaskInput) error {
	if _, err := tx.Exec(`INSERT INTO task_hidden_tests (task_id, test_code) VALUES ($1,$2)`,
		taskID, in.HiddenTests); err != nil {
		return err
	}
	for _, ex := range in.Examples {
		if _, err := tx.Exec(`INSERT INTO task_examples (task_id, input, output, explanation) VALUES ($1,$2,$3,$4)`,
			taskID, ex.Input, ex.Output, ex.Explanation); err != nil {
			return err
		}
	}
	return nil
}

// requireTaskOwner: задача существует и принадлежит курсу, владельцем которого является пользователь.
func requireTaskOwner(w http.ResponseWriter, r *http.Request, taskID int) bool {
	var ownerID sql.NullInt64
	err := db.QueryRow(`
		SELECT c.owner_id FROM tasks t JOIN courses c ON c.id = t.course_id WHERE t.id=$1`, taskID).Scan(&ownerID)
	switch {
	case err == sql.ErrNoRows:
		jsonError(w, "Задача не найдена", http.StatusNotFound)
	case err != nil:
		jsonError(w, "Ошибка БД", http.StatusInternalServerError)
	case !ownerID.Valid || int(ownerID.Int64) != getUserID(r):
		jsonError(w, "Изменять задачи может только владелец курса", http.StatusForbidden)
	default:
		return true
	}
	return false
}

// POST /api/courses/:id/tasks
func handleAddCourseTask(w http.ResponseWriter, r *http.Request) {
	uid := getUserID(r)
	courseID := courseIDFromPath(r.URL.Path, "/tasks")

	var ownerID sql.NullInt64
	err := db.QueryRow(`SELECT owner_id FROM courses WHERE id=$1`, courseID).Scan(&ownerID)
	if err == sql.ErrNoRows {
		jsonError(w, "Курс не найден", http.StatusNotFound)
		return
	}
	if err != nil {
		jsonError(w, "Ошибка БД", http.StatusInternalServerError)
		return
	}
	if !ownerID.Valid || int(ownerID.Int64) != uid {
		jsonError(w, "Добавлять задачи может только владелец курса", http.StatusForbidden)
		return
	}

	in, ok := readTaskInput(w, r)
	if !ok {
		return
	}

	tx, err := db.Begin()
	if err != nil {
		jsonError(w, "Ошибка БД", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	var taskID int
	err = tx.QueryRow(`
		INSERT INTO tasks (title, description, starter_code, difficulty, topic, course_id)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		in.Title, in.Description, in.StarterCode, in.Difficulty, in.Topic, courseID,
	).Scan(&taskID)
	if err == nil {
		err = saveTaskContent(tx, taskID, in)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		log.Printf("создание задачи: %v", err)
		jsonError(w, "Не удалось сохранить задачу", http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]any{"taskId": taskID, "message": "Задача добавлена"})
}

// GET /api/tasks/:id/full — задача целиком, включая скрытые тесты (для редактирования)
func handleGetTaskFull(w http.ResponseWriter, r *http.Request) {
	id := taskIDFromPath(r.URL.Path, "/full")
	if !requireTaskOwner(w, r, id) {
		return
	}

	var t Task
	err := db.QueryRow(`
		SELECT id, title, description, starter_code, difficulty, COALESCE(topic,''), COALESCE(course_id,0)
		FROM tasks WHERE id=$1`, id,
	).Scan(&t.ID, &t.Title, &t.Description, &t.StarterCode, &t.Difficulty, &t.Topic, &t.CourseID)
	if err != nil {
		jsonError(w, "Ошибка БД", http.StatusInternalServerError)
		return
	}

	examples := []TaskExample{}
	if rows, err := db.Query(
		`SELECT input, output, COALESCE(explanation,'') FROM task_examples WHERE task_id=$1 ORDER BY id`, id); err == nil {
		defer rows.Close()
		for rows.Next() {
			var e TaskExample
			rows.Scan(&e.Input, &e.Output, &e.Explanation)
			examples = append(examples, e)
		}
	}

	var parts []string
	if rows, err := db.Query(`SELECT test_code FROM task_hidden_tests WHERE task_id=$1 ORDER BY id`, id); err == nil {
		defer rows.Close()
		for rows.Next() {
			var code string
			rows.Scan(&code)
			parts = append(parts, code)
		}
	}

	jsonOK(w, map[string]any{"task": t, "examples": examples, "hiddenTests": strings.Join(parts, "\n")})
}

// PUT /api/tasks/:id — полная замена содержимого задачи
func handleUpdateTask(w http.ResponseWriter, r *http.Request) {
	id := taskIDFromPath(r.URL.Path, "")
	if !requireTaskOwner(w, r, id) {
		return
	}
	in, ok := readTaskInput(w, r)
	if !ok {
		return
	}

	tx, err := db.Begin()
	if err != nil {
		jsonError(w, "Ошибка БД", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		UPDATE tasks SET title=$1, description=$2, starter_code=$3, difficulty=$4, topic=$5 WHERE id=$6`,
		in.Title, in.Description, in.StarterCode, in.Difficulty, in.Topic, id)
	if err == nil {
		_, err = tx.Exec(`DELETE FROM task_examples WHERE task_id=$1`, id)
	}
	if err == nil {
		_, err = tx.Exec(`DELETE FROM task_hidden_tests WHERE task_id=$1`, id)
	}
	if err == nil {
		err = saveTaskContent(tx, id, in)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		log.Printf("изменение задачи %d: %v", id, err)
		jsonError(w, "Не удалось сохранить изменения", http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]any{"message": "Задача обновлена"})
}

// DELETE /api/tasks/:id — вместе с примерами, тестами и отметками о решении (каскадом)
func handleDeleteTask(w http.ResponseWriter, r *http.Request) {
	id := taskIDFromPath(r.URL.Path, "")
	if !requireTaskOwner(w, r, id) {
		return
	}
	if _, err := db.Exec(`DELETE FROM tasks WHERE id=$1`, id); err != nil {
		log.Printf("удаление задачи %d: %v", id, err)
		jsonError(w, "Не удалось удалить задачу", http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]any{"message": "Задача удалена"})
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

func handleGetTask(w http.ResponseWriter, r *http.Request) {
	id := taskIDFromPath(r.URL.Path, "")
	if !requireTaskAccess(w, r, id) {
		return
	}
	var t Task
	err := db.QueryRow(`
		SELECT id, title, description, starter_code, difficulty,
		       COALESCE(topic,''), COALESCE(course_id,0)
		FROM tasks WHERE id=$1`, id,
	).Scan(&t.ID, &t.Title, &t.Description, &t.StarterCode, &t.Difficulty, &t.Topic, &t.CourseID)
	if err == sql.ErrNoRows {
		jsonError(w, "Задача не найдена", http.StatusNotFound)
		return
	}
	jsonOK(w, t)
}

func handleGetExamples(w http.ResponseWriter, r *http.Request) {
	id := taskIDFromPath(r.URL.Path, "/examples")
	if !requireTaskAccess(w, r, id) {
		return
	}
	rows, err := db.Query(
		`SELECT id, input, output, COALESCE(explanation,'') FROM task_examples WHERE task_id=$1 ORDER BY id`, id)
	if err != nil {
		jsonError(w, "Ошибка БД", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	var examples []Example
	for rows.Next() {
		var e Example
		rows.Scan(&e.ID, &e.Input, &e.Output, &e.Explanation)
		examples = append(examples, e)
	}
	if examples == nil {
		examples = []Example{}
	}
	jsonOK(w, map[string]any{"examples": examples})
}

func handleGetTests(w http.ResponseWriter, r *http.Request) {
	id := taskIDFromPath(r.URL.Path, "/get-tests")
	if !requireTaskAccess(w, r, id) {
		return
	}
	rows, err := db.Query(`SELECT test_code FROM task_hidden_tests WHERE task_id=$1 ORDER BY id`, id)
	if err != nil {
		jsonError(w, "Ошибка БД", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	var parts []string
	for rows.Next() {
		var code string
		rows.Scan(&code)
		parts = append(parts, code)
	}
	if len(parts) == 0 {
		jsonError(w, "Тесты не найдены", http.StatusNotFound)
		return
	}
	jsonOK(w, map[string]string{"tests": strings.Join(parts, "\n")})
}

func handleMarkSolved(w http.ResponseWriter, r *http.Request) {
	id := taskIDFromPath(r.URL.Path, "/solved")
	if !requireTaskAccess(w, r, id) {
		return
	}
	userID := getUserID(r)
	db.Exec(`INSERT INTO user_progress (user_id, task_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, userID, id)
	rows, _ := db.Query(`SELECT task_id FROM user_progress WHERE user_id=$1`, userID)
	defer rows.Close()
	var solved []int
	for rows.Next() {
		var tid int
		rows.Scan(&tid)
		solved = append(solved, tid)
	}
	jsonOK(w, map[string]any{"solvedTasks": solved})
}

func handleProgress(w http.ResponseWriter, r *http.Request) {
	uid := getUserID(r)
	var total int
	db.QueryRow(`SELECT COUNT(*) FROM tasks`).Scan(&total)
	rows, _ := db.Query(`SELECT task_id FROM user_progress WHERE user_id=$1`, uid)
	defer rows.Close()
	var solved []int
	for rows.Next() {
		var tid int
		rows.Scan(&tid)
		solved = append(solved, tid)
	}
	if solved == nil {
		solved = []int{}
	}
	jsonOK(w, map[string]any{"solved": len(solved), "total": total, "solvedTasks": solved})
}

// ─── Router ──────────────────────────────────────────────────────────────────

func router() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/register", handleRegister)
	mux.HandleFunc("/api/login", handleLogin)
	mux.HandleFunc("/api/progress", authMiddleware(handleProgress))

	mux.HandleFunc("/api/courses", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handleGetCourses(w, r)
		case http.MethodPost:
			handleCreateCourse(w, r)
		default:
			jsonError(w, "Метод не поддерживается", http.StatusMethodNotAllowed)
		}
	}))
	mux.HandleFunc("/api/courses/join", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			jsonError(w, "Метод не поддерживается", http.StatusMethodNotAllowed)
			return
		}
		handleJoinCourse(w, r)
	}))
	mux.HandleFunc("/api/courses/", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		switch {
		case strings.HasSuffix(path, "/tasks") && r.Method == http.MethodGet:
			handleGetCourseTasks(w, r)
		case strings.HasSuffix(path, "/tasks") && r.Method == http.MethodPost:
			handleAddCourseTask(w, r)
		default:
			jsonError(w, "Не найдено", http.StatusNotFound)
		}
	}))

	mux.HandleFunc("/api/tasks/", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		switch {
		case strings.HasSuffix(path, "/examples") && r.Method == http.MethodGet:
			handleGetExamples(w, r)
		case strings.HasSuffix(path, "/get-tests") && r.Method == http.MethodPost:
			handleGetTests(w, r)
		case strings.HasSuffix(path, "/solved") && r.Method == http.MethodPost:
			handleMarkSolved(w, r)
		case strings.HasSuffix(path, "/full") && r.Method == http.MethodGet:
			handleGetTaskFull(w, r)
		case r.Method == http.MethodPut:
			handleUpdateTask(w, r)
		case r.Method == http.MethodDelete:
			handleDeleteTask(w, r)
		case r.Method == http.MethodGet:
			handleGetTask(w, r)
		default:
			jsonError(w, "Не найдено", http.StatusNotFound)
		}
	}))

	return mux
}

func main() {
	dsn := loadConfig()
	initDB(dsn)
	var courseCount int
	db.QueryRow(`SELECT COUNT(*) FROM courses`).Scan(&courseCount)

	handler := cors.New(cors.Options{
		AllowedOrigins: []string{corsOrigin},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Authorization", "Content-Type"},
	}).Handler(router())

	addr := ":" + serverPort
	fmt.Printf("✅ Go-бэкенд запущен: http://localhost%s\n", addr)
	fmt.Printf("   Курсов в БД: %d\n", courseCount)
	log.Fatal(http.ListenAndServe(addr, handler))
}
