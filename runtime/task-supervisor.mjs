export function createTaskSupervisor({ onError }) {
  const inFlight = new Set();
  let accepting = true;

  function run(label, task) {
    if (!accepting) return false;
    const promise = Promise.resolve()
      .then(task)
      .catch((error) => onError(error, label))
      .finally(() => inFlight.delete(promise));
    inFlight.add(promise);
    return true;
  }

  async function stop({ timeoutMs = 5_000 } = {}) {
    accepting = false;
    if (inFlight.size === 0) return true;
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref?.();
    });
    const drained = Promise.allSettled([...inFlight]).then(() => true);
    const result = await Promise.race([drained, timeout]);
    clearTimeout(timer);
    return result;
  }

  return Object.freeze({ run, stop, size: () => inFlight.size });
}
