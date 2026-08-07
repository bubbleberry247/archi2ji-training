import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const api = fs.readFileSync(new URL('../src/api.gs', import.meta.url), 'utf8');
const code = fs.readFileSync(new URL('../src/Code.gs', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');

for (const name of ['apiImportQuestions', 'apiImportRubrics', 'apiUpdateModelAnswers', 'apiImportQuestionImages']) {
  const wrapper = api.match(new RegExp(`function ${name}\\([^]*?\\n}`));
  assert.ok(wrapper, `${name} wrapper is present`);
  assert.match(wrapper[0], /requireAdmin_\(clientUserKey\)/, `${name} requires an admin key`);
  assert.match(wrapper[0], new RegExp(`return ${name}Core_\\(`), `${name} delegates to its private core`);
  assert.match(api, new RegExp(`function ${name}Core_\\(`), `${name} private core is present`);
  assert.doesNotMatch(code, new RegExp(`${name}\\(`), `doPost does not bypass the public wrapper with a blank key`);
  assert.match(code, new RegExp(`${name}Core_\\(`), `token-authenticated doPost calls ${name}Core_`);
}

const server = { console };
vm.createContext(server);
vm.runInContext(api, server);
server.requireAdmin_ = () => { throw new Error('管理者権限が必要です'); };
assert.equal(server.apiImportQuestions('[]', '')._error, true);
assert.equal(server.apiImportRubrics([], '')._error, true);
assert.equal(server.apiUpdateModelAnswers([], '')._error, true);
assert.equal(server.apiImportQuestionImages([], '')._error, true);
assert.equal(server.isArchiPracticeOnlyStatus_(null), true);
assert.equal(server.isArchiPracticeOnlyStatus_({ excludeFromTotal: true, scoreMode: 'ai', reviewStatus: 'approved' }), true);
assert.equal(server.isArchiPracticeOnlyStatus_({ excludeFromTotal: false, scoreMode: 'missing', reviewStatus: 'approved' }), true);
assert.equal(server.isArchiPracticeOnlyStatus_({ excludeFromTotal: false, scoreMode: 'practice_only', reviewStatus: 'approved' }), true);
assert.equal(server.isArchiPracticeOnlyStatus_({ excludeFromTotal: false, scoreMode: 'ai', reviewStatus: 'needs_answer_key' }), true);
assert.equal(server.isArchiPracticeOnlyStatus_({ excludeFromTotal: false, scoreMode: 'ai', reviewStatus: 'approved' }), false);

assert.match(client, /本サイトの問題は、各年度の出題当時の法令・基準・試験形式に基づいています。現在の法令・基準とは異なる場合があります。/);
assert.equal((client.match(/renderContentNotice_\(\)/g) || []).length, 4, 'helper plus home, result, and question calls');

console.log('archi content/admin contracts: 35 assertions passed');
