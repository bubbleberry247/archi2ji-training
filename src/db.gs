var SHEETS = {
  Config: 'Config',
  Users: 'Users',
  Questions: 'Questions',
  Notes: 'Notes'
};

var HEADERS = {};
HEADERS[SHEETS.Config]    = ['key', 'value'];
HEADERS[SHEETS.Users]     = ['userKey', 'email', 'displayName', 'recoveryCode', 'createdAt'];
HEADERS[SHEETS.Questions] = ['qId', 'year', 'number', 'questionType', 'stem', 'modelAnswer', 'tags', 'createdAt'];
HEADERS[SHEETS.Notes]     = ['noteId', 'userKey', 'qId', 'note', 'selfScore', 'createdAt'];

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
  }
  return sh;
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
