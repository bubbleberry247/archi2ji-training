#!/usr/bin/env python3
"""Regression tests for the official-PDF-verified R4 choice layout repair."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = Path(__file__).with_name("repair_r4_choice_layout.py")
spec = importlib.util.spec_from_file_location("repair_r4_choice_layout", MODULE_PATH)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

sys.path.insert(0, str(MODULE_PATH.parent))
parser_path = MODULE_PATH.with_name("parse_archi2ji_r1r4.py")
parser_spec = importlib.util.spec_from_file_location("parse_archi2ji_r1r4", parser_path)
assert parser_spec and parser_spec.loader
parser_module = importlib.util.module_from_spec(parser_spec)
parser_spec.loader.exec_module(parser_module)


def load() -> list[dict]:
    return json.loads((ROOT / "data" / "kenchiku2ji_mondai_all.json").read_text(encoding="utf-8"))


before = load()
after = module.repaired_questions(before)
changes = set(module.changed_fields(before, after))
assert changes <= {("Q_R4_5", "stem"), ("Q_R4_6", "stem")}, changes

q5 = next(q for q in after if q["qId"] == "Q_R4_5")
q6 = next(q for q in after if q["qId"] == "Q_R4_6")

q5_lines = q5["stem"].splitlines()
headers = [i for i, line in enumerate(q5_lines) if line == "ａｂｃ"]
assert len(headers) == 8
for header in headers:
    rows = q5_lines[header + 1 : header + 6]
    assert len(rows) == 5
    assert all(row.startswith(tuple(chr(0x2460 + n) for n in range(5))) for row in rows)
    assert all(row.count("／") == 2 for row in rows)

q6_lines = q6["stem"].splitlines()
for key, values in module.Q6_CHOICES.items():
    expected = f"{key} {' ／ '.join(values)}"
    assert q6_lines.count(expected) == 1, (key, expected)

# Metadata and the model answer remain byte-for-byte equivalent for both
# target questions; only the presentation text is changed.
for old, new in zip(before, after):
    if old["qId"] in {"Q_R4_5", "Q_R4_6"}:
        for key in old:
            if key != "stem":
                assert old[key] == new[key], (old["qId"], key)
    else:
        assert old == new, old["qId"]

# Rebuild from the OCR/parser sources and compare the same raw parse before and
# after the postprocess. The postprocess itself must affect only R4 Q5/Q6 stems,
# regardless of older curated differences in the tracked derived JSON.
raw_parser_questions: list[dict] = []
for year in parser_module.YEARS:
    raw_parser_questions.extend(parser_module.parse_year(year))
processed_parser_questions = module.postprocess_parser_questions(raw_parser_questions)
parser_changes: list[tuple[str, int, str]] = []
for old, new in zip(raw_parser_questions, processed_parser_questions):
    assert old.keys() == new.keys()
    for field in old:
        if old[field] != new[field]:
            parser_changes.append((old["year"], old["questionNumber"], field))
assert set(parser_changes) == {("R4", 5, "stem"), ("R4", 6, "stem")}, parser_changes
assert len(raw_parser_questions) == len(processed_parser_questions) == 24

print("R4 layout regression: PASS")
print("  tables: Q_R4_5=8 x 5 rows")
print("  choices: Q_R4_6=6 separated rows")
print("  changed fields: only Q_R4_5.stem and Q_R4_6.stem")
print("  parser postprocess delta: only R4 Q5.stem and R4 Q6.stem")
