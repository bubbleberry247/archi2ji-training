import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function createClientContext() {
  const html = fs.readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  const client = scripts.at(-1)[1];
  const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  const document = {
    referrer: '',
    getElementById() { return null; },
    querySelectorAll() { return []; }
  };
  const window = {
    location: { href: '' },
    addEventListener() {},
    setInterval() { return 1; },
    clearInterval() {}
  };
  const context = { console, document, window, localStorage: storage, sessionStorage: storage };
  vm.createContext(context);
  vm.runInContext(client, context);
  return context;
}

const client = createClientContext();
client.state.practiceKind = 'mock';

const q5 = { qId: 'Q_R7_5', year: 'R7', number: 5, questionType: 'multiple_choice', responseType: 'multiple_choice', answerKeys: ['1', '2', '3', '4', '5', '6', '7', '8'] };
const q6 = { qId: 'Q_R7_6', year: 'R7', number: 6, questionType: 'multiple_choice', responseType: 'multiple_choice', answerKeys: ['1-1', '1-2', '2-3', '2-4', '3-5', '3-6'] };
const oldSchedule = { qId: 'Q_H28_5', year: 'H28', number: 5, questionType: 'mixed', responseType: 'mixed', answerKeys: [] };
const futureChoice = { qId: 'Q_R8_5', year: 'R8', number: 5, questionType: 'multiple_choice', responseType: 'multiple_choice', answerKeys: ['a', 'b'] };
const q5Keys = Array.from(client.getMockChoiceAnswerKeys_(q5));
const q6Keys = Array.from(client.getMockChoiceAnswerKeys_(q6));

assert.deepEqual(q5Keys, ['1', '2', '3', '4', '5', '6', '7', '8']);
assert.deepEqual(q6Keys, ['1-1', '1-2', '2-3', '2-4', '3-5', '3-6']);
assert.deepEqual(Array.from(client.getMockChoiceAnswerKeys_(oldSchedule)), []);
assert.deepEqual(Array.from(client.getMockChoiceAnswerKeys_(futureChoice)), ['a', 'b']);
client.state.practiceKind = 'mini';
assert.deepEqual(Array.from(client.getMockChoiceAnswerKeys_(q5)), q5Keys);
assert.deepEqual(Array.from(client.getMockChoiceAnswerKeys_(q6)), q6Keys);
client.state.practiceKind = 'mock';

const q5Answer = client.serializeMockChoiceAnswerMap_(
  { 1: '4', 2: '2', 3: '3', 4: '3', 5: '5', 6: '5', 7: '2', 8: '1' },
  q5Keys
);
assert.equal(q5Answer.split('\n').length, 8);
assert.equal(client.isMockQuestionAnswered_(q5, q5Answer), true);
assert.equal(client.isMockQuestionAnswered_(q5, '1: 4\n2: 2'), false);

const q6Answer = client.serializeMockChoiceAnswerMap_(
  { '1-1': '5', '1-2': '3', '2-3': '2', '2-4': '1', '3-5': '4', '3-6': '2' },
  q6Keys
);
assert.equal(client.isMockQuestionAnswered_(q6, q6Answer), true);
assert.equal(client.isMockQuestionAnswered_(oldSchedule, '工程表の解答'), true);

const q5Html = client.renderMockChoiceAnswerHtml_(q5);
assert.equal((q5Html.match(/data-mock-choice-key=/g) || []).length, 40);
assert.match(q5Html, /0 \/ 8小問/);

client.state.questions = [
  { qId: 'Q_R7_1', number: 1, questionType: 'experience_essay' },
  { qId: 'Q_R7_2', number: 2, questionType: 'short_answer' },
  { qId: 'Q_R7_3', number: 3, questionType: 'mixed' },
  { qId: 'Q_R7_4', number: 4, questionType: 'short_answer' },
  q5,
  q6
];
assert.equal(client.isFullSixQuestionMock_(), true);
assert.equal(client.getMockSectionRules_().length, 2);
client.state.sessionAnswers = {
  Q_R7_1: '答案1', Q_R7_2: '答案2', Q_R7_3: '答案3', Q_R7_4: '答案4',
  Q_R7_5: '1: 4\n2: 2', Q_R7_6: q6Answer
};
assert.equal(client.getMockAnsweredCount_(client.getMockSectionRules_()[1]), 1);
client.state.sessionAnswers.Q_R7_5 = q5Answer;
assert.equal(client.getMockAnsweredCount_(client.getMockSectionRules_()[1]), 2);

client.state.questions = [
  { qId: 'Q_H28_1', number: 1, questionType: 'experience_essay' },
  { qId: 'Q_H28_2', number: 2, questionType: 'short_answer' },
  { qId: 'Q_H28_4', number: 4, questionType: 'short_answer' },
  oldSchedule
];
const legacyRules = client.getMockSectionRules_();
assert.equal(client.isFullSixQuestionMock_(), false);
assert.equal(legacyRules.length, 1);
assert.equal(legacyRules[0].required, 4);
assert.match(client.formatYearMockMeta_({ year: 'H28', count: 4 }), /4大問を配信/);
assert.match(client.renderMockRulesOverview_(), /年度別演習/);

const server = { console };
vm.createContext(server);
vm.runInContext(fs.readFileSync(new URL('../src/api.gs', import.meta.url), 'utf8'), server);

const rubric = {
  qId: 'Q_R7_5',
  scoreMode: 'deterministic',
  maxScore: 10,
  rubricJson: { correctAnswers: [4, 2, 3, 3, 5, 5, 2, 1] }
};
const rubricStatus = server.buildArchiRubricStatus_({ ...rubric, responseType: 'multiple_choice' });
assert.equal(rubricStatus.responseType, 'multiple_choice');
assert.deepEqual(Array.from(rubricStatus.answerKeys), ['1', '2', '3', '4', '5', '6', '7', '8']);
let persistedModel = '';
server.SHEETS = { Questions: 'Questions' };
server.readRecords_ = () => [{ qId: 'Q_R7_5' }];
server.decorateArchiQuestionMedia_ = q => q;
server.getArchiRubricByQId_ = () => rubric;
server.buildArchiRubricStatus_ = () => ({ canGrade: true, scoreMode: 'deterministic' });
server.applyArchiQuestionMediaStatus_ = status => status;
server.PropertiesService = { getScriptProperties() { throw new Error('deterministic grading must not read OpenAI settings'); } };
server.gradeArchiWithOpenAI_ = () => { throw new Error('deterministic grading must not call OpenAI'); };
server.appendArchiAiGrading_ = (userKey, qId, answerText, usedRubric, result, model) => {
  persistedModel = model;
  return { score: result.score, maxScore: result.maxScore, answerText };
};
server.appendArchiSubmission_ = () => ({ noteId: 'N1' });
server.toSerializable_ = value => value;

const graded = server.apiGradeAnswer('Q_R7_5', q5Answer, 'user-1');
assert.equal(graded.success, true);
assert.equal(graded.grading.score, 10);
assert.equal(persistedModel, 'deterministic');

const q6Rubric = {
  scoreMode: 'deterministic',
  maxScore: 10,
  rubricJson: { correctAnswers: { '1-1': 5, '1-2': 3, '2-3': 2, '2-4': 1, '3-5': 4, '3-6': 2 } }
};
const q6Graded = server.gradeArchiDeterministic_(q6Answer, q6Rubric);
assert.equal(q6Graded.score, 10);
assert.equal(q6Graded.rawJson.correctCount, 6);

console.log('archi mock/deterministic contracts: 29 assertions passed');
