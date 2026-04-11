var __clientUserKey = '';

// Return year list with question counts for the home screen
function apiGetHome(clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    var qs = readRecords_(SHEETS.Questions);
    var grouped = {};
    qs.forEach(function(q) {
      if (!grouped[q.year]) grouped[q.year] = 0;
      grouped[q.year]++;
    });
    var years = Object.keys(grouped).sort().reverse();
    return toSerializable_({
      years: years.map(function(y) { return { year: y, count: grouped[y] }; })
    });
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

// Return question list for a given year (brief)
function apiGetQuestionsByYear(year, clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    var qs = readRecords_(SHEETS.Questions).filter(function(q) {
      return String(q.year) === String(year);
    });
    qs.sort(function(a, b) { return Number(a.number) - Number(b.number); });
    return toSerializable_(qs.map(function(q) {
      return {
        qId: q.qId,
        number: q.number,
        questionType: q.questionType,
        stemShort: String(q.stem).slice(0, 60)
      };
    }));
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

// Return full question + latest note for this user
function apiGetQuestion(qId, clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    var q = readRecords_(SHEETS.Questions).filter(function(r) { return r.qId === qId; })[0];
    if (!q) return { _error: true, message: '問題が見つかりません' };
    var notes = readRecords_(SHEETS.Notes).filter(function(n) {
      return n.qId === qId && n.userKey === (__clientUserKey || '');
    });
    var note = notes.length > 0 ? notes[notes.length - 1] : null;
    return toSerializable_({ question: q, note: note });
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

// Save (append) a note with self-score
function apiSaveNote(qId, note, selfScore, clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    var noteId = 'N_' + new Date().getTime();
    appendRow_(SHEETS.Notes, {
      noteId: noteId,
      userKey: __clientUserKey,
      qId: qId,
      note: note,
      selfScore: selfScore,
      createdAt: new Date()
    });
    return { success: true };
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

// Bulk import questions from JSON string (admin use)
function apiImportQuestions(questionsJson, clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    var qs = JSON.parse(questionsJson);
    var sh = getSheet_(SHEETS.Questions);
    var imported = 0;
    qs.forEach(function(q) {
      var qId = 'Q_' + q.year + '_' + q.questionNumber;
      sh.appendRow([
        qId,
        q.year,
        q.questionNumber,
        q.questionType || 'essay',
        q.stem || '',
        q.modelAnswer || '',
        (q.tags || []).join(','),
        new Date()
      ]);
      imported++;
    });
    return { success: true, imported: imported };
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}
