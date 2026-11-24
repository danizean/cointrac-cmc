"""The sync Supabase client must not be shared across threads."""

from __future__ import annotations

import threading

from app.core import db


def test_each_thread_receives_its_own_supabase_client(monkeypatch) -> None:
    created: list[object] = []

    def factory(_url: str, _key: str) -> object:
        client = object()
        created.append(client)
        return client

    monkeypatch.setattr(db, "create_client", factory)
    found: list[object] = []

    def read() -> None:
        found.append(db.supabase_client())
        found.append(db.supabase_client())

    first = threading.Thread(target=read)
    second = threading.Thread(target=read)
    first.start()
    second.start()
    first.join()
    second.join()

    assert len(created) == 2
    assert created[0] is not created[1]
    assert found[0] is found[1]
    assert found[2] is found[3]
    assert found[0] is not found[2]
