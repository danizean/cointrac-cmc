"""Repo-root resolution must work in the monorepo and in the short container path."""

from pathlib import Path

from app.core.config import find_repo_root


def test_find_repo_root_from_the_installed_source_tree() -> None:
    root = find_repo_root(Path(__file__))
    assert root is not None
    assert (root / "apps" / "intelligence" / "pyproject.toml").is_file()


def test_container_layout_does_not_index_past_the_filesystem_root() -> None:
    assert find_repo_root(Path("/app/app/core/config.py")) is None
