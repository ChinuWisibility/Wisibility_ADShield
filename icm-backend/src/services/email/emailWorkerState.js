let workerRunning = false;
let lastPollAt = null;

export function setEmailWorkerRunning(running) {
  workerRunning = Boolean(running);
}

export function isEmailWorkerRunning() {
  return workerRunning;
}

export function markEmailWorkerPoll() {
  lastPollAt = new Date();
}

export function getEmailWorkerLastPollAt() {
  return lastPollAt;
}
