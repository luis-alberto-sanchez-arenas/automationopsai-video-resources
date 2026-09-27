#!/usr/bin/env python3
"""Deterministic dependency gate for AI-generated package changes."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).parent


@dataclass(frozen=True)
class Finding:
    package: str
    rule: str
    detail: str


def load(name: str) -> dict:
    return json.loads((ROOT / name).read_text())


def dependency_gate(baseline: dict, candidate: dict) -> dict:
    old = baseline["packages"]
    new = candidate["packages"]
    introduced = sorted(set(new) - set(old))
    findings: list[Finding] = []

    for package in introduced:
        item = new[package]
        if not item.get("integrity", "").startswith("sha512-"):
            findings.append(Finding(package, "integrity", "missing sha512 integrity pin"))
        if item.get("registry") != "https://registry.npmjs.org":
            findings.append(Finding(package, "registry", "package resolves outside the approved registry"))
        if item.get("installScript"):
            findings.append(Finding(package, "install-script", "new dependency executes code during install"))
        if not item.get("provenance"):
            findings.append(Finding(package, "provenance", "no build provenance recorded"))
        if item.get("license") not in {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"}:
            findings.append(Finding(package, "license", "license is absent or outside policy"))

    result = {
        "status": "BLOCK" if findings else "PASS",
        "introducedDependencies": introduced,
        "introducedCount": len(introduced),
        "findingCount": len(findings),
        "findings": [finding.__dict__ for finding in findings],
    }
    return result


def main() -> None:
    baseline = load("baseline-lock.json")
    unsafe = dependency_gate(baseline, load("agent-lock-unsafe.json"))
    repaired = dependency_gate(baseline, load("agent-lock-repaired.json"))

    print("UNSAFE CANDIDATE")
    print(json.dumps(unsafe, indent=2))
    print("\nREPAIRED CANDIDATE")
    print(json.dumps(repaired, indent=2))

    assert unsafe["status"] == "BLOCK"
    assert unsafe["findingCount"] == 5
    assert repaired["status"] == "PASS"
    assert repaired["findingCount"] == 0
    print("\nRESULT: 2 deterministic assertions passed")


if __name__ == "__main__":
    main()
