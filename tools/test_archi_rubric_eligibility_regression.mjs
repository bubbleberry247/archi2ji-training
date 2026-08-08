import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const api = fs.readFileSync(new URL('../src/api.gs', import.meta.url), 'utf8');
const rubrics = JSON.parse(
  fs.readFileSync(new URL('../data/scoring_rubrics.json', import.meta.url), 'utf8')
);

const server = { console };
vm.createContext(server);
vm.runInContext(api, server);

assert.equal(server.isArchiPracticeOnlyStatus_(null), true, 'missing status is excluded');
assert.equal(
  server.isArchiPracticeOnlyStatus_({ excludeFromTotal: true, scoreMode: 'rubric_ai', reviewStatus: 'needs_review' }),
  false,
  'excludeFromTotal alone does not exclude a question from practice'
);
assert.equal(
  server.isArchiPracticeOnlyStatus_({ excludeFromTotal: false, scoreMode: 'missing', reviewStatus: 'approved' }),
  true,
  'missing score mode is excluded'
);
assert.equal(
  server.isArchiPracticeOnlyStatus_({ excludeFromTotal: false, scoreMode: 'practice_only', reviewStatus: 'approved' }),
  true,
  'practice-only score mode is excluded'
);
assert.equal(
  server.isArchiPracticeOnlyStatus_({ excludeFromTotal: false, scoreMode: 'rubric_ai', reviewStatus: 'needs_answer_key' }),
  true,
  'rubrics needing an answer key are excluded'
);
assert.equal(
  server.isArchiPracticeOnlyStatus_({ excludeFromTotal: false, scoreMode: 'rubric_ai', reviewStatus: 'approved' }),
  false,
  'normal rubric status is included'
);

const statuses = rubrics.map((rubric) => server.buildArchiRubricStatus_(rubric));
const excluded = statuses.filter((status) => server.isArchiPracticeOnlyStatus_(status));
const included = statuses.filter((status) => !server.isArchiPracticeOnlyStatus_(status));

assert.equal(rubrics.length, 60, 'canonical rubric fixture contains 60 questions');
assert.equal(excluded.length, 14, 'only the 14 unscorable questions are excluded');
assert.equal(included.length, 46, 'the established 46 practice questions remain eligible');

console.log('archi rubric eligibility regression: 9 assertions passed');
