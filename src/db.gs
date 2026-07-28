var SHEETS = {
  Config: 'Config',
  Users: 'Users',
  Questions: 'Questions',
  Notes: 'Notes',
  AnswerDrafts: 'AnswerDrafts',
  ScoringRubrics: 'ScoringRubrics',
  AiGradings: 'AiGradings',
  UserAccess: 'UserAccess',
  MiniTestCompletions: 'MiniTestCompletions'
};

var HEADERS = {};
HEADERS[SHEETS.Config]    = ['key', 'value'];
HEADERS[SHEETS.Users]     = ['userKey', 'email', 'displayName', 'recoveryCode', 'createdAt'];
HEADERS[SHEETS.Questions] = ['qId', 'year', 'number', 'questionType', 'stem', 'modelAnswer', 'tags', 'createdAt', 'imageRequired', 'imageUrls'];
HEADERS[SHEETS.Notes]     = ['noteId', 'userKey', 'qId', 'note', 'selfScore', 'createdAt'];
HEADERS[SHEETS.AnswerDrafts] = ['userKey', 'qId', 'draftText', 'updatedAt'];
HEADERS[SHEETS.ScoringRubrics] = ['qId', 'responseType', 'sourceQuality', 'scoreMode', 'maxScore', 'rubricJson', 'reviewStatus', 'updatedAt'];
HEADERS[SHEETS.AiGradings] = ['gradingId', 'userKey', 'qId', 'answerText', 'answerHash', 'score', 'maxScore', 'scoreMode', 'sourceQuality', 'reviewStatus', 'overallComment', 'criteriaJson', 'flagsJson', 'rawJson', 'model', 'createdAt', 'inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens', 'reasoningTokens', 'estimatedCostUsd', 'estimatedCostJpy', 'pricingJson'];
HEADERS[SHEETS.UserAccess] = ['email', 'role', 'managerEmail', 'active', 'updatedAt', 'displayName', 'showInDashboard'];
HEADERS[SHEETS.MiniTestCompletions] = ['completionId', 'userKey', 'testKey', 'testLabel', 'questionCount', 'startedAt', 'completedAt'];

function setDbId_(id) {
  PropertiesService.getScriptProperties().setProperty('DB_ID', id);
}

function getDbId_() {
  return PropertiesService.getScriptProperties().getProperty('DB_ID');
}

function getDb_() {
  var id = getDbId_();
  if (!id) throw new Error('DB not initialized. Run setup_()');
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  var ss = getDb_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(HEADERS[name]);
    sh.getRange(1, 1, 1, HEADERS[name].length).setFontWeight('bold');
  } else {
    ensureSheetHeaders_(sh, HEADERS[name] || []);
  }
  return sh;
}

function ensureSheetHeaders_(sh, requiredHeaders) {
  if (!requiredHeaders || !requiredHeaders.length) return;
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) {
    return String(h || '').trim();
  });
  var existing = {};
  headers.forEach(function(h) {
    if (h) existing[h] = true;
  });
  var missing = requiredHeaders.filter(function(h) {
    return h && !existing[h];
  });
  if (!missing.length) return;
  sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  sh.getRange(1, 1, 1, headers.length + missing.length).setFontWeight('bold');
}

function readRecords_(sheetName) {
  var sh = getSheet_(sheetName);
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return [];
  var headers = vals[0];
  return vals.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function appendRow_(sheetName, obj) {
  var sh = getSheet_(sheetName);
  var headers = HEADERS[sheetName];
  sh.appendRow(headers.map(function(h) { return obj[h] !== undefined ? obj[h] : ''; }));
}

// ─── Config helpers ───────────────────────────────────────

function getConfigMap_() {
  try {
    var sh = getSheet_(SHEETS.Config);
    var vals = sh.getDataRange().getValues();
    if (vals.length < 2) return {};
    var map = {};
    for (var i = 1; i < vals.length; i++) {
      var k = String(vals[i][0] || '').trim();
      var v = vals[i][1];
      if (k) map[k] = v;
    }
    return map;
  } catch (e) { return {}; }
}

function getConfigValue_(map, key, defVal) {
  return map.hasOwnProperty(key) ? map[key] : defVal;
}

function setConfigValue_(key, value) {
  var sh = getSheet_(SHEETS.Config);
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0] || '').trim() === String(key)) {
      sh.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value]);
}

function ensureArchi2jiScheduleConfig_() {
  setConfigValue_('PROGRAM_START_DATE', '2026-07-01');
  setConfigValue_('EXAM_DATE', '2026-10-18');
}

// ─── Serialization ────────────────────────────────────────

function toSerializable_(obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(toSerializable_);
  if (typeof obj === 'object') {
    var r = {};
    for (var k in obj) { if (obj.hasOwnProperty(k)) r[k] = toSerializable_(obj[k]); }
    return r;
  }
  return obj;
}
