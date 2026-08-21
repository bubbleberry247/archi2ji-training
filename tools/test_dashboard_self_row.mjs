import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const apiSource = fs.readFileSync(new URL('../src/api.gs', import.meta.url), 'utf8');
const logicSource = fs.readFileSync(new URL('../src/logic.gs', import.meta.url), 'utf8');
const clientSource = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
const dashboardWrapper = apiSource.match(/function apiAdminDashboard\([^]*?\n}/);
assert.ok(dashboardWrapper, 'dashboard API wrapper is present');
assert.match(dashboardWrapper[0], /requireDashboardViewer_\(clientUserKey\)/, 'dashboard uses the viewer authorization gate');
assert.doesNotMatch(dashboardWrapper[0], /requireManager_\(clientUserKey\)/, 'ordinary users are not rejected at the dashboard gate');

const server = { console };
vm.createContext(server);
vm.runInContext(apiSource, server);

server.SHEETS = { Questions: 'Questions', Users: 'Users', Notes: 'Notes', UserAccess: 'UserAccess' };
server.getArchiMiniCompletionLegacyCutoffMs_ = () => 0;
server.getArchiRubricStatusMap_ = () => ({});
server.isArchiPracticeOnlyStatus_ = () => false;
server.getArchiAdminTypeLabel_ = () => 'type';
server.buildArchiAdminMiniMeta_ = () => ({ columns: [], questionIdsByKey: {} });
server.getArchiMiniCompletionTrackingByUser_ = () => ({});
server.getUserAccessSheet_ = () => 'UserAccess';
server.normalizeUserAccessBoolean_ = (value, defaultValue) => {
  if (value === undefined || value === null || value === '') return defaultValue ? 'true' : 'false';
  return String(value).trim().toLowerCase() === 'false' ? 'false' : 'true';
};
server.buildArchiMiniCompletionCounts_ = () => ({ byTest: {}, totalCompletions: 0 });
server.buildAdminTypeStats_ = () => [];
server.formatAdminDate_ = () => '';
server.isAdminWithinLast7Days_ = () => false;
server.getCurrentAuthInfo_ = key => ({ userKey: key, role: 'manager' });
server.toSerializable_ = value => value;

const questions = [
  { qId: 'Q1', year: 'R7', questionType: 'choice', stem: '問題1' },
  { qId: 'Q2', year: 'R6', questionType: 'choice', stem: '問題2' }
];
const users = [
  { email: 'self@example.invalid', userKey: 'self-key', displayName: '自分' },
  { email: 'allowed@example.invalid', userKey: 'allowed-key', displayName: '許可' },
  { email: 'denied@example.invalid', userKey: 'denied-key', displayName: '拒否' }
];
let accessRows = [
  { email: 'self@example.invalid', role: 'manager', managerEmail: 'other@example.invalid', active: 'true', showInDashboard: 'false', displayName: '自分' },
  { email: 'allowed@example.invalid', role: 'user', managerEmail: 'self@example.invalid', active: 'true', showInDashboard: 'true', displayName: '許可' },
  { email: 'denied@example.invalid', role: 'user', managerEmail: 'other@example.invalid', active: 'true', showInDashboard: 'true', displayName: '拒否' }
];
server.readRecords_ = sheet => {
  if (sheet === 'Questions') return questions;
  if (sheet === 'Users') return users;
  if (sheet === 'Notes') return [];
  return [];
};
server.readRecordsFromSheet_ = sheet => sheet === 'UserAccess' ? accessRows : [];
let currentContext = { userKey: 'self-key', email: 'self@example.invalid', displayName: '自分', role: 'manager', active: true };
server.requireDashboardViewer_ = key => {
  if (key !== currentContext.userKey) throw new Error('ログインが必要です');
  return currentContext;
};

const scoped = server.apiAdminDashboard('self-key');
assert.equal(scoped._error, undefined, 'authorized manager receives dashboard data');
assert.equal(scoped.users.filter(user => user.isSelf === true).length, 1, 'self appears exactly once');
assert.equal(scoped.users.find(user => user.isSelf === true).email, 'self@example.invalid', 'self row is the authenticated identity');
assert.equal(scoped.users.find(user => user.isSelf === true).showInDashboard, true, 'self bypasses a hidden dashboard flag');
assert.equal(scoped.users.some(user => user.email === 'allowed@example.invalid'), true, 'manager-scoped member remains visible');
assert.equal(scoped.users.some(user => user.email === 'denied@example.invalid'), false, 'another manager\'s member remains hidden');

accessRows = [];
const syntheticSelf = server.apiAdminDashboard('self-key');
assert.equal(syntheticSelf.users.filter(user => user.isSelf === true).length, 1, 'self is synthesized when access roster has no row');
assert.equal(syntheticSelf.users[0].userKey, 'self-key', 'synthetic self row retains authenticated user key');

const unauthorized = server.apiAdminDashboard('unknown-key');
assert.equal(unauthorized._error, true, 'unknown key cannot read dashboard data');

accessRows = [
  { email: 'self@example.invalid', role: 'user', managerEmail: 'other@example.invalid', active: 'true', showInDashboard: 'false', displayName: '自分' },
  { email: 'allowed@example.invalid', role: 'user', managerEmail: 'self@example.invalid', active: 'true', showInDashboard: 'true', displayName: '許可' }
];
currentContext = { userKey: 'self-key', email: 'self@example.invalid', displayName: '自分', role: 'user', active: true };
const ordinaryUser = server.apiAdminDashboard('self-key');
assert.equal(ordinaryUser.users.length, 1, 'ordinary user receives one dashboard row');
assert.equal(ordinaryUser.users[0].isSelf, true, 'ordinary user receives only the authenticated row');
assert.equal(ordinaryUser.users[0].email, 'self@example.invalid', 'ordinary user cannot select another email');

const logic = { console };
vm.createContext(logic);
vm.runInContext(logicSource, logic);
logic.getUserContextByKey_ = key => ({ userKey: key, active: true, role: 'user' });
assert.equal(logic.requireDashboardViewer_('ordinary-key').role, 'user', 'ordinary active user passes the dashboard viewer gate');
logic.getUserContextByKey_ = key => ({ userKey: key, active: false, role: 'user' });
assert.throws(() => logic.requireDashboardViewer_('inactive-key'), /ログインが必要です/, 'inactive user is denied');
logic.getUserContextByKey_ = key => ({ userKey: key, active: true, role: 'guest' });
assert.throws(() => logic.requireDashboardViewer_('guest-key'), /ログインが必要です/, 'guest is denied');

const client = {};
vm.createContext(client);
const displayName = clientSource.match(/function getAdminDisplayName_\([^]*?\n}/);
const memberLabel = clientSource.match(/function getAdminMemberLabel_\([^]*?\n}/);
const visibility = clientSource.match(/function shouldShowDashboardMember_\([^]*?\n}/);
assert.ok(displayName && memberLabel && visibility, 'dashboard identity helpers are present');
vm.runInContext(`${displayName[0]}\n${memberLabel[0]}\n${visibility[0]}`, client);
assert.match(client.getAdminMemberLabel_({ displayName: '自分', isSelf: true }), /自分（自分）/);
assert.equal(client.shouldShowDashboardMember_({ displayName: '自分', isSelf: true, showInDashboard: false }), true);
assert.equal(client.shouldShowDashboardMember_({ displayName: '他', isSelf: false, showInDashboard: false }), false);

assert.equal((clientSource.match(/id="dashboard-status-help"/g) || []).length, 1, 'status explanation panel appears once');
for (const text of ['優秀：進捗率80%以上', '急成長：直近7日以内に活動あり', '要サポート：進捗率1%以上30%未満', '停滞中：進捗率0%']) {
  assert.match(clientSource, new RegExp(text));
}
assert.match(clientSource, /判定は独立しているため、1人が複数の項目に含まれる場合があります。/);

console.log('archi dashboard self-row/help contracts: 28 assertions passed');
