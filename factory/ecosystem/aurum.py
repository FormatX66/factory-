"""Aurum's additive ecosystem entry point; no service replacement or live dispatch.

The existing Future Branch source supplies admission, Medic/Factory supplies work,
and a separate receipt reader supplies verification. Admission is NOT authority.
The CLI deliberately has no live-submit switch in this acceptance candidate.
"""
from __future__ import annotations
import argparse
import hashlib
import http.client
import json
import math
import re
import sqlite3
import sys
import time
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "vendor"))
from aurum_farmer.operation_gate import OperationGate, source_revision

SCHEMA = "aurum.ecosystem.v1"
COMPONENTS = (
    ("future_branch", 19466, "policy admission and model-only exploration"),
    ("medic_factory", 8091, "existing authenticated Medic-to-Factory bridge"),
    ("medic_hub", 8090, "existing Medic main hub"),
    ("commander", 19470, "existing authorized command execution"),
)

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     allow_nan=False).encode()).hexdigest()

def normalize(raw):
    allowed = {"id", "goal", "classification", "requirements", "constraints", "needsTools", "repo", "lkg"}
    if not isinstance(raw, dict) or set(raw) - allowed:
        raise ValueError("unknown job fields; jobs cannot supply authority, commands or endpoints")
    ident, goal = raw.get("id"), raw.get("goal")
    if not isinstance(ident, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", ident):
        raise ValueError("invalid operation id")
    if not isinstance(goal, str) or not 1 <= len(goal.strip()) <= 4096:
        raise ValueError("invalid goal")
    classification = raw.get("classification", "private")
    if not isinstance(classification, str) or classification not in {"synthetic", "public", "private"}:
        raise ValueError("invalid classification")
    if "needsTools" in raw and not isinstance(raw["needsTools"], bool):
        raise ValueError("needsTools must be boolean")
    job = {"id": ident, "goal": goal.strip(), "classification": classification,
           "needsTools": raw.get("needsTools", False)}
    for name in ("requirements", "constraints"):
        values = raw.get(name, [])
        if not isinstance(values, list) or len(values) > 32 or any(
                not isinstance(v, str) or len(v) > 512 for v in values):
            raise ValueError("invalid " + name)
        job[name] = values
    for name in ("repo", "lkg"):
        value = raw.get(name)
        if not isinstance(value, str) or not 1 <= len(value) <= 256:
            raise ValueError(name + " reference required")
        job[name] = value
    return job

def semantic(job):
    return {k: v for k, v in job.items() if k != "id"}

@dataclass(frozen=True)
class Grant:
    """Trusted caller-owned grant. Never constructed from the submitted job."""
    job_digest: str
    expires_at: float
    source: str = "operator"
    capability: str = "synthetic_proposal"

class ReceiptMismatch(ValueError):
    pass

def verify_factory_receipt(job, response, receipt):
    """Verify proposal delivery, not truth of model output or execution of its advice."""
    if not isinstance(response, dict) or not isinstance(receipt, dict):
        raise ReceiptMismatch("receipt/response type")
    if receipt.get("schema") != "medic.factory.result.v1" or response.get("ok") is not True:
        raise ReceiptMismatch("receipt/response schema")
    task = receipt.get("task", {})
    if not isinstance(task, dict):
        raise ReceiptMismatch("task type")
    if any(record.get("id") != job["id"] for record in (response, receipt, task)):
        raise ReceiptMismatch("operation correlation")
    if receipt.get("status") != "review" or response.get("status") != "review" or task.get("status") != "review":
        raise ReceiptMismatch("proposal must remain review-only")
    output, route = receipt.get("output"), receipt.get("route")
    if not isinstance(output, str) or not 1 <= len(output) <= 32768 or not isinstance(route, str):
        raise ReceiptMismatch("bounded output/route")
    if route != "free/opencode/space-bunny-free":
        raise ReceiptMismatch("unqualified candidate route")
    if response.get("output") != output or response.get("route") != route or task.get("worker") != route:
        raise ReceiptMismatch("response and separately read receipt disagree")
    if job["classification"] != "synthetic" or job["needsTools"]:
        raise ReceiptMismatch("candidate is synthetic text-only")
    # Verify Factory retained the actual contract, not merely the matching ID.
    for key in ("goal", "requirements", "constraints", "repo", "lkg"):
        if task.get(key) != job[key]:
            raise ReceiptMismatch("task contract mismatch: " + key)
    return {"receipt_sha256": digest(receipt), "output_sha256": digest(output),
            "route": route, "scope": "synthetic_proposal_delivery_only",
            "arbitrary_effect_verified": False, "lkg_promoted": False}

class Ecosystem:
    """Single finite-operation facade. No scheduler, recovery worker or model loop."""
    def __init__(self, state_root: Path, *, submit: Callable, read_receipt: Callable,
                 adapter_identity: str, activation: str = "held"):
        self.root = Path(state_root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.submit, self.read_receipt = submit, read_receipt
        self.adapter_identity, self.activation = adapter_identity, activation
        implementation = source_revision([Path(__file__)])
        self.gate = OperationGate(self.root / "future-branch.sqlite3", implementation=implementation)
        self.db = self.root / "operations.sqlite3"
        with closing(sqlite3.connect(self.db)) as con, con:
            con.execute("CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status TEXT NOT NULL, proof TEXT)")

    def _get(self, ident):
        with closing(sqlite3.connect(self.db)) as con:
            con.row_factory = sqlite3.Row
            row = con.execute("SELECT * FROM jobs WHERE id=?", (ident,)).fetchone()
            return dict(row) if row else None

    def _claim(self, ident, fingerprint):
        with closing(sqlite3.connect(self.db)) as con, con:
            con.execute("INSERT INTO jobs VALUES(?,?,?,NULL)", (ident, fingerprint, "running"))

    def _finish(self, ident, status, proof):
        with closing(sqlite3.connect(self.db)) as con, con:
            con.execute("UPDATE jobs SET status=?,proof=? WHERE id=?", (status, json.dumps(proof), ident))

    def run(self, raw, grant: Grant | None):
        job = normalize(raw)
        fingerprint = digest(semantic(job))
        result = {"schema": SCHEMA, "id": job["id"], "status": "held", "submitted": False}
        if self.activation != "fixture_only":
            return {**result, "reason": "live_activation_held"}
        if not isinstance(grant, Grant) or grant.source != "operator" or grant.capability != "synthetic_proposal" or grant.job_digest != digest(job) or not isinstance(grant.expires_at, (int, float)) or not math.isfinite(grant.expires_at) or grant.expires_at <= time.time():
            return {**result, "reason": "explicit_matching_authority_required"}
        if job["classification"] != "synthetic" or job["needsTools"]:
            return {**result, "reason": "unsupported_scope"}
        old = self._get(job["id"])
        if old:
            if old["fingerprint"] != fingerprint:
                return {**result, "reason": "operation_id_conflict"}
            if old["status"] == "proposal_verified":
                try:
                    receipt = self.read_receipt(job["id"])
                    response = {**receipt, "ok": True}
                    proof = verify_factory_receipt(job, response, receipt)
                    if proof != json.loads(old["proof"]):
                        raise ReceiptMismatch("cached receipt changed")
                    return {**result, "status": "proposal_verified", "cached": True, "proof": proof}
                except Exception:
                    return {**result, "reason": "cached_receipt_unverified"}
            return {**result, "reason": "prior_attempt_requires_review"}
        # Only stable adapter identity enters observed state. Never a new timestamp.
        ticket = self.gate.begin("aurum.synthetic_proposal", semantic(job),
                                 {"adapter": self.adapter_identity, "activation": self.activation})
        if not ticket["allowed"]:
            return {**result, "reason": ticket["reason"] or "policy_hold"}
        try:
            self._claim(job["id"], fingerprint)
        except sqlite3.IntegrityError:
            self.gate.finish(ticket, "waiting", {"reason": "operation_claim_conflict"})
            return {**result, "reason": "operation_claim_conflict"}
        except Exception:
            self.gate.finish(ticket, "uncertain", {"reason": "state_unavailable"})
            return {**result, "reason": "state_unavailable"}
        try:
            response = self.submit(job)
            receipt = self.read_receipt(job["id"])
            proof = verify_factory_receipt(job, response, receipt)
            self._finish(job["id"], "proposal_verified", proof)
            self.gate.finish(ticket, "observed", proof)
            return {**result, "status": "proposal_verified", "submitted": True, "cached": False, "proof": proof}
        except Exception as error:
            # Do not infer that an exception means the external action did not happen.
            evidence = {"error_type": type(error).__name__, "review_required": True}
            self._finish(job["id"], "uncertain", evidence)
            self.gate.finish(ticket, "uncertain", evidence)
            return {**result, "reason": "outcome_uncertain", "submitted": True}


def probe_component(name, port, role):
    item = {"name": name, "port": port, "role": role, "execution_verified": False}
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
    try:
        connection.request("GET", "/health")
        response = connection.getresponse()
        raw = response.read(131073)
        item["http_status"] = response.status
        if response.status in (401, 403):
            return {**item, "state": "authentication_required"}
        if response.status != 200 or len(raw) > 131072:
            return {**item, "state": "unverified"}
        value = json.loads(raw)
        if not isinstance(value, dict):
            return {**item, "state": "unverified"}
        if name == "future_branch":
            explorer = value.get("continuous_exploration", {})
            if not isinstance(explorer, dict):
                return {**item, "state": "unverified"}
            healthy = value.get("status") == "healthy" and value.get("event_chain_valid") is True
            item["explorer"] = {k: explorer.get(k) for k in ("healthy", "model_only", "seal_valid", "worker_alive", "watchdog_alive", "invariant_violations")}
        elif name == "commander":
            healthy = value.get("ok") is True and value.get("service") == "aurum-commander"
            item["version"] = value.get("version")
        elif name == "medic_factory":
            healthy = value.get("ok") is True and value.get("service") == "medic-factory-bridge"
        else:
            # Main Medic's health schema is not qualified by this candidate.
            healthy = False
        return {**item, "state": "health_observed" if healthy else "unverified"}
    except (OSError, ValueError, http.client.HTTPException) as error:
        return {**item, "state": "unreachable_or_invalid", "error_type": type(error).__name__}
    finally:
        connection.close()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("status", help="read-only loopback observations, never an execution claim")
    validate = sub.add_parser("plan", help="validate a job without submitting it")
    validate.add_argument("job", type=Path)
    args = parser.parse_args()
    if args.action == "status":
        value = {"schema": SCHEMA, "live_dispatch": "held", "components": [probe_component(*c) for c in COMPONENTS]}
    else:
        job = normalize(json.loads(args.job.read_text(encoding="utf-8-sig")))
        value = {"schema": SCHEMA, "id": job["id"], "job_digest": digest(job),
                 "required_capability": "tool_execution" if job["needsTools"] else "proposal",
                 "classification": job["classification"], "submitted": False, "live_dispatch": "held"}
    print(json.dumps(value, sort_keys=True))

if __name__ == "__main__":
    main()
