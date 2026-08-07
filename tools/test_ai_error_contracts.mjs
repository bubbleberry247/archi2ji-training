import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = { console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../src/api.gs', import.meta.url), 'utf8'), context);

function classify(message, httpStatus, openaiCode) {
  const error = new Error(message);
  error.httpStatus = httpStatus;
  error.openaiCode = openaiCode;
  return context.classifyArchiGradingError_(error);
}

const quota = classify('You exceeded your current quota', 429, 'insufficient_quota');
assert.equal(quota.errorCode, 'AI_QUOTA');
assert.equal(quota.fatal, true);
assert.equal(quota.stopBatch, true);

const rate = classify('Too many requests', 429, 'rate_limit_exceeded');
assert.equal(rate.errorCode, 'AI_RATE_LIMIT');
assert.equal(rate.retryable, true);
assert.equal(rate.stopBatch, true);

const auth = classify('Incorrect API key', 401, 'invalid_api_key');
assert.equal(auth.errorCode, 'AI_AUTH');
assert.equal(auth.fatal, true);

const temporary = classify('server error', 503, 'server_error');
assert.equal(temporary.errorCode, 'AI_TEMPORARY');
assert.equal(temporary.stopBatch, true);

const client = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
assert.match(client, /if \(res && res\.stopBatch\)/);
assert.match(client, /doneFn\(\);/);

console.log('archi AI error contracts: 12 assertions passed');
