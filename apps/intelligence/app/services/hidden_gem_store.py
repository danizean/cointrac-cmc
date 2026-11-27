"""Persistence repository for Hidden Gem Discovery Engine (Supabase + Memory)."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol
from uuid import uuid4

from app.adapters.cache import parse_timestamp
from app.adapters.normalizer import as_float
from app.quant.hidden_gems import OhlcvBar

ExplanationFn = Callable[[dict[str, object], list[dict[str, object]]], dict[str, object]]


class HiddenGemStore(Protocol):
    async def get_recent_ingest_batch(
        self, max_age_seconds: int, now: datetime
    ) -> tuple[str, list[dict[str, object]]] | None: ...

    async def upsert_assets(self, rows: list[dict[str, object]]) -> dict[str, str]: ...

    async def insert_snapshots(self, rows: list[dict[str, object]]) -> dict[str, str]: ...

    async def get_prior_snapshot_prices(
        self, asset_ids: list[str], start_ts: datetime, end_ts: datetime
    ) -> dict[str, list[tuple[datetime, float]]]: ...

    async def get_cached_historical(
        self, asset_id: str, series_type: str, max_age_seconds: int, now: datetime
    ) -> list[OhlcvBar]: ...

    async def upsert_historical_cache(
        self, asset_id: str, series_type: str, bars: list[dict[str, object]]
    ) -> None: ...

    async def get_scan_by_idempotency(
        self, user_id: str, idempotency_key: str
    ) -> dict[str, object] | None: ...

    async def create_scan_run(self, row: dict[str, object]) -> dict[str, object]: ...

    async def update_scan_run(
        self, user_id: str, scan_run_id: str, patch: dict[str, object]
    ) -> dict[str, object] | None: ...

    async def is_cancel_requested(self, user_id: str, scan_run_id: str) -> bool: ...

    async def list_scans(self, user_id: str, limit: int = 25) -> list[dict[str, object]]: ...

    async def get_scan(self, user_id: str, scan_run_id: str) -> dict[str, object] | None: ...

    async def list_rejections(
        self, user_id: str, scan_run_id: str
    ) -> list[dict[str, object]]: ...

    async def get_previous_candidate(
        self,
        user_id: str,
        asset_id: str,
        track: str,
        horizon: str,
        exclude_run_id: str,
    ) -> dict[str, object] | None: ...

    async def has_recent_alert(
        self, user_id: str, dedup_key: str, since: datetime
    ) -> bool: ...

    async def persist_scan_outputs(
        self,
        *,
        user_id: str,
        scan_run_id: str,
        candidates: list[dict[str, object]],
        evidence_by_key: dict[tuple[str, str, str], list[dict[str, object]]],
        rejections: list[dict[str, object]],
        history_rows: list[dict[str, object]],
        checkpoints: list[dict[str, object]],
        alerts: list[dict[str, object]],
        explanation_builder: ExplanationFn,
        explain_keys: set[tuple[str, str, str]],
    ) -> None: ...

    async def list_candidates(
        self,
        user_id: str,
        *,
        track: str | None = None,
        horizon: str | None = None,
        min_score: float | None = None,
        confidence: str | None = None,
        classification: str | None = None,
        eligibility: str | None = None,
        run_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, object]]: ...

    async def get_candidate_detail(
        self, user_id: str, candidate_id: str
    ) -> dict[str, object] | None: ...

    async def set_candidate_explanation(
        self, user_id: str, candidate_id: str, explanation: dict[str, object]
    ) -> None: ...

    async def list_configs(self, user_id: str) -> list[dict[str, object]]: ...

    async def create_config(self, row: dict[str, object]) -> dict[str, object]: ...

    async def update_config(
        self, user_id: str, config_id: str, patch: dict[str, object]
    ) -> dict[str, object] | None: ...

    async def list_watchlist(self, user_id: str) -> list[dict[str, object]]: ...

    async def upsert_watchlist(self, row: dict[str, object]) -> dict[str, object]: ...

    async def delete_watchlist(self, user_id: str, item_id: str) -> bool: ...

    async def list_alerts(self, user_id: str, limit: int = 50) -> list[dict[str, object]]: ...

    async def list_outcome_checkpoints(self, user_id: str) -> list[dict[str, object]]: ...

    async def list_active_checkpoints_all(self, since: datetime) -> list[dict[str, object]]: ...

    async def get_latest_snapshots_for_assets(
        self, asset_ids: list[str]
    ) -> dict[str, dict[str, object]]: ...

    async def update_checkpoint(
        self, checkpoint_id: str, patch: dict[str, object]
    ) -> None: ...

    async def mark_stale_running_scans_failed(self, stale_before: datetime) -> int: ...

    async def list_active_configs_all(self) -> list[dict[str, object]]: ...

    async def get_asset_id_by_cmc_id(self, canonical_provider_id: str) -> str | None: ...

    async def update_alert_delivery(
        self, alert_id: str, patch: dict[str, object]
    ) -> None: ...


class MemoryHiddenGemStore:
    """In-memory repository for unit, integration, and cross-tenant security tests."""

    def __init__(self) -> None:
        self.assets: dict[str, dict[str, object]] = {}
        self.assets_by_cid: dict[tuple[str, str], str] = {}
        self.snapshots: list[dict[str, object]] = []
        self.historical: dict[tuple[str, str, datetime], dict[str, object]] = {}
        self.configs: dict[str, dict[str, object]] = {}
        self.runs: dict[str, dict[str, object]] = {}
        self.candidates: dict[str, dict[str, object]] = {}
        self.evidence: list[dict[str, object]] = []
        self.rejections: list[dict[str, object]] = []
        self.history: list[dict[str, object]] = []
        self.watchlist: dict[str, dict[str, object]] = {}
        self.alerts: list[dict[str, object]] = []
        self.checkpoints: dict[str, dict[str, object]] = {}
        self.fail_evidence_write = False

    async def get_recent_ingest_batch(
        self, max_age_seconds: int, now: datetime
    ) -> tuple[str, list[dict[str, object]]] | None:
        cutoff = now - timedelta(seconds=max_age_seconds)
        recent = [
            row
            for row in self.snapshots
            if (parse_timestamp(row.get("fetched_at")) or now) >= cutoff
        ]
        if not recent:
            return None
        latest_row = max(
            recent,
            key=lambda row: parse_timestamp(row.get("fetched_at")) or cutoff,
        )
        batch_id = str(latest_row["ingest_batch_id"])
        batch_rows = [
            {**row, "asset": self.assets.get(str(row["asset_id"]), {})}
            for row in self.snapshots
            if str(row["ingest_batch_id"]) == batch_id
        ]
        return batch_id, batch_rows

    async def upsert_assets(self, rows: list[dict[str, object]]) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for row in rows:
            provider = str(row.get("canonical_provider") or "coinmarketcap")
            cid = str(row["canonical_provider_id"])
            key = (provider, cid)
            existing_id = self.assets_by_cid.get(key)
            aid = existing_id or str(uuid4())
            self.assets_by_cid[key] = aid
            merged = dict(self.assets.get(aid, {}))
            merged.update(row)
            merged["id"] = aid
            self.assets[aid] = merged
            mapping[cid] = aid
        return mapping

    async def insert_snapshots(self, rows: list[dict[str, object]]) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for row in rows:
            sid = str(uuid4())
            stored = dict(row)
            stored["id"] = sid
            self.snapshots.append(stored)
            mapping[str(row["asset_id"])] = sid
        return mapping

    async def get_prior_snapshot_prices(
        self, asset_ids: list[str], start_ts: datetime, end_ts: datetime
    ) -> dict[str, list[tuple[datetime, float]]]:
        wanted = set(asset_ids)
        out: dict[str, list[tuple[datetime, float]]] = {}
        for row in self.snapshots:
            aid = str(row.get("asset_id") or "")
            if aid not in wanted:
                continue
            ts = parse_timestamp(row.get("source_timestamp"))
            price = as_float(row.get("price"))
            if ts is not None and price is not None and start_ts <= ts <= end_ts:
                out.setdefault(aid, []).append((ts, price))
        return out

    async def get_cached_historical(
        self, asset_id: str, series_type: str, max_age_seconds: int, now: datetime
    ) -> list[OhlcvBar]:
        cutoff = now - timedelta(seconds=max_age_seconds)
        bars: list[OhlcvBar] = []
        for (aid, stype, ts), row in self.historical.items():
            if aid != asset_id or stype != series_type:
                continue
            fetched = parse_timestamp(row.get("fetched_at"))
            if fetched is not None and fetched < cutoff:
                continue
            close = as_float(row.get("close"))
            if close is None:
                continue
            bars.append(
                OhlcvBar(
                    timestamp=ts,
                    open=as_float(row.get("open")),
                    high=as_float(row.get("high")),
                    low=as_float(row.get("low")),
                    close=close,
                    volume=as_float(row.get("volume")),
                )
            )
        bars.sort(key=lambda b: b.timestamp)
        return bars

    async def upsert_historical_cache(
        self, asset_id: str, series_type: str, bars: list[dict[str, object]]
    ) -> None:
        for bar in bars:
            raw_ts = bar["bar_timestamp"]
            ts = raw_ts if isinstance(raw_ts, datetime) else parse_timestamp(raw_ts)
            if ts is None:
                continue
            self.historical[(asset_id, series_type, ts)] = {
                **bar,
                "asset_id": asset_id,
                "series_type": series_type,
                "bar_timestamp": ts.isoformat(),
            }

    async def get_scan_by_idempotency(
        self, user_id: str, idempotency_key: str
    ) -> dict[str, object] | None:
        for run in self.runs.values():
            if run.get("user_id") == user_id and run.get("idempotency_key") == idempotency_key:
                return dict(run)
        return None

    async def create_scan_run(self, row: dict[str, object]) -> dict[str, object]:
        rid = str(row.get("id") or uuid4())
        stored = {
            **row,
            "id": rid,
            "created_at": str(row.get("created_at") or datetime.now(UTC).isoformat()),
        }
        self.runs[rid] = stored
        return dict(stored)

    async def update_scan_run(
        self, user_id: str, scan_run_id: str, patch: dict[str, object]
    ) -> dict[str, object] | None:
        run = self.runs.get(scan_run_id)
        if run is None or run.get("user_id") != user_id:
            return None
        run.update(patch)
        return dict(run)

    async def is_cancel_requested(self, user_id: str, scan_run_id: str) -> bool:
        run = self.runs.get(scan_run_id)
        if run is None or run.get("user_id") != user_id:
            return False
        return run.get("cancel_requested_at") is not None

    async def list_scans(self, user_id: str, limit: int = 25) -> list[dict[str, object]]:
        rows = [dict(r) for r in self.runs.values() if r.get("user_id") == user_id]
        rows.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
        return rows[:limit]

    async def get_scan(self, user_id: str, scan_run_id: str) -> dict[str, object] | None:
        run = self.runs.get(scan_run_id)
        if run is None or run.get("user_id") != user_id:
            return None
        return dict(run)

    async def list_rejections(self, user_id: str, scan_run_id: str) -> list[dict[str, object]]:
        rows = []
        for rej in self.rejections:
            if rej.get("user_id") == user_id and rej.get("scan_run_id") == scan_run_id:
                asset = self.assets.get(str(rej.get("asset_id") or ""), {})
                rows.append({**rej, "symbol": asset.get("symbol")})
        return rows

    async def get_previous_candidate(
        self,
        user_id: str,
        asset_id: str,
        track: str,
        horizon: str,
        exclude_run_id: str,
    ) -> dict[str, object] | None:
        matches = [
            c
            for c in self.candidates.values()
            if c.get("user_id") == user_id
            and c.get("asset_id") == asset_id
            and c.get("discovery_track") == track
            and c.get("trading_horizon") == horizon
            and c.get("scan_run_id") != exclude_run_id
        ]
        if not matches:
            return None
        matches.sort(key=lambda c: str(c.get("created_at") or ""), reverse=True)
        return dict(matches[0])

    async def has_recent_alert(self, user_id: str, dedup_key: str, since: datetime) -> bool:
        for alert in self.alerts:
            if alert.get("user_id") != user_id or alert.get("dedup_key") != dedup_key:
                continue
            created = parse_timestamp(alert.get("created_at"))
            if created is not None and created >= since:
                return True
        return False

    async def persist_scan_outputs(
        self,
        *,
        user_id: str,
        scan_run_id: str,
        candidates: list[dict[str, object]],
        evidence_by_key: dict[tuple[str, str, str], list[dict[str, object]]],
        rejections: list[dict[str, object]],
        history_rows: list[dict[str, object]],
        checkpoints: list[dict[str, object]],
        alerts: list[dict[str, object]],
        explanation_builder: ExplanationFn,
        explain_keys: set[tuple[str, str, str]],
    ) -> None:
        now_iso = datetime.now(UTC).isoformat()
        candidate_id_map: dict[tuple[str, str, str], str] = {}
        for row in candidates:
            cid = str(uuid4())
            key = (
                str(row["asset_id"]),
                str(row["discovery_track"]),
                str(row["trading_horizon"]),
            )
            candidate_id_map[key] = cid
            self.candidates[cid] = {**row, "id": cid, "user_id": user_id, "created_at": now_iso}

        if self.fail_evidence_write:
            raise RuntimeError("Simulated evidence persistence failure")

        for key, ev_rows in evidence_by_key.items():
            cand_id = candidate_id_map.get(key)
            if cand_id is None:
                continue
            persisted_ev: list[dict[str, object]] = []
            for ev in ev_rows:
                eid = str(uuid4())
                stored_ev = {
                    **ev,
                    "id": eid,
                    "user_id": user_id,
                    "candidate_result_id": cand_id,
                    "created_at": now_iso,
                }
                self.evidence.append(stored_ev)
                persisted_ev.append(stored_ev)
            if key in explain_keys:
                self.candidates[cand_id]["explanation"] = explanation_builder(
                    self.candidates[cand_id],
                    persisted_ev,
                )

        for rej in rejections:
            self.rejections.append(
                {**rej, "id": str(uuid4()), "user_id": user_id, "created_at": now_iso}
            )
        for hist in history_rows:
            key = (
                str(hist["asset_id"]),
                str(hist["discovery_track"]),
                str(hist["trading_horizon"]),
            )
            self.history.append(
                {
                    **hist,
                    "id": str(uuid4()),
                    "user_id": user_id,
                    "candidate_result_id": candidate_id_map.get(key, ""),
                    "observed_at": now_iso,
                }
            )
        for cp in checkpoints:
            key = (
                str(cp["asset_id"]),
                str(cp["discovery_track"]),
                str(cp["trading_horizon"]),
            )
            cand_id = candidate_id_map.get(key, "")
            if cand_id:
                self.checkpoints[cand_id] = {
                    **cp,
                    "id": str(uuid4()),
                    "candidate_result_id": cand_id,
                }
        for alert in alerts:
            self.alerts.append(
                {
                    **alert,
                    "id": str(uuid4()),
                    "user_id": user_id,
                    "scan_run_id": scan_run_id,
                    "created_at": now_iso,
                }
            )

    def _enrich_candidate_summary(self, row: dict[str, object]) -> dict[str, object]:
        asset = self.assets.get(str(row["asset_id"]), {})
        snap = next(
            (s for s in self.snapshots if s.get("id") == row.get("market_snapshot_id")),
            {},
        )
        return {
            **row,
            "canonical_provider_id": asset.get("canonical_provider_id", ""),
            "symbol": asset.get("symbol", ""),
            "name": asset.get("name", ""),
            "price": as_float(snap.get("price")),
            "market_cap": as_float(snap.get("market_cap")),
            "volume_24h": as_float(snap.get("volume_24h")),
            "return_24h": as_float(snap.get("return_24h")),
            "return_7d": as_float(snap.get("return_7d")),
            "rs_btc_7d": as_float(snap.get("rs_btc_7d")),
            "source_timestamp": snap.get("source_timestamp"),
        }

    async def list_candidates(
        self,
        user_id: str,
        *,
        track: str | None = None,
        horizon: str | None = None,
        min_score: float | None = None,
        confidence: str | None = None,
        classification: str | None = None,
        eligibility: str | None = None,
        run_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, object]]:
        rows: list[dict[str, object]] = []
        for row in self.candidates.values():
            if row.get("user_id") != user_id:
                continue
            if track and row.get("discovery_track") != track:
                continue
            if horizon and row.get("trading_horizon") != horizon:
                continue
            if confidence and row.get("confidence_level") != confidence:
                continue
            if classification and row.get("classification") != classification:
                continue
            if eligibility and row.get("eligibility_status") != eligibility:
                continue
            if run_id and row.get("scan_run_id") != run_id:
                continue
            score = as_float(row.get("adjusted_score"))
            if min_score is not None and (score is None or score < min_score):
                continue
            rows.append(self._enrich_candidate_summary(row))
        rows.sort(
            key=lambda r: (
                r.get("adjusted_score") is not None,
                as_float(r.get("adjusted_score")) or -1.0,
                str(r.get("created_at") or ""),
                str(r.get("id") or ""),
            ),
            reverse=True,
        )
        return rows[offset : offset + limit]

    async def get_candidate_detail(
        self, user_id: str, candidate_id: str
    ) -> dict[str, object] | None:
        row = self.candidates.get(candidate_id)
        if row is None or row.get("user_id") != user_id:
            return None
        ev = [
            dict(e)
            for e in self.evidence
            if e.get("user_id") == user_id and e.get("candidate_result_id") == candidate_id
        ]
        hist = [
            dict(h)
            for h in self.history
            if h.get("user_id") == user_id and h.get("asset_id") == row.get("asset_id")
        ]
        cp_row = self.checkpoints.get(candidate_id)
        checkpoint = (
            dict(cp_row)
            if isinstance(cp_row, dict)
            and (cp_row.get("user_id") is None or cp_row.get("user_id") == user_id)
            else None
        )
        return {
            "row": self._enrich_candidate_summary(row),
            "evidence": ev,
            "score_history": hist,
            "outcome_checkpoint": checkpoint,
        }

    async def set_candidate_explanation(
        self, user_id: str, candidate_id: str, explanation: dict[str, object]
    ) -> None:
        row = self.candidates.get(candidate_id)
        if row is not None and row.get("user_id") == user_id:
            row["explanation"] = explanation

    async def list_configs(self, user_id: str) -> list[dict[str, object]]:
        return [dict(c) for c in self.configs.values() if c.get("user_id") == user_id]

    async def create_config(self, row: dict[str, object]) -> dict[str, object]:
        cid = str(uuid4())
        now_iso = datetime.now(UTC).isoformat()
        stored = {**row, "id": cid, "created_at": now_iso, "updated_at": now_iso}
        self.configs[cid] = stored
        return dict(stored)

    async def update_config(
        self, user_id: str, config_id: str, patch: dict[str, object]
    ) -> dict[str, object] | None:
        cfg = self.configs.get(config_id)
        if cfg is None or cfg.get("user_id") != user_id:
            return None
        cfg.update(patch)
        cfg["updated_at"] = datetime.now(UTC).isoformat()
        return dict(cfg)

    async def list_watchlist(self, user_id: str) -> list[dict[str, object]]:
        out = []
        for item in self.watchlist.values():
            if item.get("user_id") == user_id:
                asset = self.assets.get(str(item.get("asset_id") or ""), {})
                out.append({**item, "symbol": asset.get("symbol"), "name": asset.get("name")})
        return out

    async def upsert_watchlist(self, row: dict[str, object]) -> dict[str, object]:
        now_iso = datetime.now(UTC).isoformat()
        for existing in self.watchlist.values():
            same_user = existing.get("user_id") == row["user_id"]
            same_asset = existing.get("asset_id") == row["asset_id"]
            if same_user and same_asset:
                existing.update(row)
                existing["updated_at"] = now_iso
                asset = self.assets.get(str(existing["asset_id"]), {})
                return {**existing, "symbol": asset.get("symbol"), "name": asset.get("name")}
        wid = str(uuid4())
        stored = {**row, "id": wid, "added_at": now_iso, "updated_at": now_iso}
        self.watchlist[wid] = stored
        asset = self.assets.get(str(stored["asset_id"]), {})
        return {**stored, "symbol": asset.get("symbol"), "name": asset.get("name")}

    async def delete_watchlist(self, user_id: str, item_id: str) -> bool:
        item = self.watchlist.get(item_id)
        if item is None or item.get("user_id") != user_id:
            return False
        self.watchlist.pop(item_id, None)
        return True

    async def list_alerts(self, user_id: str, limit: int = 50) -> list[dict[str, object]]:
        rows = [dict(a) for a in self.alerts if a.get("user_id") == user_id]
        rows.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
        return rows[:limit]

    async def list_outcome_checkpoints(self, user_id: str) -> list[dict[str, object]]:
        return [dict(c) for c in self.checkpoints.values() if c.get("user_id") == user_id]

    async def list_active_checkpoints_all(self, since: datetime) -> list[dict[str, object]]:
        out: list[dict[str, object]] = []
        for row in self.checkpoints.values():
            ts = parse_timestamp(row.get("entry_observed_at"))
            if ts is not None and ts >= since and row.get("invalidated_at") is None:
                out.append(dict(row))
        return out

    async def get_latest_snapshots_for_assets(
        self, asset_ids: list[str]
    ) -> dict[str, dict[str, object]]:
        latest: dict[str, dict[str, object]] = {}
        wanted = set(asset_ids)
        for row in self.snapshots:
            aid = str(row.get("asset_id") or "")
            if aid not in wanted:
                continue
            prev = latest.get(aid)
            row_obs = str(
                row.get("observed_at")
                or row.get("fetched_at")
                or row.get("source_timestamp")
                or ""
            )
            prev_obs = (
                str(
                    prev.get("observed_at")
                    or prev.get("fetched_at")
                    or prev.get("source_timestamp")
                    or ""
                )
                if prev is not None
                else ""
            )
            if prev is None or row_obs > prev_obs:
                latest[aid] = {**row, "observed_at": row_obs}
        return latest

    async def update_checkpoint(self, checkpoint_id: str, patch: dict[str, object]) -> None:
        for cp in self.checkpoints.values():
            if cp.get("id") == checkpoint_id:
                cp.update(patch)
                return

    async def mark_stale_running_scans_failed(self, stale_before: datetime) -> int:
        count = 0
        for run in self.runs.values():
            if run.get("status") != "RUNNING":
                continue
            hb = parse_timestamp(run.get("heartbeat_at"))
            if hb is not None and hb < stale_before:
                run["status"] = "FAILED"
                run["error_summary"] = "Worker heartbeat timeout"
                run["completed_at"] = datetime.now(UTC).isoformat()
                count += 1
        return count

    async def list_active_configs_all(self) -> list[dict[str, object]]:
        return [dict(c) for c in self.configs.values() if bool(c.get("is_active", True))]

    async def get_asset_id_by_cmc_id(self, canonical_provider_id: str) -> str | None:
        return self.assets_by_cid.get(("coinmarketcap", str(canonical_provider_id)))

    async def update_alert_delivery(self, alert_id: str, patch: dict[str, object]) -> None:
        for alert in self.alerts:
            if alert.get("id") == alert_id:
                alert.update(patch)
                return


class SupabaseHiddenGemStore:
    """Supabase PostgreSQL backing store for all hg_* tables (service-role worker)."""

    def __init__(self, client: Any | None = None) -> None:
        self._client = client

    def _db(self) -> Any:
        if self._client is not None:
            return self._client
        from app.core.db import supabase_client

        return supabase_client()

    async def get_recent_ingest_batch(
        self, max_age_seconds: int, now: datetime
    ) -> tuple[str, list[dict[str, object]]] | None:
        cutoff = (now - timedelta(seconds=max_age_seconds)).isoformat()

        def read() -> tuple[str, list[dict[str, object]]] | None:
            latest = (
                self._db()
                .table("hg_market_snapshots")
                .select("ingest_batch_id,fetched_at")
                .gte("fetched_at", cutoff)
                .order("fetched_at", desc=True)
                .limit(1)
                .execute()
            )
            rows = latest.data or []
            if not rows:
                return None
            batch_id = str(rows[0]["ingest_batch_id"])
            snap_resp = (
                self._db()
                .table("hg_market_snapshots")
                .select("*,hg_assets(*)")
                .eq("ingest_batch_id", batch_id)
                .execute()
            )
            merged: list[dict[str, object]] = []
            for row in snap_resp.data or []:
                item = dict(row)
                item["asset"] = item.pop("hg_assets", {}) or {}
                merged.append(item)
            return batch_id, merged

        return await asyncio.to_thread(read)

    async def upsert_assets(self, rows: list[dict[str, object]]) -> dict[str, str]:
        if not rows:
            return {}

        def write() -> dict[str, str]:
            resp = (
                self._db()
                .table("hg_assets")
                .upsert(rows, on_conflict="canonical_provider,canonical_provider_id")
                .execute()
            )
            return {
                str(r["canonical_provider_id"]): str(r["id"]) for r in (resp.data or [])
            }

        return await asyncio.to_thread(write)

    async def insert_snapshots(self, rows: list[dict[str, object]]) -> dict[str, str]:
        if not rows:
            return {}

        def write() -> dict[str, str]:
            resp = self._db().table("hg_market_snapshots").insert(rows).execute()
            return {str(r["asset_id"]): str(r["id"]) for r in (resp.data or [])}

        return await asyncio.to_thread(write)

    async def get_prior_snapshot_prices(
        self, asset_ids: list[str], start_ts: datetime, end_ts: datetime
    ) -> dict[str, list[tuple[datetime, float]]]:
        if not asset_ids:
            return {}

        def read() -> dict[str, list[tuple[datetime, float]]]:
            resp = (
                self._db()
                .table("hg_market_snapshots")
                .select("asset_id,source_timestamp,price")
                .in_("asset_id", asset_ids)
                .gte("source_timestamp", start_ts.isoformat())
                .lte("source_timestamp", end_ts.isoformat())
                .execute()
            )
            out: dict[str, list[tuple[datetime, float]]] = {}
            for row in resp.data or []:
                ts = parse_timestamp(row.get("source_timestamp"))
                price = as_float(row.get("price"))
                if ts is not None and price is not None:
                    out.setdefault(str(row["asset_id"]), []).append((ts, price))
            return out

        return await asyncio.to_thread(read)

    async def get_cached_historical(
        self, asset_id: str, series_type: str, max_age_seconds: int, now: datetime
    ) -> list[OhlcvBar]:
        cutoff = (now - timedelta(seconds=max_age_seconds)).isoformat()

        def read() -> list[OhlcvBar]:
            resp = (
                self._db()
                .table("hg_historical_cache")
                .select("bar_timestamp,open,high,low,close,volume")
                .eq("asset_id", asset_id)
                .eq("series_type", series_type)
                .gte("fetched_at", cutoff)
                .order("bar_timestamp", desc=False)
                .execute()
            )
            bars: list[OhlcvBar] = []
            for row in resp.data or []:
                ts = parse_timestamp(row.get("bar_timestamp"))
                close = as_float(row.get("close"))
                if ts is None or close is None:
                    continue
                bars.append(
                    OhlcvBar(
                        timestamp=ts,
                        open=as_float(row.get("open")),
                        high=as_float(row.get("high")),
                        low=as_float(row.get("low")),
                        close=close,
                        volume=as_float(row.get("volume")),
                    )
                )
            return bars

        return await asyncio.to_thread(read)

    async def upsert_historical_cache(
        self, asset_id: str, series_type: str, bars: list[dict[str, object]]
    ) -> None:
        if not bars:
            return
        rows = [
            {**bar, "asset_id": asset_id, "series_type": series_type}
            for bar in bars
        ]

        def write() -> None:
            (
                self._db()
                .table("hg_historical_cache")
                .upsert(rows, on_conflict="asset_id,series_type,bar_timestamp")
                .execute()
            )

        await asyncio.to_thread(write)

    async def get_scan_by_idempotency(
        self, user_id: str, idempotency_key: str
    ) -> dict[str, object] | None:
        def read() -> dict[str, object] | None:
            resp = (
                self._db()
                .table("hg_scan_runs")
                .select("*")
                .eq("user_id", user_id)
                .eq("idempotency_key", idempotency_key)
                .limit(1)
                .execute()
            )
            rows = resp.data or []
            return dict(rows[0]) if rows else None

        return await asyncio.to_thread(read)

    async def create_scan_run(self, row: dict[str, object]) -> dict[str, object]:
        def write() -> dict[str, object]:
            resp = self._db().table("hg_scan_runs").insert(row).execute()
            rows = resp.data or []
            return dict(rows[0])

        return await asyncio.to_thread(write)

    async def update_scan_run(
        self, user_id: str, scan_run_id: str, patch: dict[str, object]
    ) -> dict[str, object] | None:
        def write() -> dict[str, object] | None:
            resp = (
                self._db()
                .table("hg_scan_runs")
                .update(patch)
                .eq("id", scan_run_id)
                .eq("user_id", user_id)
                .execute()
            )
            rows = resp.data or []
            return dict(rows[0]) if rows else None

        return await asyncio.to_thread(write)

    async def is_cancel_requested(self, user_id: str, scan_run_id: str) -> bool:
        def read() -> bool:
            resp = (
                self._db()
                .table("hg_scan_runs")
                .select("cancel_requested_at")
                .eq("id", scan_run_id)
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            rows = resp.data or []
            return bool(rows and rows[0].get("cancel_requested_at") is not None)

        return await asyncio.to_thread(read)

    async def list_scans(self, user_id: str, limit: int = 25) -> list[dict[str, object]]:
        def read() -> list[dict[str, object]]:
            resp = (
                self._db()
                .table("hg_scan_runs")
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return [dict(r) for r in (resp.data or [])]

        return await asyncio.to_thread(read)

    async def get_scan(self, user_id: str, scan_run_id: str) -> dict[str, object] | None:
        def read() -> dict[str, object] | None:
            resp = (
                self._db()
                .table("hg_scan_runs")
                .select("*")
                .eq("id", scan_run_id)
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            rows = resp.data or []
            return dict(rows[0]) if rows else None

        return await asyncio.to_thread(read)

    async def list_rejections(self, user_id: str, scan_run_id: str) -> list[dict[str, object]]:
        def read() -> list[dict[str, object]]:
            resp = (
                self._db()
                .table("hg_scan_rejections")
                .select("*,hg_assets(symbol)")
                .eq("user_id", user_id)
                .eq("scan_run_id", scan_run_id)
                .execute()
            )
            out = []
            for row in resp.data or []:
                item = dict(row)
                asset = item.pop("hg_assets", None) or {}
                item["symbol"] = asset.get("symbol")
                out.append(item)
            return out

        return await asyncio.to_thread(read)

    async def get_previous_candidate(
        self,
        user_id: str,
        asset_id: str,
        track: str,
        horizon: str,
        exclude_run_id: str,
    ) -> dict[str, object] | None:
        def read() -> dict[str, object] | None:
            resp = (
                self._db()
                .table("hg_candidate_results")
                .select("*")
                .eq("user_id", user_id)
                .eq("asset_id", asset_id)
                .eq("discovery_track", track)
                .eq("trading_horizon", horizon)
                .neq("scan_run_id", exclude_run_id)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            rows = resp.data or []
            return dict(rows[0]) if rows else None

        return await asyncio.to_thread(read)

    async def has_recent_alert(self, user_id: str, dedup_key: str, since: datetime) -> bool:
        def read() -> bool:
            resp = (
                self._db()
                .table("hg_alert_events")
                .select("id")
                .eq("user_id", user_id)
                .eq("dedup_key", dedup_key)
                .gte("created_at", since.isoformat())
                .limit(1)
                .execute()
            )
            return bool(resp.data)

        return await asyncio.to_thread(read)

    async def persist_scan_outputs(
        self,
        *,
        user_id: str,
        scan_run_id: str,
        candidates: list[dict[str, object]],
        evidence_by_key: dict[tuple[str, str, str], list[dict[str, object]]],
        rejections: list[dict[str, object]],
        history_rows: list[dict[str, object]],
        checkpoints: list[dict[str, object]],
        alerts: list[dict[str, object]],
        explanation_builder: ExplanationFn,
        explain_keys: set[tuple[str, str, str]],
    ) -> None:
        def write() -> None:
            db = self._db()
            cand_id_map: dict[tuple[str, str, str], str] = {}
            cand_rows_by_key: dict[tuple[str, str, str], dict[str, object]] = {}
            if candidates:
                c_resp = (
                    db.table("hg_candidate_results")
                    .insert([{**c, "user_id": user_id} for c in candidates])
                    .execute()
                )
                for row in c_resp.data or []:
                    key = (
                        str(row["asset_id"]),
                        str(row["discovery_track"]),
                        str(row["trading_horizon"]),
                    )
                    cand_id_map[key] = str(row["id"])
                    cand_rows_by_key[key] = dict(row)

            ev_insert: list[dict[str, object]] = []
            for key, ev_list in evidence_by_key.items():
                cid = cand_id_map.get(key)
                if cid is None:
                    continue
                for ev in ev_list:
                    ev_insert.append({**ev, "user_id": user_id, "candidate_result_id": cid})
            if ev_insert:
                ev_resp = db.table("hg_candidate_evidence").insert(ev_insert).execute()
                grouped_ev: dict[str, list[dict[str, object]]] = {}
                for row in ev_resp.data or []:
                    grouped_ev.setdefault(str(row["candidate_result_id"]), []).append(dict(row))
                for key in explain_keys:
                    cid = cand_id_map.get(key)
                    if cid and cid in grouped_ev:
                        exp = explanation_builder(cand_rows_by_key[key], grouped_ev[cid])
                        (
                            db.table("hg_candidate_results")
                            .update({"explanation": exp})
                            .eq("id", cid)
                            .eq("user_id", user_id)
                            .execute()
                        )

            if rejections:
                db.table("hg_scan_rejections").insert(
                    [{**r, "user_id": user_id} for r in rejections]
                ).execute()
            if history_rows:
                resolved_hist = []
                for h in history_rows:
                    key = (
                        str(h["asset_id"]),
                        str(h["discovery_track"]),
                        str(h["trading_horizon"]),
                    )
                    cid = cand_id_map.get(key)
                    if cid:
                        resolved_hist.append(
                            {**h, "user_id": user_id, "candidate_result_id": cid}
                        )
                if resolved_hist:
                    db.table("hg_score_history").insert(resolved_hist).execute()
            if checkpoints:
                resolved_cp = []
                for cp in checkpoints:
                    key = (
                        str(cp["asset_id"]),
                        str(cp["discovery_track"]),
                        str(cp["trading_horizon"]),
                    )
                    cid = cand_id_map.get(key)
                    if cid:
                        resolved_cp.append(
                            {**cp, "user_id": user_id, "candidate_result_id": cid}
                        )
                if resolved_cp:
                    db.table("hg_outcome_checkpoints").upsert(
                        resolved_cp, on_conflict="candidate_result_id"
                    ).execute()
            if alerts:
                db.table("hg_alert_events").insert(
                    [{**a, "user_id": user_id, "scan_run_id": scan_run_id} for a in alerts]
                ).execute()

        await asyncio.to_thread(write)

    @staticmethod
    def _flatten_candidate(row: dict[str, object]) -> dict[str, object]:
        asset = row.pop("hg_assets", None) or {}
        snap = row.pop("hg_market_snapshots", None) or {}
        if isinstance(asset, dict):
            row["canonical_provider_id"] = asset.get("canonical_provider_id", "")
            row["symbol"] = asset.get("symbol", "")
            row["name"] = asset.get("name", "")
        if isinstance(snap, dict):
            row["price"] = as_float(snap.get("price"))
            row["market_cap"] = as_float(snap.get("market_cap"))
            row["volume_24h"] = as_float(snap.get("volume_24h"))
            row["return_24h"] = as_float(snap.get("return_24h"))
            row["return_7d"] = as_float(snap.get("return_7d"))
            row["rs_btc_7d"] = as_float(snap.get("rs_btc_7d"))
            row["source_timestamp"] = snap.get("source_timestamp")
        return row

    async def list_candidates(
        self,
        user_id: str,
        *,
        track: str | None = None,
        horizon: str | None = None,
        min_score: float | None = None,
        confidence: str | None = None,
        classification: str | None = None,
        eligibility: str | None = None,
        run_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, object]]:
        def read() -> list[dict[str, object]]:
            q = (
                self._db()
                .table("hg_candidate_results")
                .select(
                    "*,hg_assets(canonical_provider_id,symbol,name),"
                    "hg_market_snapshots(price,market_cap,volume_24h,return_24h,return_7d,"
                    "rs_btc_7d,source_timestamp)"
                )
                .eq("user_id", user_id)
            )
            if track:
                q = q.eq("discovery_track", track)
            if horizon:
                q = q.eq("trading_horizon", horizon)
            if confidence:
                q = q.eq("confidence_level", confidence)
            if classification:
                q = q.eq("classification", classification)
            if eligibility:
                q = q.eq("eligibility_status", eligibility)
            if run_id:
                q = q.eq("scan_run_id", run_id)
            if min_score is not None:
                q = q.gte("adjusted_score", min_score)
            ordered = q.order("adjusted_score", desc=True, nullsfirst=False).order(
                "created_at", desc=True
            )
            if offset > 0:
                resp = ordered.range(offset, offset + limit - 1).execute()
            else:
                resp = ordered.limit(limit).execute()
            return [self._flatten_candidate(dict(r)) for r in (resp.data or [])]

        return await asyncio.to_thread(read)

    async def get_candidate_detail(
        self, user_id: str, candidate_id: str
    ) -> dict[str, object] | None:
        def read() -> dict[str, object] | None:
            resp = (
                self._db()
                .table("hg_candidate_results")
                .select(
                    "*,hg_assets(canonical_provider_id,symbol,name),"
                    "hg_market_snapshots(price,market_cap,volume_24h,return_24h,return_7d,"
                    "rs_btc_7d,source_timestamp)"
                )
                .eq("id", candidate_id)
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            rows = resp.data or []
            if not rows:
                return None
            row = self._flatten_candidate(dict(rows[0]))
            ev_resp = (
                self._db()
                .table("hg_candidate_evidence")
                .select("*")
                .eq("candidate_result_id", candidate_id)
                .eq("user_id", user_id)
                .execute()
            )
            hist_resp = (
                self._db()
                .table("hg_score_history")
                .select("*")
                .eq("user_id", user_id)
                .eq("asset_id", str(row["asset_id"]))
                .order("observed_at", desc=True)
                .limit(20)
                .execute()
            )
            cp_resp = (
                self._db()
                .table("hg_outcome_checkpoints")
                .select("*")
                .eq("candidate_result_id", candidate_id)
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
            cp_rows = cp_resp.data or []
            return {
                "row": row,
                "evidence": [dict(e) for e in (ev_resp.data or [])],
                "score_history": [dict(h) for h in (hist_resp.data or [])],
                "outcome_checkpoint": dict(cp_rows[0]) if cp_rows else None,
            }

        return await asyncio.to_thread(read)

    async def set_candidate_explanation(
        self, user_id: str, candidate_id: str, explanation: dict[str, object]
    ) -> None:
        def write() -> None:
            (
                self._db()
                .table("hg_candidate_results")
                .update({"explanation": explanation})
                .eq("id", candidate_id)
                .eq("user_id", user_id)
                .execute()
            )

        await asyncio.to_thread(write)

    async def list_configs(self, user_id: str) -> list[dict[str, object]]:
        def read() -> list[dict[str, object]]:
            resp = (
                self._db()
                .table("hg_scan_configs")
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .execute()
            )
            return [dict(r) for r in (resp.data or [])]

        return await asyncio.to_thread(read)

    async def create_config(self, row: dict[str, object]) -> dict[str, object]:
        def write() -> dict[str, object]:
            resp = self._db().table("hg_scan_configs").insert(row).execute()
            return dict((resp.data or [])[0])

        return await asyncio.to_thread(write)

    async def update_config(
        self, user_id: str, config_id: str, patch: dict[str, object]
    ) -> dict[str, object] | None:
        def write() -> dict[str, object] | None:
            resp = (
                self._db()
                .table("hg_scan_configs")
                .update(patch)
                .eq("id", config_id)
                .eq("user_id", user_id)
                .execute()
            )
            rows = resp.data or []
            return dict(rows[0]) if rows else None

        return await asyncio.to_thread(write)

    async def list_watchlist(self, user_id: str) -> list[dict[str, object]]:
        def read() -> list[dict[str, object]]:
            resp = (
                self._db()
                .table("hg_watchlist_items")
                .select("*,hg_assets(symbol,name)")
                .eq("user_id", user_id)
                .order("updated_at", desc=True)
                .execute()
            )
            out = []
            for row in resp.data or []:
                item = dict(row)
                asset = item.pop("hg_assets", None) or {}
                item["symbol"] = asset.get("symbol")
                item["name"] = asset.get("name")
                out.append(item)
            return out

        return await asyncio.to_thread(read)

    async def upsert_watchlist(self, row: dict[str, object]) -> dict[str, object]:
        def write() -> dict[str, object]:
            resp = (
                self._db()
                .table("hg_watchlist_items")
                .upsert(row, on_conflict="user_id,asset_id")
                .execute()
            )
            return dict((resp.data or [])[0])

        return await asyncio.to_thread(write)

    async def delete_watchlist(self, user_id: str, item_id: str) -> bool:
        def write() -> bool:
            resp = (
                self._db()
                .table("hg_watchlist_items")
                .delete()
                .eq("id", item_id)
                .eq("user_id", user_id)
                .execute()
            )
            return bool(resp.data)

        return await asyncio.to_thread(write)

    async def list_alerts(self, user_id: str, limit: int = 50) -> list[dict[str, object]]:
        def read() -> list[dict[str, object]]:
            resp = (
                self._db()
                .table("hg_alert_events")
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            )
            return [dict(r) for r in (resp.data or [])]

        return await asyncio.to_thread(read)

    async def list_outcome_checkpoints(self, user_id: str) -> list[dict[str, object]]:
        def read() -> list[dict[str, object]]:
            resp = (
                self._db()
                .table("hg_outcome_checkpoints")
                .select("*")
                .eq("user_id", user_id)
                .execute()
            )
            return [dict(r) for r in (resp.data or [])]

        return await asyncio.to_thread(read)

    async def list_active_checkpoints_all(self, since: datetime) -> list[dict[str, object]]:
        def read() -> list[dict[str, object]]:
            resp = (
                self._db()
                .table("hg_outcome_checkpoints")
                .select("*")
                .gte("entry_observed_at", since.isoformat())
                .is_("invalidated_at", "null")
                .execute()
            )
            return [dict(r) for r in (resp.data or [])]

        return await asyncio.to_thread(read)

    async def get_latest_snapshots_for_assets(
        self, asset_ids: list[str]
    ) -> dict[str, dict[str, object]]:
        if not asset_ids:
            return {}

        def read() -> dict[str, dict[str, object]]:
            resp = (
                self._db()
                .table("hg_market_snapshots")
                .select("asset_id,price,observed_at")
                .in_("asset_id", asset_ids)
                .order("observed_at", desc=True)
                .limit(max(len(asset_ids) * 2, 50))
                .execute()
            )
            latest: dict[str, dict[str, object]] = {}
            for row in resp.data or []:
                aid = str(row["asset_id"])
                if aid not in latest:
                    latest[aid] = dict(row)
            return latest

        return await asyncio.to_thread(read)

    async def update_checkpoint(self, checkpoint_id: str, patch: dict[str, object]) -> None:
        def write() -> None:
            (
                self._db()
                .table("hg_outcome_checkpoints")
                .update(patch)
                .eq("id", checkpoint_id)
                .execute()
            )

        await asyncio.to_thread(write)

    async def mark_stale_running_scans_failed(self, stale_before: datetime) -> int:
        def write() -> int:
            resp = (
                self._db()
                .table("hg_scan_runs")
                .update(
                    {
                        "status": "FAILED",
                        "error_summary": "Worker heartbeat timeout",
                        "completed_at": datetime.now(UTC).isoformat(),
                    }
                )
                .eq("status", "RUNNING")
                .lt("heartbeat_at", stale_before.isoformat())
                .execute()
            )
            return len(resp.data or [])

        return await asyncio.to_thread(write)

    async def list_active_configs_all(self) -> list[dict[str, object]]:
        def read() -> list[dict[str, object]]:
            resp = (
                self._db()
                .table("hg_scan_configs")
                .select("*")
                .eq("is_active", True)
                .execute()
            )
            return [dict(r) for r in (resp.data or [])]

        return await asyncio.to_thread(read)

    async def get_asset_id_by_cmc_id(self, canonical_provider_id: str) -> str | None:
        def read() -> str | None:
            resp = (
                self._db()
                .table("hg_assets")
                .select("id")
                .eq("canonical_provider", "coinmarketcap")
                .eq("canonical_provider_id", str(canonical_provider_id))
                .limit(1)
                .execute()
            )
            rows = resp.data or []
            return str(rows[0]["id"]) if rows else None

        return await asyncio.to_thread(read)

    async def update_alert_delivery(self, alert_id: str, patch: dict[str, object]) -> None:
        def write() -> None:
            (
                self._db()
                .table("hg_alert_events")
                .update(patch)
                .eq("id", alert_id)
                .execute()
            )

        await asyncio.to_thread(write)
