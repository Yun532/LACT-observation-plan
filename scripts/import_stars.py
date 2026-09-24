"""Export only public V<=8 stellar fields from the supplied server catalog.

Local source (requires PyArrow):
  python scripts/import_stars.py --source-dir /path/to/SII_target_catalog_20260916_mag14
Read over SSH; PyArrow is needed only on the server, which is never modified:
  python scripts/import_stars.py --ssh-host USER@HOST --identity /path/to/key --source-dir /path/to/catalog
Offline output validation:
  python scripts/import_stars.py --check
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import re
import shlex
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAIA_FILE = "gaia_enriched_allsky.parquet"
SIMBAD_FILE = "simbad_v14_with_coordinates.parquet"
MAG_LIMIT = 8
PHOTOMETRY = {
    "SIMBAD Johnson V": "simbad-v",
    "Original JSDC Johnson V": "jsdc-v",
    "Gaia GSPC synthetic V": "gaia-synthetic-v",
}
# SIMBAD can list both stellar and nonstellar historical classifications. Its
# primary nonstellar class wins here; unresolved UV/X-only sources are not stars.
NONSTELLAR = {"G", "AGN", "GlC", "GiG", "Cl*", "OpC", "rG", "As*", "Sy2", "GrG", "GiP", "SBG", "LIN", "BLL", "SN*"}
GAIA_COLUMNS = ["source_id", "oid", "main_id", "ra", "dec", "pmra", "pmdec", "Vmag", "v_source", "otypes"]
SIMBAD_COLUMNS = ["oid", "main_id", "ra", "dec", "pmra", "pmdec", "V", "otype", "otypes"]


def compact(data):
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def finite(value):
    return value is not None and math.isfinite(value)


def clean(value):
    return " ".join(re.sub(r"<[^>]*>", " ", html.unescape(value or "")).split())


def stellar(types):
    return bool({"*", "**"} & set((types or "").split("|")))


def source_record(row, gaia):
    ident = str(row["source_id"] if gaia else row["oid"])
    magnitude = row["Vmag"] if gaia else row["V"]
    values = (row["ra"], row["dec"], magnitude)
    if not all(finite(v) for v in values) or not (0 <= row["ra"] < 360 and -90 <= row["dec"] <= 90):
        raise ValueError(f"Invalid public position/magnitude in {'Gaia' if gaia else 'SIMBAD'} {ident}")
    if magnitude > MAG_LIMIT:
        raise ValueError("Magnitude filter was not applied")
    mag_source = PHOTOMETRY[row["v_source"]] if gaia else "simbad-v"
    record = {
        "id": f"star:{'gaia-dr3' if gaia else 'simbad'}-{ident}",
        "name": clean(row["main_id"]) or f"{'Gaia DR3' if gaia else 'SIMBAD'} {ident}",
        "ra": round(row["ra"], 7), "dec": round(row["dec"], 7),
        "mag": round(magnitude, 4), "band": "V",
        "epochJYear": 2016 if gaia else 2000, "photometrySource": mag_source,
    }
    if finite(row["pmra"]) and finite(row["pmdec"]):
        record["pmRA"] = round(row["pmra"], 3)
        record["pmDec"] = round(row["pmdec"], 3)
    # Missing PM is omitted, never turned into a measured zero.
    return record


def extract(source_dir):
    import pyarrow.dataset as ds
    import pyarrow.parquet as pq

    base = Path(source_dir)
    inputs = []
    for name, columns in [(GAIA_FILE, GAIA_COLUMNS), (SIMBAD_FILE, SIMBAD_COLUMNS)]:
        path = base / name
        parquet = pq.ParquetFile(path)
        missing = set(columns) - set(parquet.schema.names)
        if missing:
            raise ValueError(f"{name} missing expected columns {sorted(missing)}")
        stat = path.stat()
        inputs.append({"file": name, "bytes": stat.st_size, "rows": parquet.metadata.num_rows,
            "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds"), "selectedColumns": columns})

    gaia = ds.dataset(base / GAIA_FILE).to_table(columns=GAIA_COLUMNS, filter=ds.field("Vmag") <= MAG_LIMIT).to_pylist()
    simbad = ds.dataset(base / SIMBAD_FILE).to_table(columns=SIMBAD_COLUMNS, filter=ds.field("V") <= MAG_LIMIT).to_pylist()
    if len({r["source_id"] for r in gaia}) != len(gaia) or len({r["oid"] for r in simbad}) != len(simbad):
        raise ValueError("Duplicate upstream identifier; inspect rather than silently collapse")

    simbad_by_oid = {r["oid"]: r for r in simbad}
    stars, included_oids = [], set()
    rejected_gaia, rejected_simbad, matched_simbad = 0, 0, 0
    for row in gaia:
        counterpart = simbad_by_oid.get(row["oid"])
        if (row["otypes"] and not stellar(row["otypes"])) or (counterpart and counterpart["otype"] in NONSTELLAR):
            rejected_gaia += 1
            continue
        stars.append(source_record(row, gaia=True))
        if row["oid"] is not None:
            included_oids.add(row["oid"])
    for row in simbad:
        if row["otype"] in NONSTELLAR or not stellar(row["otypes"]):
            rejected_simbad += 1
            continue
        if row["oid"] in included_oids:
            matched_simbad += 1
            continue
        stars.append(source_record(row, gaia=False))

    stars.sort(key=lambda star: (star["mag"], star["ra"], star["id"]))
    sources = [
        {"id": "gaia-dr3", "label": "Gaia DR3 astrometry", "url": "https://www.cosmos.esa.int/web/gaia/dr3"},
        {"id": "simbad-v", "label": "SIMBAD catalog V", "url": "https://simbad.cds.unistra.fr/Pages/guide/ch15.htx"},
        {"id": "jsdc-v", "label": "Original JSDC Johnson V (upstream catalog label)", "url": "https://www.jmmc.fr/jsdc"},
        {"id": "gaia-synthetic-v", "label": "Gaia GSPC synthetic Johnson-Cousins V", "url": "https://doi.org/10.1051/0004-6361/202243709"},
    ]
    meta = {"schemaVersion": 1, "catalog": "SII_target_catalog_20260916_mag14 / public bright-star subset",
        "retrievedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "count": len(stars),
        "magnitudeBand": "V", "magnitudeLimit": MAG_LIMIT, "defaultMagnitudeLimit": 3,
        "coverage": "全天 V≤8 目录记录；Gaia DR3 主表补充 SIMBAD 亮星，无中天高度切选。不是恒星完备性声明。",
        "coordinateFrame": "ICRS", "coordinateEpochs": {"Gaia DR3": 2016, "SIMBAD": 2000},
        "properMotion": {"unit": "mas/yr", "pmRA": "mu_alpha_star = cos(dec) * dRA/dt", "pmDec": "dDec/dt", "missing": "fields omitted"},
        "photometry": "V only. SIMBAD/JSDC catalog V and Gaia GSPC synthetic V retain per-record provenance; G magnitudes are not substituted.",
        "photometrySourceCounts": dict(Counter(s["photometrySource"] for s in stars)),
        "coordinateEpochCounts": dict(Counter(str(s["epochJYear"]) for s in stars)),
        "missingProperMotion": sum("pmRA" not in s for s in stars), "sources": sources,
        "quality": {"gaiaV8InputRows": len(gaia), "simbadV8InputRows": len(simbad), "excludedGaiaNonstellar": rejected_gaia,
            "excludedSimbadNonstellarOrUnclassified": rejected_simbad, "simbadKnownIdentityMatches": matched_simbad,
            "simbadAdded": sum(s["epochJYear"] == 2000 for s in stars), "duplicateIds": 0, "missingCoordinates": 0,
            "spatialMerges": 0, "gaiaWithoutSimbadClassification": sum(not r["otypes"] for r in gaia)},
        "inputs": inputs, "recordsSha256": hashlib.sha256(compact(stars).encode("utf-8")).hexdigest(),
        "notes": ["Only published catalog identity, position, magnitude and proper motion fields are exported. No private observing results.",
            "Known identity links use the existing SIMBAD oid; proximity alone never merges stars.",
            "Multiple-star system and component entries can coexist. Counts refer to catalog records.",
            "Catalog V is not a prediction of present brightness; variability, joined photometry and passband provenance can matter.",
            "Gaia sources without a SIMBAD class are retained as catalog point sources. SIMBAD-only UV/X objects, clusters, galaxies and historical supernovae are excluded."]}
    data = {"meta": meta, "stars": stars}
    validate(data)
    return data


def validate(data):
    stars, meta = data["stars"], data["meta"]
    if not stars or len(stars) != meta["count"] or len({s["id"] for s in stars}) != len(stars):
        raise ValueError("Empty stars or invalid record counts/IDs")
    for s in stars:
        if not s["id"].startswith("star:") or s["band"] != "V" or not finite(s["mag"]) or s["mag"] > MAG_LIMIT:
            raise ValueError("Invalid star ID/band/magnitude")
        if not (finite(s["ra"]) and finite(s["dec"]) and 0 <= s["ra"] < 360 and -90 <= s["dec"] <= 90):
            raise ValueError("Invalid coordinate")
        if s["epochJYear"] not in (2000, 2016) or s["photometrySource"] not in PHOTOMETRY.values():
            raise ValueError("Unrecognized epoch or photometry source")
        if ("pmRA" in s) != ("pmDec" in s) or any(not finite(s[k]) for k in ("pmRA", "pmDec") if k in s):
            raise ValueError("Incomplete proper motion")
    if not any(s["name"] == "* alf CMa" and s["mag"] < -1 and s["epochJYear"] == 2000 for s in stars):
        raise ValueError("Sirius missing: do not publish a bright-star layer with only Gaia detections")
    if not any(s["name"] == "* alf Lyr" and s["mag"] < .1 for s in stars):
        raise ValueError("Vega missing from bright-star supplement")
    if any(s["name"] in ("NAME LMC", "NAME CMa Dwarf Galaxy", "SN 2009jb") for s in stars):
        raise ValueError("Nonstellar bright objects leaked into star layer")
    if hashlib.sha256(compact(stars).encode("utf-8")).hexdigest() != meta["recordsSha256"]:
        raise ValueError("Record checksum mismatch")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", help="Server catalog directory; paths are not included in the public output")
    parser.add_argument("--ssh-host")
    parser.add_argument("--identity", help="Local SSH identity path; never read or exported by this script")
    parser.add_argument("--output", type=Path, default=ROOT / "public" / "data" / "stars.json")
    parser.add_argument("--stdout", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        data = json.loads(args.output.read_text(encoding="utf-8"))
    elif args.ssh_host:
        if not args.source_dir:
            parser.error("--ssh-host requires --source-dir")
        command = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15"]
        if args.identity:
            command += ["-i", args.identity]
        command += [args.ssh_host, "python3 - --stdout --source-dir " + shlex.quote(args.source_dir)]
        result = subprocess.run(command, input=Path(__file__).read_text(encoding="utf-8"), text=True,
            encoding="utf-8", capture_output=True, check=True, timeout=180)
        data = json.loads(result.stdout)
    elif args.source_dir:
        data = extract(args.source_dir)
    else:
        parser.error("Supply --source-dir, --ssh-host with --source-dir, or --check")
    validate(data)
    if args.stdout:
        sys.stdout.reconfigure(encoding="utf-8")
        print(compact(data))
    elif not args.check:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(compact(data) + "\n", encoding="utf-8")
    if not args.stdout:
        print(json.dumps({"count": len(data["stars"]), "V<=3": sum(s["mag"] <= 3 for s in data["stars"]),
            "photometrySources": data["meta"]["photometrySourceCounts"], "quality": data["meta"]["quality"]}, indent=2))


if __name__ == "__main__":
    main()
