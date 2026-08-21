import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const readJson = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const questions = readJson('data/kenchiku2ji_mondai_all.json');
const rubrics = readJson('data/scoring_rubrics.json');
const pdfMirrorDir = process.env.ARCHI_QA_PDF_MIRROR || path.join(root, 'output', 'question-images', 'pdfs');
const qid = row => String(row?.qId ?? '').trim();
const nonblank = value => value !== undefined && value !== null && String(value).trim() !== '';
const ids = rows => rows.map(qid);
const unique = values => [...new Set(values)];
const byId = rows => Object.fromEntries(rows.filter(row => qid(row)).map(row => [qid(row), row]));
const countBy = (rows, selector) => rows.reduce((out, row) => {
  const key = String(selector(row));
  out[key] = (out[key] || 0) + 1;
  return out;
}, {});
const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');

const requiredQuestionFields = ['qId', 'year', 'questionNumber', 'questionType', 'responseType', 'stem', 'modelAnswer', 'tags'];
const requiredRubricFields = ['qId', 'responseType', 'sourceQuality', 'scoreMode', 'maxScore', 'rubricJson', 'reviewStatus'];
const missingFields = (rows, fields) => Object.fromEntries(fields
  .map(field => [field, rows.filter(row => !nonblank(row[field])).map(qid)])
  .filter(([, missing]) => missing.length));

const questionIds = ids(questions);
const rubricIds = ids(rubrics);
const questionById = byId(questions);
const rubricById = byId(rubrics);
const duplicateQuestionIds = unique(questionIds.filter((id, index) => questionIds.indexOf(id) !== index));
const duplicateRubricIds = unique(rubricIds.filter((id, index) => rubricIds.indexOf(id) !== index));
const missingRubricIds = questionIds.filter(id => !rubricById[id]);
const extraRubricIds = rubricIds.filter(id => !questionById[id]);

const imageRequired = questions.filter(q => q.imageRequired === true).map(qid);
const imageUrlsPresent = questions.filter(q => Array.isArray(q.imageUrls) && q.imageUrls.length > 0).map(qid);
const imageRequiredMissing = questions.filter(q => q.imageRequired === true && !(Array.isArray(q.imageUrls) && q.imageUrls.length > 0)).map(qid);
const unexpectedImageUrls = questions.filter(q => q.imageRequired !== true && Array.isArray(q.imageUrls) && q.imageUrls.length > 0).map(qid);

const statusOf = rubric => {
  const scoreMode = String(rubric.scoreMode || '').trim();
  const reviewStatus = String(rubric.reviewStatus || '').trim();
  const excluded = scoreMode === 'missing' || scoreMode === 'practice_only' || reviewStatus === 'needs_answer_key';
  return { scoreMode, reviewStatus, excluded };
};
const statuses = rubrics.map(statusOf);
const eligibleIds = rubrics.filter((rubric, index) => !statuses[index].excluded).map(qid);
const excludedIds = rubrics.filter((rubric, index) => statuses[index].excluded).map(qid);
const deterministic = rubrics.filter(rubric => String(rubric.scoreMode || '').trim() === 'deterministic');
const deterministicMissingAnswerKey = deterministic.filter(rubric => {
  const correct = rubric.rubricJson && rubric.rubricJson.correctAnswers;
  return !(Array.isArray(correct) ? correct.length > 0 : correct && typeof correct === 'object' && Object.keys(correct).length > 0);
}).map(qid);
const responseTypeMismatch = questions.filter(q => rubricById[qid(q)] && String(q.responseType || '') !== String(rubricById[qid(q)].responseType || '')).map(qid);

const textOf = q => `${String(q.stem || '')}\n${String(q.modelAnswer || '')}`;
const qidsMatching = regex => questions.filter(q => regex.test(textOf(q))).map(qid);
const duplicateParticleMatches = [];
const duplicateParticleFalsePositives = [];
const duplicateParticleRegex = /の{2,}|を{2,}|に{2,}|が{2,}|は{2,}|で{2,}|と{2,}/g;
for (const q of questions) {
  for (const match of textOf(q).matchAll(duplicateParticleRegex)) {
    const context = textOf(q).slice(Math.max(0, match.index - 8), match.index + match[0].length + 8).replace(/\s/g, '');
    if (/とともに|ことと|こととな|ものの/.test(context)) {
      duplicateParticleFalsePositives.push({ qId: qid(q), pattern: match[0] });
    } else {
      duplicateParticleMatches.push({ qId: qid(q), pattern: match[0] });
    }
  }
}

const suspectedOcrLabelIds = qidsMatching(/作業あ/);
const suspectedNumericLossIds = unique([
  ...suspectedOcrLabelIds,
  ...qidsMatching(/![°℃]/),
  ...qidsMatching(/(?:^|[^A-Za-z])[ILO](?=\s*(?:つ|[0-9]))/),
]);
const intendedBlankIds = qidsMatching(/(?:[あいうえお]|[①②③④⑤⑥])\s*(?:日|人|mm|cm|m|kg|kN|℃|°|％|%)/);
const placeholderLabelIds = qidsMatching(/R[〜~]S|Q[〜~]S|T[〜~]U|B[,、]C/);
const bangUnitIds = qidsMatching(/![°℃]/);
const romanOcrIds = qidsMatching(/(?:^|[^A-Za-z])[ILO](?=\s*(?:つ|[0-9]))/);
const unbalancedBracketIds = questions.filter(q => {
  const text = String(q.stem || '');
  return (text.match(/\[/g) || []).length !== (text.match(/\]/g) || []).length;
}).map(qid);
const controlCharIds = questions.filter(q => /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(String(q.stem || ''))).map(qid);
const replacementCharIds = qidsMatching(/�/);
const noNewlineIds = questions.filter(q => !String(q.stem || '').includes('\n')).map(qid);

const multipleChoice = questions.filter(q => q.responseType === 'multiple_choice');
const multipleChoiceInstructionCandidates = multipleChoice.filter(q => {
  const text = String(q.stem || '');
  return !/1つ選びなさい|一つ選びなさい/.test(text);
}).map(qid);
const multipleChoiceAnswerShape = multipleChoice.map(q => {
  const rubric = rubricById[qid(q)] || {};
  const correct = rubric.rubricJson && rubric.rubricJson.correctAnswers;
  return { qId: qid(q), shape: Array.isArray(correct) ? 'array' : correct && typeof correct === 'object' ? 'object' : 'missing' };
});

const yearCounts = countBy(questions, q => q.year);
const sourceEvidence = {
  officialDomainUrlCount: questions.filter(q => String(q.sourceUrl || '').includes('fcip-shiken.jp')).length,
  sourceUrlCount: questions.filter(q => nonblank(q.sourceUrl)).length,
  sourceNoteCount: questions.filter(q => nonblank(q.sourceNote)).length,
  officialTextVerifiedTrueCount: questions.filter(q => q.officialTextVerified === true).length,
  sourceQualityReferenceOnlyCount: questions.filter(q => q.sourceQuality === 'reference_only').length,
  officialDomainAndVerifiedAndNoted: questions.filter(q => String(q.sourceUrl || '').includes('fcip-shiken.jp') && q.officialTextVerified === true && nonblank(q.sourceNote)).map(qid),
  officialDomainWithoutVerifiedMetadata: questions.filter(q => String(q.sourceUrl || '').includes('fcip-shiken.jp') && !(q.officialTextVerified === true && nonblank(q.sourceNote))).map(qid),
  verifiedMetadataWithoutOfficialDomain: questions.filter(q => q.officialTextVerified === true && nonblank(q.sourceNote) && !String(q.sourceUrl || '').includes('fcip-shiken.jp')).map(qid),
  pdfMirrorFiles: fs.existsSync(pdfMirrorDir) ? fs.readdirSync(pdfMirrorDir).filter(name => /\.pdf$/i.test(name)).sort() : [],
};

const result = {
  readOnly: true,
  canonical: {
    questionCount: questions.length,
    rubricCount: rubrics.length,
    questionSha256: sha256File('data/kenchiku2ji_mondai_all.json'),
    rubricSha256: sha256File('data/scoring_rubrics.json'),
    questionIdsUnique: duplicateQuestionIds.length === 0,
    rubricIdsUnique: duplicateRubricIds.length === 0,
    duplicateQuestionIds,
    duplicateRubricIds,
    missingRubricIds,
    extraRubricIds,
    missingQuestionFields: missingFields(questions, requiredQuestionFields),
    missingRubricFields: missingFields(rubrics, requiredRubricFields),
    yearCounts,
    newlineMissingIds: noNewlineIds,
    controlCharIds,
    replacementCharIds,
    unbalancedBracketIds,
  },
  scoring: {
    eligibleCount: eligibleIds.length,
    eligibleIds,
    excludedCount: excludedIds.length,
    excludedIds,
    statusCounts: countBy(statuses, status => `${status.scoreMode}/${status.reviewStatus}/${status.excluded ? 'excluded' : 'eligible'}`),
    deterministicCount: deterministic.length,
    deterministicMissingAnswerKey,
    responseTypeMismatch,
    multipleChoiceCount: multipleChoice.length,
    multipleChoiceInstructionCandidates,
    multipleChoiceAnswerShape,
  },
  media: {
    imageRequiredCount: imageRequired.length,
    imageRequiredIds: imageRequired,
    imageUrlsPresentCount: imageUrlsPresent.length,
    imageRequiredMissing,
    unexpectedImageUrls,
    semanticQuestionChoiceImageMatch: 'unverified: canonical metadata only; image pixels were not semantically compared',
  },
  ocrSuspicion: {
    duplicatedParticleCandidates: unique(duplicateParticleMatches.map(item => item.qId)),
    duplicatedParticleFalsePositives: unique(duplicateParticleFalsePositives.map(item => item.qId)),
    placeholderLabelCandidates: placeholderLabelIds,
    romanILOCandidates: romanOcrIds,
    bangUnitCandidates: bangUnitIds,
    numericLossCandidates: suspectedNumericLossIds,
    intendedBlankFalsePositives: intendedBlankIds,
    figureTailCandidates: [],
    note: 'These are lexical candidates only. No semantic correction is asserted without official-source confirmation.',
  },
  sourceEvidence,
  production: {
    questionCount: null,
    rubricCount: null,
    questionSha256: null,
    rubricSha256: null,
    comparison: 'unverified: this read-only local gate does not read the live spreadsheet',
  },
};

console.log(JSON.stringify(result, null, 2));
