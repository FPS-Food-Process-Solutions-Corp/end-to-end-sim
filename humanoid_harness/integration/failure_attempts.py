"""Durable bridge audit for exact platform failure-report generations."""

from copy import deepcopy
from dataclasses import asdict
import hashlib
import json
from pathlib import Path

from hr_client.models import PickFailureReason
from hr_client.pending_failure import FailureIdentity, FailureState, PendingFailure, PendingFailureStore, reconcile_failure_queue, FailureReconciliationKind

from ..storage import StateError, read_json, write_json


def proof_digest(proof: dict) -> str:
    return hashlib.sha256(json.dumps(proof, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")).hexdigest()


def _valid_retry(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _platform_evidence_valid(record: PendingFailure) -> bool:
    tagged = record.platform_evidence
    if not isinstance(tagged, dict) or tagged.get("source") not in ("ack", "direct", "readback"):
        return False
    response = tagged.get("response")
    if not isinstance(response, dict):
        return False
    if tagged["source"] == "readback":
        return reconcile_failure_queue(response, record.identity, record.message).kind is FailureReconciliationKind.CONFIRMED
    retry = response.get("retryCount")
    maximum = response.get("maxRetries")
    return (response.get("eventType") == "platform.pick_task_failed"
            and response.get("orderId") == record.identity.order_id
            and response.get("pickSessionId") == record.identity.session_id
            and response.get("pickTaskId") == record.identity.task_id
            and response.get("status") == "FAILED"
            and response.get("message") == record.message
            and _valid_retry(retry) and retry == record.identity.retry_count
            and _valid_retry(maximum) and retry <= maximum
            and isinstance(response.get("willRetry"), bool)
            and response["willRetry"] == (retry < maximum))


class FailureAttemptLedger:
    """One immutable report intent per exact retry generation; callback is the audit."""

    def __init__(self, path: Path):
        self.path = Path(path)
        if self.path.exists():
            self.data = read_json(self.path)
            if self.data.get("schema") != 1 or not isinstance(self.data.get("attempts"), dict):
                raise StateError("Invalid failure-attempt ledger")
            self._validate_loaded()
        else:
            self.data = {"schema": 1, "attempts": {}}
            write_json(self.path, self.data)

    def _validate_loaded(self) -> None:
        by_task: dict[str, list[dict]] = {}
        for key, attempt in self.data["attempts"].items():
            try:
                if not isinstance(attempt, dict) or set(attempt) != {"identity", "assignment", "source", "reason", "message", "terminal_evidence", "state", "platform_evidence"}:
                    raise ValueError("record fields")
                raw_identity = attempt["identity"]
                if not isinstance(raw_identity, dict) or set(raw_identity) != {"session_id", "task_id", "order_id", "retry_count", "execution_id"}:
                    raise ValueError("identity fields")
                identity = FailureIdentity(**raw_identity)
                if key != identity.key or not identity.execution_id:
                    raise ValueError("identity key")
                assignment = attempt["assignment"]
                source = attempt["source"]
                evidence = attempt["terminal_evidence"]
                if (not isinstance(assignment, dict) or not isinstance(source, dict) or not isinstance(evidence, dict)
                        or {name: assignment.get(name) for name in ("session_id", "task_id", "order_id")} !=
                        {"session_id": identity.session_id, "task_id": identity.task_id, "order_id": identity.order_id}
                        or evidence.get("schema") != 1 or evidence.get("kind") != "verified_physical_failure"
                        or evidence.get("assignment") != assignment or evidence.get("source") != source
                        or not _valid_retry(evidence.get("retry_count"))
                        or evidence.get("retry_count") != identity.retry_count
                        or evidence.get("physical_execution_id") != identity.execution_id):
                    raise ValueError("physical context")
                proof = evidence.get("failure_readiness_proof")
                if (not isinstance(proof, dict) or proof.get("recovery_execution_id") != identity.execution_id
                        or proof.get("assignment") != assignment or proof.get("source") != source
                        or evidence.get("physical_proof_sha256") != proof_digest(proof)
                        or attempt["message"] != proof.get("failure_reason")):
                    raise ValueError("physical proof")
                if (attempt["reason"] != PickFailureReason.UNKNOWN.value or not isinstance(attempt["message"], str)
                        or not attempt["message"] or attempt["state"] not in ("pending", "confirmed")):
                    raise ValueError("report fields")
                if attempt["state"] == "pending" and attempt["platform_evidence"] is not None:
                    raise ValueError("pending platform evidence")
                if attempt["state"] == "confirmed":
                    record = PendingFailure(identity, attempt["reason"], FailureState.CONFIRMED,
                                            {"pickSessionId": identity.session_id, "pickTaskId": identity.task_id,
                                             "message": attempt["message"]}, evidence, attempt["platform_evidence"])
                    if not _platform_evidence_valid(record):
                        raise ValueError("confirmed platform evidence")
                by_task.setdefault(identity.task_id, []).append(attempt)
            except (KeyError, TypeError, ValueError) as exc:
                raise StateError(f"Invalid saved failure attempt {key}: {exc}") from exc
        for task_id, attempts in by_task.items():
            ordered = sorted(attempts, key=lambda item: item["identity"]["retry_count"])
            baseline = ordered[0]
            if [item["identity"]["retry_count"] for item in ordered] != list(range(len(ordered))):
                raise StateError(f"Failure attempts for {task_id} lack contiguous retry generations")
            for attempt in ordered:
                if (attempt["assignment"] != baseline["assignment"] or attempt["source"] != baseline["source"]
                        or attempt["terminal_evidence"]["physical_proof_sha256"] != baseline["terminal_evidence"]["physical_proof_sha256"]
                        or attempt["terminal_evidence"]["failure_readiness_proof"] != baseline["terminal_evidence"]["failure_readiness_proof"]
                        or attempt["reason"] != baseline["reason"] or attempt["message"] != baseline["message"]):
                    raise StateError(f"Failure retry for {task_id} changed immutable physical result")
            if any(item["state"] != "confirmed" for item in ordered[:-1]):
                raise StateError(f"Failure retry for {task_id} has unconfirmed prior generation")

    def records(self) -> list[dict]:
        return [deepcopy(value) for value in self.data["attempts"].values()]

    def get(self, identity: FailureIdentity) -> dict | None:
        record = self.data["attempts"].get(identity.key)
        return deepcopy(record) if record is not None else None

    def ensure_intent(self, assignment: dict, source: dict, retry_count: int, proof: dict,
                      reason: PickFailureReason, message: str) -> dict:
        if not _valid_retry(retry_count) or not isinstance(message, str) or not message or not isinstance(proof, dict):
            raise StateError("Failure intent needs exact retry, message and physical proof")
        execution_id = proof.get("recovery_execution_id")
        if (not isinstance(execution_id, str) or not execution_id or proof.get("assignment") != assignment
                or proof.get("source") != source or proof.get("failure_reason") != message):
            raise StateError("Failure proof lacks matching physical assignment, source, reason or execution ID")
        identity = FailureIdentity(assignment["session_id"], assignment["task_id"], assignment["order_id"], retry_count, execution_id)
        envelope = {"schema": 1, "kind": "verified_physical_failure", "assignment": deepcopy(assignment),
                    "source": deepcopy(source), "retry_count": retry_count, "physical_execution_id": execution_id,
                    "physical_proof_sha256": proof_digest(proof), "failure_readiness_proof": deepcopy(proof)}
        immutable = {"identity": asdict(identity), "assignment": deepcopy(assignment), "source": deepcopy(source),
                     "reason": reason.value, "message": message, "terminal_evidence": envelope}
        existing = self.data["attempts"].get(identity.key)
        if existing is not None:
            if any(existing.get(key) != value for key, value in immutable.items()):
                raise StateError("Failure attempt changed immutable report evidence")
            return deepcopy(existing)
        prior = [value for value in self.data["attempts"].values() if value.get("assignment", {}).get("task_id") == assignment["task_id"]]
        if prior:
            generations = [value["identity"]["retry_count"] for value in prior]
            if retry_count != max(generations) + 1 or any(value.get("state") != "confirmed" for value in prior):
                raise StateError("New retry generation requires exact prior callback confirmation")
            if any(value["identity"]["execution_id"] != execution_id or value["assignment"] != assignment
                   or value["source"] != source or value["terminal_evidence"]["physical_proof_sha256"] != proof_digest(proof)
                   or value["terminal_evidence"]["failure_readiness_proof"] != proof
                   or value["reason"] != reason.value or value["message"] != message for value in prior):
                raise StateError("Retry generation changed immutable physical result")
        elif retry_count != 0:
            raise StateError("First bridge failure attempt must be retry generation zero")
        result = {**immutable, "state": "pending", "platform_evidence": None}
        next_data = deepcopy(self.data)
        next_data["attempts"][identity.key] = result
        write_json(self.path, next_data)
        self.data = next_data
        return deepcopy(result)

    def audit(self, record: PendingFailure, public_store: PendingFailureStore) -> None:
        if not isinstance(record, PendingFailure) or record.state is not FailureState.CONFIRMED or not _platform_evidence_valid(record):
            raise StateError("Failure callback lacks exact confirmed platform evidence")
        saved = public_store.get(record.identity)
        if saved != record:
            raise StateError("Failure callback differs from durable public store")
        attempt = self.data["attempts"].get(record.identity.key)
        if attempt is None:
            raise StateError("Failure callback has no bridge report intent")
        if (attempt["identity"] != asdict(record.identity) or attempt["reason"] != record.reason
                or attempt["message"] != record.message or attempt["terminal_evidence"] != record.terminal_evidence):
            raise StateError("Failure callback conflicts with exact report intent")
        if attempt["state"] == "confirmed":
            if attempt["platform_evidence"] != record.platform_evidence:
                raise StateError("Failure callback changed confirmed platform evidence")
            return
        if attempt["state"] != "pending":
            raise StateError("Invalid bridge failure attempt state")
        next_data = deepcopy(self.data)
        next_data["attempts"][record.identity.key]["state"] = "confirmed"
        next_data["attempts"][record.identity.key]["platform_evidence"] = deepcopy(record.platform_evidence)
        write_json(self.path, next_data)
        self.data = next_data
