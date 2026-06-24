var __clientUserKey = '';
var ARCHI2JI_PROGRAM_START_DATE_ = '2026-07-01';
var ARCHI2JI_EXAM_DATE_ = '2026-10-18';

function parseArchiMiniDateUtc_(value) {
  var m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function getArchiMiniTodayUtc_() {
  var now = new Date();
  var jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
}

function weeksSinceArchiMiniStart_() {
  var startUtc = parseArchiMiniDateUtc_(ARCHI2JI_PROGRAM_START_DATE_);
  if (startUtc === null) return -1;
  var days = Math.floor((getArchiMiniTodayUtc_() - startUtc) / 86400000);
  if (days < 0) return -1;
  return Math.floor(days / 7);
}

function formatArchiMiniDateRange_(unlockWeek) {
  var startUtc = parseArchiMiniDateUtc_(ARCHI2JI_PROGRAM_START_DATE_);
  if (startUtc === null) return '';
  var weekStart = startUtc + Number(unlockWeek || 0) * 7 * 86400000;
  var weekEnd = weekStart + 6 * 86400000;
  var examUtc = parseArchiMiniDateUtc_(ARCHI2JI_EXAM_DATE_);
  if (examUtc !== null && weekEnd >= examUtc) weekEnd = examUtc - 86400000;
  var s = new Date(weekStart);
  var e = new Date(weekEnd);
  return (s.getUTCMonth() + 1) + '月' + s.getUTCDate() + '日〜' +
    (e.getUTCMonth() + 1) + '月' + e.getUTCDate() + '日';
}

function buildArchiMiniPlan_() {
  var years = ['R7', 'R6', 'R5', 'R4', 'R3'];
  var rows = [];
  var idx = 1;
  years.forEach(function(year) {
    for (var from = 1; from <= 6; from += 2) {
      var to = from + 1;
      var unlockWeek = idx - 1;
      rows.push({
        testIndex: idx,
        label: '第' + idx + '回 ' + year + ' 問' + from + '〜' + to,
        key: 'range:' + year + ':' + from + '-' + to,
        questionsPerTest: 2,
        unlockWeek: unlockWeek,
        recommended: false,
        dateRange: formatArchiMiniDateRange_(unlockWeek)
      });
      idx++;
    }
  });
  return rows;
}

function markArchiMiniPlanForThisWeek_(plan) {
  var week = weeksSinceArchiMiniStart_();
  var matched = false;
  plan.forEach(function(item) {
    item.recommended = Number(item.unlockWeek) === week;
    if (item.recommended) matched = true;
  });
  if (!matched && week < 0 && plan.length) {
    plan[0].recommended = true;
  }
  return plan;
}

function filterArchiMiniPlanByQuestions_(plan, questions) {
  questions = questions || [];
  return (plan || []).map(function(item) {
    var count = questions.filter(function(q) {
      return matchesArchiPractice_(q, item.key);
    }).length;
    var copy = {};
    Object.keys(item).forEach(function(k) { copy[k] = item[k]; });
    copy.questionsPerTest = count;
    return copy;
  }).filter(function(item) {
    return Number(item.questionsPerTest || 0) > 0;
  });
}

function computeArchiNextAction_(miniPlan) {
  var selected = null;
  for (var i = 0; i < miniPlan.length; i++) {
    if (miniPlan[i].recommended) {
      selected = miniPlan[i];
      break;
    }
  }
  if (!selected) {
    var week = weeksSinceArchiMiniStart_();
    for (var j = 0; j < miniPlan.length; j++) {
      if (Number(miniPlan[j].unlockWeek) > week) {
        selected = miniPlan[j];
        break;
      }
    }
  }
  if (!selected && miniPlan.length) selected = miniPlan[miniPlan.length - 1];
  if (!selected) return null;
  return {
    type: selected.recommended ? 'mini' : 'upcoming',
    label: selected.label,
    key: selected.key,
    questionsPerTest: selected.questionsPerTest,
    unlockWeek: selected.unlockWeek,
    dateRange: selected.dateRange,
    reason: selected.recommended ? '今週のミニテストです' : '次回のミニテストです'
  };
}

function apiGetAuthInfo(clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    return getCurrentAuthInfo_(clientUserKey);
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

// Return year list with question counts + answered stats for the home screen
function apiGetHome(clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    var allQuestions = readRecords_(SHEETS.Questions);
    var statusMap = getArchiRubricStatusMap_();
    var excludedCount = allQuestions.filter(function(q) {
      return isArchiPracticeOnlyStatus_(statusMap[String(q.qId)]);
    }).length;
    var qs = allQuestions.filter(function(q) {
      return !isArchiPracticeOnlyStatus_(statusMap[String(q.qId)]);
    });
    var grouped = {};
    var qIdToYear = {};
    qs.forEach(function(q) {
      var y = String(q.year);
      if (!grouped[y]) grouped[y] = 0;
      grouped[y]++;
      qIdToYear[String(q.qId)] = y;
    });

    // Per-year answered count for this user
    var answeredByYear = {};
    var answeredQidsByYear = {};
    var userKey = String(clientUserKey || '').trim();
    if (userKey) {
      readRecords_(SHEETS.Notes).forEach(function(n) {
        var qId = String(n.qId || '');
        if (String(n.userKey) === userKey && qId && String(n.note || '').trim()) {
          var y = qIdToYear[qId];
          if (y) {
            if (!answeredQidsByYear[y]) answeredQidsByYear[y] = {};
            answeredQidsByYear[y][qId] = true;
          }
        }
      });
      Object.keys(answeredQidsByYear).forEach(function(y) {
        answeredByYear[y] = Object.keys(answeredQidsByYear[y]).length;
      });
    }

    var years = Object.keys(grouped).sort().reverse();
    var miniPlan = markArchiMiniPlanForThisWeek_(filterArchiMiniPlanByQuestions_(buildArchiMiniPlan_(), qs));
    return toSerializable_({
      auth: getCurrentAuthInfo_(clientUserKey),
      config: {
        PROGRAM_START_DATE: ARCHI2JI_PROGRAM_START_DATE_,
        EXAM_DATE: ARCHI2JI_EXAM_DATE_
      },
      miniPlan: miniPlan,
      nextAction: computeArchiNextAction_(miniPlan),
      fieldStats: getArchiFieldStats_(qs),
      totalQuestions: allQuestions.length,
      practiceQuestionCount: qs.length,
      excludedQuestionCount: excludedCount,
      years: years.map(function(y) {
        return { year: y, count: grouped[y], answered: answeredByYear[y] || 0 };
      })
    });
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

function getArchi2jiSelfTest_() {
  var out = { buildVersion: ARCHI2JI_BUILD_VERSION_ };
  try {
    var home = apiGetHome('');
    var miniPlan = home && home.miniPlan ? home.miniPlan : [];
    out.miniPlanCount = miniPlan.length;
    var firstMini = miniPlan.length ? miniPlan[0] : null;
    out.firstMiniLabel = firstMini ? String(firstMini.label || '') : '';
    out.firstMiniKey = firstMini ? String(firstMini.key || '') : '';

    var practice = firstMini
      ? apiGetPracticeQuestions('mini', firstMini.key, firstMini.label, '')
      : { questions: [] };
    var qs = practice && practice.questions ? practice.questions : [];
    out.practiceQuestionCount = qs.length;
    out.firstQId = qs.length ? String(qs[0].qId || '') : '';
    out.firstQuestionListStemHead = qs.length ? String(qs[0].stem || qs[0].stemShort || '').slice(0, 80) : '';

    var detail = out.firstQId ? apiGetQuestion(out.firstQId, '') : null;
    out.firstQuestionHasQuestion = !!(detail && detail.question);
    out.firstQuestionError = detail && detail._error ? String(detail.message || '') : '';
    out.firstQuestionRawKeys = detail ? Object.keys(detail) : [];
    out.firstQuestionYear = detail && detail.question ? String(detail.question.year || '') : '';
    out.firstQuestionNumber = detail && detail.question ? String(detail.question.number || '') : '';
    out.firstQuestionStemHead = detail && detail.question ? String(detail.question.stem || '').slice(0, 120) : '';
    out.firstQuestionRubricStatus = detail && detail.rubricStatus ? detail.rubricStatus : null;
  } catch (e) {
    out._error = true;
    out.message = String(e && e.message || e);
  }
  return toSerializable_(out);
}

// Return question list for a given year with submitted status per question
function apiGetQuestionsByYear(year, clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    var qs = readRecords_(SHEETS.Questions).filter(function(q) {
      return String(q.year) === String(year);
    });
    var statusMap = getArchiRubricStatusMap_();
    qs = qs.filter(function(q) {
      return !isArchiPracticeOnlyStatus_(statusMap[String(q.qId)]);
    });
    qs.sort(function(a, b) { return Number(a.number) - Number(b.number); });

    // Build submitted map for this user
    var submittedMap = {};
    var userKey = String(clientUserKey || '').trim();
    if (userKey && qs.length > 0) {
      var qIds = {};
      qs.forEach(function(q) { qIds[String(q.qId)] = true; });
      readRecords_(SHEETS.Notes).forEach(function(n) {
        var qId = String(n.qId || '');
        if (String(n.userKey) === userKey && qIds[qId] && String(n.note || '').trim()) {
          submittedMap[qId] = true;
        }
      });
    }

    return toSerializable_(qs.map(function(q) {
      return toArchiQuestionListItem_(q, submittedMap, statusMap);
    }));
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

// Return cross-year question lists for mini tests, field practice, and weak review.
function apiGetPracticeQuestions(kind, key, title, clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    var userKey = String(clientUserKey || '').trim();
    var statusMap = getArchiRubricStatusMap_();
    var all = readRecords_(SHEETS.Questions).filter(function(q) {
      return !isArchiPracticeOnlyStatus_(statusMap[String(q.qId)]);
    });
    var allQids = {};
    all.forEach(function(q) { allQids[String(q.qId)] = true; });
    var submittedMap = getArchiScoreMap_(userKey, allQids);
    var qs;

    if (String(kind) === 'weak') {
      qs = all.filter(function(q) {
        if (isArchiPracticeOnlyStatus_(statusMap[String(q.qId)])) return false;
        var submitted = !!submittedMap[String(q.qId)];
        if (String(key) === 'unanswered') return !submitted;
        return !submitted;
      });
      if (!qs.length && String(key) !== 'unanswered') {
        qs = all.filter(function(q) {
          if (isArchiPracticeOnlyStatus_(statusMap[String(q.qId)])) return false;
          return !submittedMap[String(q.qId)];
        });
      }
    } else {
      qs = all.filter(function(q) {
        return matchesArchiPractice_(q, key);
      });
    }

    qs.sort(sortArchiPracticeQuestions_);
    return toSerializable_({
      title: String(title || getArchiPracticeTitle_(kind, key)),
      questions: qs.map(function(q) { return toArchiQuestionListItem_(q, submittedMap, statusMap); })
    });
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

function getArchiFieldStats_(questions) {
  var keys = ['experience', 'temporary', 'management', 'structure', 'finish', 'law'];
  var stats = {};
  keys.forEach(function(key) {
    stats[key] = (questions || []).filter(function(q) {
      return matchesArchiPractice_(q, key);
    }).length;
  });
  return stats;
}

function getArchiScoreMap_(userKey, qIds) {
  var submittedMap = {};
  if (!userKey) return submittedMap;
  readRecords_(SHEETS.Notes).forEach(function(n) {
    var qId = String(n.qId || '');
    if (qIds && !qIds[qId]) return;
    if (String(n.userKey) === String(userKey) && String(n.note || '').trim()) {
      submittedMap[qId] = true;
    }
  });
  return submittedMap;
}

function getArchiRubricStatusMap_() {
  var map = {};
  readRecords_(SHEETS.ScoringRubrics).forEach(function(r) {
    var qId = String(r.qId || '').trim();
    if (qId) map[qId] = buildArchiRubricStatus_(r);
  });
  return map;
}

function isArchiPracticeOnlyStatus_(status) {
  if (!status) return false;
  var scoreMode = String(status.scoreMode || '').trim();
  var reviewStatus = String(status.reviewStatus || '').trim();
  return scoreMode === 'practice_only' || reviewStatus === 'needs_answer_key';
}

function toArchiQuestionListItem_(q, submittedMap, statusMap) {
  var status = statusMap ? statusMap[String(q.qId)] : null;
  var scoringDisabled = isArchiPracticeOnlyStatus_(status);
  var submitted = !!(submittedMap && submittedMap[String(q.qId)]);
  return {
    qId: q.qId,
    year: q.year,
    number: q.number,
    questionType: q.questionType,
    stemShort: String(q.stem || '').slice(0, 60),
    lastScore: 0,
    submitted: submitted,
    scoreMode: status ? String(status.scoreMode || '') : '',
    reviewStatus: status ? String(status.reviewStatus || '') : '',
    scoringDisabled: scoringDisabled,
    statusLabel: scoringDisabled ? '採点対象外' : ''
  };
}

function matchesArchiPractice_(q, key) {
  var n = Number(q.number || 0);
  var text = [
    q.questionType || '',
    q.tags || '',
    q.stem || ''
  ].join(' ');
  key = String(key || '');
  var rangeMatch = matchesArchiRangePractice_(q, key);
  if (rangeMatch !== null) return rangeMatch;
  if (key === 'experience') return n === 1 || text.indexOf('経験') >= 0;
  if (key === 'temporary') return n === 2 || /仮設|安全|災害/.test(text);
  if (key === 'management') return n === 3 || /施工管理|工程|品質|安全/.test(text);
  if (key === 'structure') return n === 4 || /躯体|鉄筋|型枠|コンクリート/.test(text);
  if (key === 'finish') return n === 5 || /仕上|防水|内装|外装|タイル/.test(text);
  if (key === 'law') return n === 6 || /法規|建設業法|建築基準法|労働安全衛生法/.test(text);
  return true;
}

function matchesArchiRangePractice_(q, key) {
  var tokens = String(key || '').split(',');
  var hasRange = false;
  for (var i = 0; i < tokens.length; i++) {
    var token = String(tokens[i] || '').trim();
    var m = token.match(/^range:((?:H|R)\d+):(\d+)-(\d+)$/);
    if (!m) continue;
    hasRange = true;
    var from = Number(m[2]);
    var to = Number(m[3]);
    if (from > to) {
      var tmp = from;
      from = to;
      to = tmp;
    }
    var year = m[1].toUpperCase();
    var no = Number(q.number || 0);
    if (String(q.year || '').toUpperCase() === year && no >= from && no <= to) return true;
  }
  return hasRange ? false : null;
}

function getArchiPracticeTitle_(kind, key) {
  var titles = {
    experience: '経験記述',
    temporary: '仮設計画',
    management: '施工管理',
    structure: '躯体施工',
    finish: '仕上施工',
    law: '法規',
    low: '弱点復習',
    unanswered: '未提出確認'
  };
  return titles[String(key || '')] || String(kind || '演習');
}

function sortArchiPracticeQuestions_(a, b) {
  var ay = yearOrderForArchi_(a.year);
  var by = yearOrderForArchi_(b.year);
  if (ay !== by) return by - ay;
  return Number(a.number || 0) - Number(b.number || 0);
}

function yearOrderForArchi_(year) {
  var m = String(year || '').match(/^([HR])(\d+)$/);
  if (!m) return 0;
  var n = Number(m[2] || 0);
  return m[1] === 'H' ? 1988 + n : 2018 + n;
}

// Return full question + latest note for this user
function apiGetQuestion(qId, clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    var userKey = String(clientUserKey || '').trim();
    var q = readRecords_(SHEETS.Questions).filter(function(r) { return String(r.qId) === String(qId); })[0];
    if (!q) return { _error: true, message: '問題が見つかりません: ' + qId };
    q = decorateArchiQuestionMedia_(q);
    var draft = getArchiAnswerDraft_(userKey, qId);
    var submissionHistory = getArchiSubmissionHistory_(userKey, qId, 10);
    var latestSubmission = submissionHistory.length ? submissionHistory[0] : null;
    var rubric = getArchiRubricByQId_(qId);
    var rubricStatus = buildArchiRubricStatus_(rubric);
    rubricStatus = applyArchiQuestionMediaStatus_(rubricStatus, q);
    var latestAiGrading = getLatestArchiAiGrading_(userKey, qId);
    return toSerializable_({
      question: q,
      note: latestSubmission,
      draft: draft,
      latestSubmission: latestSubmission,
      submissionHistory: submissionHistory,
      rubricStatus: rubricStatus,
      latestAiGrading: latestAiGrading
    });
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

function apiGetPracticeResult(qIds, title, clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    var userKey = String(clientUserKey || '').trim();
    var ids = Array.isArray(qIds) ? qIds.map(function(v) { return String(v || '').trim(); }).filter(String) : [];
    var idSet = {};
    ids.forEach(function(id) { idSet[id] = true; });
    var statusMap = getArchiRubricStatusMap_();
    var qById = {};
    readRecords_(SHEETS.Questions).forEach(function(q) {
      var qId = String(q.qId || '').trim();
      if (idSet[qId]) qById[qId] = q;
    });

    var submissionById = {};
    if (userKey) {
      readRecords_(SHEETS.Notes).forEach(function(n) {
        var qId = String(n.qId || '').trim();
        if (String(n.userKey || '') === userKey && idSet[qId]) {
          submissionById[qId] = toArchiSubmission_(n);
        }
      });
    }

    var gradingById = {};
    if (userKey) {
      readRecords_(SHEETS.AiGradings).forEach(function(g) {
        var qId = String(g.qId || '').trim();
        if (String(g.userKey || '') === userKey && idSet[qId] && !isStaleArchiDeterministicEmptyParse_(g)) {
          gradingById[qId] = toPublicArchiAiGrading_(g);
        }
      });
    }

    var scoreSum = 0;
    var maxScoreSum = 0;
    var estimatedCostUsdSum = 0;
    var estimatedCostJpySum = 0;
    var submittedCount = 0;
    var aiGradedCount = 0;
    var excludedCount = 0;
    var rows = ids.map(function(qId) {
      var q = qById[qId] || { qId: qId };
      var status = statusMap[qId] || buildArchiRubricStatus_(null);
      var excluded = isArchiPracticeOnlyStatus_(status);
      if (excluded) excludedCount += 1;
      var submission = submissionById[qId] || null;
      var grading = gradingById[qId] || null;
      if (submission) submittedCount += 1;
      var includeAiScore = grading && !excluded && Number(grading.maxScore || 0) > 0;
      if (includeAiScore) {
        aiGradedCount += 1;
        scoreSum += Number(grading.score || 0);
        maxScoreSum += Number(grading.maxScore || 0);
        estimatedCostUsdSum += Number(grading.estimatedCostUsd || 0);
        estimatedCostJpySum += Number(grading.estimatedCostJpy || 0);
      }
      return {
        qId: qId,
        year: q.year || '',
        number: q.number || q.questionNumber || '',
        title: (q.year ? String(q.year) + ' ' : '') + '問' + String(q.number || q.questionNumber || ''),
        answerText: submission ? String(submission.note || '') : '',
        submittedAt: submission ? (submission.createdAt || '') : '',
        modelAnswer: String(q.modelAnswer || ''),
        scoringDisabled: excluded,
        scoreMode: status.scoreMode || '',
        submitted: !!submission,
        selfScore: submission ? Number(submission.selfScore || 0) : 0,
        aiGrading: grading,
        includeAiScore: !!includeAiScore
      };
    });
    var practiceSummary = buildArchiPracticeSummary_(rows, scoreSum, maxScoreSum, aiGradedCount);
    return toSerializable_({
      title: String(title || '演習結果'),
      total: ids.length,
      submittedCount: submittedCount,
      aiGradedCount: aiGradedCount,
      excludedCount: excludedCount,
      aiScore: Math.round(scoreSum * 10) / 10,
      aiMaxScore: Math.round(maxScoreSum * 10) / 10,
      aiScorePct: maxScoreSum > 0 ? Math.round(scoreSum / maxScoreSum * 1000) / 10 : 0,
      estimatedCostUsd: roundArchiCost_(estimatedCostUsdSum, 6),
      estimatedCostJpy: roundArchiCost_(estimatedCostJpySum, 2),
      practiceSummary: practiceSummary,
      rows: rows
    });
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

function buildArchiPracticeSummary_(rows, scoreSum, maxScoreSum, aiGradedCount) {
  var gradedRows = (rows || []).filter(function(row) {
    return row && row.includeAiScore && row.aiGrading;
  });
  if (!gradedRows.length) {
    return {
      headline: 'AI採点済みの答案がまだありません。',
      scoreComment: '結果を見る前に、各問題の答案を入力してAI採点してください。',
      weakTags: [],
      strengths: [],
      nextActions: []
    };
  }
  var pct = maxScoreSum > 0 ? Math.round(scoreSum / maxScoreSum * 1000) / 10 : 0;
  var headline = pct >= 90
    ? '高得点圏です。あとは減点されやすい条件違反や記録・是正手順の追記で安定します。'
    : (pct >= 75
      ? '合格圏に近い答案です。理由、実施内容、評価の対応をもう一段具体化しましょう。'
      : '骨子はあります。設問条件、具体的な管理方法、評価の因果を優先して補強しましょう。');

  var improvementTexts = [];
  var strengthTexts = [];
  gradedRows.forEach(function(row) {
    var grading = row.aiGrading || {};
    var flags = grading.flags || {};
    collectArchiSummaryTexts_(strengthTexts, flags.strengths, 4);
    collectArchiSummaryTexts_(strengthTexts, grading.overallComment ? [grading.overallComment] : [], 2);
    collectArchiSummaryTexts_(improvementTexts, flags.improvements, 5);
    collectArchiSummaryTexts_(improvementTexts, flags.fullScoreHints, 5);
    collectArchiSummaryTexts_(improvementTexts, flags.addableExamples, 4);
    collectArchiSummaryTexts_(improvementTexts, flags.warnings, 4);
    (grading.criteria || []).forEach(function(c) {
      if (Number(c.score || 0) < Number(c.maxScore || 0)) {
        collectArchiSummaryTexts_(improvementTexts, [c.comment || c.name], 4);
      }
    });
  });

  var tags = buildArchiPracticeWeakTags_(improvementTexts.join(' '));
  return {
    headline: headline,
    scoreComment: 'AI推定合計は ' + (Math.round(scoreSum * 10) / 10) + ' / ' + (Math.round(maxScoreSum * 10) / 10) + ' 点です。採点済み ' + aiGradedCount + ' 問をもとに整理しています。',
    weakTags: tags,
    strengths: uniqueArchiSummaryTexts_(strengthTexts).slice(0, 3),
    nextActions: uniqueArchiSummaryTexts_(improvementTexts).slice(0, 5)
  };
}

function collectArchiSummaryTexts_(target, items, limit) {
  if (!Array.isArray(items)) return;
  items.forEach(function(item) {
    if (target.length >= limit) return;
    var text = String(item || '').trim();
    if (text) target.push(text);
  });
}

function uniqueArchiSummaryTexts_(items) {
  var seen = {};
  var out = [];
  (items || []).forEach(function(item) {
    var text = String(item || '').trim();
    if (!text || seen[text]) return;
    seen[text] = true;
    out.push(text);
  });
  return out;
}

function buildArchiPracticeWeakTags_(text) {
  var src = String(text || '');
  var defs = [
    { tag: '工事概要不足', words: ['工事概要', '構造', '規模', '工期', '担当', '立場'] },
    { tag: '固定概要との不整合', words: ['工事概要に示す', '固定概要', '施工上必要としない', '設備工事', '不適合'] },
    { tag: '理由不足', words: ['理由', '因果', 'なぜ', '影響'] },
    { tag: '実施内容不足', words: ['実施内容', '管理方法', '確認方法', '具体'] },
    { tag: '記録・是正不足', words: ['記録', '是正', '再確認', '再検査', '監理者'] },
    { tag: '評価不足', words: ['評価', '効果', '結果', '良い影響'] },
    { tag: '条件違反注意', words: ['条件違反', '同じ内容', '不可', '重複'] },
    { tag: '図表・数値根拠不足', words: ['図表', '工程表', 'EST', 'LST', 'フロート', '数値', '根拠'] },
    { tag: '組織的管理不足', words: ['組織的', '職長', '協力会社', '伝達', '標準化'] }
  ];
  var tags = [];
  defs.forEach(function(def) {
    if (tags.length >= 4) return;
    var hit = def.words.some(function(w) { return src.indexOf(w) >= 0; });
    if (hit) tags.push(def.tag);
  });
  if (!tags.length) tags.push('具体性の追加');
  return tags;
}

function apiGradeAnswer(qId, answerText, clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    var userKey = String(clientUserKey || '').trim();
    var answer = String(answerText || '').trim();
    if (!answer) return { _error: true, message: '答案を入力してください' };

    var q = readRecords_(SHEETS.Questions).filter(function(r) { return String(r.qId) === String(qId); })[0];
    if (!q) return { _error: true, message: '問題が見つかりません: ' + qId };
    q = decorateArchiQuestionMedia_(q);

    var rubric = getArchiRubricByQId_(qId);
    var status = buildArchiRubricStatus_(rubric);
    status = applyArchiQuestionMediaStatus_(status, q);
    if (!rubric) return { _error: true, message: '採点ルーブリックが未登録です' };
    if (!status.canGrade) {
      return {
        success: false,
        skipped: true,
        message: status.displayNotice || 'この問題はAI採点の対象外です',
        rubricStatus: status
      };
    }

    var props = PropertiesService.getScriptProperties();
    var apiKey = props.getProperty('OPENAI_API_KEY');
    if (!apiKey) return { _error: true, message: 'OPENAI_API_KEY が未設定です' };
    var model = String(props.getProperty('OPENAI_MODEL') || 'gpt-5.4-mini').trim();
    var result = gradeArchiWithOpenAI_(q, rubric, answer, model, apiKey);

    var modelLabel = model;
    if (result && result.reasoningEffort) modelLabel += ' / effort:' + result.reasoningEffort;
    var saved = appendArchiAiGrading_(userKey, qId, answer, rubric, result, modelLabel);
    var submission = userKey ? appendArchiSubmission_(userKey, qId, answer, 0, true) : null;
    return toSerializable_({ success: true, rubricStatus: status, grading: saved, submission: submission, autoSubmitted: !!submission });
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

// Save (append) a submitted answer. selfScore is kept only for sheet compatibility.
function apiSaveNote(qId, note, selfScore, clientUserKey) {
  return apiSubmitAnswer(qId, note, selfScore, clientUserKey);
}

function apiSaveDraft(qId, draftText, clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    var userKey = String(clientUserKey || '').trim();
    if (!userKey) return { _error: true, message: 'ログイン情報が見つかりません' };
    var text = String(draftText || '');
    if (!String(text).trim()) {
      clearArchiAnswerDraft_(userKey, qId);
      return { success: true, cleared: true, draft: null };
    }
    var draft = upsertArchiAnswerDraft_(userKey, qId, text);
    return toSerializable_({ success: true, draft: draft });
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

function apiClearDraft(qId, clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    var userKey = String(clientUserKey || '').trim();
    if (!userKey) return { _error: true, message: 'ログイン情報が見つかりません' };
    var deleted = clearArchiAnswerDraft_(userKey, qId);
    return { success: true, deleted: deleted };
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

function apiSubmitAnswer(qId, answerText, selfScore, clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    var userKey = String(clientUserKey || '').trim();
    var answer = String(answerText || '').trim();
    if (!userKey) return { _error: true, message: 'ログイン情報が見つかりません' };
    if (!answer) return { _error: true, message: '答案を入力してください' };
    return toSerializable_({ success: true, submission: appendArchiSubmission_(userKey, qId, answerText, selfScore, true) });
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

function appendArchiSubmission_(userKey, qId, answerText, selfScore, clearDraft) {
  var score = Number(selfScore || 0);
  var row = {
    noteId: 'N_' + new Date().getTime() + '_' + Utilities.getUuid(),
    userKey: userKey,
    qId: qId,
    note: answerText,
    selfScore: isFinite(score) ? score : 0,
    createdAt: new Date()
  };
  appendRow_(SHEETS.Notes, row);
  if (clearDraft) clearArchiAnswerDraft_(userKey, qId);
  return toArchiSubmission_(row);
}

function getArchiAnswerDraft_(userKey, qId) {
  if (!userKey) return null;
  var rows = readRecords_(SHEETS.AnswerDrafts);
  var latest = null;
  rows.forEach(function(r) {
    if (String(r.userKey || '') === String(userKey) && String(r.qId || '') === String(qId)) {
      latest = r;
    }
  });
  if (!latest) return null;
  return {
    userKey: String(latest.userKey || ''),
    qId: String(latest.qId || ''),
    draftText: String(latest.draftText || ''),
    updatedAt: latest.updatedAt || ''
  };
}

function upsertArchiAnswerDraft_(userKey, qId, draftText) {
  var sh = getSheet_(SHEETS.AnswerDrafts);
  var values = sh.getDataRange().getValues();
  var headers = values[0];
  var userCol = headers.indexOf('userKey');
  var qCol = headers.indexOf('qId');
  var now = new Date();
  var row = [userKey, qId, draftText, now];
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][userCol] || '') === String(userKey) && String(values[i][qCol] || '') === String(qId)) {
      sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return { userKey: userKey, qId: qId, draftText: draftText, updatedAt: now };
    }
  }
  sh.appendRow(row);
  return { userKey: userKey, qId: qId, draftText: draftText, updatedAt: now };
}

function clearArchiAnswerDraft_(userKey, qId) {
  var sh = getSheet_(SHEETS.AnswerDrafts);
  var values = sh.getDataRange().getValues();
  if (values.length <= 1) return 0;
  var headers = values[0];
  var userCol = headers.indexOf('userKey');
  var qCol = headers.indexOf('qId');
  var deleted = 0;
  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][userCol] || '') === String(userKey) && String(values[i][qCol] || '') === String(qId)) {
      sh.deleteRow(i + 1);
      deleted += 1;
    }
  }
  return deleted;
}

function getArchiSubmissionHistory_(userKey, qId, limit) {
  if (!userKey) return [];
  var rows = readRecords_(SHEETS.Notes).filter(function(n) {
    return String(n.qId || '') === String(qId) && String(n.userKey || '') === String(userKey);
  }).map(toArchiSubmission_);
  rows.reverse();
  if (limit && rows.length > limit) rows = rows.slice(0, limit);
  return rows;
}

function toArchiSubmission_(n) {
  return {
    noteId: String(n.noteId || ''),
    userKey: String(n.userKey || ''),
    qId: String(n.qId || ''),
    note: String(n.note || ''),
    selfScore: Number(n.selfScore || 0),
    createdAt: n.createdAt || ''
  };
}

// Bulk import questions from JSON string (admin use)
function apiImportQuestions(questionsJson, clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    var qs = JSON.parse(questionsJson);
    var sh = getSheet_(SHEETS.Questions);
    var values = sh.getDataRange().getValues();
    var rowById = {};
    for (var r = 1; r < values.length; r++) {
      var existingQId = String(values[r][0] || '').trim();
      if (existingQId) rowById[existingQId] = r + 1;
    }
    var imported = 0;
    var updated = 0;
    var skipped = 0;
    var now = new Date();
    qs.forEach(function(q) {
      var qId = String(q.qId || ('Q_' + q.year + '_' + q.questionNumber)).trim();
      if (!qId) {
        skipped += 1;
        return;
      }
      var tags = q.tags || [];
      if (!Array.isArray(tags)) tags = [tags];
      var row = [
        qId,
        q.year,
        q.questionNumber,
        q.questionType || 'essay',
        q.stem || '',
        q.modelAnswer || '',
        tags.join(','),
        now,
        isArchiQuestionImageRequired_(q),
        JSON.stringify(getArchiQuestionImageUrls_(q))
      ];
      var rowNo = rowById[qId];
      if (rowNo) {
        sh.getRange(rowNo, 1, 1, row.length).setValues([row]);
        updated += 1;
      } else {
        sh.appendRow(row);
        rowById[qId] = sh.getLastRow();
        imported += 1;
      }
    });
    return { success: true, imported: imported, updated: updated, skipped: skipped };
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

function apiImportRubrics(rubricsJson, clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    if (String(clientUserKey || '').trim()) requireAdmin_(clientUserKey);
    var items = typeof rubricsJson === 'string' ? JSON.parse(rubricsJson) : rubricsJson;
    if (!items || !Array.isArray(items)) {
      return { _error: true, message: 'rubricsJson は配列JSONで指定してください' };
    }

    var sh = getSheet_(SHEETS.ScoringRubrics);
    var values = sh.getDataRange().getValues();
    var rowById = {};
    for (var r = 1; r < values.length; r++) {
      var id = String(values[r][0] || '').trim();
      if (id) rowById[id] = r + 1;
    }

    var imported = 0;
    var updated = 0;
    var skipped = 0;
    var now = new Date();
    items.forEach(function(item) {
      var qId = String(item && item.qId || '').trim();
      if (!qId) {
        skipped += 1;
        return;
      }
      var row = [
        qId,
        String(item.responseType || ''),
        String(item.sourceQuality || ''),
        String(item.scoreMode || ''),
        Number(item.maxScore || 10),
        JSON.stringify(item.rubricJson || {}, null, 0),
        String(item.reviewStatus || ''),
        now
      ];
      var rowNo = rowById[qId];
      if (rowNo) {
        sh.getRange(rowNo, 1, 1, row.length).setValues([row]);
        updated += 1;
      } else {
        sh.appendRow(row);
        imported += 1;
      }
    });

    return { success: true, imported: imported, updated: updated, skipped: skipped };
  } catch (e) {
    return { _error: true, message: '採点ルーブリック取り込みエラー: ' + String(e.message || e) };
  }
}

// Update only modelAnswer for existing questions.
// Each item: { qId, modelAnswer }
function apiUpdateModelAnswers(items, clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return { _error: true, message: '更新データが空です' };
    }
    var sh = getSheet_(SHEETS.Questions);
    var values = sh.getDataRange().getValues();
    if (values.length <= 1) return { updated: 0, unchanged: 0, notFound: items.length, blank: 0 };

    var headers = values[0];
    var qIdCol = headers.indexOf('qId');
    var answerCol = headers.indexOf('modelAnswer');
    var createdCol = headers.indexOf('createdAt');
    if (qIdCol < 0 || answerCol < 0) {
      return { _error: true, message: 'qId または modelAnswer ヘッダーが見つかりません' };
    }

    var rowById = {};
    for (var r = 1; r < values.length; r++) {
      rowById[String(values[r][qIdCol] || '').trim()] = r + 1;
    }

    var now = new Date();
    var updated = 0;
    var unchanged = 0;
    var blank = 0;
    var notFound = [];

    items.forEach(function(item) {
      var qId = String(item && item.qId || '').trim();
      var modelAnswer = String(item && item.modelAnswer || '').trim();
      if (!qId || !modelAnswer) {
        blank += 1;
        return;
      }
      var rowNo = rowById[qId];
      if (!rowNo) {
        notFound.push(qId);
        return;
      }
      var current = String(values[rowNo - 1][answerCol] || '').trim();
      if (current === modelAnswer) {
        unchanged += 1;
        return;
      }
      sh.getRange(rowNo, answerCol + 1).setValue(modelAnswer);
      if (createdCol >= 0) sh.getRange(rowNo, createdCol + 1).setValue(now);
      updated += 1;
    });

    return { updated: updated, unchanged: unchanged, notFound: notFound, blank: blank };
  } catch (e) {
    return { _error: true, message: '模範解答更新エラー: ' + String(e.message || e) };
  }
}

function apiImportQuestionImages(imagesJson, clientUserKey, replaceExisting) {
  __clientUserKey = clientUserKey || '';
  try {
    if (String(clientUserKey || '').trim()) requireAdmin_(clientUserKey);
    var items = typeof imagesJson === 'string' ? JSON.parse(imagesJson) : imagesJson;
    if (!items || !Array.isArray(items)) {
      return { _error: true, message: 'imagesJson は配列JSONで指定してください' };
    }

    var folder = getArchiQuestionImageFolder_();
    var urlsByQid = {};
    var imported = 0;
    var skipped = 0;
    var errors = [];

    items.forEach(function(item) {
      var qId = String(item && item.qId || '').trim();
      var b64 = String(item && item.base64Data || '').trim();
      if (!qId || !b64) {
        skipped += 1;
        return;
      }
      try {
        var mimeType = normalizeArchiImageMimeType_(item.mimeType);
        var filename = sanitizeArchiImageFilename_(item.filename || (qId + '_' + (new Date().getTime()) + '.png'));
        var bytes = Utilities.base64Decode(b64);
        var blob = Utilities.newBlob(bytes, mimeType, filename);
        var file = folder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        var url = getArchiDriveImageUrl_(file.getId());
        if (!urlsByQid[qId]) urlsByQid[qId] = [];
        urlsByQid[qId].push(url);
        imported += 1;
      } catch (err) {
        skipped += 1;
        errors.push({ qId: qId, message: String(err.message || err) });
      }
    });

    var updated = 0;
    Object.keys(urlsByQid).forEach(function(qId) {
      var urls = urlsByQid[qId];
      if (replaceExisting === false || String(replaceExisting).toLowerCase() === 'false') {
        urls = mergeArchiQuestionImageUrls_(getArchiQuestionImageUrlsByQId_(qId), urls);
      }
      if (updateArchiQuestionImageUrls_(qId, urls)) updated += 1;
    });

    return { success: true, imported: imported, updated: updated, skipped: skipped, imageUrlsByQId: urlsByQid, errors: errors };
  } catch (e) {
    return { _error: true, message: '問題図表画像取り込みエラー: ' + String(e.message || e) };
  }
}

function getArchiRubricByQId_(qId) {
  var rows = readRecords_(SHEETS.ScoringRubrics);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].qId || '').trim() === String(qId || '').trim()) {
      rows[i].rubricJson = parseArchiJson_(rows[i].rubricJson, {});
      rows[i].maxScore = Number(rows[i].maxScore || 10);
      return rows[i];
    }
  }
  return null;
}

function buildArchiRubricStatus_(rubric) {
  if (!rubric) {
    return {
      canGrade: false,
      scoreMode: 'missing',
      sourceQuality: '',
      reviewStatus: 'missing',
      displayNotice: '採点ルーブリックが未登録です。',
      excludeFromTotal: true
    };
  }
  var rj = parseArchiJson_(rubric.rubricJson, {});
  var scoreMode = String(rubric.scoreMode || '').trim();
  var sourceQuality = String(rubric.sourceQuality || '').trim();
  var reviewStatus = String(rubric.reviewStatus || '').trim();
  var displayNotice = String(rj.displayNotice || '').trim();
  if (!displayNotice && sourceQuality === 'reference_only') {
    displayNotice = 'AI推定点・公式採点ではありません。';
  }
  var canGrade = scoreMode === 'rubric_ai' || scoreMode === 'ai_estimate' || scoreMode === 'deterministic';
  if (scoreMode === 'practice_only' || reviewStatus === 'needs_answer_key') {
    canGrade = false;
    displayNotice = '採点観点が未整備のため、AI採点・合計点の対象外です。復習用として使用してください。';
  }
  if (scoreMode === 'deterministic' && !rj.correctAnswers) {
    canGrade = false;
    displayNotice = '採点観点が未登録のため採点できません。';
  }
  return {
    canGrade: canGrade,
    scoreMode: scoreMode,
    sourceQuality: sourceQuality,
    reviewStatus: reviewStatus,
    displayNotice: displayNotice,
    excludeFromTotal: rj.excludeFromTotal === true,
    maxScore: Number(rubric.maxScore || 10)
  };
}

function decorateArchiQuestionMedia_(q) {
  q = q || {};
  q.imageRequired = isArchiQuestionImageRequired_(q);
  q.imageUrls = getArchiQuestionImageUrls_(q);
  q.imageMissing = q.imageRequired && q.imageUrls.length === 0;
  if (q.imageMissing) {
    var notice = getArchiQuestionImageNotice_(q);
    var stem = String(q.stem || '');
    if (stem.indexOf(notice) < 0) q.stem = notice + '\n\n' + stem;
  }
  return q;
}

function applyArchiQuestionMediaStatus_(status, q) {
  status = status || {};
  if (!q || !q.imageMissing) return status;
  var notice = getArchiQuestionImageNotice_(q);
  var current = String(status.displayNotice || '').trim();
  status.displayNotice = current ? current + '\n' + notice : notice;
  if (String(q.questionType || '') === 'mixed') {
    status.canGrade = false;
    status.reviewStatus = 'needs_image';
    status.excludeFromTotal = true;
  }
  return status;
}

function getArchiQuestionImageNotice_(q) {
  var text = String(q && q.stem || '');
  var subject = /工程表|ネットワーク/.test(text) ? '工程表・図表' : '工事概要・図表';
  return '【注意】この問題は元PDFの' + subject + '画像が必要です。現在画像が未登録のため、本文だけでは解けない可能性があります。';
}

function isArchiQuestionImageRequired_(q) {
  var explicit = parseArchiBoolean_(q && q.imageRequired);
  if (explicit !== null) return explicit;
  var stem = String(q && q.stem || '');
  if (/右の.+工程表|右に示す.+工程表|右の.+図|下図|ネットワーク工程/.test(stem)) return true;
  if (/工程表/.test(stem) && /(フリーフロート|トータルフロート|EST|LST|総所要日数|クリティカルパス|開始日|終了日|作業工程|未記入|旬日)/.test(stem)) return true;
  if (/右の工事概要|右に示す工事概要|工事概要に示す/.test(stem) && !/\[工事概要\]|〔工事概要〕/.test(stem)) return true;
  return false;
}

function getArchiQuestionImageUrls_(q) {
  var raw = q && (q.imageUrls || q.imageUrl || q.images || q.imageFileIds || q.imageFileId);
  if (!raw) return [];
  var parsed = parseArchiJson_(raw, null);
  if (Array.isArray(parsed)) return normalizeArchiQuestionImageUrlList_(parsed);
  if (parsed && typeof parsed === 'object') {
    return normalizeArchiQuestionImageUrlList_(Object.keys(parsed).map(function(k) { return parsed[k]; }));
  }
  return normalizeArchiQuestionImageUrlList_(String(raw).split(/\s*,\s*/));
}

function normalizeArchiQuestionImageUrlList_(values) {
  var out = [];
  var seen = {};
  (values || []).forEach(function(value) {
    var s = normalizeArchiQuestionImageUrl_(value);
    if (!s || seen[s]) return;
    seen[s] = true;
    out.push(s);
  });
  return out;
}

function normalizeArchiQuestionImageUrl_(value) {
  var s = String(value || '').trim();
  if (!s) return '';
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(s)) return s;
  var fileId = extractArchiDriveFileId_(s);
  if (fileId) return getArchiDriveImageUrl_(fileId);
  return /^https?:\/\//i.test(s) ? s : '';
}

function getArchiDriveImageUrl_(fileId) {
  return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(String(fileId || '').trim()) + '&sz=w2000';
}

function extractArchiDriveFileId_(url) {
  var s = String(url || '').trim();
  var m = s.match(/[?&]id=([^&]+)/);
  if (m) return decodeURIComponent(m[1]);
  m = s.match(/\/file\/d\/([^/]+)/);
  if (m) return decodeURIComponent(m[1]);
  m = s.match(/\/d\/([^/=]+)(?:=|\/|$)/);
  if (m) return decodeURIComponent(m[1]);
  return '';
}

function getArchiQuestionImageUrlsByQId_(qId) {
  var rows = readRecords_(SHEETS.Questions);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].qId || '').trim() === String(qId || '').trim()) {
      return getArchiQuestionImageUrls_(rows[i]);
    }
  }
  return [];
}

function mergeArchiQuestionImageUrls_(existing, incoming) {
  var out = [];
  var seen = {};
  (existing || []).concat(incoming || []).forEach(function(url) {
    var s = String(url || '').trim();
    if (!s || seen[s]) return;
    seen[s] = true;
    out.push(s);
  });
  return out;
}

function updateArchiQuestionImageUrls_(qId, imageUrls) {
  var sh = getSheet_(SHEETS.Questions);
  var values = sh.getDataRange().getValues();
  if (values.length <= 1) return false;
  var headers = values[0].map(function(h) { return String(h || '').trim(); });
  var qIdCol = headers.indexOf('qId');
  var imageRequiredCol = headers.indexOf('imageRequired');
  var imageUrlsCol = headers.indexOf('imageUrls');
  if (qIdCol < 0 || imageRequiredCol < 0 || imageUrlsCol < 0) {
    throw new Error('Questionsシートに qId/imageRequired/imageUrls ヘッダーがありません');
  }
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][qIdCol] || '').trim() !== String(qId || '').trim()) continue;
    sh.getRange(r + 1, imageRequiredCol + 1).setValue(true);
    sh.getRange(r + 1, imageUrlsCol + 1).setValue(JSON.stringify(imageUrls || []));
    return true;
  }
  return false;
}

function getArchiQuestionImageFolder_() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty('QUESTION_IMAGE_FOLDER_ID');
  if (folderId) {
    try {
      return DriveApp.getFolderById(folderId);
    } catch (e) {
      props.deleteProperty('QUESTION_IMAGE_FOLDER_ID');
    }
  }
  var folder = DriveApp.createFolder('archi2ji-question-images');
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  props.setProperty('QUESTION_IMAGE_FOLDER_ID', folder.getId());
  return folder;
}

function normalizeArchiImageMimeType_(value) {
  var mimeType = String(value || 'image/png').trim().toLowerCase();
  var allowed = { 'image/png': true, 'image/jpeg': true, 'image/webp': true };
  return allowed[mimeType] ? mimeType : 'image/png';
}

function sanitizeArchiImageFilename_(value) {
  var name = String(value || 'question-image.png').replace(/[\\/:*?"<>|]+/g, '_').trim();
  return name || 'question-image.png';
}

function getArchiQuestionImageInputUrls_(q) {
  return getArchiQuestionImageUrls_(q).filter(function(url) {
    return /^https?:\/\//i.test(String(url || '')) || /^data:image\/(png|jpe?g|webp);base64,/i.test(String(url || ''));
  });
}

function parseArchiBoolean_(value) {
  if (value === true || value === false) return value;
  var s = String(value || '').trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return null;
}

function getLatestArchiAiGrading_(userKey, qId) {
  var rows = readRecords_(SHEETS.AiGradings);
  var latest = null;
  rows.forEach(function(row) {
    if (String(row.userKey || '') === String(userKey || '') && String(row.qId || '') === String(qId || '')) {
      if (!isStaleArchiDeterministicEmptyParse_(row)) latest = row;
    }
  });
  return latest ? toPublicArchiAiGrading_(latest) : null;
}

function isStaleArchiDeterministicEmptyParse_(row) {
  if (String(row && row.scoreMode || '') !== 'deterministic') return false;
  if (Number(row && row.score || 0) !== 0) return false;
  var raw = parseArchiJson_(row && row.rawJson, {});
  var answers = raw && raw.userAnswers;
  if (answers && typeof answers === 'object' && Object.keys(answers).length > 0) return false;
  return String(row && row.answerText || '').trim() !== '';
}

function appendArchiAiGrading_(userKey, qId, answerText, rubric, result, model) {
  var createdAt = new Date();
  var usage = result.usage || {};
  var flags = {
    strengths: result.strengths || [],
    improvements: result.improvements || [],
    fullScoreHints: result.fullScoreHints || [],
    addableExamples: result.addableExamples || [],
    warnings: result.warnings || [],
    confidence: result.confidence,
    officialNotice: result.officialNotice || '',
    excludeFromTotal: result.excludeFromTotal === true
  };
  var row = {
    gradingId: 'G_' + createdAt.getTime() + '_' + Utilities.getUuid(),
    userKey: userKey,
    qId: qId,
    answerText: answerText,
    answerHash: sha256Hex_(answerText),
    score: Number(result.score || 0),
    maxScore: Number(result.maxScore || rubric.maxScore || 10),
    scoreMode: String(rubric.scoreMode || '') === 'deterministic' && String(model || '') !== 'deterministic' ? 'ai_assisted_key' : String(rubric.scoreMode || ''),
    sourceQuality: String(rubric.sourceQuality || ''),
    reviewStatus: String(rubric.reviewStatus || ''),
    overallComment: String(result.overallComment || ''),
    criteriaJson: JSON.stringify(result.criteria || []),
    flagsJson: JSON.stringify(flags),
    rawJson: JSON.stringify(result.rawJson || result),
    model: String(model || ''),
    createdAt: createdAt,
    inputTokens: Number(usage.inputTokens || 0),
    outputTokens: Number(usage.outputTokens || 0),
    totalTokens: Number(usage.totalTokens || 0),
    cachedInputTokens: Number(usage.cachedInputTokens || 0),
    reasoningTokens: Number(usage.reasoningTokens || 0),
    estimatedCostUsd: roundArchiCost_(Number(usage.estimatedCostUsd || 0), 6),
    estimatedCostJpy: roundArchiCost_(Number(usage.estimatedCostJpy || 0), 2),
    pricingJson: JSON.stringify(usage.pricing || {})
  };
  appendRow_(SHEETS.AiGradings, row);
  return toPublicArchiAiGrading_(row);
}

function toPublicArchiAiGrading_(row) {
  var flags = parseArchiJson_(row.flagsJson, {});
  var pricing = parseArchiJson_(row.pricingJson, {});
  return {
    gradingId: row.gradingId,
    qId: row.qId,
    answerText: String(row.answerText || ''),
    answerHash: String(row.answerHash || ''),
    score: Number(row.score || 0),
    maxScore: Number(row.maxScore || 10),
    scoreMode: row.scoreMode,
    sourceQuality: row.sourceQuality,
    reviewStatus: row.reviewStatus,
    overallComment: row.overallComment,
    criteria: parseArchiJson_(row.criteriaJson, []),
    flags: flags,
    model: row.model,
    inputTokens: Number(row.inputTokens || 0),
    outputTokens: Number(row.outputTokens || 0),
    totalTokens: Number(row.totalTokens || 0),
    cachedInputTokens: Number(row.cachedInputTokens || 0),
    reasoningTokens: Number(row.reasoningTokens || 0),
    estimatedCostUsd: Number(row.estimatedCostUsd || 0),
    estimatedCostJpy: Number(row.estimatedCostJpy || 0),
    pricing: pricing,
    createdAt: row.createdAt
  };
}

function gradeArchiDeterministic_(answerText, rubric) {
  var rj = parseArchiJson_(rubric.rubricJson, {});
  var correct = rj.correctAnswers;
  if (!correct) throw new Error('正答キーが未登録です');
  var keys = [];
  var expected = {};
  if (Array.isArray(correct)) {
    for (var i = 0; i < correct.length; i++) {
      var k = String(i + 1);
      keys.push(k);
      expected[k] = String(correct[i]);
    }
  } else {
    keys = Object.keys(correct).sort(compareArchiAnswerKeys_);
    keys.forEach(function(k) { expected[k] = String(correct[k]); });
  }
  if (!keys.length) throw new Error('正答キーが空です');

  var actual = parseArchiAnswerMap_(answerText, keys);
  var correctCount = 0;
  var criteria = keys.map(function(k) {
    var ok = String(actual[k] || '') === String(expected[k]);
    if (ok) correctCount += 1;
    return {
      name: '小問 ' + k,
      score: ok ? 1 : 0,
      maxScore: 1,
      comment: ok ? '正解' : '不正解（正答: ' + expected[k] + '、解答: ' + (actual[k] || '未入力') + '）'
    };
  });
  var maxScore = Number(rubric.maxScore || 10);
  var score = Math.round((correctCount / keys.length) * maxScore * 10) / 10;
  return {
    score: score,
    maxScore: maxScore,
    overallComment: correctCount + '/' + keys.length + '問正解です。',
    criteria: criteria,
    strengths: correctCount === keys.length ? ['全問正解です。'] : (correctCount > 0 ? ['正答キーと一致した小問があります。'] : []),
    improvements: correctCount < keys.length ? ['不正解又は未入力の小問を復習してください。'] : [],
    fullScoreHints: correctCount < keys.length ? ['満点にするには、不正解又は未入力の小問を正答キーと一致させてください。'] : [],
    addableExamples: [],
    warnings: [],
    confidence: 1,
    officialNotice: '正答キーに基づく採点です。',
    excludeFromTotal: rj.excludeFromTotal === true,
    rawJson: { correctAnswers: correct, userAnswers: actual, correctCount: correctCount, total: keys.length }
  };
}

function gradeArchiWithOpenAI_(question, rubric, answerText, model, apiKey) {
  var rj = parseArchiJson_(rubric.rubricJson, {});
  var maxScore = Number(rubric.maxScore || rj.maxScore || 10);
  var payload = {
    question: {
      qId: question.qId,
      year: question.year,
      number: question.number,
      questionType: question.questionType,
      stem: question.stem,
      modelAnswer: question.modelAnswer,
      imageUrls: getArchiQuestionImageInputUrls_(question)
    },
    rubric: {
      responseType: rubric.responseType,
      sourceQuality: rubric.sourceQuality,
      scoreMode: rubric.scoreMode,
      reviewStatus: rubric.reviewStatus,
      maxScore: maxScore,
      rubricJson: rj
    },
    answerText: answerText
  };
  var imageUrls = getArchiQuestionImageInputUrls_(question);
  var userContent = [{ type: 'input_text', text: JSON.stringify(payload) }];
  var imageDetail = getArchiOpenAIImageDetail_();
  imageUrls.forEach(function(url) {
    userContent.push({
      type: 'input_image',
      image_url: url,
      detail: imageDetail
    });
  });

  var body = {
    model: model,
    store: false,
    max_output_tokens: getArchiOpenAIMaxOutputTokens_(),
    input: [
      {
        role: 'developer',
        content: [{
          type: 'input_text',
          text: [
            'あなたは1級建築施工管理技術検定 実地/二次試験の学習用採点者です。',
            '公式採点者ではありません。reference_onlyは必ずAI推定点として扱います。',
            'experience_essayは模範解答との一致ではなく、工事概要、管理項目、理由、実施内容、周知確認方法などの構造で評価してください。',
            '問題文が「右の工事概要」「右に示す工事概要」等の固定シナリオを前提にしている場合、受験者に工事概要の記入を明示要求していない限り、工事名・場所・規模・工期・担当立場の未記載だけで減点しないでください。',
            '問題図表画像が添付されている場合は、工程表、作業内容表、工事概要、作業条件を画像から読み取って採点してください。画像が読めない場合はwarningsに明記し、確信度を下げてください。',
            '問題文とrubricJsonが衝突する場合は問題文を優先し、rubricJsonのcriteriaは設問要求に合わせて解釈してください。',
            '10点は出し惜しみしないでください。設問要求、具体性、因果、除外条件への適合が十分なら10点を付けてください。',
            '記録、是正、許容値、担当者、頻度などは、問題文又はrubricが明示しない限り満点の必須条件にしないでください。それらが無いだけで9点止まりにしないでください。',
            'scoreがmaxScore未満の場合、fullScoreHintsには満点を妨げている不足点を具体的に書き、addableExamplesには答案へ追記・差替えできる短い文例を書いてください。',
            '9点台の場合は、10点に近づくための最小限の追記を1〜2件に絞ってください。すでに十分な観点を、形式的に繰り返す助言は避けてください。',
            '講評は簡潔にしてください。overallCommentは160字以内、criteria.commentは各80字以内、strengths/improvements/warnings/fullScoreHints/addableExamplesは各最大4件・各90字以内を目安にしてください。',
            'rubricJsonにcorrectAnswersがある穴埋め・選択問題でも、単純な文字列一致ではなく、答案の表記ゆれ、番号付き回答、表形式回答、説明付き回答を読み取り、正答キーを根拠にAI採点してください。',
            '問題文、参考答案、rubricJson、受験者答案だけを根拠に、指定JSON schemaだけで返してください。'
          ].join('\n')
        }]
      },
      {
        role: 'user',
        content: userContent
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'archi2ji_grading',
        strict: true,
        schema: getArchiGradingSchema_()
      }
    }
  };
  var reasoningEffort = getArchiOpenAIReasoningEffort_(model);
  if (reasoningEffort) body.reasoning = { effort: reasoningEffort };
  var resp = UrlFetchApp.fetch('https://api.openai.com/v1/responses', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  var text = resp.getContentText();
  var data = parseArchiJson_(text, {});
  if (code < 200 || code >= 300) {
    var msg = data && data.error && data.error.message ? data.error.message : text;
    throw new Error('OpenAI API error ' + code + ': ' + msg);
  }
  if (data && data.status === 'incomplete') {
    var reason = data.incomplete_details && data.incomplete_details.reason ? data.incomplete_details.reason : 'unknown';
    throw new Error('OpenAI APIの出力が途中で終了しました: ' + reason);
  }
  var outputText = extractOpenAIOutputText_(data);
  if (!outputText) throw new Error('OpenAI APIの出力が空です');
  var parsed = parseArchiJsonOutput_(outputText);
  if (!parsed) throw new Error('OpenAI APIのJSON出力を解析できません: ' + summarizeArchiOutput_(outputText));
  var result = normalizeArchiAiResult_(parsed, rubric);
  result.reasoningEffort = reasoningEffort;
  result.usage = getArchiOpenAIUsageMetrics_(data, model);
  return result;
}

function getArchiOpenAIUsageMetrics_(responseData, model) {
  var usage = responseData && responseData.usage || {};
  var inputTokens = Number(usage.input_tokens || 0);
  var outputTokens = Number(usage.output_tokens || 0);
  var totalTokens = Number(usage.total_tokens || inputTokens + outputTokens || 0);
  var inputDetails = usage.input_tokens_details || usage.prompt_tokens_details || {};
  var outputDetails = usage.output_tokens_details || {};
  var cachedInputTokens = Number(inputDetails.cached_tokens || 0);
  var reasoningTokens = Number(outputDetails.reasoning_tokens || 0);
  var pricing = getArchiOpenAIPricing_(model);
  var billableInputTokens = Math.max(inputTokens - cachedInputTokens, 0);
  var costUsd =
    billableInputTokens / 1000000 * pricing.inputUsdPer1M +
    cachedInputTokens / 1000000 * pricing.cachedInputUsdPer1M +
    outputTokens / 1000000 * pricing.outputUsdPer1M;
  var costJpy = costUsd * pricing.usdJpyRate;
  return {
    inputTokens: inputTokens,
    outputTokens: outputTokens,
    totalTokens: totalTokens,
    cachedInputTokens: cachedInputTokens,
    reasoningTokens: reasoningTokens,
    estimatedCostUsd: roundArchiCost_(costUsd, 6),
    estimatedCostJpy: roundArchiCost_(costJpy, 2),
    pricing: pricing
  };
}

function getArchiOpenAIPricing_(model) {
  var m = String(model || '').trim().toLowerCase();
  var table = {
    'gpt-5.5-pro': { inputUsdPer1M: 30, cachedInputUsdPer1M: 0, outputUsdPer1M: 180 },
    'gpt-5.5': { inputUsdPer1M: 5, cachedInputUsdPer1M: 0.5, outputUsdPer1M: 30 },
    'gpt-5.4-pro': { inputUsdPer1M: 30, cachedInputUsdPer1M: 0, outputUsdPer1M: 180 },
    'gpt-5.4-mini': { inputUsdPer1M: 0.75, cachedInputUsdPer1M: 0.075, outputUsdPer1M: 4.5 },
    'gpt-5.4-nano': { inputUsdPer1M: 0.2, cachedInputUsdPer1M: 0.02, outputUsdPer1M: 1.25 },
    'gpt-5.4': { inputUsdPer1M: 2.5, cachedInputUsdPer1M: 0.25, outputUsdPer1M: 15 }
  };
  var base = null;
  Object.keys(table).some(function(prefix) {
    if (m === prefix || m.indexOf(prefix + '-') === 0) {
      base = table[prefix];
      return true;
    }
    return false;
  });
  if (!base) base = { inputUsdPer1M: 0, cachedInputUsdPer1M: 0, outputUsdPer1M: 0 };
  var props = PropertiesService.getScriptProperties();
  var inputPrice = getArchiNumberProperty_(props, 'OPENAI_INPUT_PRICE_PER_1M_USD', base.inputUsdPer1M);
  var cachedPrice = getArchiNumberProperty_(props, 'OPENAI_CACHED_INPUT_PRICE_PER_1M_USD', base.cachedInputUsdPer1M);
  var outputPrice = getArchiNumberProperty_(props, 'OPENAI_OUTPUT_PRICE_PER_1M_USD', base.outputUsdPer1M);
  var usdJpy = getArchiNumberProperty_(props, 'OPENAI_USD_JPY_RATE', getArchiNumberProperty_(props, 'USD_JPY_RATE', 160));
  return {
    model: String(model || ''),
    inputUsdPer1M: inputPrice,
    cachedInputUsdPer1M: cachedPrice,
    outputUsdPer1M: outputPrice,
    usdJpyRate: usdJpy,
    source: 'openai_api_pricing_2026_06_standard_or_script_properties'
  };
}

function getArchiNumberProperty_(props, key, fallback) {
  var raw = props.getProperty(key);
  if (raw === null || raw === undefined || raw === '') return Number(fallback || 0);
  var n = Number(raw);
  return isFinite(n) ? n : Number(fallback || 0);
}

function roundArchiCost_(value, digits) {
  var n = Number(value || 0);
  if (!isFinite(n)) return 0;
  var p = Math.pow(10, Number(digits || 0));
  return Math.round(n * p) / p;
}

function getArchiOpenAIMaxOutputTokens_() {
  var value = Number(PropertiesService.getScriptProperties().getProperty('OPENAI_MAX_OUTPUT_TOKENS') || 1800);
  if (!isFinite(value) || value < 1200) return 1800;
  if (value > 4000) return 4000;
  return Math.floor(value);
}

function getArchiOpenAIImageDetail_() {
  var detail = String(PropertiesService.getScriptProperties().getProperty('OPENAI_IMAGE_DETAIL') || 'high').trim().toLowerCase();
  var allowed = { low: true, high: true, auto: true };
  if (!allowed[detail]) {
    throw new Error('OPENAI_IMAGE_DETAIL は low/high/auto のいずれかで指定してください');
  }
  return detail;
}

function getArchiOpenAIReasoningEffort_(model) {
  var configured = PropertiesService.getScriptProperties().getProperty('OPENAI_REASONING_EFFORT');
  var effort = String(configured || 'low').trim().toLowerCase();
  if (!effort || effort === 'default') return '';
  var allowed = { none: true, minimal: true, low: true, medium: true, high: true, xhigh: true };
  if (!allowed[effort]) {
    throw new Error('OPENAI_REASONING_EFFORT は none/minimal/low/medium/high/xhigh/default のいずれかで指定してください');
  }
  if (!supportsArchiOpenAIReasoningEffort_(model)) {
    if (configured) throw new Error('OPENAI_REASONING_EFFORT は gpt-5系又はo-series系モデルでのみ使用してください');
    return '';
  }
  return effort;
}

function supportsArchiOpenAIReasoningEffort_(model) {
  var m = String(model || '').trim().toLowerCase();
  return /^gpt-5(?:\.|-|$)/.test(m) || /^o\d/.test(m) || /^o-/.test(m);
}

function normalizeArchiAiResult_(parsed, rubric) {
  var rj = parseArchiJson_(rubric.rubricJson, {});
  var maxScore = Number(rubric.maxScore || parsed.maxScore || 10);
  var score = Number(parsed.score || 0);
  if (!isFinite(score)) score = 0;
  if (score < 0) score = 0;
  if (score > maxScore) score = maxScore;
  var criteria = Array.isArray(parsed.criteria) ? parsed.criteria : [];
  return {
    score: Math.round(score * 10) / 10,
    maxScore: maxScore,
    overallComment: String(parsed.overallComment || ''),
    criteria: criteria.map(function(c) {
      return {
        name: String(c.name || ''),
        score: Number(c.score || 0),
        maxScore: Number(c.maxScore || 0),
        comment: String(c.comment || '')
      };
    }),
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
    improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
    fullScoreHints: Array.isArray(parsed.fullScoreHints) ? parsed.fullScoreHints : [],
    addableExamples: Array.isArray(parsed.addableExamples) ? parsed.addableExamples : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    confidence: Number(parsed.confidence || 0),
    officialNotice: String(parsed.officialNotice || rj.displayNotice || 'AI推定点・公式採点ではありません。'),
    excludeFromTotal: rj.excludeFromTotal === true || parsed.excludeFromTotal === true,
    rawJson: parsed
  };
}

function getArchiGradingSchema_() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['score', 'maxScore', 'overallComment', 'criteria', 'strengths', 'improvements', 'fullScoreHints', 'addableExamples', 'warnings', 'confidence', 'officialNotice', 'excludeFromTotal'],
    properties: {
      score: { type: 'number' },
      maxScore: { type: 'number' },
      overallComment: { type: 'string' },
      criteria: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'score', 'maxScore', 'comment'],
          properties: {
            name: { type: 'string' },
            score: { type: 'number' },
            maxScore: { type: 'number' },
            comment: { type: 'string' }
          }
        }
      },
      strengths: { type: 'array', items: { type: 'string' } },
      improvements: { type: 'array', items: { type: 'string' } },
      fullScoreHints: { type: 'array', items: { type: 'string' } },
      addableExamples: { type: 'array', items: { type: 'string' } },
      warnings: { type: 'array', items: { type: 'string' } },
      confidence: { type: 'number' },
      officialNotice: { type: 'string' },
      excludeFromTotal: { type: 'boolean' }
    }
  };
}

function extractOpenAIOutputText_(data) {
  if (data && data.output_text) return String(data.output_text);
  var out = data && data.output;
  if (!out || !Array.isArray(out)) return '';
  var chunks = [];
  var structured = null;
  out.forEach(function(item) {
    var content = item && item.content;
    if (!content || !Array.isArray(content)) return;
    content.forEach(function(c) {
      if (!c) return;
      if (c.parsed !== undefined && c.parsed !== null) {
        structured = c.parsed;
        return;
      }
      if (c.json !== undefined && c.json !== null) {
        structured = c.json;
        return;
      }
      if (typeof c.text === 'string') {
        chunks.push(c.text);
        return;
      }
      if (c.text && typeof c.text.value === 'string') {
        chunks.push(c.text.value);
        return;
      }
      if (typeof c.refusal === 'string') {
        chunks.push(c.refusal);
      }
    });
  });
  if (structured !== null) return JSON.stringify(structured);
  return chunks.join('').trim();
}

function parseArchiJsonOutput_(value) {
  var text = String(value || '').trim().replace(/^\uFEFF/, '');
  var parsed = parseArchiJson_(text, null);
  if (typeof parsed === 'string') parsed = parseArchiJson_(parsed, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;

  var fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) {
    parsed = parseArchiJson_(String(fence[1] || '').trim(), null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  }

  var start = text.indexOf('{');
  var end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    parsed = parseArchiJson_(text.slice(start, end + 1), null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  }
  return null;
}

function summarizeArchiOutput_(value) {
  return String(value || '').replace(/\s+/g, ' ').slice(0, 220);
}

function parseArchiAnswerMap_(answerText, keys) {
  var map = {};
  var lines = String(answerText || '').split(/\r?\n/);
  var suffixChoices = parseArchiNumberedChoiceLines_(lines);
  keys.forEach(function(k) {
    var suffix = getArchiAnswerKeySuffix_(k);
    if (suffixChoices[suffix]) map[k] = suffixChoices[suffix];
  });
  lines.forEach(function(line) {
    var clean = String(line || '').trim();
    if (!clean) return;
    keys.forEach(function(k) {
      if (map[k]) return;
      var leading = parseArchiLeadingAnswerToken_(clean);
      if (leading && leading.key === getArchiAnswerKeySuffix_(k)) {
        var leadingChoice = extractArchiChoiceTokens_(leading.rest)[0];
        if (leadingChoice) {
          map[k] = leadingChoice;
          return;
        }
      }
      var cells = clean.split(/\s*\|\s*|\t+/).map(function(cell) {
        return String(cell || '').trim();
      }).filter(String);
      if (cells.length >= 2 && normalizeArchiAnswerKeyToken_(cells[0]) === String(k)) {
        var cellChoice = extractArchiChoiceTokens_(cells[1])[0];
        if (cellChoice) {
          map[k] = cellChoice;
          return;
        }
      }
      var re = new RegExp('^\\s*(?:No\\.?\\s*)?(?:問|小問)?\\s*' + escapeRegExp_(k) + '\\s*[\\.．:：\\)）]?\\s*(?:正答\\s*)?(?:[=＝]\\s*)?([1-5１-５①②③④⑤])');
      var m = clean.match(re);
      if (m) map[k] = normalizeArchiChoiceToken_(m[1]);
    });
  });
  if (Object.keys(map).length === 0) {
    var tokens = extractArchiChoiceTokens_(answerText);
    if (tokens.length !== keys.length) tokens = [];
    keys.forEach(function(k, i) {
      if (tokens[i]) map[k] = tokens[i];
    });
  }
  return map;
}

function parseArchiNumberedChoiceLines_(lines) {
  var map = {};
  (lines || []).forEach(function(line) {
    var clean = String(line || '').trim();
    var leading = parseArchiLeadingAnswerToken_(clean);
    if (!leading || !leading.key || map[leading.key]) return;
    var choice = extractArchiChoiceTokens_(leading.rest)[0];
    if (choice) map[leading.key] = choice;
  });
  return map;
}

function parseArchiLeadingAnswerToken_(value) {
  var m = String(value || '').trim().match(/^([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|[1-9]\d*|[１-９][０-９]*)\s*(?:[\.．:：\)）]|\s+)\s*(.*)$/);
  if (!m) return null;
  var key = normalizeArchiNumberToken_(m[1]);
  return key ? { key: key, rest: String(m[2] || '') } : null;
}

function getArchiAnswerKeySuffix_(value) {
  var nums = String(value || '').match(/\d+/g) || [];
  if (nums.length) return String(Number(nums[nums.length - 1]));
  return normalizeArchiAnswerKeyToken_(value);
}

function extractArchiChoiceTokens_(value) {
  var text = String(value || '');
  var raw = text.match(/[①②③④⑤]/g) || [];
  if (!raw.length) raw = text.match(/[１-５]/g) || [];
  if (!raw.length) raw = text.match(/\b[1-5]\b/g) || [];
  return raw.map(normalizeArchiChoiceToken_).filter(String);
}

function normalizeArchiAnswerKeyToken_(value) {
  var m = String(value || '').trim().match(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]|[0-9]+|[０-９]+/);
  return m ? normalizeArchiNumberToken_(m[0]) : '';
}

function normalizeArchiNumberToken_(value) {
  var s = String(value || '').trim();
  var circled = {
    '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5',
    '⑥': '6', '⑦': '7', '⑧': '8', '⑨': '9', '⑩': '10',
    '⑪': '11', '⑫': '12', '⑬': '13', '⑭': '14', '⑮': '15',
    '⑯': '16', '⑰': '17', '⑱': '18', '⑲': '19', '⑳': '20'
  };
  if (circled[s]) return circled[s];
  var normalized = s.replace(/[０-９]/g, function(ch) {
    return String(ch.charCodeAt(0) - 0xFF10);
  });
  var m = normalized.match(/\d+/);
  return m ? String(Number(m[0])) : '';
}

function normalizeArchiChoiceToken_(value) {
  var s = String(value || '').trim();
  var map = {
    '1': '1', '１': '1', '①': '1',
    '2': '2', '２': '2', '②': '2',
    '3': '3', '３': '3', '③': '3',
    '4': '4', '４': '4', '④': '4',
    '5': '5', '５': '5', '⑤': '5'
  };
  return map[s] || '';
}

function compareArchiAnswerKeys_(a, b) {
  var aa = String(a).match(/\d+/g) || [];
  var bb = String(b).match(/\d+/g) || [];
  var len = Math.max(aa.length, bb.length);
  for (var i = 0; i < len; i++) {
    var an = Number(aa[i] || 0);
    var bn = Number(bb[i] || 0);
    if (an !== bn) return an - bn;
  }
  return String(a).localeCompare(String(b));
}

function escapeRegExp_(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseArchiJson_(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (e) {
    return fallback;
  }
}

function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text || ''), Utilities.Charset.UTF_8);
  var out = [];
  for (var i = 0; i < bytes.length; i++) {
    var v = bytes[i];
    if (v < 0) v += 256;
    var h = v.toString(16);
    if (h.length < 2) h = '0' + h;
    out.push(h);
  }
  return out.join('');
}

function apiAdminDashboard(clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    var ctx = requireManager_(clientUserKey);
    var statusMap = getArchiRubricStatusMap_();
    var questions = readRecords_(SHEETS.Questions).filter(function(q) {
      return !isArchiPracticeOnlyStatus_(statusMap[String(q.qId)]);
    });
    var qIdMap = {};
    var yearCounts = {};
    var typeTotals = {};
    questions.forEach(function(q) {
      var qId = String(q.qId || '').trim();
      var year = String(q.year || '').trim();
      if (qId) qIdMap[qId] = q;
      if (year) yearCounts[year] = (yearCounts[year] || 0) + 1;
      var typeLabel = getArchiAdminTypeLabel_(q);
      typeTotals[typeLabel] = (typeTotals[typeLabel] || 0) + 1;
    });
    var yearOrder = function(value) {
      var m = String(value || '').match(/^([HR])(\d+)$/);
      if (!m) return 0;
      var y = Number(m[2] || 0);
      if (m[1] === 'H') return 1988 + y;
      if (m[1] === 'R') return 2018 + y;
      return 0;
    };
    var completionColumns = Object.keys(yearCounts).sort(function(a, b) { return yearOrder(a) - yearOrder(b); }).map(function(year) {
      return { key: year, label: year, total: Number(yearCounts[year] || 0) };
    });

    var users = readRecords_(SHEETS.Users);
    var usersByEmail = {};
    users.forEach(function(u) {
      var email = String(u.email || '').trim().toLowerCase();
      if (email) usersByEmail[email] = u;
    });

    var statsByUserKey = {};
    readRecords_(SHEETS.Notes).forEach(function(n) {
      var key = String(n.userKey || '').trim();
      if (!key) return;
      if (!statsByUserKey[key]) statsByUserKey[key] = {
        noteCount: 0,
        answeredCount: 0,
        answeredQids: {},
        answeredByYear: {},
        lastActivity: '',
        scorePctSum: 0,
        scoreCount: 0,
        last7DaysCount: 0,
        typeStats: {}
      };
      var st = statsByUserKey[key];
      var hasAnswer = String(n.note || '').trim() !== '';
      if (hasAnswer) st.noteCount += 1;
      var qId = String(n.qId || '').trim();
      if (hasAnswer && qId && !st.answeredQids[qId]) {
        st.answeredQids[qId] = true;
        st.answeredCount += 1;
        var q = qIdMap[qId] || {};
        var year = String(q.year || '').trim();
        if (year) {
          if (!st.answeredByYear[year]) st.answeredByYear[year] = {};
          st.answeredByYear[year][qId] = true;
        }
        var typeLabel = getArchiAdminTypeLabel_(q);
        if (!st.typeStats[typeLabel]) st.typeStats[typeLabel] = { answered: 0, scorePctSum: 0, scoreCount: 0 };
        st.typeStats[typeLabel].answered += 1;
      }
      var at = formatAdminDate_(n.createdAt);
      if (at && at > st.lastActivity) st.lastActivity = at;
      if (isAdminWithinLast7Days_(n.createdAt)) st.last7DaysCount += 1;
    });

    var accessRows = readRecordsFromSheet_(getUserAccessSheet_());
    var rows = [];
    accessRows.forEach(function(access) {
      var email = String(access.email || '').trim().toLowerCase();
      if (!email) return;
      var active = normalizeUserAccessBoolean_(access.active, true) !== 'false';
      var showInDashboard = normalizeUserAccessBoolean_(access.showInDashboard, true) !== 'false';
      if (!active || !showInDashboard) return;
      if (ctx.role === 'manager' && String(access.managerEmail || '').trim().toLowerCase() !== ctx.email) return;
      var u = usersByEmail[email] || {};
      var stats = statsByUserKey[String(u.userKey || '')] || {
        noteCount: 0,
        answeredCount: 0,
        answeredQids: {},
        answeredByYear: {},
        lastActivity: '',
        scorePctSum: 0,
        scoreCount: 0,
        last7DaysCount: 0,
        typeStats: {}
      };
      var completedByUnit = {};
      var unitProgress = {};
      completionColumns.forEach(function(col) {
        var colKey = String(col.key || '');
        var answeredMap = (stats.answeredByYear || {})[colKey] || {};
        var answered = Object.keys(answeredMap).length;
        var total = Number(col.total || 0);
        unitProgress[colKey] = { answered: answered, total: total };
        if (total > 0 && answered >= total) completedByUnit[colKey] = true;
      });
      rows.push({
        email: email,
        displayName: String(access.displayName || u.displayName || email).trim(),
        role: String(access.role || 'user').trim().toLowerCase(),
        userKey: String(u.userKey || ''),
        answeredCount: stats.answeredCount,
        noteCount: stats.noteCount,
        totalQuestions: questions.length,
        progressPct: questions.length ? Math.round(stats.answeredCount / questions.length * 1000) / 10 : 0,
        lastActivity: stats.lastActivity,
        avgScorePct: stats.scoreCount > 0 ? Math.round(stats.scorePctSum / stats.scoreCount * 10) / 10 : 0,
        last7DaysCount: stats.last7DaysCount || 0,
        typeStats: buildAdminTypeStats_(typeTotals, stats.typeStats),
        completedByUnit: completedByUnit,
        unitProgress: unitProgress
      });
    });

    return toSerializable_({ auth: getCurrentAuthInfo_(clientUserKey), totalQuestions: questions.length, completionColumns: completionColumns, users: rows });
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

function getArchiSelfScorePct_(score) {
  var n = Number(score || 0);
  if (n >= 5) return 100;
  if (n === 4) return 90;
  if (n === 3) return 70;
  if (n === 2) return 50;
  if (n === 1) return 0;
  return 0;
}

function getArchiAdminTypeLabel_(q) {
  var n = Number(q && q.number || 0);
  var text = [
    q && q.questionType || '',
    q && q.tags || '',
    q && q.stem || ''
  ].join(' ');
  if (n === 1 || text.indexOf('経験') >= 0) return '経験記述';
  if (n === 2 || /仮設|安全|災害/.test(text)) return '仮設・安全';
  if (n === 3 || /施工管理|工程|品質/.test(text)) return '施工管理';
  if (n === 4 || /躯体|鉄筋|型枠|コンクリート/.test(text)) return '躯体施工';
  if (n === 5 || /仕上|防水|内装|外装|タイル/.test(text)) return '仕上施工';
  if (n === 6 || /法規|建設業法|建築基準法|労働安全衛生法/.test(text)) return '法規';
  return 'その他';
}

function buildAdminTypeStats_(typeTotals, userTypeStats) {
  return Object.keys(typeTotals || {}).sort().map(function(label) {
    var s = (userTypeStats || {})[label] || {};
    var answered = Number(s.answered || 0);
    var scoreCount = Number(s.scoreCount || 0);
    return {
      label: label,
      answered: answered,
      total: Number(typeTotals[label] || 0),
      avgScorePct: scoreCount > 0 ? Math.round(Number(s.scorePctSum || 0) / scoreCount * 10) / 10 : 0
    };
  });
}

function isAdminWithinLast7Days_(value) {
  if (!value) return false;
  var d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return false;
  return (new Date().getTime() - d.getTime()) <= 7 * 24 * 60 * 60 * 1000;
}

function apiSyncDashboardRoster(clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    requireAdmin_(clientUserKey);
    return syncDashboardRosterForCurrentApp_();
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

function apiAdminListUserAccess(clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    requireAdmin_(clientUserKey);
    return toSerializable_(readRecordsFromSheet_(getUserAccessSheet_()));
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

function apiAdminUpsertUserAccess(payload, clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    requireAdmin_(clientUserKey);
    var list = Array.isArray(payload) ? payload : [payload];
    var count = 0;
    list.forEach(function(item) {
      if (!item) return;
      var email = String(item.email || '').trim().toLowerCase();
      if (!email) return;
      upsertUserAccess_(item);
      count += 1;
    });
    return { ok: true, updated: count };
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

function apiAdminImportUserAccessCsv(csvText, clientUserKey) {
  __clientUserKey = clientUserKey || '';
  try {
    requireAdmin_(clientUserKey);
    var parsed = Utilities.parseCsv(String(csvText || '').trim());
    if (!parsed || parsed.length < 2) return { ok: true, imported: 0 };
    var header = parsed[0].map(function(h) { return String(h || '').trim().toLowerCase(); });
    var imported = 0;
    for (var r = 1; r < parsed.length; r++) {
      var row = {};
      for (var c = 0; c < header.length; c++) row[header[c]] = parsed[r][c];
      var email = String(row.email || '').trim().toLowerCase();
      if (!email) continue;
      upsertUserAccess_(row);
      imported += 1;
    }
    return { ok: true, imported: imported };
  } catch (e) {
    return { _error: true, message: String(e.message || e) };
  }
}

function upsertUserAccess_(item) {
  var sh = getUserAccessSheet_();
  var headers = HEADERS[SHEETS.UserAccess];
  var values = sh.getDataRange().getValues();
  var target = String(item.email || '').trim().toLowerCase();
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  var row = [
    target,
    String(item.role || 'user').trim().toLowerCase(),
    String(item.managerEmail || '').trim().toLowerCase(),
    normalizeUserAccessBoolean_(item.active, true),
    now,
    String(item.displayName || '').trim(),
    normalizeUserAccessBoolean_(item.showInDashboard, true)
  ];
  var emailCol = headers.indexOf('email');
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][emailCol] || '').trim().toLowerCase() === target) {
      sh.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return;
    }
  }
  sh.appendRow(row);
}

function formatAdminDate_(value) {
  if (!value) return '';
  if (value instanceof Date) return Utilities.formatDate(value, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  var d = new Date(value);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  return String(value);
}
