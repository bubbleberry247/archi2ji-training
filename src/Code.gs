// Code.gs — doGet entry point + setup

var ARCHI2JI_BUILD_VERSION_ = '2026-08-07-multi-answer-deterministic-v1';

function doGet(e) {
  // Auto-setup on first access
  if (!getDbId_()) { setup_(); }

  // OAuth error (Google returns ?error=access_denied etc.)
  var oauthError = (e && e.parameter) ? e.parameter.error : '';
  if (oauthError) {
    var msgs = {
      'access_denied': 'ログインがキャンセルされました',
      'invalid_request': 'リクエストが無効です',
      'server_error': 'Googleサーバーエラーが発生しました'
    };
    return errorPage_(msgs[oauthError] || 'Google認証エラーが発生しました');
  }

  // OAuth callback (code + state)
  var code = (e && e.parameter) ? e.parameter.code : '';
  var state = (e && e.parameter) ? e.parameter.state : '';
  if (code && state) {
    return handleOAuthCallback_(code, state);
  }

  // OAuth start (redirect to Google)
  var oauthStart = (e && e.parameter) ? e.parameter.oauthStart : '';
  if (oauthStart === '1') {
    return generateOAuthStartPage_();
  }

  // Admin actions
  var action = (e && e.parameter) ? e.parameter.action : '';
  if (action === 'setup') {
    var setupAuthError = requireMaintenanceToken_(e);
    if (setupAuthError) return setupAuthError;
    setup_();
    return ContentService.createTextOutput(JSON.stringify({ ok: true, dbId: getDbId_() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'syncRoster') {
    var syncAuthError = requireMaintenanceToken_(e);
    if (syncAuthError) return syncAuthError;
    return ContentService.createTextOutput(JSON.stringify(syncDashboardRosterForCurrentApp_()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'diag') {
    var config = getConfigMap_();
    var qDiag = getQuestionDiag_();
    var uaDiag = getUserAccessDiag_();
    var props = PropertiesService.getScriptProperties();
    var configuredAiProvider = String(props.getProperty('AI_PROVIDER') || 'openai').trim().toLowerCase();
    var configuredOpenAIModel = String(props.getProperty('OPENAI_MODEL') || '');
    var configuredOpenAIReasoningEffort = String(props.getProperty('OPENAI_REASONING_EFFORT') || '');
    var configuredOpenAIMaxOutputTokens = String(props.getProperty('OPENAI_MAX_OUTPUT_TOKENS') || '');
    return ContentService.createTextOutput(JSON.stringify({
      dbId: getDbId_() ? 'SET' : 'MISSING',
      googleClientId: getConfigValue_(config, 'GOOGLE_CLIENT_ID', '') ? 'SET' : 'MISSING',
      appExecUrl: getAppExecUrl_(),
      buildVersion: ARCHI2JI_BUILD_VERSION_,
      aiProvider: configuredAiProvider,
      openaiApiKey: props.getProperty('OPENAI_API_KEY') ? 'SET' : 'MISSING',
      openaiModel: configuredOpenAIModel || 'gpt-5.4-mini',
      openaiModelConfigured: configuredOpenAIModel,
      openaiReasoningEffort: configuredOpenAIReasoningEffort || 'low',
      openaiReasoningEffortConfigured: configuredOpenAIReasoningEffort,
      openaiMaxOutputTokens: configuredOpenAIMaxOutputTokens || '1800',
      openaiMaxOutputTokensConfigured: configuredOpenAIMaxOutputTokens,
      azureOpenaiEndpoint: props.getProperty('AZURE_OPENAI_ENDPOINT') ? 'SET' : 'MISSING',
      azureOpenaiResponsesUrl: props.getProperty('AZURE_OPENAI_RESPONSES_URL') ? 'SET' : 'MISSING',
      azureOpenaiDeployment: props.getProperty('AZURE_OPENAI_DEPLOYMENT') ? 'SET' : 'MISSING',
      azureOpenaiApiKey: props.getProperty('AZURE_OPENAI_API_KEY') ? 'SET' : 'MISSING',
      questionCount: qDiag.questionCount,
      duplicateCount: qDiag.duplicateCount,
      imageRequiredCount: qDiag.imageRequiredCount,
      imageMissingCount: qDiag.imageMissingCount,
      yearCounts: qDiag.yearCounts,
      userAccessCount: uaDiag.userAccessCount,
      adminCount: uaDiag.adminCount
    })).setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'selftest') {
    return ContentService.createTextOutput(JSON.stringify(getArchi2jiSelfTest_()))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'initImportToken') {
    var tokenAuthError = requireMaintenanceToken_(e);
    if (tokenAuthError) return tokenAuthError;
    var props = PropertiesService.getScriptProperties();
    var existing = props.getProperty('IMPORT_TOKEN');
    if (!existing) {
      var tok = Utilities.getUuid();
      props.setProperty('IMPORT_TOKEN', tok);
      return ContentService.createTextOutput(JSON.stringify({ token: tok }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(JSON.stringify({ token: existing }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'dedupeQuestions') {
    var dedupeAuthError = requireMaintenanceToken_(e);
    if (dedupeAuthError) return dedupeAuthError;
    return ContentService.createTextOutput(JSON.stringify(dedupeQuestions_()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Serve SPA
  return serveSpa_('');
}

function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    var token = PropertiesService.getScriptProperties().getProperty('IMPORT_TOKEN');
    if (!token || params.token !== token) {
      return ContentService.createTextOutput(JSON.stringify({ _error: true, message: 'Unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var action = params.action || '';
    if (action === 'importQuestions') {
      var result = apiImportQuestionsCore_(params.questionsJson);
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (action === 'updateModelAnswers') {
      var updateResult = apiUpdateModelAnswersCore_(params.answers || []);
      return ContentService.createTextOutput(JSON.stringify(updateResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (action === 'importRubrics') {
      var rubricResult = apiImportRubricsCore_(params.rubricsJson);
      return ContentService.createTextOutput(JSON.stringify(rubricResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    if (action === 'importQuestionImages') {
      var imageResult = apiImportQuestionImagesCore_(params.imagesJson || params.images || [], params.replaceExisting);
      return ContentService.createTextOutput(JSON.stringify(imageResult))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(JSON.stringify({ _error: true, message: 'Unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ _error: true, message: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function requireMaintenanceToken_(e) {
  var expected = PropertiesService.getScriptProperties().getProperty('MAINTENANCE_TOKEN') || '';
  var supplied = '';
  if (e && e.parameter) {
    supplied = String(e.parameter.maintenanceToken || e.parameter.adminToken || '').trim();
  }
  if (!expected || supplied !== expected) {
    return ContentService.createTextOutput(JSON.stringify({ _error: true, message: 'Unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return null;
}

function setup_() {
  var id = getDbId_();
  if (!id) {
    var ss = SpreadsheetApp.create('Archi2ji_DB_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd'));
    setDbId_(ss.getId());
    Logger.log('Database created: ' + ss.getName() + ' ' + ss.getUrl());
  }
  Object.keys(SHEETS).forEach(function(k) { getSheet_(SHEETS[k]); });
  ensureArchi2jiScheduleConfig_();
  syncDashboardRosterForCurrentApp_();
  Logger.log('Setup complete');
}

function getQuestionDiag_() {
  var rows = readRecords_(SHEETS.Questions);
  var seen = {};
  var years = {};
  var duplicateCount = 0;
  var imageRequiredCount = 0;
  var imageMissingCount = 0;
  rows.forEach(function(r) {
    var qId = String(r.qId || '');
    if (qId) {
      if (seen[qId]) duplicateCount++;
      seen[qId] = true;
    }
    var y = String(r.year || '');
    if (y) years[y] = (years[y] || 0) + 1;
    var required = isArchiQuestionImageRequired_(r);
    var urls = getArchiQuestionImageUrls_(r);
    if (required) {
      imageRequiredCount += 1;
      if (!urls.length) imageMissingCount += 1;
    }
  });
  return {
    questionCount: rows.length,
    duplicateCount: duplicateCount,
    imageRequiredCount: imageRequiredCount,
    imageMissingCount: imageMissingCount,
    yearCounts: years
  };
}

function getUserAccessDiag_() {
  var rows = readRecordsFromSheet_(getUserAccessSheet_());
  var adminCount = 0;
  rows.forEach(function(r) {
    if (String(r.role || '').trim().toLowerCase() === 'admin') adminCount += 1;
  });
  return { userAccessCount: rows.length, adminCount: adminCount };
}

function dedupeQuestions_() {
  var sh = getSheet_(SHEETS.Questions);
  var values = sh.getDataRange().getValues();
  if (values.length <= 1) {
    return { ok: true, deleted: 0, remaining: 0 };
  }
  var headers = values[0];
  var qIdx = headers.indexOf('qId');
  if (qIdx < 0) throw new Error('qId header not found');

  var seen = {};
  var toDelete = [];
  for (var i = 1; i < values.length; i++) {
    var qId = String(values[i][qIdx] || '');
    if (!qId) continue;
    if (seen[qId]) {
      toDelete.push(i + 1);
    } else {
      seen[qId] = true;
    }
  }

  for (var d = toDelete.length - 1; d >= 0; d--) {
    sh.deleteRow(toDelete[d]);
  }
  return { ok: true, deleted: toDelete.length, remaining: values.length - 1 - toDelete.length };
}
