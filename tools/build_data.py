from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source"
DATA = ROOT / "data"
MASTER_CSV = SOURCE / "master.csv"
MAPPING_CSV = SOURCE / "transform_mapping.csv"


def read_csv(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        return list(reader), reader.fieldnames or []


def s(value):
    return (value or "").strip()


def unique_records(rows, cols):
    seen = set()
    out = []
    for row in rows:
        rec = tuple(s(row.get(c)) for c in cols)
        if not any(rec):
            continue
        if rec in seen:
            continue
        seen.add(rec)
        out.append(rec)
    return out


def base_station_name(name: str):
    name = s(name)
    m = re.match(r"^(.*?)[（(]([^（）()]*)[）)]$", name)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return name, ""


def build_simple(rows, code_col, value_col):
    records = []
    for code, value in unique_records(rows, [code_col, value_col]):
        if code == "" and value == "":
            continue
        records.append({"code": code, "value": value})
    return records


def build_prefectures(rows):
    records = []
    for code, value in unique_records(rows, ["都道府県コード", "都道府県名"]):
        records.append({"code": code, "value": value})
    return records


def build_municipalities(rows, prefectures):
    pref_by_code = {r["code"]: r["value"] for r in prefectures}
    records = []
    seen = set()
    for row in rows:
        pref_code = s(row.get("市区町村コード対応都道府県コード"))
        city_code = s(row.get("市区町村コード"))
        city_name = s(row.get("市区町村名"))
        if not (pref_code or city_code or city_name):
            continue
        key = (pref_code, city_code, city_name)
        if key in seen:
            continue
        seen.add(key)
        pref_name = pref_by_code.get(pref_code, "")
        full_code = f"{int(pref_code):02d}{int(city_code):03d}" if pref_code.isdigit() and city_code.isdigit() else f"{pref_code}{city_code}"
        full_name = f"{pref_name}{city_name}" if pref_name else city_name
        records.append({
            "prefCode": pref_code,
            "cityCode": city_code,
            "fullCode": full_code,
            "prefName": pref_name,
            "cityName": city_name,
            "fullName": full_name,
        })
    return records


def build_stations(rows):
    records = []
    seen = set()
    for code, name in unique_records(rows, ["最寄駅コード", "駅名"]):
        base, qualifier = base_station_name(name)
        key = (code, name)
        if key in seen:
            continue
        seen.add(key)
        records.append({
            "stationCode": code,
            "stationName": name,
            "baseName": base,
            "qualifier": qualifier,
        })
    return records


def master_id_for(code_col, value_col, sub_col=""):
    if code_col == "公開情報区分コード":
        return "publish_status"
    if code_col == "雇用形態区分コード":
        return "employment_type"
    if code_col == "給与区分コード":
        return "salary_type"
    if code_col == "職種コード":
        return "job_category"
    if code_col == "特徴コード":
        return "feature"
    if code_col == "都道府県コード":
        return "prefecture"
    if code_col == "市区町村コード" or sub_col:
        return "municipality"
    if code_col == "最寄駅コード":
        return "station"
    if code_col == "自分力パラメータコード":
        return "self_power_param"
    if code_col == "自分力パラメータ値":
        return "self_power_value"
    if code_col == "タグコード":
        return "tag"
    if code_col == "固定残業代有無コード":
        return "fixed_overtime"
    if code_col == "勤務形態コード":
        return "work_style"
    if code_col == "社会保険整備状況コード":
        return "social_insurance"
    if code_col == "試用期間有無コード":
        return "trial_period"
    return re.sub(r"\W+", "_", code_col).strip("_") or "unknown"


def linked_pref_column(input_col: str) -> str:
    if not input_col.startswith("市区町村コード"):
        return ""
    suffix = input_col.replace("市区町村コード", "", 1)
    return f"県コード{suffix}"


def build_transform_config(mapping_rows):
    mappings = []
    for row in mapping_rows:
        input_col = s(row.get("入力csv列ヘッダー"))
        code_col = s(row.get("コード"))
        value_col = s(row.get("value"))
        sub_col = s(row.get("市区町村用サブコード"))
        multi_raw = s(row.get("複数値を::で繋ぐ可能性")).upper()
        multi = multi_raw == "TRUE"
        # 前提修正：雇用形態区分は複数値ではない
        if input_col == "雇用形態区分":
            multi = False
        master_id = master_id_for(code_col, value_col, sub_col)
        item = {
            "inputColumn": input_col,
            "masterId": master_id,
            "codeColumn": code_col,
            "valueColumn": value_col,
            "multi": multi,
        }
        if sub_col:
            item["masterSubCodeColumn"] = sub_col
            item["inputSubCodeColumn"] = linked_pref_column(input_col)
        mappings.append(item)
    return {
        "version": "2026-06-14",
        "multiDelimiter": "::",
        "brToken": "<BR>",
        "mappings": mappings,
    }


def main():
    DATA.mkdir(exist_ok=True)
    rows, cols = read_csv(MASTER_CSV)
    mapping_rows, _ = read_csv(MAPPING_CSV)

    prefectures = build_prefectures(rows)
    masters = {
        "version": "2026-06-14",
        "masters": {
            "publish_status": {"type": "simple", "name": "公開情報区分", "records": build_simple(rows, "公開情報区分コード", "公開情報区分")},
            "employment_type": {"type": "simple", "name": "雇用形態区分", "records": build_simple(rows, "雇用形態区分コード", "雇用形態区分")},
            "salary_type": {"type": "simple", "name": "給与区分", "records": build_simple(rows, "給与区分コード", "給与区分")},
            "job_category": {"type": "simple", "name": "職種", "records": build_simple(rows, "職種コード", "職種名（表示名）")},
            "feature": {"type": "simple", "name": "特徴", "records": build_simple(rows, "特徴コード", "特徴名（表示名）")},
            "prefecture": {"type": "prefecture", "name": "都道府県", "records": prefectures},
            "municipality": {"type": "municipality", "name": "市区町村", "records": build_municipalities(rows, prefectures)},
            "station": {"type": "station", "name": "最寄駅", "records": build_stations(rows)},
            "self_power_param": {"type": "simple", "name": "自分力パラメータ", "records": build_simple(rows, "自分力パラメータコード", "自分力パラメータ名（表示名）")},
            "self_power_value": {"type": "simple", "name": "自分力パラメータ値", "records": build_simple(rows, "自分力パラメータ値", "自分力パラメータ値名（表示名）")},
            "tag": {"type": "simple", "name": "タグ", "records": build_simple(rows, "タグコード", "タグ名（表示名）")},
            "fixed_overtime": {"type": "simple", "name": "固定残業代有無", "records": build_simple(rows, "固定残業代有無コード", "固定残業代有無区分")},
            "work_style": {"type": "simple", "name": "勤務形態", "records": build_simple(rows, "勤務形態コード", "勤務形態区分")},
            "social_insurance": {"type": "simple", "name": "社会保険整備状況", "records": build_simple(rows, "社会保険整備状況コード", "社会保険整備状況区分")},
            "trial_period": {"type": "simple", "name": "試用期間有無", "records": build_simple(rows, "試用期間有無コード", "試用期間有無区分")},
        }
    }

    transform_config = build_transform_config(mapping_rows)

    (DATA / "masters.json").write_text(json.dumps(masters, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (DATA / "transform-config.json").write_text(json.dumps(transform_config, ensure_ascii=False, indent=2), encoding="utf-8")

    print("masters written", DATA / "masters.json")
    print("config written", DATA / "transform-config.json")
    for mid, m in masters["masters"].items():
        print(mid, len(m["records"]))


if __name__ == "__main__":
    main()
