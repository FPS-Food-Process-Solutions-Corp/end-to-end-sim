# Proposed partial-fulfillment fix

Status: design proposal; platform business logic has not been changed. The observed bug and evidence are in [failure-recovery-summary.md](failure-recovery-summary.md). A manual platform-only reproduction is in [partial-order-api-socketio-reproduction.md](partial-order-api-socketio-reproduction.md).

## Intended behavior

Collection state and fulfillment result answer different questions. Keep the existing order lifecycle, and persist a separate terminal fulfillment result with item-level evidence.

| Work outcome | Order lifecycle | Fulfillment result | Counter |
| --- | --- | --- | --- |
| All requested units succeed | READY, then COMPLETED when collected | COMPLETE | Held until collection |
| Some succeed; every remaining unit has a known, exhausted failure | READY, then COMPLETED when collected | PARTIAL | Held until collection |
| All units have known, exhausted failures | FAILED | NONE | Released |
| Any required work is pending, retryable, or has an unknown outcome | PREPARING | Not finalized | Held |

FAILED and REFUND_REQUIRED already exist in the platform. Use FAILED for a wholly unsuccessful fulfillment. Choosing REFUND_REQUIRED or issuing a refund is a separate explicit payment decision; this fix does not automatically refund, issue credit, or rewrite the recorded charge. Keep the current retry budget unchanged.

## Implementation

1. Introduce one transactional finalization path. It checks all required pick and brew work, including that the expected sessions exist. A first failure with a retry remaining cannot finalize the order. An uncertain physical result cannot be treated as a known failure. Keep the existing session-completion barrier so an order does not become collectable while work is active.
2. Release only the remaining reservations belonging to permanently failed task units, using their order-item and inventory allocation identities. Reuse the existing successful-task inventory consumption. Do not restore successfully consumed stock or call the all-order reservation release while other work is pending.
3. Persist a terminal outcome and item-level snapshot: requested, completed, failed/cancelled quantities, task identifiers, retry counts, failure reasons, and finalization time. Guard finalization and reservation release in the same transaction so duplicate messages cannot apply the transition twice.
4. For a mixed terminal result, set READY with PARTIAL and retain the counter. The customer sees, for example, "1 of 2 ready; 1 unavailable", with the failed item identified. Admin views expose the failure and retry evidence. Collection records COMPLETED while preserving PARTIAL and its item summary.
5. For no successful units, set FAILED, release the unused reservations and counter, and retain the failure summary for operator/payment review. Do not offer collection of nonexistent items.
6. Save the outcome snapshot before collection or cancellation cleanup deletes operational sessions. Preserve evidence without retaining runnable cancelled work. Collection must not turn failed tasks into successful picks. A terminal result cannot be changed by a delayed duplicate message; explicit reconciliation is a separate action.

The same aggregate applies to mixed coffee/snack orders: a finished snack does not finalize an order whose coffee is still running; known terminal outcomes across both determine COMPLETE, PARTIAL, or NONE.

## Scope and validation

Implement and validate in the isolated staging platform first. The main seams are order-preparation.service.ts, hr-pick-session.service.ts, inventory-reservation.service.ts, the order cleanup/mapping services, the persisted order outcome, and the customer/admin fulfillment display. Keep the robot Socket.IO event contract and READY-to-COMPLETED collection lifecycle compatible.

The first regression repeats the two-croissant case: one success, one failed initial attempt, one failed retry. It must finish READY/PARTIAL, consume one unit, release the unsuccessful unit's reservation, keep the counter until collection, and preserve both item outcomes afterward. Also verify all-success, all-failed, failure before retry exhaustion, pending/unknown work, mixed brew/pick work, duplicate terminal messages, cancellation, and restart persistence. Snapshot evidence must remain available after cleanup.

Payment handling is deliberately separate from this fulfillment fix. The default proposal for this simulation is operator review of unfulfilled paid items, with the original amount retained and no automatic refund. A later payment policy can choose refund timing, partial amounts, tax allocation, or credit.
