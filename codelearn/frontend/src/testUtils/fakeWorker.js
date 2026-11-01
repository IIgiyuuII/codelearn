// Управляемый поддельный Web Worker для тестов движка: сам ничего не делает,
// тест вручную «отвечает» от его имени (say / fail) и смотрит, что ему отправили (sent).

export function makeFactory() {
  const workers = [];
  const factory = () => {
    const worker = {
      terminated: false,
      sent: [],
      onmessage: null,
      onerror: null,
      postMessage(message) { this.sent.push(message); },
      terminate() { this.terminated = true; },
      say(data) { if (this.onmessage) this.onmessage({ data }); },
      fail(message) { if (this.onerror) this.onerror({ message, preventDefault() {} }); },
      ready() { this.say({ type: 'ready' }); },
      lastRun() { return [...this.sent].reverse().find(m => m.type === 'run'); },
      answer(result) {
        const job = this.lastRun();
        this.say({ type: 'result', id: job.id, result: { status: 'ok', passed: true, output: '', error: '', durationMs: 1, ...result } });
      },
    };
    workers.push(worker);
    return worker;
  };
  return { factory, workers };
}

export const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));
