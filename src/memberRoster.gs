function getCanonicalMembers_() {
  return [
    { email: 'y.shinjo.tscg@gmail.com',     role: 'user',  displayName: '新城雄一朗' },
    { email: 'h.kakegawa.tscg@gmail.com',   role: 'user',  displayName: '掛川晴喜' },
    { email: 'r.yokoi.tscg@gmail.com',      role: 'user',  displayName: '横井稜' },
    { email: 'y.isoda.tscg@gmail.com',      role: 'user',  displayName: '磯田百合香' },
    { email: 'k.fukushima.tscg@gmail.com',  role: 'user',  displayName: '福島楓' },
    { email: 'm.terada.tscg@gmail.com',     role: 'user',  displayName: '寺田征弘' },
    { email: 'm.inagaki.tscg@gmail.com',    role: 'user',  displayName: '稲垣誠' },
    { email: 'i.suzuki.tscg@gmail.com',     role: 'user',  displayName: '鈴木勲' },
    { email: 'y.nagasaki.tscg@gmail.com',   role: 'user',  displayName: '長崎豊' },
    { email: 'i.matumura.tscg@gmail.com',   role: 'user',  displayName: '松村巌' },
    { email: 't.masuhara.tscg@gmail.com',   role: 'user',  displayName: '増原卓也' },
    { email: 'm.koshima.tscg@gmail.com',    role: 'user',  displayName: '河島正典' },
    { email: 'a.seto.tscg@gmail.com',       role: 'user',  displayName: '瀬戸阿紀子' },
    { email: 'e.morikami.tscg@gmail.com',   role: 'user',  displayName: '森上栄介' },
    { email: 'm.yano.tscg@gmail.com',       role: 'user',  displayName: '矢野将也' },
    { email: 'k.anraku.tscg@gmail.com',     role: 'user',  displayName: '安樂洸介' },
    { email: 's.ishihara.tscg@gmail.com',   role: 'user',  displayName: '石原駿太朗' },
    { email: 't.yasui.tscg@gmail.com',      role: 'user',  displayName: '安井智紀' },
    { email: 'h.kondo.tscg@gmail.com',      role: 'user',  displayName: '近藤秀夫' },
    { email: 't.kitamura.tscg@gmail.com',   role: 'admin', displayName: '北村健' },
    { email: 'm.tsuji.tscg@gmail.com',      role: 'admin', displayName: '辻雅幸' },
    { email: 'y.otomori.tscg@gmail.com',    role: 'admin', displayName: '乙守陽介' },
    { email: 'k.fukuoka.tscg@gmail.com',    role: 'admin', displayName: '福岡健治' },
    { email: 'y.minamiwaki.tscg@gmail.com', role: 'admin', displayName: '南脇祐輔' },
    { email: 'a.furukawa.tscg@gmail.com',   role: 'admin', displayName: '古川あかね' },
    { email: 'm.fujita.tscg@gmail.com',     role: 'admin', displayName: '藤田美和' },
    { email: 'kalimistk@gmail.com',         role: 'admin', displayName: '開発者', showInDashboard: false }
  ];
}

function normalizeUserAccessBoolean_(value, defaultValue) {
  if (value === true || value === false) return value ? 'true' : 'false';
  var raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw) return defaultValue ? 'true' : 'false';
  return (raw === 'false' || raw === '0' || raw === 'no') ? 'false' : 'true';
}

function normalizeRosterHeader_(h) {
  return String(h || '').trim().replace(/^\uFEFF/, '');
}

function readRecordsFromSheet_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  var headers = values[0].map(normalizeRosterHeader_);
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = values[r][c];
    rows.push(obj);
  }
  return rows;
}

function getCanonicalMemberMap_() {
  var map = {};
  getCanonicalMembers_().forEach(function(member) {
    var email = String(member.email || '').trim().toLowerCase();
    if (!email) return;
    map[email] = {
      email: email,
      role: String(member.role || 'user').trim().toLowerCase(),
      displayName: String(member.displayName || '').trim(),
      showInDashboard: normalizeUserAccessBoolean_(member.showInDashboard, true) !== 'false'
    };
  });
  return map;
}

function ensureUserAccessDashboardSchema_(sheet) {
  var headers = HEADERS[SHEETS.UserAccess];
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
}

function generateRosterRecoveryCode_() {
  return String(Utilities.getUuid()).replace(/-/g, '').slice(0, 12);
}

function syncDashboardRoster(clientUserKey) {
  requireAdmin_(clientUserKey);
  return syncDashboardRosterForCurrentApp_();
}

function syncDashboardRosterForCurrentApp_() {
  var nowText = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  var ss = getDb_();
  return {
    status: 'ok',
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    userAccess: syncUserAccessRosterForSpreadsheet_(ss, nowText),
    users: syncUsersRosterForSpreadsheet_(ss)
  };
}

function syncUserAccessRosterForSpreadsheet_(ss, nowText) {
  var sh = ss.getSheetByName(SHEETS.UserAccess);
  if (!sh) sh = ss.insertSheet(SHEETS.UserAccess);
  ensureUserAccessDashboardSchema_(sh);

  var rows = readRecordsFromSheet_(sh);
  var canonical = getCanonicalMembers_();
  var canonicalMap = getCanonicalMemberMap_();
  var primaryByEmail = {};
  var hiddenRows = [];

  rows.forEach(function(row) {
    var email = String(row.email || '').trim().toLowerCase();
    if (!email) return;
    var normalized = {
      email: email,
      role: String(row.role || '').trim().toLowerCase() || 'user',
      managerEmail: String(row.managerEmail || '').trim(),
      active: normalizeUserAccessBoolean_(row.active, true),
      updatedAt: String(row.updatedAt || '').trim(),
      displayName: String(row.displayName || '').trim(),
      showInDashboard: normalizeUserAccessBoolean_(row.showInDashboard, true)
    };
    if (canonicalMap[email] && !primaryByEmail[email]) {
      primaryByEmail[email] = normalized;
    } else {
      hiddenRows.push(normalized);
    }
  });

  var finalRows = [];
  var insertedCanonical = 0;
  canonical.forEach(function(member) {
    var email = String(member.email || '').trim().toLowerCase();
    var existing = primaryByEmail[email];
    if (!existing) insertedCanonical += 1;
    finalRows.push([
      email,
      String(member.role || (existing && existing.role) || 'user').trim().toLowerCase(),
      existing ? String(existing.managerEmail || '').trim() : '',
      'true',
      nowText,
      String(member.displayName || '').trim(),
      normalizeUserAccessBoolean_(member.showInDashboard, true)
    ]);
  });

  hiddenRows.forEach(function(row) {
    var fallback = canonicalMap[row.email];
    finalRows.push([
      row.email,
      row.role || (fallback ? fallback.role : 'user'),
      row.managerEmail || '',
      'false',
      nowText,
      row.displayName || (fallback ? fallback.displayName : row.email),
      'false'
    ]);
  });

  var clearCols = Math.max(sh.getLastColumn(), HEADERS[SHEETS.UserAccess].length);
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, clearCols).clearContent();
  }
  if (finalRows.length > 0) {
    sh.getRange(2, 1, finalRows.length, HEADERS[SHEETS.UserAccess].length).setValues(finalRows);
  }

  return {
    canonicalCount: canonical.length,
    insertedCanonical: insertedCanonical,
    hiddenCount: hiddenRows.length,
    totalRowsWritten: finalRows.length
  };
}

function syncUsersRosterForSpreadsheet_(ss) {
  var userSh = ss.getSheetByName(SHEETS.Users);
  var uaSh = ss.getSheetByName(SHEETS.UserAccess);
  if (!uaSh) return { inserted: 0, updated: 0, totalRows: 0 };
  if (!userSh) {
    userSh = ss.insertSheet(SHEETS.Users);
    userSh.getRange(1, 1, 1, HEADERS[SHEETS.Users].length).setValues([HEADERS[SHEETS.Users]]);
    userSh.setFrozenRows(1);
  }

  var canonicalMap = getCanonicalMemberMap_();
  var desiredByEmail = {};
  readRecordsFromSheet_(uaSh).forEach(function(row) {
    var email = String(row.email || '').trim().toLowerCase();
    if (!email || !canonicalMap[email]) return;
    if (normalizeUserAccessBoolean_(row.active, true) === 'false') return;
    desiredByEmail[email] = {
      email: email,
      displayName: String(row.displayName || canonicalMap[email].displayName || '').trim()
    };
  });

  var values = userSh.getDataRange().getValues();
  if (values.length < 1) {
    values = [HEADERS[SHEETS.Users]];
    userSh.getRange(1, 1, 1, HEADERS[SHEETS.Users].length).setValues([HEADERS[SHEETS.Users]]);
  }
  var headers = values[0].map(normalizeRosterHeader_);
  if (!headers.length || headers.indexOf('email') < 0) {
    headers = HEADERS[SHEETS.Users];
    userSh.clear();
    userSh.getRange(1, 1, 1, headers.length).setValues([headers]);
    userSh.setFrozenRows(1);
    values = [headers];
  }

  var emailIdx = headers.indexOf('email');
  var displayNameIdx = headers.indexOf('displayName');

  var seen = {};
  var updated = 0;
  for (var i = 1; i < values.length; i++) {
    var email = String(values[i][emailIdx] || '').trim().toLowerCase();
    if (!email) continue;
    seen[email] = true;
    var desired = desiredByEmail[email];
    if (desired && displayNameIdx >= 0 && desired.displayName && String(values[i][displayNameIdx] || '') !== desired.displayName) {
      values[i][displayNameIdx] = desired.displayName;
      updated += 1;
    }
  }

  if (updated > 0) {
    userSh.getRange(2, 1, values.length - 1, values[0].length).setValues(values.slice(1));
  }

  var rowsToAppend = [];
  Object.keys(desiredByEmail).forEach(function(email) {
    if (seen[email]) return;
    var desired = desiredByEmail[email];
    var row = headers.map(function(h) {
      if (h === 'userKey') return email;
      if (h === 'email') return email;
      if (h === 'displayName') return desired.displayName;
      if (h === 'recoveryCode') return generateRosterRecoveryCode_();
      if (h === 'createdAt') return new Date().toISOString();
      return '';
    });
    rowsToAppend.push(row);
  });
  if (rowsToAppend.length) {
    userSh.getRange(userSh.getLastRow() + 1, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);
  }

  return { inserted: rowsToAppend.length, updated: updated, totalRows: values.length - 1 + rowsToAppend.length };
}
