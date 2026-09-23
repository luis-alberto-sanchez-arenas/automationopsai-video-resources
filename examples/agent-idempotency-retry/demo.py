#!/usr/bin/env python3
"""Reproduce duplicate agent side effects and block them with an idempotency key."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ActionAPI:
    effects: list[str] = field(default_factory=list)
    results: dict[str, str] = field(default_factory=dict)

    def create_ticket(self, payload: str, key: str | None = None) -> str:
        if key and key in self.results:
            return self.results[key]
        ticket_id = f"T-{len(self.effects) + 1:03d}"
        self.effects.append(f"{ticket_id}:{payload}")
        if key:
            self.results[key] = ticket_id
        return ticket_id


def main() -> None:
    unsafe = ActionAPI()
    first = unsafe.create_ticket("refund-order-42")
    retry = unsafe.create_ticket("refund-order-42")
    print(f"unsafe  first={first} retry={retry} side_effects={len(unsafe.effects)}")

    safe = ActionAPI()
    action_key = "run-7:refund-order-42"
    first = safe.create_ticket("refund-order-42", action_key)
    retry = safe.create_ticket("refund-order-42", action_key)
    print(f"safe    first={first} retry={retry} side_effects={len(safe.effects)}")
    assert len(unsafe.effects) == 2
    assert len(safe.effects) == 1
    assert first == retry
    print("PASS: retry returned the stored result without repeating the action")


if __name__ == "__main__":
    main()
