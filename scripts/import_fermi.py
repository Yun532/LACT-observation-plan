"""Build the optional public 4FGL-DR4 library from NASA's pinned v35 FITS.

Requires astropy only when rebuilding, not in the website runtime.
python scripts/import_fermi.py --input /path/to/gll_psc_v35.fit
python scripts/import_fermi.py  # download the same official public file
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from astropy.io import fits

ROOT = Path(__file__).resolve().parent.parent
PAGE = "https://fermi.gsfc.nasa.gov/ssc/data/access/lat/14yr_catalog/"
URL = PAGE + "gll_psc_v35.fit"
SHA256 = "e3b3ea278412b7bda4c259ab558f00b76605be59eb84e44086a862a179ffc3e6"


def clean(value):
    return str(value).strip()


def number(value):
    value = float(value)
    return float(f"{value:.8g}") if math.isfinite(value) else None


def source_id(name):
    return "fermi:4fgl:" + name.removeprefix("4FGL ").lower().replace("+", "p").replace("-", "m")


def convert(body):
    if hashlib.sha256(body).hexdigest() != SHA256:
        raise ValueError("Input is not the reviewed official public 4FGL-DR4 v35 file; no output written.")
    with fits.open(io.BytesIO(body)) as hdul:
        table = hdul["LAT_Point_Source_Catalog"]
        assert table.header["VERSION"] == "v35"
        assert table.header["RADECSYS"] == "FK5" and table.header["EQUINOX"] == 2000
        assert (table.header["TEMIN17"], table.header["TEMAX17"]) == (1000, 100000)
        assert (table.header["TEMIN19"], table.header["TEMAX19"]) == (100, 100000)
        models = {clean(row["Source_Name"]): row for row in hdul["ExtendedSources"].data}
        sources = []
        for row in table.data:
            name = clean(row["Source_Name"])
            model_name = clean(row["Extended_Source_Name"])
            model = models.get(model_name)
            spectrum = clean(row["SpectrumType"])
            index_field = {"PowerLaw": "PL_Index", "LogParabola": "LP_Index", "PLSuperExpCutoff": "PLEC_IndexS"}[spectrum]
            position = None
            if number(row["Conf_95_SemiMajor"]) and not model_name:
                position = {"semiMajorDeg": number(row["Conf_95_SemiMajor"]),
                            "semiMinorDeg": number(row["Conf_95_SemiMinor"]),
                            "positionAngleDeg": number(row["Conf_95_PosAng"])}
            spatial = None if model is None else {
                "name": model_name, "form": clean(model["Model_Form"]),
                "semiMajorDeg": number(model["Model_SemiMajor"]),
                "semiMinorDeg": number(model["Model_SemiMinor"]),
                "positionAngleDeg": number(model["Model_PosAng"]),
                "function": clean(model["Spatial_Function"]), "template": clean(model["Spatial_Filename"]),
            }
            high_energy = clean(row["ASSOC_FHL"])
            aliases = list(dict.fromkeys(clean(row[key]) for key in (
                "ASSOC1", "ASSOC2", "ASSOC_4FGL", "ASSOC_FGL", "ASSOC_FHL",
                "ASSOC_GAM1", "ASSOC_GAM2", "ASSOC_GAM3", "ASSOC_TEV", "Extended_Source_Name"
            ) if clean(row[key]) and clean(row[key]) != name))
            sources.append({
                "id": source_id(name), "name": name, "catalog": "4FGL-DR4",
                "ra": number(row["RAJ2000"]), "dec": number(row["DEJ2000"]),
                "coordinateFrame": "FK5/J2000", "type": clean(row["CLASS1"]) or "Unclassified",
                "aliases": aliases, "reference": PAGE, "status": "established", "defaultIncluded": True,
                "flux": {"value": number(row["Flux1000"]), "error": number(row["Unc_Flux1000"]),
                         "unit": "ph cm-2 s-1", "energy": "1–100 GeV", "kind": "integral",
                         "energyMinGeV": 1, "energyMaxGeV": 100, "comparisonGroup": "4FGL-DR4-1-100GeV"},
                "spectralIndex": number(row[index_field]), "extension": None, "extended": bool(model_name),
                "fermi": {
                    "classCode": clean(row["CLASS1"]), "association": clean(row["ASSOC1"]),
                    "associationAlt": clean(row["ASSOC2"]), "significance": number(row["Signif_Avg"]),
                    "variabilityIndex": number(row["Variability_Index"]),
                    "energyFlux": {"value": number(row["Energy_Flux100"]), "error": number(row["Unc_Energy_Flux100"]),
                                   "unit": "erg cm-2 s-1", "energy": "0.1–100 GeV"},
                    "spectrumType": spectrum, "photonIndex": number(row[index_field]),
                    "photonIndexError": number(row["Unc_" + index_field]), "photonIndexField": index_field,
                    "pivotEnergyMeV": number(row["Pivot_Energy"]), "flags": int(row["Flags"]),
                    "highEnergyAssociations": [high_energy] if high_energy else [],
                    "tevAssociation": clean(row["ASSOC_TEV"]), "tevFlag": clean(row["TEVCAT_FLAG"]),
                    "positionError95": position, "spatialModel": spatial,
                },
            })
        assert len(sources) == 7195 and len({s["id"] for s in sources}) == 7195
        for source in sources:
            assert 0 <= source["ra"] < 360 and -90 <= source["dec"] <= 90
        return {"meta": {
            "catalog": "4FGL-DR4", "version": "v35", "count": len(sources), "physicalSourceCount": 7194,
            "highEnergyAssociationCount": sum(bool(s["fermi"]["highEnergyAssociations"]) for s in sources),
            "threeFhlAssociationCount": sum(any(a.startswith("3FHL ") for a in s["fermi"]["highEnergyAssociations"]) for s in sources),
            "sourceUrl": URL, "referenceUrl": PAGE, "sha256": SHA256,
            "retrievedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "coordinateFrame": "FK5/J2000", "observationStart": table.header["DATE-OBS"],
            "observationEnd": table.header["DATE-END"], "catalogEnergyBand": "50 MeV–1 TeV",
            "variabilityThreshold99": number(table.header["VARMIN"]),
            "notes": [
                "7195 catalog rows represent 7194 sources: the Crab Nebula has separate inverse-Compton and synchrotron rows.",
                "FHL associations are the published ASSOC_FHL values, not a new positional cross-match or a complete FHL catalog.",
                "Fluxes are catalog averages, not current brightness or a prediction of LACT/TeV detectability.",
                "Upper-case CLASS1 codes are identifications; lower-case codes are associations. ASSOC2 is an alternative/lower-confidence association.",
                "Spatial-model parameters and 95% localization errors are kept separate; no generic extension radius is inferred.",
            ],
        }, "sources": sources}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, help="Optional existing official gll_psc_v35.fit; checksum is always verified.")
    parser.add_argument("--output", type=Path, default=ROOT / "public/data/fermi-sources.json")
    args = parser.parse_args()
    if args.input:
        body = args.input.read_bytes()
    else:
        request = Request(URL, headers={"User-Agent": "LACT-observation-plan/1.0"})
        with urlopen(request, timeout=60) as response:
            body = response.read()
    data = convert(body)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    print(f"Wrote {data['meta']['count']} public catalog rows to {args.output}")


if __name__ == "__main__":
    main()
