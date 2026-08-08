import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const api = fs.readFileSync(new URL('../src/api.gs', import.meta.url), 'utf8');
const context = { console };
vm.createContext(context);
vm.runInContext(api, context);

function props(values) {
  return { getProperty: (key) => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null };
}

const openai = context.getArchiAiProviderConfig_(props({ OPENAI_API_KEY: 'openai-test-key', OPENAI_MODEL: 'gpt-5.4-mini' }));
assert.equal(openai.ready, true);
assert.equal(openai.provider, 'openai');
assert.equal(openai.requestUrl, 'https://api.openai.com/v1/responses');
assert.equal(openai.requestModel, 'gpt-5.4-mini');
assert.equal(openai.headers.Authorization, 'Bearer openai-test-key');
assert.equal(openai.headers['api-key'], undefined);

const azure = context.getArchiAiProviderConfig_(props({
  AI_PROVIDER: 'azure',
  AZURE_OPENAI_ENDPOINT: 'https://docintel50-vlm.openai.azure.com/',
  AZURE_OPENAI_DEPLOYMENT: 'elearning-grading-gpt54mini',
  AZURE_OPENAI_API_KEY: 'azure-test-key',
  OPENAI_MODEL: 'gpt-5.4-mini'
}));
assert.equal(azure.ready, true);
assert.equal(azure.provider, 'azure');
assert.equal(azure.requestUrl, 'https://docintel50-vlm.openai.azure.com/openai/v1/responses');
assert.equal(azure.requestUrl.includes('api-version='), false);
assert.equal(azure.requestModel, 'elearning-grading-gpt54mini');
assert.equal(azure.capabilityModel, 'gpt-5.4-mini');
assert.equal(azure.headers['api-key'], 'azure-test-key');
assert.equal(azure.headers.Authorization, undefined);

const explicit = context.getArchiAiProviderConfig_(props({
  AI_PROVIDER: 'azure',
  AZURE_OPENAI_RESPONSES_URL: 'https://docintel50-vlm.openai.azure.com/openai/v1/responses/',
  AZURE_OPENAI_DEPLOYMENT: 'elearning-grading-gpt54mini',
  AZURE_OPENAI_API_KEY: 'azure-test-key',
  AZURE_OPENAI_MODEL: 'gpt-5.4-mini'
}));
assert.equal(explicit.ready, true);
assert.equal(explicit.requestUrl, 'https://docintel50-vlm.openai.azure.com/openai/v1/responses');

const missing = context.getArchiAiProviderConfig_(props({ AI_PROVIDER: 'azure' }));
assert.equal(missing.ready, false);
assert.deepEqual(Array.from(missing.missing), ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_DEPLOYMENT', 'AZURE_OPENAI_API_KEY']);

const queryUrl = context.getArchiAiProviderConfig_(props({
  AI_PROVIDER: 'azure',
  AZURE_OPENAI_RESPONSES_URL: 'https://docintel50-vlm.openai.azure.com/openai/v1/responses?api-version=v1',
  AZURE_OPENAI_DEPLOYMENT: 'elearning-grading-gpt54mini',
  AZURE_OPENAI_API_KEY: 'azure-test-key'
}));
assert.equal(queryUrl.ready, false);
assert.deepEqual(Array.from(queryUrl.missing), ['AZURE_OPENAI_RESPONSES_URL']);

const invalid = context.getArchiAiProviderConfig_(props({ AI_PROVIDER: 'other' }));
assert.equal(invalid.ready, false);
assert.deepEqual(Array.from(invalid.missing), ['AI_PROVIDER']);

assert.match(api, /model: aiConfig\.requestModel/);
assert.match(api, /headers: aiConfig\.headers/);
assert.match(api, /modelLabel = aiConfig\.provider \+ ':' \+ aiConfig\.requestModel/);

const cacheValues = {};
context.CacheService = { getScriptCache: () => ({
  get: (key) => cacheValues[key] || null,
  put: (key, value) => { cacheValues[key] = value; }
}) };
context.setArchiAiCircuit_({ stopBatch: true, fatal: true, errorCode: 'AI_QUOTA' }, 'openai');
assert.equal(context.getArchiAiCircuit_('azure'), null);
assert.equal(context.getArchiAiCircuit_('openai').errorCode, 'AI_QUOTA');
context.setArchiAiCircuit_({ stopBatch: true, fatal: false, errorCode: 'AI_RATE_LIMIT' }, 'azure');
assert.equal(context.getArchiAiCircuit_('azure').errorCode, 'AI_RATE_LIMIT');

let capturedRequest = null;
context.getArchiQuestionImageInputUrls_ = () => [];
context.getArchiOpenAIMaxOutputTokens_ = () => 1800;
context.getArchiOpenAIImageDetail_ = () => 'high';
context.getArchiOpenAIReasoningEffort_ = () => 'low';
context.getArchiOpenAIUsageMetrics_ = () => ({ totalTokens: 12 });
context.UrlFetchApp = { fetch: (url, options) => {
  capturedRequest = { url, options };
  return {
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ score: 7, maxScore: 10, overallComment: '確認済み', criteria: [], strengths: [], improvements: [], fullScoreHints: [], addableExamples: [], warnings: [] }) }] }]
    })
  };
} };
const graded = context.gradeArchiWithOpenAI_({ qId: 'TEST-1', year: 'R7', number: 1, stem: '架空問題', modelAnswer: '架空答案' }, { maxScore: 10, rubricJson: '{}' }, '架空の受講者答案', azure);
const sentBody = JSON.parse(capturedRequest.options.payload);
assert.equal(capturedRequest.url, azure.requestUrl);
assert.equal(capturedRequest.options.headers['api-key'], 'azure-test-key');
assert.equal(capturedRequest.options.headers.Authorization, undefined);
assert.equal(sentBody.model, 'elearning-grading-gpt54mini');
assert.equal(sentBody.store, false);
assert.equal(sentBody.reasoning.effort, 'low');
assert.equal(sentBody.text.format.type, 'json_schema');
assert.equal(graded.score, 7);

console.log('archi AI provider contracts: 36 assertions passed');
