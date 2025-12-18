import json
from datetime import datetime, timezone
import requests

FHIR_BASE = "https://thas.mohw.gov.tw/v/r4/fhir"
TIMEOUT = 30

# 你自己的 extension URL（demo 用，之後可改成正式 StructureDefinition）
UTI_DEMO_INPUT_EXT_URL = "https://cch.org.tw/fhir/StructureDefinition/uti-demo-input"

def post_fhir(resource: dict) -> dict:
    url = f"{FHIR_BASE}/{resource['resourceType']}"
    headers = {"Content-Type": "application/fhir+json"}
    r = requests.post(url, headers=headers, json=resource, timeout=TIMEOUT)
    print(f"POST {resource['resourceType']} -> {r.status_code}")

    body = r.json()
    if r.status_code >= 400:
        print(json.dumps(body, ensure_ascii=False, indent=2))
        r.raise_for_status()
    return body

def create_demo_patient(title: str, demo_case: dict) -> dict:
    # 將 demo_case JSON 放進 Patient.extension.valueString
    patient = {
        "resourceType": "Patient",
        "name": [{"family": "Demo", "given": [title]}],
        "gender": "other",
        # 這裡 birthDate 只是占位；年齡以 demo_case.ageYears 為準（demo階段）
        "birthDate": "1970-01-01",
        "extension": [
            {
                "url": UTI_DEMO_INPUT_EXT_URL,
                "valueString": json.dumps(demo_case, ensure_ascii=False)
            }
        ]
    }
    return post_fhir(patient)

def main():
    demos = [
        ("UTI-1a", {
            "admitDate": "2025-12-10",
            "labDate": "2025-12-13",
            "symptomDates": [],
            "ageYears": 40,
            "tempC": 38.6,
            "catheterPeriods": [{"start": "2025-12-10", "end": "2025-12-13"}],
            "urinaryRetentionDate": "2025-12-12",
            "hasBladderScanOrStraightCath": True,
            "nursingNoteText": "膀胱掃描顯示尿量 120 mL，評估單導。",
            "infantKeywordsHit": False,
            "urinaryOtherSymptom": None
        }),
        ("UTI-1b", {
            "admitDate": "2025-12-10",
            "labDate": "2025-12-13",
            "symptomDates": [],
            "ageYears": 30,
            "tempC": 38.3,
            "catheterPeriods": [],
            "urinaryRetentionDate": "2025-12-12",
            "hasBladderScanOrStraightCath": True,
            "nursingNoteText": "病人排尿困難，膀胱掃描尿量 150 mL，已評估單導。",
            "infantKeywordsHit": False,
            "urinaryOtherSymptom": None
        }),
        ("UTI-2a", {
            "admitDate": "2025-12-01",
            "labDate": "2025-12-04",
            "symptomDates": ["2025-12-04"],
            "ageYears": 0.3,
            "tempC": 35.8,
            "catheterPeriods": [{"start": "2025-12-01", "end": "2025-12-04"}],
            "infantKeywordsHit": True,
            "urinaryRetentionDate": None,
            "hasBladderScanOrStraightCath": False,
            "nursingNoteText": "",
            "urinaryOtherSymptom": None
        }),
        ("UTI-2b", {
            "admitDate": "2025-12-01",
            "labDate": "2025-12-04",
            "symptomDates": ["2025-12-05"],
            "ageYears": 0.8,
            "tempC": 38.2,
            "catheterPeriods": [],
            "infantKeywordsHit": True,
            "urinaryRetentionDate": None,
            "hasBladderScanOrStraightCath": False,
            "nursingNoteText": "",
            "urinaryOtherSymptom": None
        }),
        ("EX-AdmDay12", {
            "admitDate": "2025-12-10",
            "labDate": "2025-12-11",
            "symptomDates": ["2025-12-11"],
            "ageYears": 50,
            "tempC": 38.5,
            "catheterPeriods": [{"start": "2025-12-10", "end": "2025-12-13"}],
            "infantKeywordsHit": False,
            "urinaryRetentionDate": None,
            "hasBladderScanOrStraightCath": False,
            "nursingNoteText": "",
            "urinaryOtherSymptom": True
        }),
        ("EX->65FeverOnly", {
            "admitDate": "2025-12-10",
            "labDate": "2025-12-13",
            "symptomDates": ["2025-12-13"],
            "ageYears": 70,
            "tempC": 38.6,
            "catheterPeriods": [],
            "infantKeywordsHit": False,
            "urinaryRetentionDate": None,
            "hasBladderScanOrStraightCath": False,
            "nursingNoteText": "",
            "urinaryOtherSymptom": False
        })
    ]

    created = []
    for title, demo_case in demos:
        print(f"\n=== create {title} ===")
        pat = create_demo_patient(title, demo_case)
        created.append({
            "title": title,
            "patientId": pat["id"],
            "patientRef": f"Patient/{pat['id']}"
        })

    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "fhirBase": FHIR_BASE,
        "extensionUrl": UTI_DEMO_INPUT_EXT_URL,
        "patients": created
    }

    with open("uti_demo_patients.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print("\n✅ done. wrote uti_demo_patients.json")
    print(json.dumps(out, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
