package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	_ "github.com/lib/pq"
	"github.com/rs/cors"
	"golang.org/x/crypto/bcrypt"
)

const (
	PORT       = 4000
	JWT_SECRET = "codelearn_secret_2024"
	DB_DSN     = "host=localhost port=5432 user=postgres password=12345 dbname=CodeLearn sslmode=disable"
)

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

func initDB() {
	var err error
	db, err = sql.Open("postgres", DB_DSN)
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
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(JWT_SECRET))
}

func parseToken(tokenStr string) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("неверный метод подписи")
		}
		return []byte(JWT_SECRET), nil
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
		idFloat, _ := claims["id"].(float64)
		r.Header.Set("X-User-ID", strconv.Itoa(int(idFloat)))
		r.Header.Set("X-Username", claims["username"].(string))
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
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	code := make([]byte, 8)
	for i := range code {
		code[i] = chars[r.Intn(len(chars))]
	}
	return string(code)
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
	var body struct{ Code string `json:"code"` }
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

	srows, _ := db.Query(`
		SELECT up.task_id FROM user_progress up
		JOIN tasks t ON t.id = up.task_id
		WHERE up.user_id=$1 AND t.course_id=$2`, uid, courseID)
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

	// Проверяем владелец ли
	var ownerID sql.NullInt64
	db.QueryRow(`SELECT owner_id FROM courses WHERE id=$1`, courseID).Scan(&ownerID)
	isOwner := ownerID.Valid && int(ownerID.Int64) == uid

	jsonOK(w, map[string]any{"tasks": tasks, "solvedTasks": solved, "isOwner": isOwner})
}

// POST /api/courses/:id/tasks
func handleAddCourseTask(w http.ResponseWriter, r *http.Request) {
	uid := getUserID(r)
	courseID := courseIDFromPath(r.URL.Path, "/tasks")

	var ownerID sql.NullInt64
	db.QueryRow(`SELECT owner_id FROM courses WHERE id=$1`, courseID).Scan(&ownerID)
	if !ownerID.Valid || int(ownerID.Int64) != uid {
		jsonError(w, "Только владелец может добавлять задачи", http.StatusForbidden)
		return
	}

	var body struct {
		Title       string `json:"title"`
		Description string `json:"description"`
		StarterCode string `json:"starterCode"`
		Difficulty  string `json:"difficulty"`
		Topic       string `json:"topic"`
		HiddenTests string `json:"hiddenTests"`
		Examples    []struct {
			Input       string `json:"input"`
			Output      string `json:"output"`
			Explanation string `json:"explanation"`
		} `json:"examples"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Title == "" {
		jsonError(w, "Укажите название задачи", http.StatusBadRequest)
		return
	}
	if body.Difficulty == "" {
		body.Difficulty = "easy"
	}
	if body.StarterCode == "" {
		body.StarterCode = "# Ваш код здесь\n"
	}

	var taskID int
	err := db.QueryRow(`
		INSERT INTO tasks (title, description, starter_code, difficulty, topic, course_id)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		body.Title, body.Description, body.StarterCode,
		body.Difficulty, body.Topic, courseID,
	).Scan(&taskID)
	if err != nil {
		jsonError(w, "Ошибка создания задачи: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if body.HiddenTests != "" {
		db.Exec(`INSERT INTO task_hidden_tests (task_id, test_code) VALUES ($1,$2)`, taskID, body.HiddenTests)
	}
	for _, ex := range body.Examples {
		if ex.Input != "" && ex.Output != "" {
			db.Exec(`INSERT INTO task_examples (task_id, input, output, explanation) VALUES ($1,$2,$3,$4)`,
				taskID, ex.Input, ex.Output, ex.Explanation)
		}
	}
	jsonOK(w, map[string]any{"taskId": taskID, "message": "Задача добавлена"})
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

func handleGetTask(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/api/tasks/"))
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
		}
	}))
	mux.HandleFunc("/api/courses/join", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			handleJoinCourse(w, r)
		}
	}))
	mux.HandleFunc("/api/courses/", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		switch {
		case strings.HasSuffix(path, "/tasks") && r.Method == http.MethodGet:
			handleGetCourseTasks(w, r)
		case strings.HasSuffix(path, "/tasks") && r.Method == http.MethodPost:
			handleAddCourseTask(w, r)
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
		case r.Method == http.MethodGet:
			handleGetTask(w, r)
		default:
			jsonError(w, "Не найдено", http.StatusNotFound)
		}
	}))

	return mux
}

func main() {
	initDB()
	var courseCount int
	db.QueryRow(`SELECT COUNT(*) FROM courses`).Scan(&courseCount)

	handler := cors.New(cors.Options{
		AllowedOrigins: []string{"http://localhost:3000"},
		AllowedMethods: []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders: []string{"Authorization", "Content-Type"},
	}).Handler(router())

	addr := fmt.Sprintf(":%d", PORT)
	fmt.Printf("✅ Go-бэкенд запущен: http://localhost%s\n", addr)
	fmt.Printf("   Курсов в БД: %d\n", courseCount)
	log.Fatal(http.ListenAndServe(addr, handler))
}