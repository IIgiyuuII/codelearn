import { Worker } from 'node:worker_threads';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Фабрика воркеров для WorkerEngine на worker_threads: даёт движку тот же интерфейс,
 * что и браузерный Worker (postMessage / terminate / onmessage / onerror).
 */
export function nodeWorkerFactory(adapterFile, { resourceLimits, counter } = {}) {
  const url = new URL(`./adapters/${adapterFile}`, import.meta.url);
  return () => {
    if (counter) counter.spawned += 1;
    const worker = new Worker(url, resourceLimits ? { resourceLimits } : undefined);
    const adapter = {
      onmessage: null,
      onerror: null,
      postMessage: message => worker.postMessage(message),
      terminate: () => worker.terminate(),
    };
    worker.on('message', data => adapter.onmessage && adapter.onmessage({ data }));
    worker.on('error', error => adapter.onerror && adapter.onerror({ message: error.message, preventDefault() {} }));
    return adapter;
  };
}
