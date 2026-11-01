// Фабрики Web Worker. Вынесены отдельно, потому что `new Worker(new URL(..., import.meta.url))`
// понимает только webpack: в тестах (Jest) этот файл подменяют, а сам код движка проверяют отдельно.
// Литерал `new URL('./x.worker.js', import.meta.url)` должен остаться прямо внутри `new Worker(...)`.

export const createPythonWorker = () => new Worker(new URL('./pyodide.worker.js', import.meta.url));
export const createJavaScriptWorker = () => new Worker(new URL('./js.worker.js', import.meta.url));
