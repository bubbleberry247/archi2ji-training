// auth.gs — Google OAuth 2.0 認可コードフロー（UserAccess ホワイトリストあり）

var APP_TITLE_ = '建築2次 過去問学習';

function getAppExecUrl_() {
  try {
    var deployUrl = ScriptApp.getService().getUrl();
    if (deployUrl) return deployUrl;
  } catch (e) {}
  try {
    var config = getConfigMap_();
    return getConfigValue_(config, 'APP_EXEC_URL', '');
  } catch (e) {}
  return '';
}

function apiGetGoogleClientId() {
  try {
    var config = getConfigMap_();
    return getConfigValue_(config, 'GOOGLE_CLIENT_ID', '');
  } catch (e) { return ''; }
}

function getOAuthStartUrl_() {
  var config = getConfigMap_();
  var clientId = getConfigValue_(config, 'GOOGLE_CLIENT_ID', '');
  if (!clientId) return '';
  var redirectUri = getAppExecUrl_();
  var state = Utilities.getUuid();
  var nonce = Utilities.getUuid();
  var cache = CacheService.getScriptCache();
  cache.put('oauth_state_' + state, nonce, 300);
  return 'https://accounts.google.com/o/oauth2/v2/auth?'
    + 'client_id=' + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&response_type=code'
    + '&scope=' + encodeURIComponent('openid email profile')
    + '&state=' + encodeURIComponent(state)
    + '&nonce=' + encodeURIComponent(nonce)
    + '&prompt=select_account';
}

function generateOAuthStartPage_() {
  var authUrl = getOAuthStartUrl_();
  var execUrl = getAppExecUrl_();
  if (!authUrl) {
    return errorPage_('GOOGLE_CLIENT_ID が設定されていません。管理者にお問い合わせください。');
  }
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>ログイン</title></head>'
    + '<body style="display:flex;justify-content:center;align-items:center;'
    + 'min-height:80vh;font-family:sans-serif;margin:0;padding:16px;background:#f5f4f0">'
    + '<div style="text-align:center;max-width:400px">'
    + '<div style="font-size:2.5rem;margin-bottom:16px">&#128274;</div>'
    + '<div style="font-size:1.1rem;font-weight:700;margin-bottom:8px;color:#1a1916">'
    + 'Googleアカウントでログイン</div>'
    + '<div style="font-size:0.85rem;color:#6b6560;margin-bottom:24px;line-height:1.5">'
    + 'Googleのログイン画面に移動します。</div>'
    + '<a target="_top" href="' + authUrl + '" '
    + 'style="display:inline-flex;align-items:center;gap:8px;padding:10px 24px;'
    + 'border:1px solid #dadce0;border-radius:4px;background:#fff;font-size:14px;'
    + 'cursor:pointer;font-family:Roboto,sans-serif;text-decoration:none;color:#3c4043">'
    + '<img src="https://developers.google.com/identity/images/g-logo.png" '
    + 'width="18" height="18" alt="">Googleアカウントに進む</a>'
    + '<div style="margin-top:16px">'
    + '<a href="' + execUrl + '" target="_top" '
    + 'style="color:#5c4f3d;font-size:0.8rem;text-decoration:none">&#8592; 戻る</a>'
    + '</div></div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('ログイン')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function toSafeTemplateJson_(value) {
  return JSON.stringify(value)
    .replace(/</g, String.fromCharCode(92) + 'u003c')
    .replace(/>/g, String.fromCharCode(92) + 'u003e')
    .replace(/&/g, String.fromCharCode(92) + 'u0026')
    .replace(/\u2028/g, String.fromCharCode(92) + 'u2028')
    .replace(/\u2029/g, String.fromCharCode(92) + 'u2029');
}

function handleOAuthCallback_(code, state) {
  try {
    var cache = CacheService.getScriptCache();
    var expectedNonce = cache.get('oauth_state_' + state);
    if (!expectedNonce) {
      var wasDone = cache.get('oauth_done_' + state);
      if (wasDone) {
        // リロード後のフォールバック: ログイン画面に戻す
        return serveSpa_('');
      }
      return errorPage_('認証エラー: リクエストが無効または期限切れです。再度ログインしてください。');
    }
    cache.remove('oauth_state_' + state);

    var config = getConfigMap_();
    var clientId = getConfigValue_(config, 'GOOGLE_CLIENT_ID', '');
    var clientSecret = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_SECRET');
    var redirectUri = getAppExecUrl_();

    // Authorization code → tokens
    var tokenResp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      payload: {
        code: code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      },
      muteHttpExceptions: true
    });

    if (tokenResp.getResponseCode() !== 200) {
      Logger.log('[AUTH] token_exchange error: ' + tokenResp.getResponseCode() + ' ' + tokenResp.getContentText());
      return errorPage_('トークン取得に失敗しました (HTTP ' + tokenResp.getResponseCode() + ')');
    }

    var tokens = JSON.parse(tokenResp.getContentText());
    var idToken = tokens.id_token;
    if (!idToken) {
      return errorPage_('ID Tokenが取得できませんでした');
    }

    // Verify ID token
    var verifyResp = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (verifyResp.getResponseCode() !== 200) {
      return errorPage_('トークン検証に失敗しました');
    }

    var payload = JSON.parse(verifyResp.getContentText());
    var email = String(payload.email || '').trim().toLowerCase();
    var name = String(payload.name || payload.given_name || '').trim() || email.split('@')[0];

    if (!email) {
      return errorPage_('Googleアカウントからメールアドレスを取得できませんでした');
    }

    ensureScriptOwnerInUserAccess_();

    // Nonce check (CSRF防御)
    var idPayload = JSON.parse(
      Utilities.newBlob(
        Utilities.base64DecodeWebSafe(idToken.split('.')[1])
      ).getDataAsString()
    );
    if (idPayload.nonce !== expectedNonce) {
      Logger.log('[AUTH] nonce mismatch: expected=' + expectedNonce + ' got=' + idPayload.nonce);
      return errorPage_('認証エラー: nonce が一致しません');
    }

    cache.put('oauth_done_' + state, '1', 300);

    var access = getUserAccessByEmail_(email);
    if (!access || !access.active) {
      Logger.log('[AUTH] blocked: email=' + email);
      return errorPage_('このアカウントは登録されていません。管理者にお問い合わせください。');
    }

    // Upsert user record
    var displayName = access.displayName || name;
    var user = ensureUser_(email, email, displayName);

    var authResult = {
      userKey: user.userKey,
      displayName: displayName,
      email: email,
      role: access.role || 'user',
      isAdmin: access.role === 'admin',
      isManager: access.role === 'admin' || access.role === 'manager'
    };

    Logger.log('[AUTH] success: email=' + email);
    return serveSpa_(authResult);
  } catch (e) {
    Logger.log('[AUTH] callback_error: ' + String(e.message || e));
    return errorPage_('認証処理中にエラーが発生しました。しばらくしてから再度お試しください。');
  }
}

function serveSpa_(authResult) {
  var template = HtmlService.createTemplateFromFile('index');
  var hasAuth = authResult && typeof authResult === 'object' && authResult.userKey;
  template.serverAuthResult = hasAuth ? toSafeTemplateJson_(authResult) : '';
  template.appExecUrl = toSafeTemplateJson_(getAppExecUrl_());
  return template.evaluate()
    .setTitle(APP_TITLE_)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function errorPage_(message) {
  var url = getAppExecUrl_();
  var safe = String(message || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + '<body style="font-family:sans-serif;padding:24px;background:#f5f4f0">'
    + '<p style="color:#7c4a4a">' + safe + '</p>'
    + '<p><a href="' + url + '" target="_top" style="color:#5c4f3d">トップへ戻る</a></p>'
    + '</body></html>'
  ).setTitle('エラー').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function ensureUser_(userKey, email, displayName) {
  if (!userKey) return null;
  var users = readRecords_(SHEETS.Users);
  var existing = users.filter(function(u) { return u.userKey === userKey; })[0];
  if (existing) {
    if (displayName && existing.displayName !== displayName) {
      var sh = getSheet_(SHEETS.Users);
      var values = sh.getDataRange().getValues();
      var headers = values[0];
      var dnCol = headers.indexOf('displayName');
      var keyCol = headers.indexOf('userKey');
      if (dnCol >= 0 && keyCol >= 0) {
        for (var i = 1; i < values.length; i++) {
          if (String(values[i][keyCol]) === String(userKey)) {
            sh.getRange(i + 1, dnCol + 1).setValue(displayName);
            existing.displayName = displayName;
            break;
          }
        }
      }
    }
    return existing;
  }
  var newUser = {
    userKey: userKey,
    email: email || '',
    displayName: displayName || userKey.slice(0, 8),
    recoveryCode: generateRecoveryCode_(),
    createdAt: new Date()
  };
  appendRow_(SHEETS.Users, newUser);
  return newUser;
}

function generateRecoveryCode_() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  var users = readRecords_(SHEETS.Users);
  var used = users.map(function(u) { return u.recoveryCode; });
  if (used.indexOf(code) !== -1) return generateRecoveryCode_();
  return code;
}
