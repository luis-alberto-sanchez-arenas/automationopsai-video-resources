#!/usr/bin/env python3
"""A small deterministic gate for a patch produced by a coding agent."""

from pathlib import PurePosixPath


ALLOW = (PurePosixPath("src"), PurePosixPath("tests"))


def review(changed: list[str], tests_passed: bool) -> tuple[bool, str]:
    for item in changed:
        path = PurePosixPath(item)
        if not any(path == root or root in path.parents for root in ALLOW):
            return False, f"unexpected_path:{item}"
    if not tests_passed:
        return False, "tests_failed"
    return True, "reviewable_patch"


cases = [
    (["src/parser.py", "tests/test_parser.py"], True),
    (["src/parser.py", ".github/workflows/deploy.yml"], True),
    (["src/parser.py", "tests/test_parser.py"], False),
]

for files, passed in cases:
    accepted, reason = review(files, passed)
    print(f"{('PASS' if accepted else 'BLOCK'):5}  {reason}")
