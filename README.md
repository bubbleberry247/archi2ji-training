# archi2ji-training

建築施工管理技士 二次試験 学習支援アプリ（H28-R7、10年分）

## 概要
- 試験形式: 記述式（経験記述・選択記述）
- データ: H28〜R7 テキスト抽出済み JSON + 統合JSON（60問）
- ステータス: **公開済み**（GAS Webアプリ実装済み）
- 公開URL: https://script.google.com/macros/s/AKfycbxtZzcKpx0DTlBEMfyBQECD66bjfeMKdw6pSPdRuEF9gJWSurHHmbybGOIEFd5kHgS4/exec

## データ
- `data/kenchiku2ji_XX_text.json`: 年度別テキスト抽出済み問題
- `data/kenchiku2ji_mondai_all.json`: 全問統合JSON
- `data/scoring_rubrics.json`: AI採点・正答キー採点用ルーブリック（60件）

## AI採点
- `ScoringRubrics` シートにルーブリックを投入し、`AiGradings` シートに採点履歴を保存する
- AI接続設定はGASのScript Propertiesで管理し、`AI_PROVIDER` 未設定時は従来どおり `openai` を使用する
- OpenAI設定: `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-5.4-mini`
- Azure OpenAI設定: `AI_PROVIDER=azure`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_KEY`。必要な場合だけ完全URLを `AZURE_OPENAI_RESPONSES_URL` に設定する
- 共通設定: `OPENAI_REASONING_EFFORT=low`, `OPENAI_MAX_OUTPUT_TOKENS=1800`。Azureのデプロイ名から基盤モデルを判定できない場合は `AZURE_OPENAI_MODEL=gpt-5.4-mini` を設定する
- APIキーはソースコード・Git・READMEへ記録しない。`AI_PROVIDER=azure` でAzure設定が不足している場合、OpenAIへ自動フォールバックせず採点を停止する
- `practice_only` / `needs_answer_key` は採点対象外、`deterministic` は正答キーでローカル採点、`rubric_ai` / `ai_estimate` のみ設定されたResponses APIで採点
- `reference_only` は「AI推定点・公式採点ではありません」と表示し、既存の自己採点・進捗集計には反映しない
- ルーブリック投入: `python tools/import_scoring_rubrics.py --url <exec_url> --maintenance-token <token>`
- 問題データ再投入: `python tools/import_archi2ji.py --url <exec_url> --maintenance-token <token>`

## 実装状況
- 年度別一覧、問題一覧、問題詳細、模範解答表示、メモ、自己採点を実装済み
- 2026-06-17: R1-R7各6問（計42問）に統合し、既存公開IDを @16 に更新
- 2026-06-22: H28-H30各6問を追加し、H28-R7各6問（計60問）に統合
- 2026-06-22: AI採点v1を追加（Rubrics投入、AI/正答キー採点、採点履歴保存）
- QuestionBankは60問、重複0件を診断対象に更新
- 2026-06-17: UserAccess（既存 建築/土木 一次系と同じ26名）と管理画面を追加し、公開IDを @18 に更新
- 2026-06-18: 42問すべてに学習用の参考答案・採点観点を投入し、公開IDを @19 に更新
- 公開診断: 60問 / 重複0 / UserAccess 26名 / admin 8名
- 注意: `modelAnswer` は公式解答ではなく、学習用の参考答案・採点観点として投入している

## 学習方針（調査済み）
- 記述式は手書き練習が必須（試験本番が手書き）
- アプリの役割: 穴埋め・択一の反復 + 模範解答の研究
- 経験記述: 逆算テンプレート法（評価→対応→課題）
