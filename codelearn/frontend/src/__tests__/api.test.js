import { api } from '../api';

let calls;
const respond = (status = 200, body = {}) => ({ status, json: async () => body });

beforeEach(() => {
  calls = [];
  localStorage.clear();
  localStorage.setItem('token', 'tok123');
  localStorage.setItem('username', 'alice');
  global.fetch = jest.fn(async (url, options) => {
    calls.push({ url, ...options });
    return respond(200, { ok: true });
  });
});

describe('формирование запросов', () => {
  const table = [
    ['getCourses', [], 'GET', '/api/courses', undefined],
    ['createCourse', ['К', 'О', 'python'], 'POST', '/api/courses', { title: 'К', description: 'О', language: 'python' }],
    ['joinCourse', ['ABCD'], 'POST', '/api/courses/join', { code: 'ABCD' }],
    ['getCourseTasks', [5], 'GET', '/api/courses/5/tasks', undefined],
    ['addCourseTask', [5, { title: 'Т' }], 'POST', '/api/courses/5/tasks', { title: 'Т' }],
    ['getCourseStats', [5], 'GET', '/api/courses/5/stats', undefined],
    ['updateCourse', [5, { title: 'Н' }], 'PUT', '/api/courses/5', { title: 'Н' }],
    ['deleteCourse', [5, 'Название'], 'DELETE', '/api/courses/5', { confirmTitle: 'Название' }],
    ['regenerateAccessCode', [5], 'POST', '/api/courses/5/access-code', undefined],
    ['getTask', [7], 'GET', '/api/tasks/7', undefined],
    ['getTaskFull', [7], 'GET', '/api/tasks/7/full', undefined],
    ['updateTask', [7, { title: 'Н' }], 'PUT', '/api/tasks/7', { title: 'Н' }],
    ['deleteTask', [7], 'DELETE', '/api/tasks/7', undefined],
    ['getExamples', [7], 'GET', '/api/tasks/7/examples', undefined],
    ['getTests', [7], 'POST', '/api/tasks/7/get-tests', undefined],
    ['markSolved', [7], 'POST', '/api/tasks/7/solved', undefined],
    ['getProgress', [], 'GET', '/api/progress', undefined],
  ];

  test.each(table)('%s → %s %s', async (name, args, method, url, body) => {
    await api[name](...args);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(url);
    expect(calls[0].method).toBe(method);
    expect(calls[0].headers.Authorization).toBe('Bearer tok123');
    expect(calls[0].headers['Content-Type']).toBe('application/json');
    expect(calls[0].body).toBe(body === undefined ? undefined : JSON.stringify(body));
  });

  test('вход и регистрация идут без токена', async () => {
    await api.login('a', 'b');
    await api.register('c', 'd');
    expect(calls[0]).toMatchObject({ url: '/api/login', method: 'POST', body: JSON.stringify({ username: 'a', password: 'b' }) });
    expect(calls[1]).toMatchObject({ url: '/api/register', method: 'POST', body: JSON.stringify({ username: 'c', password: 'd' }) });
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[1].headers.Authorization).toBeUndefined();
  });

  test('возвращает разобранный JSON ответа', async () => {
    global.fetch = jest.fn(async () => respond(200, { courses: [1, 2] }));
    expect(await api.getCourses()).toEqual({ courses: [1, 2] });
  });

  test('ошибки сервера (400, 403, 404) приходят как обычные данные с полем error', async () => {
    for (const status of [400, 403, 404, 500]) {
      global.fetch = jest.fn(async () => respond(status, { error: `код ${status}` }));
      expect(await api.getTask(1)).toEqual({ error: `код ${status}` });
    }
    expect(localStorage.getItem('token')).toBe('tok123'); // не 401 — сессию не трогаем
  });
});

describe('устойчивость', () => {
  test('обрыв сети → { error }, исключение не вылетает', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await api.getCourses()).toEqual({ error: 'Нет связи с сервером' });
    expect(await api.login('a', 'b')).toEqual({ error: 'Нет связи с сервером' });
  });

  test('ответ не в JSON (например, 502 от прокси) → { error } со статусом', async () => {
    global.fetch = jest.fn(async () => ({ status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); } }));
    expect(await api.getCourses()).toEqual({ error: 'Ошибка сервера (502)' });
  });
});

describe('истёкшая сессия (401)', () => {
  test('защищённый запрос: токен и имя удаляются, отправляется auth:expired, промис не завершается', async () => {
    global.fetch = jest.fn(async () => respond(401, { error: 'Токен недействителен' }));
    const onExpired = jest.fn();
    window.addEventListener('auth:expired', onExpired);

    let settled = false;
    api.getCourses().then(() => { settled = true; });
    await new Promise(r => setTimeout(r, 30));

    window.removeEventListener('auth:expired', onExpired);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('username')).toBeNull();
    expect(settled).toBe(false); // страница размонтируется и не упадёт на пустых данных
  });

  test('401 при входе — это просто «неверные данные», разлогинивать нечего', async () => {
    global.fetch = jest.fn(async () => respond(401, { error: 'Неверный пароль' }));
    const onExpired = jest.fn();
    window.addEventListener('auth:expired', onExpired);
    expect(await api.login('a', 'b')).toEqual({ error: 'Неверный пароль' });
    window.removeEventListener('auth:expired', onExpired);
    expect(onExpired).not.toHaveBeenCalled();
    expect(localStorage.getItem('token')).toBe('tok123');
  });
});
