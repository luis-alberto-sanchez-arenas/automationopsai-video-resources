#!/usr/bin/env python3
"""Deterministic policy gate used by the accompanying Short."""

from dataclasses import dataclass


@dataclass(frozen=True)
class ToolCall:
    tool: str
    target: str


ALLOWED_TOOLS = {"read_workspace", "run_tests", "create_patch"}
ALLOWED_PREFIX = "/workspace/repo/"


def authorize(call: ToolCall) -> tuple[bool, str]:
    if call.tool not in ALLOWED_TOOLS:
        return False, "tool_not_allowed"
    if call.tool == "read_workspace" and not call.target.startswith(ALLOWED_PREFIX):
        return False, "path_outside_workspace"
    return True, "allowed"


tests = [
    ToolCall("read_workspace", "/workspace/repo/src/app.py"),
    ToolCall("read_workspace", "/run/secrets/prod_token"),
    ToolCall("http_post", "https://unknown.example/upload"),
    ToolCall("run_tests", "pytest -q"),
]

for test in tests:
    allowed, reason = authorize(test)
    print(f"{test.tool:16} {('ALLOW' if allowed else 'BLOCK'):5}  {reason}")
