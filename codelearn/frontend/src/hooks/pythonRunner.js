// Раннер решений для Pyodide.
//
// Вердикт «тесты пройдены» определяется СТРУКТУРНО: код студента и скрытые тесты
// выполняются по очереди в свежем словаре globals, и успех — это «оба exec завершились
// без исключения». Текст в stdout/stderr на вердикт не влияет. Это устраняет три
// дефекта прежней проверки по подстроке «✓ Все тесты пройдены!»:
//   1. имена из предыдущего запуска оставались в globals и «спасали» пустое решение;
//   2. любой текст в stderr (например, warnings.warn) превращал верное решение в провал;
//   3. тест без финальной print-строки было невозможно пройти.
// Строка print("✓ Все тесты пройдены!") в тестах теперь не нужна (старые тесты работают).
//
// Ограничение: проверка по-прежнему выполняется на клиенте, поэтому человек, готовый
// писать запросы к API вручную (или подсунуть объект с __eq__, всегда равный True),
// может обмануть систему. Полноценная защита — серверная перепроверка.

const PYTHON_RUNNER = String.raw`
import sys, io, json, traceback

_MAX_OUT = 20000


def _clip(text):
    if len(text) > _MAX_OUT:
        return text[:_MAX_OUT] + "\n... (вывод обрезан)"
    return text


def _last_filename(tb):
    last = None
    while tb is not None:
        last = tb
        tb = tb.tb_next
    return last.tb_frame.f_code.co_filename if last is not None else None


def _format_exc(exc):
    # tb_next пропускает служебный кадр самого раннера
    tb = exc.__traceback__.tb_next if exc.__traceback__ is not None else None
    return "".join(traceback.format_exception(type(exc), exc, tb))


def run_solution(student_code, tests_code):
    out = io.StringIO()
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = out
    ns = {"__name__": "__main__"}  # свежее пространство имён на каждый запуск
    status, error = "ok", ""
    try:
        try:
            exec(compile(student_code, "<solution>", "exec"), ns)
        except BaseException as exc:  # включая SystemExit и SyntaxError
            status, error = "runtime_error", _format_exc(exc)

        if status == "ok" and tests_code.strip():
            try:
                exec(compile(tests_code, "<tests>", "exec"), ns)
            except AssertionError as exc:
                if _last_filename(exc.__traceback__) == "<tests>":
                    msg = str(exc)
                    status = "test_failed"
                    error = "Тест не пройден" + (": " + msg if msg else "")
                else:  # assert внутри кода студента — показываем трассировку
                    status, error = "runtime_error", _format_exc(exc)
            except BaseException as exc:
                status, error = "runtime_error", _format_exc(exc)
    finally:
        sys.stdout, sys.stderr = old_out, old_err

    return json.dumps({"status": status, "output": _clip(out.getvalue()), "error": error})
`;

/**
 * Готовит раннер в изолированном словаре globals (не в глобальном пространстве Pyodide,
 * чтобы код студента не видел и не подменял служебные функции).
 * Возвращает функцию run(studentCode, hiddenTests) -> Promise<результат>.
 */
export function createRunner(pyodide) {
  const runnerGlobals = pyodide.toPy({});
  pyodide.runPython(PYTHON_RUNNER, { globals: runnerGlobals });
  const runSolution = runnerGlobals.get('run_solution');

  /**
   * @returns {{
   *   status: 'ok' | 'test_failed' | 'runtime_error',
   *   passed: boolean,      // true только если были тесты и все прошли
   *   output: string,       // stdout + stderr студента
   *   error: string,        // трассировка или сообщение о непройденном тесте
   *   durationMs: number
   * }}
   */
  return function run(studentCode, hiddenTests = '') {
    const t0 = performance.now();
    let res;
    try {
      res = JSON.parse(runSolution(studentCode, hiddenTests));
    } catch (e) {
      res = { status: 'runtime_error', output: '', error: e.message || String(e) };
    }
    return {
      status: res.status,
      passed: res.status === 'ok' && hiddenTests.trim() !== '',
      output: res.output,
      error: res.error,
      durationMs: Math.round(performance.now() - t0),
    };
  };
}
