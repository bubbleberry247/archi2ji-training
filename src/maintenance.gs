// Owner-operated, one-off repair for the two official-PDF-verified R4 stems.
// Every function in this file is private (trailing underscore). Nothing here is
// routed from doPost or the browser client.

var R4_STEM_REPAIR_DEFINITIONS_ = [
  { qId: 'Q_R4_5', oldStemHash: '6d848507ef025a2272e26a79029bd85c338e9c0fd61ff0c594b52a1924f809d6', newStemHash: 'a334f0123c087c0d4bd330a5e811b90a39abc99d67cd7432f87f250e6f71f6f3' },
  { qId: 'Q_R4_6', oldStemHash: 'ae8d8131a4617ab27f063db26505b5ec0c59b21b4705b3d8a73c582b47d5bdf9', newStemHash: 'cbf98e2d96e7c43e5c45093ef0a24b635ef26cc111a3ccd919ce19a7fa11dcbd' }
];

var R4_Q5_REPAIR_TABLES_ = [
  [['30', '載荷係数', '2.0'], ['30', '沈下量', '2.0'], ['20', '載荷係数', '3.0'], ['20', '沈下量', '3.0'], ['30', '沈下量', '3.0']],
  [['平状', '水締め', '水平'], ['爪状', '水締め', '鉛直'], ['平状', '転圧', '水平'], ['爪状', '転圧', '水平'], ['平状', '転圧', '鉛直']],
  [['10', 'ハンマーグラブ', '沈殿バケット'], ['5', 'ハンマーグラブ', '沈殿バケット'], ['5', 'ドリリングバケット', '底ざらいバケット'], ['10', 'ドリリングバケット', '沈殿バケット'], ['5', 'ハンマーグラブ', '底ざらいバケット']],
  [['2', '酸化炎', '3'], ['2', '酸化炎', '2'], ['2', '中性炎', '2'], ['5', '中性炎', '2'], ['5', '酸化炎', '3']],
  [['大きく', '大きい', '大きい'], ['小さく', '小さい', '大きい'], ['大きく', '小さい', '大きい'], ['小さく', '大きい', '小さい'], ['大きく', '大きい', '小さい']],
  [['破断', '内側', '近接させる'], ['圧縮', '外側', '近接させる'], ['破断', '外側', '近接させる'], ['破断', '内側', '離す'], ['圧縮', '外側', '離す']],
  [['30', '90', '直後'], ['35', '120', '直前'], ['35', '90', '直後'], ['30', '90', '直前'], ['30', '120', '直後']],
  [['150', '2', '5'], ['150', '3', '15'], ['100', '2', '15'], ['100', '2', '5'], ['100', '3', '5']]
];

var R4_Q6_REPAIR_CHOICES_ = {
  '①': ['注文者', '発注者', '依頼者', '事業者', '受注者'],
  '②': ['20', '30', '40', '50', '60'],
  '③': ['3', '4', '5', '6', '7'],
  '④': ['3', '4', '5', '6', '7'],
  '⑤': ['破損', '損壊', '危険', '労働災害', '事故'],
  '⑥': ['教育', '技術', '施工', '作業', '安全']
};

function runR4ChoiceStemRepairDryRun_() {
  return logR4ChoiceStemRepairResult_(runR4ChoiceStemRepair_(false));
}

function runR4ChoiceStemRepairApply_() {
  return logR4ChoiceStemRepairResult_(runR4ChoiceStemRepair_(true));
}

function runR4ChoiceStemRepair_(apply) {
  assertR4StemRepairDefinitions_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var initial = readFixedR4StemRepairState_();
    assertR4StemRepairPairState_(initial);
    if (initial.state === 'already_applied') return buildR4StemRepairResult_(apply ? false : true, 0, 2, '');
    if (!apply) return buildR4StemRepairResult_(true, 2, 0, '');

    var backupId = createFixedR4StemRepairBackup_(initial);
    var prewrite = readFixedR4StemRepairState_();
    assertR4StemRepairPrewriteState_(initial, prewrite);
    try {
      executeFixedR4StemBatchUpdate_(prewrite.sheet, prewrite.items.map(function(item) {
        return { qId: item.qId, oldStem: item.oldStem, newStem: item.newStem };
      }), prewrite.stemColumn);
      SpreadsheetApp.flush();
      verifyFixedR4StemRepairWrite_(prewrite);
      return buildR4StemRepairResult_(false, 2, 0, backupId);
    } catch (writeError) {
      try {
        rollbackFixedR4StemRepair_(prewrite);
      } catch (rollbackError) {
        var rollbackFailure = makeR4StemRepairError_('ROLLBACK_FAILED');
        rollbackFailure.backupId = backupId;
        rollbackFailure.writeCode = String((writeError && writeError.code) || 'WRITE_FAILED');
        rollbackFailure.rollbackCode = String((rollbackError && rollbackError.code) || 'ROLLBACK_FAILED');
        rollbackFailure.message = 'ROLLBACK_FAILED backupId=' + backupId + ' writeCode=' + rollbackFailure.writeCode + ' rollbackCode=' + rollbackFailure.rollbackCode;
        throw rollbackFailure;
      }
      var writeFailure = makeR4StemRepairError_('WRITE_FAILED_ROLLED_BACK');
      writeFailure.backupId = backupId;
      writeFailure.writeCode = String((writeError && writeError.code) || 'WRITE_FAILED');
      writeFailure.message = 'WRITE_FAILED_ROLLED_BACK backupId=' + backupId + ' writeCode=' + writeFailure.writeCode;
      throw writeFailure;
    }
  } finally {
    lock.releaseLock();
  }
}

function assertR4StemRepairDefinitions_() {
  if (R4_STEM_REPAIR_DEFINITIONS_.length !== 2 ||
      R4_STEM_REPAIR_DEFINITIONS_[0].qId !== 'Q_R4_5' ||
      R4_STEM_REPAIR_DEFINITIONS_[1].qId !== 'Q_R4_6') {
    throw makeR4StemRepairError_('FIXED_TARGETS_INVALID');
  }
}

function readFixedR4StemRepairState_() {
  var sheet = getSheet_(SHEETS.Questions);
  var values = sheet.getDataRange().getValues();
  if (!values.length) throw makeR4StemRepairError_('QUESTIONS_SCHEMA_INVALID');
  var headers = values[0].map(function(value) { return String(value || '').trim(); });
  var qIdColumn = uniqueR4StemHeaderIndex_(headers, 'qId') + 1;
  var stemColumn = uniqueR4StemHeaderIndex_(headers, 'stem') + 1;
  var items = R4_STEM_REPAIR_DEFINITIONS_.map(function(definition) {
    var matches = [];
    for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
      if (String(values[rowIndex][qIdColumn - 1] || '').trim() === definition.qId) matches.push(rowIndex);
    }
    if (matches.length !== 1) throw makeR4StemRepairError_(matches.length ? 'DUPLICATE_LIVE_QID' : 'QID_NOT_FOUND');
    var index = matches[0];
    var row = values[index].slice();
    var stem = String(row[stemColumn - 1] || '');
    var currentHash = sha256Hex_(stem);
    var status = 'unexpected';
    var newStem = '';
    if (currentHash === definition.oldStemHash) {
      status = 'old';
      newStem = buildFixedR4NewStem_(definition.qId, stem);
      if (sha256Hex_(newStem) !== definition.newStemHash) throw makeR4StemRepairError_('GENERATED_NEW_HASH_MISMATCH');
    } else if (currentHash === definition.newStemHash) {
      status = 'new';
    }
    return {
      qId: definition.qId,
      rowNumber: index + 1,
      oldRow: row,
      oldStem: stem,
      oldStemHash: definition.oldStemHash,
      newStemHash: definition.newStemHash,
      currentStemHash: currentHash,
      newStem: newStem,
      status: status
    };
  });
  var statuses = items.map(function(item) { return item.status; }).join(',');
  var hashRows = {};
  R4_STEM_REPAIR_DEFINITIONS_.forEach(function(definition) {
    hashRows[definition.qId] = { oldRows: [], newRows: [] };
  });
  for (var scanIndex = 1; scanIndex < values.length; scanIndex++) {
    var scanHash = sha256Hex_(String(values[scanIndex][stemColumn - 1] || ''));
    R4_STEM_REPAIR_DEFINITIONS_.forEach(function(definition) {
      if (scanHash === definition.oldStemHash) hashRows[definition.qId].oldRows.push(scanIndex + 1);
      if (scanHash === definition.newStemHash) hashRows[definition.qId].newRows.push(scanIndex + 1);
    });
  }
  var readyCounts = items.every(function(item) {
    var rows = hashRows[item.qId];
    return item.status === 'old' && rows.oldRows.length === 1 && rows.oldRows[0] === item.rowNumber && rows.newRows.length === 0;
  });
  var appliedCounts = items.every(function(item) {
    var rows = hashRows[item.qId];
    return item.status === 'new' && rows.newRows.length === 1 && rows.newRows[0] === item.rowNumber && rows.oldRows.length === 0;
  });
  var state = statuses === 'old,old' && readyCounts ? 'ready' : (statuses === 'new,new' && appliedCounts ? 'already_applied' : 'invalid');
  return { sheet: sheet, headers: headers, values: values, qIdColumn: qIdColumn, stemColumn: stemColumn, items: items, hashRows: hashRows, state: state };
}

function assertR4StemRepairPairState_(state) {
  if (state.items.length !== 2) throw makeR4StemRepairError_('FIXED_TARGETS_INVALID');
  if (state.state === 'invalid') {
    var hasUnexpected = state.items.some(function(item) { return item.status === 'unexpected'; });
    if (hasUnexpected) throw makeR4StemRepairError_('OLD_HASH_MISMATCH');
    var statuses = state.items.map(function(item) { return item.status; }).join(',');
    throw makeR4StemRepairError_(statuses === 'old,new' || statuses === 'new,old' ? 'MIXED_PAIR_STATE' : 'STEM_OCCURRENCE_INVALID');
  }
  mapR4QuestionRowsByQId_(state);
}

function assertR4StemRepairPrewriteState_(initial, prewrite) {
  if (prewrite.state !== 'ready') throw makeR4StemRepairError_('PREWRITE_STATE_CHANGED');
  if (stableR4StemRepairValue_(prewrite.headers) !== stableR4StemRepairValue_(initial.headers)) throw makeR4StemRepairError_('PREWRITE_SCHEMA_CHANGED');
  assertAllR4QuestionRowsUnchangedExceptTargets_(initial, prewrite);
  for (var i = 0; i < initial.items.length; i++) {
    var before = initial.items[i];
    var current = prewrite.items.filter(function(item) { return item.qId === before.qId; });
    if (current.length !== 1 || stableR4StemRepairValue_(current[0].oldRow) !== stableR4StemRepairValue_(before.oldRow)) throw makeR4StemRepairError_('PREWRITE_STATE_CHANGED');
  }
}

function createFixedR4StemRepairBackup_(state) {
  var backupId = 'r4-stem-' + Utilities.getUuid();
  var createdAt = new Date().toISOString();
  var operatorHash = sha256Hex_(String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase());
  var sheet = getSheet_(SHEETS.QuestionStemBackups);
  var backupValues = sheet.getDataRange().getValues();
  var headers = backupValues[0].map(function(value) { return String(value || '').trim(); });
  var requiredHeaders = HEADERS[SHEETS.QuestionStemBackups];
  for (var i = 0; i < requiredHeaders.length; i++) uniqueR4StemHeaderIndex_(headers, requiredHeaders[i]);
  var rows = state.items.map(function(item) {
    var record = {
      backupId: backupId,
      createdAt: createdAt,
      operatorHash: operatorHash,
      qId: item.qId,
      rowNumber: item.rowNumber,
      headersJson: JSON.stringify(state.headers),
      rowValuesJson: JSON.stringify(toSerializable_(item.oldRow)),
      oldStemHash: item.oldStemHash,
      newStemHash: item.newStemHash
    };
    return headers.map(function(header) { return record[header] !== undefined ? record[header] : ''; });
  });
  try {
    sheet.getRange(sheet.getLastRow() + 1, 1, 2, headers.length).setValues(rows);
    SpreadsheetApp.flush();
    verifyFixedR4StemRepairBackup_(sheet, backupId, state.items);
  } catch (error) {
    throw makeR4StemRepairError_('BACKUP_FAILED');
  }
  return backupId;
}

function verifyFixedR4StemRepairBackup_(sheet, backupId, items) {
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function(value) { return String(value || '').trim(); });
  var backupIdIndex = uniqueR4StemHeaderIndex_(headers, 'backupId');
  var qIdIndex = uniqueR4StemHeaderIndex_(headers, 'qId');
  var oldHashIndex = uniqueR4StemHeaderIndex_(headers, 'oldStemHash');
  var newHashIndex = uniqueR4StemHeaderIndex_(headers, 'newStemHash');
  var rowJsonIndex = uniqueR4StemHeaderIndex_(headers, 'rowValuesJson');
  var matches = values.slice(1).filter(function(row) { return String(row[backupIdIndex] || '') === backupId; });
  if (matches.length !== 2 || items.length !== 2) throw makeR4StemRepairError_('BACKUP_VERIFY_FAILED');
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var rows = matches.filter(function(row) { return String(row[qIdIndex] || '') === item.qId; });
    if (rows.length !== 1 || String(rows[0][oldHashIndex] || '') !== item.oldStemHash || String(rows[0][newHashIndex] || '') !== item.newStemHash || String(rows[0][rowJsonIndex] || '') !== JSON.stringify(toSerializable_(item.oldRow))) throw makeR4StemRepairError_('BACKUP_VERIFY_FAILED');
  }
}

function executeFixedR4StemBatchUpdate_(sheet, updates, stemColumn) {
  if (!updates || updates.length !== 2) throw makeR4StemRepairError_('FORWARD_BATCH_SIZE_INVALID');
  var sheetId = sheet.getSheetId();
  var requests = updates.map(function(update) {
    return buildR4StemFindReplaceRequest_(sheetId, stemColumn, update.oldStem, update.newStem);
  });
  var response = sendR4StemSheetsBatchUpdate_(requests);
  assertR4StemFindReplaceResponse_(response, 2);
}

function buildR4StemFindReplaceRequest_(sheetId, stemColumn, findText, replacementText) {
  return {
    findReplace: {
      find: findText,
      replacement: replacementText,
      matchCase: true,
      matchEntireCell: true,
      searchByRegex: false,
      range: { sheetId: sheetId, startColumnIndex: stemColumn - 1, endColumnIndex: stemColumn }
    }
  };
}

function sendR4StemSheetsBatchUpdate_(requests) {
  var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(getDbId_()) + ':batchUpdate';
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ requests: requests }),
    muteHttpExceptions: true
  });
  var status = Number(response.getResponseCode());
  if (status < 200 || status >= 300) throw makeR4StemRepairError_('BATCH_UPDATE_FAILED');
  try {
    return JSON.parse(String(response.getContentText() || '{}'));
  } catch (error) {
    throw makeR4StemRepairError_('BATCH_RESPONSE_INVALID');
  }
}

function assertR4StemFindReplaceResponse_(response, expectedCount) {
  var replies = response && Array.isArray(response.replies) ? response.replies : [];
  if (replies.length !== expectedCount) throw makeR4StemRepairError_('BATCH_RESPONSE_INVALID');
  for (var i = 0; i < replies.length; i++) {
    var count = Number(replies[i] && replies[i].findReplace && replies[i].findReplace.occurrencesChanged);
    if (count !== 1) throw makeR4StemRepairError_('OCCURRENCE_COUNT_INVALID');
  }
}

function verifyFixedR4StemRepairWrite_(prewrite) {
  var current = readFixedR4StemRepairState_();
  if (current.state !== 'already_applied') throw makeR4StemRepairError_('WRITE_VERIFY_FAILED');
  assertAllR4QuestionRowsUnchangedExceptTargets_(prewrite, current);
  for (var i = 0; i < prewrite.items.length; i++) {
    var before = prewrite.items[i];
    var after = current.items.filter(function(item) { return item.qId === before.qId; });
    if (after.length !== 1) throw makeR4StemRepairError_('WRITE_VERIFY_FAILED');
    assertR4StemRepairNonStemUnchanged_(before.oldRow, after[0].oldRow, prewrite.stemColumn);
  }
}

function rollbackFixedR4StemRepair_(prewrite) {
  var current = readFixedR4StemRepairState_();
  if (current.state !== 'already_applied') throw makeR4StemRepairError_('ROLLBACK_STATE_UNSAFE');
  var requests = [];
  for (var i = 0; i < prewrite.items.length; i++) {
    var original = prewrite.items[i];
    var matches = current.items.filter(function(item) { return item.qId === original.qId; });
    if (matches.length !== 1) throw makeR4StemRepairError_('ROLLBACK_QID_INVALID');
    var live = matches[0];
    if (live.currentStemHash !== original.newStemHash) throw makeR4StemRepairError_('ROLLBACK_STATE_UNSAFE');
    requests.push(buildR4StemFindReplaceRequest_(current.sheet.getSheetId(), current.stemColumn, original.newStem, original.oldStem));
  }
  var response = sendR4StemSheetsBatchUpdate_(requests);
  assertR4StemFindReplaceResponse_(response, 2);
  SpreadsheetApp.flush();
  var restored = readFixedR4StemRepairState_();
  if (restored.state !== 'ready') throw makeR4StemRepairError_('ROLLBACK_VERIFY_FAILED');
  assertAllR4QuestionRowsUnchangedExceptTargets_(prewrite, restored);
  for (var j = 0; j < prewrite.items.length; j++) {
    var before = prewrite.items[j];
    var after = restored.items.filter(function(item) { return item.qId === before.qId; });
    if (after.length !== 1 || stableR4StemRepairValue_(after[0].oldRow) !== stableR4StemRepairValue_(before.oldRow)) throw makeR4StemRepairError_('ROLLBACK_VERIFY_FAILED');
  }
}

function assertAllR4QuestionRowsUnchangedExceptTargets_(beforeState, afterState) {
  if (stableR4StemRepairValue_(beforeState.headers) !== stableR4StemRepairValue_(afterState.headers)) throw makeR4StemRepairError_('NON_STEM_CHANGED');
  var beforeRows = mapR4QuestionRowsByQId_(beforeState);
  var afterRows = mapR4QuestionRowsByQId_(afterState);
  var beforeIds = Object.keys(beforeRows).sort();
  var afterIds = Object.keys(afterRows).sort();
  if (stableR4StemRepairValue_(beforeIds) !== stableR4StemRepairValue_(afterIds)) throw makeR4StemRepairError_('NON_STEM_CHANGED');
  var targets = { Q_R4_5: true, Q_R4_6: true };
  for (var i = 0; i < beforeIds.length; i++) {
    var qId = beforeIds[i];
    assertR4StemRepairNonStemUnchanged_(beforeRows[qId], afterRows[qId], beforeState.stemColumn);
    if (!targets[qId] && stableR4StemRepairValue_(beforeRows[qId][beforeState.stemColumn - 1]) !== stableR4StemRepairValue_(afterRows[qId][afterState.stemColumn - 1])) {
      throw makeR4StemRepairError_('NON_TARGET_STEM_CHANGED');
    }
  }
}

function mapR4QuestionRowsByQId_(state) {
  var out = {};
  for (var rowIndex = 1; rowIndex < state.values.length; rowIndex++) {
    var row = state.values[rowIndex];
    var qId = String(row[state.qIdColumn - 1] || '').trim();
    var hasValue = row.some(function(value) { return value !== '' && value !== null && value !== undefined; });
    if (!qId) {
      if (hasValue) throw makeR4StemRepairError_('QUESTION_ROW_WITHOUT_QID');
      continue;
    }
    if (out[qId]) throw makeR4StemRepairError_('DUPLICATE_LIVE_QID');
    out[qId] = row.slice();
  }
  return out;
}

function assertR4StemRepairNonStemUnchanged_(before, after, stemColumn) {
  if (!before || !after || before.length !== after.length) throw makeR4StemRepairError_('NON_STEM_CHANGED');
  for (var col = 0; col < before.length; col++) {
    if (col === stemColumn - 1) continue;
    if (stableR4StemRepairValue_(before[col]) !== stableR4StemRepairValue_(after[col])) throw makeR4StemRepairError_('NON_STEM_CHANGED');
  }
}

function buildFixedR4NewStem_(qId, oldStem) {
  if (qId === 'Q_R4_5') return buildFixedR4Q5Stem_(oldStem);
  if (qId === 'Q_R4_6') return buildFixedR4Q6Stem_(oldStem);
  throw makeR4StemRepairError_('FIXED_TARGETS_INVALID');
}

function buildFixedR4Q5Stem_(oldStem) {
  var lines = String(oldStem || '').split('\n');
  var headerIndexes = [];
  for (var i = 0; i < lines.length; i++) if (lines[i] === 'ａｂｃ') headerIndexes.push(i);
  if (headerIndexes.length !== 8) throw makeR4StemRepairError_('SOURCE_LAYOUT_MISMATCH');
  for (var tableIndex = 7; tableIndex >= 0; tableIndex--) {
    var headerIndex = headerIndexes[tableIndex];
    var rows = lines.slice(headerIndex + 1, headerIndex + 6);
    if (rows.length !== 5) throw makeR4StemRepairError_('SOURCE_LAYOUT_MISMATCH');
    var formatted = [];
    for (var rowIndex = 0; rowIndex < 5; rowIndex++) {
      var expected = R4_Q5_REPAIR_TABLES_[tableIndex][rowIndex];
      if (compactR4StemText_(rows[rowIndex]) !== compactR4StemText_(expected.join(''))) throw makeR4StemRepairError_('SOURCE_LAYOUT_MISMATCH');
      formatted.push(String.fromCharCode(0x2460 + rowIndex) + ' ' + expected.join(' ／ '));
    }
    lines.splice.apply(lines, [headerIndex + 1, 5].concat(formatted));
  }
  return lines.join('\n');
}

function buildFixedR4Q6Stem_(oldStem) {
  var lines = String(oldStem || '').split('\n');
  Object.keys(R4_Q6_REPAIR_CHOICES_).forEach(function(key) {
    var values = R4_Q6_REPAIR_CHOICES_[key];
    var matches = [];
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf(key) === 0 && compactR4StemText_(lines[i].slice(key.length)) === compactR4StemText_(values.join(''))) matches.push(i);
    }
    if (matches.length !== 1) throw makeR4StemRepairError_('SOURCE_LAYOUT_MISMATCH');
    lines[matches[0]] = key + ' ' + values.join(' ／ ');
  });
  return lines.join('\n');
}

function compactR4StemText_(value) {
  return String(value || '').replace(/\s+/g, '');
}

function uniqueR4StemHeaderIndex_(headers, name) {
  var indexes = [];
  for (var i = 0; i < headers.length; i++) if (headers[i] === name) indexes.push(i);
  if (indexes.length !== 1) throw makeR4StemRepairError_('SCHEMA_INVALID');
  return indexes[0];
}

function stableR4StemRepairValue_(value) {
  return JSON.stringify(toSerializable_(value));
}

function buildR4StemRepairResult_(dryRun, wouldUpdate, alreadyApplied, backupId) {
  return {
    ok: true,
    dryRun: dryRun,
    targetCount: 2,
    wouldUpdate: wouldUpdate,
    updated: dryRun ? 0 : wouldUpdate,
    alreadyApplied: alreadyApplied,
    backupId: String(backupId || ''),
    hashes: R4_STEM_REPAIR_DEFINITIONS_.map(function(item) { return { qId: item.qId, oldStemHash: item.oldStemHash, newStemHash: item.newStemHash }; })
  };
}

function logR4ChoiceStemRepairResult_(result) {
  console.log(JSON.stringify(result));
  return result;
}

function makeR4StemRepairError_(code) {
  var error = new Error(String(code || 'R4_STEM_REPAIR_FAILED'));
  error.code = String(code || 'R4_STEM_REPAIR_FAILED');
  return error;
}
