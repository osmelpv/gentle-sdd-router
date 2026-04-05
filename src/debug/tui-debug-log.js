import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOG_DIR = resolve(process.cwd(), 'tmp');
const LOG_FILE = resolve(LOG_DIR, 'gsr-tui-debug.log');

function ensureLogDir() {
  mkdirSync(LOG_DIR, { recursive: true });
}

function normalize(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalize(item, seen));
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = normalize(item, seen);
    }
    seen.delete(value);
    return out;
  }
  return String(value);
}

export function resetTuiDebugLog(context = {}) {
  ensureLogDir();
  writeFileSync(LOG_FILE, '', 'utf8');
  appendTuiDebug('session_start', context);
}

export function appendTuiDebug(event, payload = {}) {
  ensureLogDir();
  const entry = {
    ts: new Date().toISOString(),
    pid: process.pid,
    event,
    payload: normalize(payload),
  };
  appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
}

export function getTuiDebugLogPath() {
  ensureLogDir();
  return LOG_FILE;
}
