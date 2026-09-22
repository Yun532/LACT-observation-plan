"""Rebuild the bundled catalog from public metadata snapshots (Python stdlib only).

python scripts/import_catalog.py                 # reproducible offline rebuild
python scripts/import_catalog.py --refresh       # refresh the two complete public catalogs
python scripts/import_catalog.py --output path/to/sources.json
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import html
import json
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
TEVCAT_URL = "https://tevcat.org/"
LHAASO_URL = "https://casdc.china-vo.org/archive/LHAASO-Gamma-Ray-sources/table.csv"
LHAASO_PAPER = "https://doi.org/10.3847/1538-4365/acfd29"
TEVCAT_FIELDS = "id canonical_name catalog_name catalog_id public coord_ra coord_dec source_type_name other_names flux eth ext size_x size_y spec_idx discovery_date observatory_name coord_gal_lon coord_gal_lat distance distance_mod variability".split()
STATUSES = {1: "established", 2: "newly_announced", 3: "disputed", 4: "candidate"}


def dump(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")


def snapshot_tevcat(body):
    """Keep public scientific metadata only; omit notes, private fields and web code."""
    html = body.decode("utf-8")
    objects = []
    for match in re.finditer(r"var dataObj\s*=\s*", html):
        if html[match.end():].startswith("{"):
            data, _ = json.JSONDecoder().raw_decode(html[match.end():])
            if isinstance(data, dict) and isinstance(data.get("sources"), list):
                objects.append(data)
    if len(objects) != 1:
        raise ValueError(f"Expected one complete TeVCat data object, found {len(objects)}")
    data = objects[0]
    rows = [{k: source.get(k) for k in TEVCAT_FIELDS} for source in data["sources"] if source.get("public") == 1]
    return {"totalEmbeddedRecords": len(data["sources"]), "publicRecords": len(rows),
            "catalogs": {k: {f: v.get(f) for f in ("id", "name", "description")} for k, v in data["catalogs"].items()},
            "sources": rows}


def refresh():
    RAW.mkdir(parents=True, exist_ok=True)
    manifest = {"retrievedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), "inputs": []}
    for name, url, transform in [("tevcat-public-metadata.json", TEVCAT_URL, snapshot_tevcat), ("lhaaso-table.csv", LHAASO_URL, None)]:
        request = Request(url, headers={"User-Agent": "LACT-observation-plan/1.0 (+https://github.com/Yun532/LACT-observation-plan)"})
        with urlopen(request, timeout=60) as response:
            body = response.read()
            info = {"path": name, "url": url, "responseSha256": hashlib.sha256(body).hexdigest(),
                    "responseBytes": len(body), "lastModified": response.headers.get("Last-Modified")}
        if transform:
            dump(RAW / name, transform(body))
            info["projection"] = "All public rows; allowlisted scientific metadata fields; no notes or private fields."
        else:
            (RAW / name).write_bytes(body)
        info["snapshotSha256"] = hashlib.sha256((RAW / name).read_bytes()).hexdigest()
        manifest["inputs"].append(info)
    dump(RAW / "manifest.json", manifest)


def number(value):
    if value is None or str(value).strip() == "":
        return None
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"Non-finite catalog number {value!r}")
    return result


def sexagesimal(value, hours=False):
    value = value.strip()
    parts = [float(x) for x in value.lstrip("+-").split()]
    if len(parts) != 3 or not 0 <= parts[1] < 60 or not 0 <= parts[2] < 60:
        raise ValueError(f"Invalid sexagesimal coordinate {value!r}")
    result = parts[0] + parts[1] / 60 + parts[2] / 3600
    return round(result * (-1 if value.startswith("-") else 1) * (15 if hours else 1), 8)


def plain_text(value):
    value = html.unescape(value or "")
    return " ".join(re.sub(r"<[^>]*>|<[^>]*$", " ", value).split())


def tevcat_sources(snapshot):
    result = []
    for row in snapshot["sources"]:
        name = plain_text(row["canonical_name"])
        # Split actual and escaped breaks, including TeVCat 87's malformed '<br2HWC'.
        other_names = html.unescape(row.get("other_names") or "")
        aliases = [row["catalog_name"]] + re.split(r"<br\s*/?>|<br(?=[0-9A-Z])|[,;\r\n]", other_names, flags=re.I)
        aliases = list(dict.fromkeys(plain_text(x) for x in aliases if plain_text(x) and plain_text(x) != name))
        flux = number(row["flux"])
        threshold = number(row["eth"])
        size_x, size_y = number(row["size_x"]), number(row["size_y"])
        result.append({
            "id": f"tevcat-{row['id']}", "name": name, "catalog": "TeVCat",
            "ra": sexagesimal(row["coord_ra"], hours=True), "dec": sexagesimal(row["coord_dec"]),
            "type": plain_text(row["source_type_name"]) or "Unclassified", "aliases": aliases,
            "reference": f"https://tevcat.org/?mode=1&showsrc={row['id']}",
            "status": STATUSES[int(row["catalog_id"])], "defaultIncluded": int(row["catalog_id"]) in (1, 2),
            "flux": None if flux is None else {"value": flux, "unit": "Crab", "energy": f"> {threshold:g} GeV" if threshold else "threshold not supplied",
                "kind": "catalog-representative", "energyThresholdGeV": threshold, "comparisonGroup": "TeVCat-Crab", "heterogeneousThresholds": True,
                **({"qualityFlag": "nonpositive-value-in-catalog"} if flux <= 0 else {})},
            "extension": None if size_x is None and size_y is None else {"kind": "catalog-angular-size", "xDeg": size_x, "yDeg": size_y, "unit": "deg"},
            "extended": None if row["ext"] is None else bool(row["ext"]),
            "spectralIndex": number(row["spec_idx"]), "discovery": row["discovery_date"], "observatory": plain_text(row["observatory_name"]) or None,
        })
    return result


def lhaaso_sources(text):
    groups = defaultdict(list)
    for raw in csv.DictReader(io.StringIO(text)):
        if None in raw:
            raise ValueError("LHAASO CSV column count changed")
        row = {key.strip(): value.strip() for key, value in raw.items()}
        groups[row["Source name"]].append(row)
    if len(groups) != 90 or sum(map(len, groups.values())) != 180:
        raise ValueError("The first LHAASO catalog must contain exactly 90 sources / 180 components")
    result = []
    for raw_name, rows in groups.items():
        components, associations = [], []
        for row in rows:
            detector = row["components"].strip("* ")
            if detector not in ("WCDA", "KM2A"):
                raise ValueError(f"Unknown LHAASO component {detector}")
            detected = number(row["Ra"]) is not None
            amplitude, error = number(row["N0"]), number(row["N0 error"])
            factor, energy = (1e-13, 3) if detector == "WCDA" else (1e-16, 50)
            # The machine table encodes an upper limit as value=0, limit in its error column.
            upper_limit = amplitude == 0
            flux = {"value": float(f"{(error if upper_limit else amplitude) * factor:.10g}"), "unit": "cm-2 s-1 TeV-1",
                    "energy": f"{energy} TeV", "referenceEnergyTeV": energy, "kind": "differential", "upperLimit": upper_limit,
                    "confidence": 0.95 if upper_limit else None, "error": None if upper_limit else float(f"{error * factor:.10g}"),
                    "comparisonGroup": f"1LHAASO-{detector}-{energy}TeV"}
            radius, radius_error = number(row["r39"]), number(row["r39 error"])
            extension = None if radius is None else {"kind": "gaussian-r39", "radiusDeg": radius_error if radius == 0 else radius,
                    "errorDeg": None if radius == 0 else radius_error, "upperLimit": radius == 0, "confidence": 0.95 if radius == 0 else None}
            components.append({"detector": detector, "detected": detected, "ra": number(row["Ra"]), "dec": number(row["Dec"]),
                    "positionError95Deg": number(row["positional error"]), "ts": number(row["TS"]), "ts100": number(row["TS100"]),
                    "spectralIndex": number(row["index"]), "spectralIndexError": number(row["index error"]),
                    "gdeImpact": "*" in row["components"], "flux": flux, "extension": extension})
            if row["Assoc.(Sep.)"]:
                match = re.fullmatch(r"(.+?)\s*\(([\d.]+)\)", row["Assoc.(Sep.)"])
                if not match:
                    raise ValueError(f"Unexpected association format: {row['Assoc.(Sep.)']}")
                associations.append({"name": match[1].strip().rstrip("* "), "separationDeg": float(match[2]), "uncertain": "*" in match[1]})
        primary = max((c for c in components if c["detected"]), key=lambda c: c["ts"])
        # LACT-facing flux summary prefers the detected lower-energy component; preserve both below.
        flux_component = next((c for c in components if c["detector"] == "WCDA" and c["detected"]), primary)
        name = raw_name.rstrip("* ")
        base = re.search(r"J\d{4}[+-]\d{4}", name).group()
        result.append({"id": "1lhaaso-" + base.lower().replace("+", "p").replace("-", "m"), "name": name, "catalog": "1LHAASO",
            "ra": primary["ra"], "dec": primary["dec"], "coordinateComponent": primary["detector"],
            "type": "Unclassified", "aliases": [], "reference": LHAASO_PAPER,
            "status": "established", "defaultIncluded": True, "flux": flux_component["flux"], "fluxComponent": flux_component["detector"],
            "extension": primary["extension"], "components": components, "associations": associations,
            "uhe": "u" in raw_name, "dubiousMerged": "*" in raw_name})
    return result


def validate(sources, snapshot):
    assert len({x["id"] for x in sources}) == len(sources), "Duplicate record IDs"
    assert all(0 <= x["ra"] < 360 and -90 <= x["dec"] <= 90 for x in sources), "Invalid sky coordinates"
    tev = [x for x in sources if x["catalog"] == "TeVCat"]
    lhaaso = [x for x in sources if x["catalog"] == "1LHAASO"]
    assert len(tev) == snapshot["publicRecords"], "TeVCat public rows lost"
    assert len(lhaaso) == 90
    components = [c for x in lhaaso for c in x["components"]]
    assert Counter(c["detector"] for c in components) == {"WCDA": 90, "KM2A": 90}
    assert Counter(c["detector"] for c in components if c["detected"]) == {"WCDA": 69, "KM2A": 75}
    assert sum(x["uhe"] for x in lhaaso) == 43
    assert sum(all(c["detected"] for c in x["components"]) for x in lhaaso) == 54
    # Checks fail if upper-limit placeholders become detections or coordinate signs/hours are misread.
    first = next(x for x in lhaaso if x["id"] == "1lhaaso-j0007p5659")
    wcda = next(c for c in first["components"] if c["detector"] == "WCDA")
    assert wcda["ra"] is None and wcda["flux"]["upperLimit"] and wcda["flux"]["value"] == 2.7e-14
    crab = next(x for x in tev if x["id"] == "tevcat-74")
    assert abs(crab["ra"] - 83.62875) < 1e-7 and crab["flux"]["value"] == 1
    assert "SN1054" in crab["aliases"] and "2HWC J0534+220" in crab["aliases"], "HTML alias breaks not normalized"
    assert plain_text("  A &amp; <b>B</b>  ") == "A & B"
    assert all(not re.search(r"[<>]|&(?:#\w+|\w+);", value) for source in tev for value in [source["name"], source["type"], *source["aliases"]]), "Non-plain catalog display text"
    assert sexagesimal("-00 30 00") == -0.5
    return {"totalRecords": len(sources), "TeVCatStatusCounts": dict(Counter(x["status"] for x in tev)),
            "lhaasoSources": len(lhaaso), "lhaasoComponents": len(components), "lhaasoDetections": {"WCDA": 69, "KM2A": 75},
            "lhaasoBothDetectors": 54, "lhaasoUhe": 43,
            "missingCoordinates": 0, "duplicateIds": 0, "mergedAcrossCatalogs": 0,
            "TeVCatMissingFlux": sum(x["flux"] is None for x in tev),
            "TeVCatNonpositiveFlux": sum(x["flux"] is not None and x["flux"]["value"] <= 0 for x in tev),
            "completeWithinSnapshot": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--output", type=Path, default=ROOT / "public" / "data" / "sources.json")
    args = parser.parse_args()
    if args.refresh:
        refresh()
    manifest = json.loads((RAW / "manifest.json").read_text(encoding="utf-8"))
    for entry in manifest["inputs"]:
        actual = hashlib.sha256((RAW / entry["path"]).read_bytes()).hexdigest()
        if actual != entry["snapshotSha256"]:
            raise ValueError(f"Snapshot checksum mismatch: {entry['path']}")
    tevcat = json.loads((RAW / "tevcat-public-metadata.json").read_text(encoding="utf-8"))
    sources = tevcat_sources(tevcat) + lhaaso_sources((RAW / "lhaaso-table.csv").read_text(encoding="utf-8"))
    sources.sort(key=lambda x: (x["catalog"], x["ra"], x["id"]))
    quality = validate(sources, tevcat)
    meta = {"schemaVersion": 1, "retrievedAt": manifest["retrievedAt"], "coordinateFrame": "J2000 (as reported by catalogs)",
        "catalogs": [{"id": "TeVCat", "label": "TeVCat public catalog", "url": TEVCAT_URL, "recordCount": tevcat["publicRecords"], "citation": "Wakely & Horan 2008, 2008ICRC....3.1341W"},
                     {"id": "1LHAASO", "label": "First LHAASO catalog", "url": LHAASO_URL, "recordCount": 90, "componentCount": 180, "reference": LHAASO_PAPER, "citation": "Cao et al. 2024, ApJS 271, 25"}],
        "quality": quality,
        "notes": ["Catalog records are not deduplicated physical sources; associations remain separate.",
                  "TeVCat includes established, newly announced, disputed and candidate entries; filter by status.",
                  "Flux groups differ in unit, energy and observing epoch; cross-group numeric ordering is not physical brightness ranking.",
                  "1LHAASO positions use the detected component with largest TS; detector-specific positions and upper limits are preserved.",
                  "1LHAASO source type is Unclassified because the source table does not assign a physical classification."]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    dump(args.output, {"meta": meta, "sources": sources})
    dump(ROOT / "data" / "quality-report.json", quality)
    print(json.dumps(quality, ensure_ascii=True, indent=2))
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
