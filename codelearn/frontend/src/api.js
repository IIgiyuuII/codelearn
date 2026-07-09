const BASE = '/api';

function getToken() { return localStorage.getItem('token'); }
function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}

export const api = {
  async register(username, password) {
    const r = await fetch(`${BASE}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    return r.json();
  },
  async login(username, password) {
    const r = await fetch(`${BASE}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    return r.json();
  },

  // ─── Courses ───
  async getCourses() {
    const r = await fetch(`${BASE}/courses`, { headers: authHeaders() });
    return r.json();
  },
  async createCourse(title, description, language) {
    const r = await fetch(`${BASE}/courses`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ title, description, language }) });
    return r.json();
  },
  async joinCourse(code) {
    const r = await fetch(`${BASE}/courses/join`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ code }) });
    return r.json();
  },
  async getCourseTasks(courseId) {
    const r = await fetch(`${BASE}/courses/${courseId}/tasks`, { headers: authHeaders() });
    return r.json();
  },
  async addCourseTask(courseId, task) {
    const r = await fetch(`${BASE}/courses/${courseId}/tasks`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(task) });
    return r.json();
  },

  // ─── Tasks ───
  async getTask(id) {
    const r = await fetch(`${BASE}/tasks/${id}`, { headers: authHeaders() });
    return r.json();
  },
  async getExamples(taskId) {
    const r = await fetch(`${BASE}/tasks/${taskId}/examples`, { headers: authHeaders() });
    return r.json();
  },
  async getTests(taskId) {
    const r = await fetch(`${BASE}/tasks/${taskId}/get-tests`, { method: 'POST', headers: authHeaders() });
    return r.json();
  },
  async markSolved(taskId) {
    const r = await fetch(`${BASE}/tasks/${taskId}/solved`, { method: 'POST', headers: authHeaders() });
    return r.json();
  },
  async getProgress() {
    const r = await fetch(`${BASE}/progress`, { headers: authHeaders() });
    return r.json();
  },
};
