# R4 Q_R4_5 / Q_R4_6 layout repair: import plan

## Scope

- Source checked: `output/question-images/pdfs/r04_1kj_mondai.pdf` (official source URL: `https://www.fcip-shiken.jp/pdf/r04_1kj_mondai.pdf`).
- Local PDF mirror SHA-256: `06fbbc7e0df049267ced86f813445fa1ea6c3482fc00ddccf047a69ab8ba8794` (1,012,352 bytes).
- `Q_R4_5`: restore the eight official a/b/c tables, five rows per table, with explicit row and cell separators.
- `Q_R4_6`: restore the six official candidate groups ①–⑥ with explicit candidate separators.
- Only the `stem` field of these two qIds changes. `modelAnswer`, tags, question type, rubrics, and all other 58 questions remain unchanged.

The OCR parser is not the authority for the missing cell boundaries: its control-character cleanup removes layout marks and its source text has already lost some numeric cells. The parser now invokes the PDF-verified postprocess before writing. The regression gate compares one raw parse before/after that postprocess and requires the only changes to be `R4/Q5/stem` and `R4/Q6/stem`.

## Local dry-run gate

Run from the repository root:

```text
python tools/repair_r4_choice_layout.py
python tools/test_r4_choice_layout.py
node tools/test_r4_stem_maintenance.mjs
```

The first command must report either the two intended stem changes or that the canonical file is already repaired. The layout test must report eight tables × five rows, six separated choice rows, and only the two parser postprocess deltas. The maintenance contract test covers private-only entry points, fixed-pair enforcement, hash checks, backup/re-read checks, row insertion/reordering, atomic forward update, rollback, rollback failure, and idempotency.

## Owner-only production procedure (only after code review and script push)

There is no browser RPC, UI button, `doPost` route, payload argument, or client user key for this repair. Every maintenance function ends in `_`, and the two entry points take no arguments. Run them only from the Google Apps Script editor while signed in as the script owner.

1. After reviewed code is pushed to the Apps Script project, select and run `runR4ChoiceStemRepairDryRun_` in the Apps Script editor.
2. Require `ok=true`, `dryRun=true`, `targetCount=2`, `wouldUpdate=2`, `updated=0`, and no `backupId`. The only accepted hashes are:

   - `Q_R4_5`: old `6d848507ef025a2272e26a79029bd85c338e9c0fd61ff0c594b52a1924f809d6` → new `a334f0123c087c0d4bd330a5e811b90a39abc99d67cd7432f87f250e6f71f6f3`
   - `Q_R4_6`: old `ae8d8131a4617ab27f063db26505b5ec0c59b21b4705b3d8a73c582b47d5bdf9` → new `cbf98e2d96e7c43e5c45093ef0a24b635ef26cc111a3ccd919ce19a7fa11dcbd`

   Any other result is a stop condition.
3. Select and run `runR4ChoiceStemRepairApply_` once. It always processes both fixed qIds or stops; a one-question forward update is rejected. Require `ok=true`, `targetCount=2`, `updated=2`, and a non-empty `backupId`.
4. Run `runR4ChoiceStemRepairDryRun_` again. Require `wouldUpdate=0`, `updated=0`, and `alreadyApplied=2`.

Under one script lock, the apply function checks that each approved old stem occurs exactly once in the entire `stem` column at its corresponding qId, each approved new stem occurs zero times, and the target set is exactly the fixed two qIds. It appends and verifies two complete backup rows, then repeats the qId/hash/count checks immediately before writing.

No forward write uses a row number. The two replacements are sent as two `FindReplaceRequest` subrequests in one Google Sheets `spreadsheets.batchUpdate` HTTP request. Each request is restricted to the `stem` column, uses the complete fixed old stem as `find` and complete fixed new stem as `replacement`, and sets `matchEntireCell=true`, `matchCase=true`, and `searchByRegex=false`. Therefore insertion or reordering immediately before the HTTP send cannot redirect an update to a different row. Both response values must report `occurrencesChanged=1`. Google documents that all subrequests in this method are validated first and applied together atomically: <https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate>. Afterward the function finds both qIds again, requires each new stem exactly once at its matching qId and each old stem zero times, and verifies every non-stem value for every qId plus every non-target stem.

The existing 60-row importer must not be used because it rewrites complete rows.

## Rollback design

- If the batch call or post-write verification throws, automatic rollback first re-reads the full stem column. It proceeds only when both approved new stems each occur exactly once at their corresponding qIds and both old stems occur zero times. It then sends two exact new-to-old `FindReplaceRequest` operations in one batch and requires `occurrencesChanged=1` for each. A mixed, duplicated, or unknown state is not touched automatically and stops as unsafe. Restoration is verified against the complete pre-update state by qId.
- Rollback failure is not swallowed. The execution fails with `ROLLBACK_FAILED`, the `backupId`, the original write code, and the rollback code. Do not report completion in this state.
- For a deliberate rollback after a successful call, use the two `QuestionStemBackups` rows with the returned `backupId`. Parse `headersJson` and `rowValuesJson`, identify `stem` by header name, and re-find each live row by unique `qId`; never trust stored `rowNumber`. Before restoring, require the live stem hash to equal `newStemHash`; restore only `stem`; then verify `oldStemHash` and all other stored columns. Preserve backup rows as the audit trail.
- Do not run a full-sheet import, delete/reseed any sheet, or modify `Notes`, `AnswerDrafts`, `ScoringRubrics`, `AiGradings`, or attempt history during update or rollback.

## 強制終了の限界

The Sheets API guarantees that the two forward cell updates inside its single batch request are applied atomically, so that request does not intentionally create a one-question state. However, if Apps Script is forcibly terminated after sending the HTTP request but before receiving or processing the response, the script cannot know whether the atomic request completed and cannot run its automatic post-verification or rollback. This is an unavoidable 応答不明 window outside Apps Script control.

After any timeout or forced termination, do not run apply blindly. Run the owner-only dry-run first and inspect `QuestionStemBackups`:

- both old hashes: forward update did not remain applied;
- both new hashes: the atomic forward update completed; verify both backup rows and non-stem columns;
- mixed or unknown hash: dry-run stops; use the backupId and qId-based manual recovery procedure above.

The contract test enforces one two-subrequest forward batch call and checks this forced-termination limitation remains documented. External collaborators can still change the sheet after the atomic request; the post-write qId/hash/non-stem verification detects that when the Apps Script execution continues normally.

There is one additional collaborative-editing race that no client-side preflight can eliminate: another editor could insert an exact duplicate of one full approved old stem after the final preflight but before the Sheets service evaluates `FindReplaceRequest`. In that case `occurrencesChanged` would exceed one, verification would fail, and automatic rollback would refuse to guess because the new stem would no longer be unique. To avoid this extreme ambiguity, announce a maintenance window and prohibit all direct edits to `Questions` from the successful dry-run until the apply result and post-dry-run are confirmed. If it still occurs, stop and recover manually from the named backup by qId after inspecting every matching stem.

No production database update, commit, push, or deployment is part of this prepared change.
