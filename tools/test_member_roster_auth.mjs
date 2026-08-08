import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/memberRoster.gs', import.meta.url), 'utf8');
const server = {};
vm.createContext(server);
vm.runInContext(source, server);

let syncCalls = 0;
server.syncDashboardRosterForCurrentApp_ = () => {
  syncCalls += 1;
  return { status: 'ok' };
};
server.requireAdmin_ = (clientUserKey) => {
  if (clientUserKey !== 'admin-key') throw new Error('管理者権限が必要です');
};

assert.throws(() => server.syncDashboardRoster(''), /管理者権限が必要です/);
assert.equal(syncCalls, 0, 'blank key cannot reach the write operation');

assert.throws(() => server.syncDashboardRoster('unknown-key'), /管理者権限が必要です/);
assert.equal(syncCalls, 0, 'unregistered key cannot reach the write operation');

assert.deepEqual(server.syncDashboardRoster('admin-key'), { status: 'ok' });
assert.equal(syncCalls, 1, 'authorized admin delegates to the private sync operation');

assert.match(source, /function syncDashboardRoster\(clientUserKey\)/);
assert.match(source, /requireAdmin_\(clientUserKey\);[\s\S]*?return syncDashboardRosterForCurrentApp_\(\);/);

console.log('archi member roster auth: 8 assertions passed');
