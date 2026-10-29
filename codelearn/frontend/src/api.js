const BASE = '/api';

function getToken() { return localStorage.getItem('token'); }
function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}

// Токен протух или недействителен: чистим сессию и сообщаем App.jsx,
// который вернёт пользователя на страницу входа.
function handleUnauthorized() {
  localStorage.removeItem('token');
  localStorage.removeItem('username');
  window.dispatchEvent(new Event('auth:expired'));
}

/**
 * Единая точка для всех запросов.
 * - всегда возвращает объект (при сбое сети или не-JSON ответе — { error });
 * - на 401 для защищённых запросов разлогинивает пользователя. Промис при этом
 *   намеренно НЕ завершается: страница всё равно будет размонтирована, и её
 *   .then() не успеет упасть на данных, которых нет.
 */
async function request(path, { method = 'GET', body, auth = true } = {}) {
  let r;
  try {
    r = await fetch(`${BASE}${path}`, {
      method,
      headers: auth ? authHeaders() : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { error: 'Нет связи с сервером' };
  }

  if (auth && r.status === 401) {
    handleUnauthorized();
    return new Promise(() => {});
  }

  try {
    return await r.json();
  } catch {
    return { error: `Ошибка сервера (${r.status})` };
  }
}

export const api = {
  register: (username, password) =>
    request('/register', { method: 'POST', body: { username, password }, auth: false }),
  login: (username, password) =>
    request('/login', { method: 'POST', body: { username, password }, auth: false }),

  // ─── Courses ───
  getCourses: () => request('/courses'),
  createCourse: (title, description, language) =>
    request('/courses', { method: 'POST', body: { title, description, language } }),
  joinCourse: (code) => request('/courses/join', { method: 'POST', body: { code } }),
  getCourseTasks: (courseId) => request(`/courses/${courseId}/tasks`),
  // Управление курсом (только владелец)
  getCourseStats: (id) => request(`/courses/${id}/stats`),
  updateCourse: (id, data) => request(`/courses/${id}`, { method: 'PUT', body: data }),
  // Сервер сам сверяет введённое название с настоящим — защита не зависит от интерфейса
  deleteCourse: (id, confirmTitle) => request(`/courses/${id}`, { method: 'DELETE', body: { confirmTitle } }),
  regenerateAccessCode: (id) => request(`/courses/${id}/access-code`, { method: 'POST' }),
  addCourseTask: (courseId, task) =>
    request(`/courses/${courseId}/tasks`, { method: 'POST', body: task }),

  // ─── Tasks ───
  getTask: (id) => request(`/tasks/${id}`),
  // Только для владельца курса: задача целиком, включая скрытые тесты
  getTaskFull: (id) => request(`/tasks/${id}/full`),
  updateTask: (id, task) => request(`/tasks/${id}`, { method: 'PUT', body: task }),
  deleteTask: (id) => request(`/tasks/${id}`, { method: 'DELETE' }),
  getExamples: (taskId) => request(`/tasks/${taskId}/examples`),
  getTests: (taskId) => request(`/tasks/${taskId}/get-tests`, { method: 'POST' }),
  markSolved: (taskId) => request(`/tasks/${taskId}/solved`, { method: 'POST' }),
  getProgress: () => request('/progress'),
};
