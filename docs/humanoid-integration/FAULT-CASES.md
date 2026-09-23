# Remaining fresh runtime fixtures

These are proposed fixtures for the sole shared runtime owner, not run results. Use only fresh databases/state roots after the new client and bridge pins are reviewed. Replace `<T1>`, `<TA>`, `<TB>` and `<TC>` with task IDs read from the actual created order; every rule's `task_id` must equal its map key. Baseline captures remain immutable.

## Independent physical retry budgets

One successful Rack B case can exercise navigation retry, VLA retry and confirmed-loss recovery together:

```json
{"<T1>":[{"task_id":"<T1>","kind":"navigate_pick","occurrence":1,"outcome":"fail"},{"task_id":"<T1>","kind":"pick","occurrence":1,"outcome":"stuck"},{"task_id":"<T1>","kind":"pick","occurrence":2,"outcome":"no_bun"},{"task_id":"<T1>","kind":"pre_place_check","occurrence":1,"outcome":"loss"}]}
```

The current defaults allow one navigation retry, two VLA retries and one loss cycle. Expected evidence is cycle-zero navigation attempts one/two, a stuck first pick followed by jolt/reset, a second pick with no transferred pastry, then a successful third pick. The first pre-place check confirms loss. Cycle one uses new cycle/action identities, retrieves the replacement and places exactly once, followed by verified post-place release. Preserve one lost bun and one placed bun in the simulated world.

The stub's `no_bun` execution has a generic `effect_applied` flag; no-transfer proof comes from source/world/possession observations, not that flag alone. Record actual platform database and available-stock deltas separately from the simulator's lost-bun/replacement accounting. Do not invent platform inventory writes to account for a simulated loss.

## Completion response loss and active-owner restart

The exit-76 hook can share a case with completion response loss only if two separate checkpoints are retained. With no physical faults, first launch `--crash-after-place-once`: placement and post-place retract effects are saved, but current release proof and the client queue are absent. Restart reconciles those exact effects and verifies release before reporting.

The existing `hold_after_terminal` proxy mode forwards completion to the backend and withholds acknowledgment/direct success. Retain the accepted backend completion and unsettled local record before stopping again. Restore pass mode and reconnect/restart to confirm the same record with no additional pick, place or retract. This is accepted completion with lost responses, not a dropped outbound completion. Keep these as separate cases if the two-checkpoint fixture cannot preserve both boundaries reliably.

## Verified placement with a persistent physical hold

Use a separate fresh case and `--crash-after-held-placement-once`:

```json
{"<T1>":[{"task_id":"<T1>","kind":"post_place_retract","occurrence":1,"outcome":"unknown"}]}
```

Before restart require exit 78, exactly one place and exact placement proof, saved owner HOLD/readiness unknown, the one-shot marker, no pending completion file or outbound completion, and backend IN_PROGRESS. After adoption, restart installs the stable public recovery hold before queueing/connecting, settles the exact completion, and stays PAUSED with the same physical action ledger. No FREE, next-task request, default delivery or automatic hold release is allowed. Do not enable the exit-76 flag in this case.

## Unknown physical state and cancellation

Each persistent hold needs its own fresh case. Use `kind: "pick"`, `occurrence: 1` and either `outcome: "unknown"` or `outcome: "cancel_unknown"`. The latter remains running through the polling budget and returns unknown on cancellation. Require persistent HOLD, no unjustified terminal failure/completion, and no subsequent or repeated motion after restart. `collision` may cover its own distinct branch if required; it is not a substitute for cancellation. A `cancel_race` case establishes a completed effect during cancellation and must be described separately from an unknown effect.

## Partial A/B/C order

Create a single three-pastry Rack B order. A and C have no faults; bind all three failures to the exact B task:

```json
{"<TB>":[{"task_id":"<TB>","kind":"pick","occurrence":1,"outcome":"fail"},{"task_id":"<TB>","kind":"pick","occurrence":2,"outcome":"fail"},{"task_id":"<TB>","kind":"pick","occurrence":3,"outcome":"fail"}]}
```

Require A placement, B's three known no-effect attempts and one verified failure retract, then C placement before B's platform retry. Retry one reuses B's immutable physical proof with zero new B actions and preserves C's latest device release. The new client must retain exact report attempts and confirmation audits for both B generations. Preserve the platform's failed task, PREPARING order and unconsumed failed reservation if observed; do not manufacture READY. This case also covers exhausted VLA attempts, so a duplicate ordinary VLA-exhaustion case adds little.

## Additional boundaries

Fixed-client outbound-failure-loss and committed-failure-response-loss require separate fresh runs matching the accepted baseline proxy faults and checkpoints. Their acceptance must include durable failure records, exact retry counts and callbacks, no repeated physical work, and actual terminal platform behavior.

Proxy event logs may retain a reduced metadata projection. An omitted field in that projection is not evidence that the actual wire response lacks it. Validate response schemas against complete captured payloads and the exact staged API source; the current FAILED acknowledgment includes the immutable message used by client validation.

Mixed Rack A/Nova plus Rack B/humanoid acceptance follows isolated recovery cases and the frozen Nova/new-client compatibility check. The sole owner uses API 3121, humanoid proxy 3122, optional Nova proxy 3123 and ROS domain 71. Capture per-device routing, physical execution counts, counter assignment, stock deltas and settlement.

Assigned execution also supports `failure_retract`, `post_place_retract`, `failure_source_check`, `failure_ready_check` and `post_place_ready_check`. These stages are defined in the assigned controller even though the older standalone runbook's fault table does not enumerate them.
