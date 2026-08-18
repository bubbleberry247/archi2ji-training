import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../src/maintenance.gs', import.meta.url), 'utf8');
const codeSource = fs.readFileSync(new URL('../src/Code.gs', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../src/api.gs', import.meta.url), 'utf8');
const clientSource = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
const docsSource = fs.readFileSync(new URL('../docs/r4_q5_q6_layout_import_plan.md', import.meta.url), 'utf8');
const newCanonical = JSON.parse(fs.readFileSync(new URL('../data/kenchiku2ji_mondai_all.json', import.meta.url), 'utf8'));
const newById = Object.fromEntries(newCanonical.map(item => [item.qId, item]));
const hash = value => crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');

const oldQ5Rows = [
  ['30載荷係数2.0', '30沈下量2.0', '20載荷係数3.0', '20沈下量3.0', '30沈下量3.0'],
  ['平状水締め水平', '爪状水締め鉛直', '平状転圧水平', '爪状転圧水平', '平状転圧鉛直'],
  ['10ハンマーグラブ沈殿バケット', '5ハンマーグラブ沈殿バケット', '5ドリリングバケット底ざらいバケット', '10ドリリングバケット沈殿バケット', '5ハンマーグラブ底ざらいバケット'],
  ['2酸化炎3', '2酸化炎2', '2中性炎2', '5中性炎2', '5酸化炎3'],
  ['大きく大きい大きい', '小さく小さい大きい', '大きく小さい大きい', '小さく大きい小さい', '大きく大きい小さい'],
  ['破断内側近接させる', '圧縮外側近接させる', '破断外側近接させる', '破断内側離す', '圧縮外側離す'],
  ['30 90直後', '35 120直前', '35 90直後', '30 90直前', '30 120直後'],
  ['150 2 5', '150 3 15', '100 2 15', '100 2 5', '100 3 5']
];
const oldQ6Rows = {
  '①': '①注文者発注者依頼者事業者受注者',
  '②': '②20 30405060',
  '③': '③ 3 4 5 6 7',
  '④': '④ 3 4 5 6 7',
  '⑤': '⑤破損損壊危険労働災害事故',
  '⑥': '⑥教育技術施工作業安全'
};

function reconstructOldQ5(newStem) {
  const lines = newStem.split('\n');
  const headers = lines.map((line, index) => line === 'ａｂｃ' ? index : -1).filter(index => index >= 0);
  for (let table = headers.length - 1; table >= 0; table--) lines.splice(headers[table] + 1, 5, ...oldQ5Rows[table]);
  return lines.join('\n');
}

function reconstructOldQ6(newStem) {
  const lines = newStem.split('\n');
  for (const [key, oldLine] of Object.entries(oldQ6Rows)) {
    const index = lines.findIndex(line => line.startsWith(`${key} `));
    assert.notEqual(index, -1);
    lines[index] = oldLine;
  }
  return lines.join('\n');
}

const oldById = {
  Q_R4_5: { ...newById.Q_R4_5, stem: reconstructOldQ5(newById.Q_R4_5.stem) },
  Q_R4_6: { ...newById.Q_R4_6, stem: reconstructOldQ6(newById.Q_R4_6.stem) }
};
assert.equal(hash(oldById.Q_R4_5.stem), '6d848507ef025a2272e26a79029bd85c338e9c0fd61ff0c594b52a1924f809d6');
assert.equal(hash(oldById.Q_R4_6.stem), 'ae8d8131a4617ab27f063db26505b5ec0c59b21b4705b3d8a73c582b47d5bdf9');

class FakeRange {
  constructor(sheet, row, col, numRows = 1, numCols = 1) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }
  setValues(rows) {
    if (this.sheet.failSetValues) throw new Error('backup failed');
    for (let r = 0; r < this.numRows; r++) {
      for (let c = 0; c < this.numCols; c++) {
        this.sheet.ensureSize(this.row + r, this.col + c);
        this.sheet.values[this.row + r - 1][this.col + c - 1] = rows[r][c];
      }
    }
    if (this.sheet.afterSetValues) this.sheet.afterSetValues();
    return this;
  }
}

class FakeSheet {
  constructor(name, values, sheetId) {
    this.name = name;
    this.values = structuredClone(values);
    this.sheetId = sheetId;
    this.failSetValues = false;
    this.afterSetValues = null;
  }
  ensureSize(row, col) {
    while (this.values.length < row) this.values.push([]);
    while (this.values[row - 1].length < col) this.values[row - 1].push('');
  }
  getDataRange() { return { getValues: () => structuredClone(this.values) }; }
  getRange(row, col, numRows = 1, numCols = 1) { return new FakeRange(this, row, col, numRows, numCols); }
  getLastRow() { return this.values.length; }
  getSheetId() { return this.sheetId; }
}

const questionHeaders = ['qId', 'year', 'number', 'questionType', 'stem', 'modelAnswer', 'tags', 'createdAt', 'imageRequired', 'imageUrls'];
const backupHeaders = ['backupId', 'createdAt', 'operatorHash', 'qId', 'rowNumber', 'headersJson', 'rowValuesJson', 'oldStemHash', 'newStemHash'];
const qRow = (qid, stem) => [qid, 'R4', Number(qid.slice(-1)), 'essay', stem, `answer ${qid}`, 'essay', '2026-01-01', false, ''];

function makeEnv({ gap = false, duplicate = false, backupFailure = false, afterBackup = null, batchMode = 'normal', beforeFirstBatch = null, afterFirstBatch = null } = {}) {
  const rows = [questionHeaders, qRow('Q_R4_5', oldById.Q_R4_5.stem)];
  if (gap) rows.push(qRow('Q_R4_7', 'unchanged seven'));
  rows.push(qRow('Q_R4_6', oldById.Q_R4_6.stem));
  if (!gap) rows.push(qRow('Q_R4_7', 'unchanged seven'));
  if (duplicate) rows.push(qRow('Q_R4_5', oldById.Q_R4_5.stem));
  const questions = new FakeSheet('Questions', rows, 123);
  const backups = new FakeSheet('QuestionStemBackups', [backupHeaders], 456);
  backups.failSetValues = backupFailure;
  backups.afterSetValues = afterBackup ? () => afterBackup(questions) : null;
  const lock = { waits: 0, releases: 0, waitLock() { this.waits++; }, releaseLock() { this.releases++; } };
  const batchCalls = [];
  let batchNumber = 0;
  const sandbox = {
    console: { log() {} },
    Date,
    JSON,
    Array,
    Object,
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    Utilities: { getUuid: () => 'test-uuid' },
    SpreadsheetApp: { flush() {} },
    LockService: { getScriptLock: () => lock },
    SHEETS: { Questions: 'Questions', QuestionStemBackups: 'QuestionStemBackups' },
    HEADERS: { QuestionStemBackups: backupHeaders },
    sha256Hex_: hash,
    toSerializable_: value => value,
    getSheet_: name => name === 'Questions' ? questions : backups
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  sandbox.sendR4StemSheetsBatchUpdate_ = requests => {
    batchNumber++;
    batchCalls.push(structuredClone(requests));
    if (batchNumber === 1 && beforeFirstBatch) beforeFirstBatch(questions);
    if (batchMode === 'rollback-fails' && batchNumber === 2) throw new Error('rollback transport failed');
    const applyRequest = request => {
      const update = request.findReplace;
      const col = update.range.startColumnIndex;
      let count = 0;
      for (let row = 0; row < questions.values.length; row++) {
        const current = questions.values[row][col];
        if (String(current) === update.find) {
          questions.values[row][col] = update.replacement;
          count++;
        }
      }
      return { findReplace: { occurrencesChanged: count } };
    };
    const replies = requests.map(applyRequest);
    if (batchNumber === 1 && afterFirstBatch) afterFirstBatch(questions);
    if ((batchMode === 'bad-response' || batchMode === 'rollback-fails') && batchNumber === 1) return { replies: [{ findReplace: { occurrencesChanged: 0 } }] };
    return { replies };
  };
  return { sandbox, questions, backups, lock, batchCalls };
}

function rowById(sheet, qid) {
  const qidCol = sheet.values[0].indexOf('qId');
  return sheet.values.slice(1).find(row => row[qidCol] === qid);
}

// The fixed transformations reproduce the checked-in canonical stems exactly.
{
  const { sandbox } = makeEnv();
  assert.equal(sandbox.buildFixedR4Q5Stem_(oldById.Q_R4_5.stem), newById.Q_R4_5.stem);
  assert.equal(sandbox.buildFixedR4Q6Stem_(oldById.Q_R4_6.stem), newById.Q_R4_6.stem);
  assert.equal(hash(newById.Q_R4_5.stem), 'a334f0123c087c0d4bd330a5e811b90a39abc99d67cd7432f87f250e6f71f6f3');
  assert.equal(hash(newById.Q_R4_6.stem), 'cbf98e2d96e7c43e5c45093ef0a24b635ef26cc111a3ccd919ce19a7fa11dcbd');
}

// Dry-run is no-argument, always inspects exactly two fixed targets, and writes nothing.
{
  const { sandbox, questions, backups, lock, batchCalls } = makeEnv();
  const before = structuredClone(questions.values);
  const result = sandbox.runR4ChoiceStemRepairDryRun_();
  assert.equal(result.targetCount, 2);
  assert.equal(result.dryRun, true);
  assert.equal(result.wouldUpdate, 2);
  assert.equal(result.updated, 0);
  assert.deepEqual(questions.values, before);
  assert.equal(backups.values.length, 1);
  assert.equal(batchCalls.length, 0);
  assert.equal(lock.waits, 1);
  assert.equal(lock.releases, 1);
}

// Missing/duplicate/unexpected/mixed pairs stop before backup or write.
{
  const duplicate = makeEnv({ duplicate: true });
  assert.throws(() => duplicate.sandbox.runR4ChoiceStemRepairDryRun_(), error => error.code === 'DUPLICATE_LIVE_QID');
  const unexpected = makeEnv();
  rowById(unexpected.questions, 'Q_R4_5')[4] = 'unexpected';
  assert.throws(() => unexpected.sandbox.runR4ChoiceStemRepairApply_(), error => error.code === 'OLD_HASH_MISMATCH');
  assert.equal(unexpected.backups.values.length, 1);
  const mixed = makeEnv();
  rowById(mixed.questions, 'Q_R4_5')[4] = newById.Q_R4_5.stem;
  assert.throws(() => mixed.sandbox.runR4ChoiceStemRepairApply_(), error => error.code === 'MIXED_PAIR_STATE');
  assert.equal(mixed.backups.values.length, 1);
  const duplicateOldStem = makeEnv();
  duplicateOldStem.questions.values.push(qRow('Q_R4_8', oldById.Q_R4_5.stem));
  assert.throws(() => duplicateOldStem.sandbox.runR4ChoiceStemRepairApply_(), error => error.code === 'STEM_OCCURRENCE_INVALID');
  const prematureNewStem = makeEnv();
  prematureNewStem.questions.values.push(qRow('Q_R4_8', newById.Q_R4_5.stem));
  assert.throws(() => prematureNewStem.sandbox.runR4ChoiceStemRepairApply_(), error => error.code === 'STEM_OCCURRENCE_INVALID');
}

// A backup failure leaves both question rows untouched.
{
  const { sandbox, questions, backups, batchCalls } = makeEnv({ backupFailure: true });
  const before = structuredClone(questions.values);
  assert.throws(() => sandbox.runR4ChoiceStemRepairApply_(), error => error.code === 'BACKUP_FAILED');
  assert.deepEqual(questions.values, before);
  assert.equal(backups.values.length, 1);
  assert.equal(batchCalls.length, 0);
}

// Row insertion/reordering after backup is safe because replacement is exact-text based.
for (const afterBackup of [
  sheet => sheet.values.splice(1, 0, new Array(questionHeaders.length).fill('')),
  sheet => { const q5 = rowById(sheet, 'Q_R4_5'); const q6 = rowById(sheet, 'Q_R4_6'); const i5 = sheet.values.indexOf(q5); const i6 = sheet.values.indexOf(q6); [sheet.values[i5], sheet.values[i6]] = [sheet.values[i6], sheet.values[i5]]; }
]) {
  const { sandbox, questions, batchCalls } = makeEnv({ gap: true, afterBackup });
  const result = sandbox.runR4ChoiceStemRepairApply_();
  assert.equal(result.updated, 2);
  assert.equal(rowById(questions, 'Q_R4_5')[4], newById.Q_R4_5.stem);
  assert.equal(rowById(questions, 'Q_R4_6')[4], newById.Q_R4_6.stem);
  assert.equal(batchCalls.length, 1);
  assert.equal(batchCalls[0].length, 2);
}

// A content change between backup and prewrite is detected; no forward batch is sent.
{
  const { sandbox, batchCalls } = makeEnv({ afterBackup: sheet => { rowById(sheet, 'Q_R4_5')[4] = 'changed after backup'; } });
  assert.throws(() => sandbox.runR4ChoiceStemRepairApply_(), error => error.code === 'PREWRITE_STATE_CHANGED');
  assert.equal(batchCalls.length, 0);
}

// Insertion/reordering immediately before the HTTP send cannot redirect the write to another row.
{
  const { sandbox, questions, backups, batchCalls } = makeEnv({
    gap: true,
    beforeFirstBatch: sheet => {
      sheet.values.splice(1, 0, new Array(questionHeaders.length).fill(''));
      const q5 = rowById(sheet, 'Q_R4_5');
      sheet.values.splice(sheet.values.indexOf(q5), 1);
      sheet.values.push(q5);
    }
  });
  const beforeById = Object.fromEntries(questions.values.slice(1).map(row => [row[0], structuredClone(row)]));
  const result = sandbox.runR4ChoiceStemRepairApply_();
  assert.equal(result.updated, 2);
  assert.equal(result.backupId, 'r4-stem-test-uuid');
  assert.equal(batchCalls.length, 1);
  assert.equal(batchCalls[0].length, 2);
  for (const qid of ['Q_R4_5', 'Q_R4_6']) {
    const after = rowById(questions, qid);
    assert.equal(after[4], newById[qid].stem);
    for (let col = 0; col < after.length; col++) if (col !== 4) assert.deepEqual(after[col], beforeById[qid][col]);
  }
  assert.deepEqual(rowById(questions, 'Q_R4_7'), beforeById.Q_R4_7);
  assert.equal(backups.values.length, 3);
  const second = sandbox.runR4ChoiceStemRepairApply_();
  assert.equal(second.updated, 0);
  assert.equal(second.alreadyApplied, 2);
  assert.equal(batchCalls.length, 1);
  assert.equal(backups.values.length, 3);
}

// An invalid response after both atomic replacements is compensated with one exact new-to-old batch.
{
  const { sandbox, questions, batchCalls } = makeEnv({ batchMode: 'bad-response', afterBackup: sheet => { const q5 = rowById(sheet, 'Q_R4_5'); sheet.values.splice(sheet.values.indexOf(q5), 1); sheet.values.push(q5); } });
  assert.throws(() => sandbox.runR4ChoiceStemRepairApply_(), error => error.code === 'WRITE_FAILED_ROLLED_BACK' && error.backupId === 'r4-stem-test-uuid');
  assert.equal(rowById(questions, 'Q_R4_5')[4], oldById.Q_R4_5.stem);
  assert.equal(rowById(questions, 'Q_R4_6')[4], oldById.Q_R4_6.stem);
  assert.equal(batchCalls.length, 2);
}

// Rollback failure is surfaced explicitly and never reported as zero-update success.
{
  const { sandbox, questions, batchCalls } = makeEnv({ batchMode: 'rollback-fails' });
  assert.throws(() => sandbox.runR4ChoiceStemRepairApply_(), error => error.code === 'ROLLBACK_FAILED' && Boolean(error.rollbackCode));
  assert.equal(rowById(questions, 'Q_R4_5')[4], newById.Q_R4_5.stem);
  assert.equal(rowById(questions, 'Q_R4_6')[4], newById.Q_R4_6.stem);
  assert.equal(batchCalls.length, 2);
}

// An exact duplicate inserted after preflight is detected by occurrence count;
// rollback refuses to guess because the new text is no longer unique.
{
  const { sandbox, questions, batchCalls } = makeEnv({
    beforeFirstBatch: sheet => sheet.values.push(qRow('Q_R4_8', oldById.Q_R4_5.stem))
  });
  assert.throws(
    () => sandbox.runR4ChoiceStemRepairApply_(),
    error => error.code === 'ROLLBACK_FAILED' && error.rollbackCode === 'ROLLBACK_STATE_UNSAFE'
  );
  assert.equal(rowById(questions, 'Q_R4_8')[4], newById.Q_R4_5.stem);
  assert.equal(batchCalls.length, 1);
  assert.match(docsSource, /exact duplicate|exact duplicate/i);
  assert.match(docsSource, /prohibit all direct edits/i);
}

// No one-question forward update exists, and no normal web entry point references the repair.
{
  const { sandbox, questions } = makeEnv();
  assert.throws(() => sandbox.executeFixedR4StemBatchUpdate_(questions, [{ oldStem: 'x', newStem: 'y' }], 5), error => error.code === 'FORWARD_BATCH_SIZE_INVALID');
  const declaredFunctions = [...source.matchAll(/function\s+([A-Za-z0-9_$]+)\s*\(/g)].map(match => match[1]);
  assert.ok(declaredFunctions.length > 0);
  assert.ok(declaredFunctions.every(name => name.endsWith('_')), declaredFunctions.filter(name => !name.endsWith('_')));
  assert.match(source, /function runR4ChoiceStemRepairDryRun_\(\)/);
  assert.match(source, /function runR4ChoiceStemRepairApply_\(\)/);
  assert.doesNotMatch(source, /clientUserKey|requireAdmin_|apiRepairR4ChoiceStems/);
  for (const publicSource of [codeSource, apiSource, clientSource]) assert.doesNotMatch(publicSource, /R4ChoiceStemRepair|apiRepairR4ChoiceStems/);
  assert.match(source, /updates\.length !== 2/);
  assert.match(source, /findReplace:/);
  assert.match(source, /matchEntireCell: true/);
  assert.match(source, /matchCase: true/);
  assert.match(source, /searchByRegex: false/);
  assert.doesNotMatch(source, /updateCells:/);
  assert.doesNotMatch(source, /startRowIndex|endRowIndex/);
  assert.match(source, /startColumnIndex: stemColumn - 1/);
  assert.match(source, /occurrencesChanged/);
  assert.match(docsSource, /強制終了/);
  assert.match(docsSource, /応答不明/);
}

console.log('R4 fixed-pair owner maintenance contracts: PASS');
