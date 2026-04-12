// Code.gs — doGet entry point + setup

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
    setup_();
    return ContentService.createTextOutput(JSON.stringify({ ok: true, dbId: getDbId_() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'diag') {
    var config = getConfigMap_();
    return ContentService.createTextOutput(JSON.stringify({
      dbId: getDbId_() ? 'SET' : 'MISSING',
      googleClientId: getConfigValue_(config, 'GOOGLE_CLIENT_ID', '') ? 'SET' : 'MISSING',
      appExecUrl: getAppExecUrl_()
    })).setMimeType(ContentService.MimeType.JSON);
  }
  if (action === 'initImportToken') {
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
      var result = apiImportQuestions(params.questionsJson, '');
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(JSON.stringify({ _error: true, message: 'Unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ _error: true, message: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function setup_() {
  var id = getDbId_();
  if (!id) {
    var ss = SpreadsheetApp.create('Archi2ji_DB_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd'));
    setDbId_(ss.getId());
    Logger.log('Database created: ' + ss.getName() + ' ' + ss.getUrl());
  }
  Object.keys(SHEETS).forEach(function(k) { getSheet_(SHEETS[k]); });
  Logger.log('Setup complete');
}
