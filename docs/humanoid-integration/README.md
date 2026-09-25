# Run the real-client humanoid integration

For a complete prepared-environment test invocation, use the [maintained E2E acceptance runbook](../e2e-acceptance-runbook.md). It prepares a fresh owned runtime for mixed-device, Nova callback-restart and held-placement controls. The module example below remains useful when you already own the required services and settings.

This composition connects the reviewed real platform-client to the humanoid simulator through `PickExecutor`. A real platform assigns each Rack B pastry; the simulated physical executor finishes navigation, picking and verified counter placement; the real client owns progress, completion/failure reporting, acknowledgment recovery and the next task.

It does not enable robot hardware. Tags, joint phases and counter targets remain symbolic. The standalone module and its 21 tests remain available through the [standalone runbook](../humanoid-harness/README.md).

Historical integration acceptance has eight isolated cases on the first corrected client, followed by mixed-order and held-placement reruns on the lifecycle client and a separately reviewed Nova callback control. Historical baseline evidence retains its original source pins. [RUNTIME-ACCEPTANCE.md](RUNTIME-ACCEPTANCE.md) records exact identities, source captures, machine audits, retained failed fixtures and the mixed-runtime result. [VALIDATION.md](VALIDATION.md) separates local tests from actual platform evidence, and [runtime-acceptance.json](runtime-acceptance.json) indexes the final acceptance without rewriting the captured source pin.

## Runtime and composition

Use the existing Ubuntu-22.04 environment `/home/user/.venvs/end-to-end-sim-ros/bin/python`, which has the client's dependencies. No installation is required. The current integration selects the canonical sibling client at `D:/Work/FPS/Robotics/platform-client` (`/mnt/d/Work/FPS/Robotics/platform-client` in WSL) and this repository at `/mnt/d/Work/FPS/Robotics/end-to-end-sim`. Put those directories on `PYTHONPATH`. The [local merge record](../merge-execution-2026-09-24.md) identifies the client and Nova branch versions. Historical worktree paths in captured acceptance records retain their original meaning.

The composition entry point is `python -m humanoid_harness.integration`. It requires a real-client settings file, a fresh integration state root, the pinned client source path, and distinct explicit local proxy/API URLs. The launcher verifies that the four guarded client modules are imported from the selected client source directory and match reviewed SHA-256 values after CRLF-to-LF normalization. It records both raw and normalized hashes in manifest schema 2. Other content changes and imports from another checkout are rejected. It selects `humanoid_robot`, forces WebSocket transport for Socket.IO and sends public completion/failure readback through the real client's direct API configuration. [RECOVERY-ADOPTION.md](RECOVERY-ADOPTION.md) records the new client pin and verification status; historical baseline runs used the older dfcb checkout.

Example inside WSL, after the sole runtime owner has prepared the fresh database, settings and services:

```bash
PYTHONPATH=/mnt/d/Work/FPS/Robotics/platform-client:/mnt/d/Work/FPS/Robotics/end-to-end-sim /home/user/.venvs/end-to-end-sim-ros/bin/python -m humanoid_harness.integration --client-source /mnt/d/Work/FPS/Robotics/platform-client --settings /path/to/fresh/hr-settings.json --state-root /path/to/fresh/humanoid-state --url http://127.0.0.1:3122 --readback-url http://127.0.0.1:3121 --device-id humanoid_robot --stop-after-seconds 60
```

The `/path/to/fresh/` values are explicit placeholders, not existing fixtures. Do not point this launcher at a captured/live journal or another case's state root. Changing only an API URL on the standalone harness does not perform this integration.

## Public executor seam

`HumanoidPickExecutor` is exported by `humanoid_harness.integration`. Its constructor accepts a state root, an optional `config_factory(TaskContext)`, the explicitly shared public failure store and one-shot crash test options. The launcher uses `reconcile_active()`, synchronous hold installation, async `recover_completed(client)` and `recover_failures(client)` before starting the client. Execution uses async `run(context, progress_cb)`; shutdown uses `drain()`.

The launcher calls recovery before `client.run()`. Exact placements and failure attempts use only the public `client.queue_recovered_completion(...)` and `client.queue_recovered_failure(...)` methods. Unknown physical ownership prevents new work. Shutdown drains or preserves a held worker before closing the client/device ownership; cancelling the coroutine alone does not release a running worker.

After a restart with verified placement and an explicit physical hold, the bridge installs the saved bound hold through synchronous `client.hold_execution_for_recovery(...)` before any queue await or connection. The client may report that placement while remaining PAUSED. The hold token/version binds the exact assignment, source, configuration, readiness version and placement-proof digest. Unknown holds without that verified context still refuse startup. An eligible ACTIVE crash may reconcile exact saved actions into verified safe release or a durable placement hold. Queueing, readback and acknowledgment never clear the physical hold; no operator resolver is implemented. The historical baseline refused held startup because that public client seam did not yet exist.

The assigned mode stops at physical completion and does not create or report through a `StubPlatform`, select another task, or command front-counter idle. Its task-ID registry rejects a changed session/order/counter or item/rack/level/slot for an existing task. Retry count is recorded as metadata and cannot authorize another pick of an already completed unit.

The safe-failure revision requires a durable recovery to the configured symbolic travel posture before allowing another task. A distinct recovery action must have a matching terminal result, and fresh correlated perception must confirm empty hands, that posture and quiescent motion. Only verified readiness permits `failed(..., ready_for_next=True)`. Unknown effects, collision, unresolved cancellation or unverified recovery use the unresolved outcome. Physical holds have no operator resolver.

Supported recovery sources are exhausted no-effect VLA picking or initial navigation, and positively known no-effect pick-side lift/posture/reset actions. They also require exact source-action readback and a versioned observation of empty hands with the pastry still at its assigned rack. Confirmed bun loss after its retry budget, post-pick failure without that source evidence, mismatched evidence and ambiguous recovery remain unresolved holds.

The unchanged platform schedules unassigned items before retrying failed items, and permits one platform retry for a new task. Redelivery of an exhausted physical unit reuses its saved failure without another pick, but a new report generation requires exact prior platform confirmation and the durable bridge callback audit. Historical failure proof establishes readiness when that unit released ownership; current readiness comes separately from the latest verified device release. A report-only retry cannot overwrite that current release with an older unit's state. Network acknowledgment remains the real client's responsibility; physical readiness alone does not establish report acceptance.

Before physical dispatch, the bridge records the explicit retry count and exact assignment/source context. Before returning or recovering FAILED, it persists a separate immutable attempt intent over the saved physical failure proof. The public callback validates the exact confirmed client record and saves acceptance evidence before returning. An ambiguous older attempt remains held; observing a later retry is not confirmation. Confirmed attempts may need callback-only recovery, but must never be resent or cause another pick.

Successful placement also requires a distinct post-place retract and fresh travel-readiness verification before another motion can begin. If placement is proven but this recovery fails, preserve and report the completed placement with readiness false, and retain the physical hold. Never turn that pastry into FAILED or pick it again. An explicit safety hold remains held even if the same task is delivered again.

## Counter mapping

The supplied real-client location file is preserved. In fresh copied settings, set `paths.poses` and `paths.locations` to absolute original client files; otherwise relative paths resolve beneath the new case directory. The launcher creates an immutable `simulation-locations.json` overlay in the integration state root, resolves existing trajectory references against their original directory and adds counter 4 with distinct symbolic `SIM_COUNTER_4` identity. Its generic `place_box` pose reference is only client-schema compatibility; the injected physical flow uses its own distinct symbolic counter targets. No taught/calibrated counter-4 coordinates or hardware movement are inferred.

## State and evidence

| Artifact | Meaning |
| --- | --- |
| `integration-manifest.json` | Loaded client module paths/hashes, source pin, endpoints, location overlay and recovered identities. |
| `task-identities.json` | Immutable task/session/order/counter and item/rack/level/slot registry, plus observed retry counts. |
| `device-owner.json` | Device-wide idle/active/hold ownership, readiness version and bound placement-recovery hold token/version. Availability alone is not physical readiness. |
| `device-readiness.json` | Current READY/UNKNOWN status and increasing version. A READY release binds exact assignment/source/configuration, action/proof hash, observation and verified robot state. UNKNOWN records retain identity/reason/provenance and do not establish a release. |
| `assignments/<unit-digest>.json` | Saved immutable assignment and observed retry contexts. Terminal physical proofs live in the unit controller and relevant client pending records. |
| `units/<unit-digest>/controller.json` | Per-unit durable controller intent, stage, result and verified physical/release proofs. |
| `units/<unit-digest>/device.json` | Independently persisted simulated action effects and that unit's world; it is not necessarily the latest device-wide robot state. |
| `units/<unit-digest>/events.jsonl`, `summary.json`, `world.html` | Per-unit progress, terminal physical result and world replay. |
| `pending-completions.json` | The real client's durable completion queue; do not edit it to force settlement. |
| `failure-attempts.json` | Bridge intent and callback audit per exact platform retry generation, bound to immutable physical failure proof. |
| `pending-failures.json` | The separately injected real-client failure queue and platform reconciliation evidence. |

The initial device readiness is an explicit fresh-simulation assumption: front location, idle posture, empty hands and no active motion. It may be created only for an empty state root. Missing or incompatible ownership/readiness records beside existing unit journals must fail closed; they must not reset the robot to the initial state.

An IDLE owner and its READY release must agree on the readiness version, and the release must validate against the exact referenced unit proof and readback before startup or another action. A bound verified-placement recovery hold also validates its exact saved readiness context. An ordinary unresolved HOLD can retain an older owner readiness version while current readiness is UNKNOWN; it does not authorize startup. Interrupted writes or corrupted release pointers fail closed. Each newly assigned unit inherits the latest released robot location, posture and possession; inventory and action ledgers remain per unit. A report-only retry leaves the current release unchanged. For example, B's saved world may remain at its rack while the current release belongs to C at placement.

The launcher wires a failure-confirmation callback but no completion callback. A confirmed completion's `callback_acknowledged: false` is therefore not applicable; platform confirmation is recorded separately. The configured failure-confirmation callback must be acknowledged before a later generation proceeds. The completion store's `attempts` field is not a count of actual wire sends; use captured transport evidence for that count.

A normal or timed launcher stop returns 0; this means the process stopped normally, not that the order reached READY. Invalid configuration/source returns 2. The explicit integrated placement crash exits 76; the held-placement crash exits 78. Always verify actual platform order/task/session/stock state and exact simulator place counts alongside process status.

## Deterministic faults and restart

`--faults-json FILE` accepts a JSON mapping from exact platform task ID to the standalone simulator's fault-rule list. Create the order and obtain its actual task identities before writing the fixture; do not guess them. The real client still owns all task reports. See the [standalone fault table](../humanoid-harness/README.md) for stage/outcome definitions.

`--crash-after-place-once` exits with code 76 at `post_place_ready_check`: placement and post-place retract effects are durable, but release-readiness proof, executor return and client completion queueing have not finished. Restart the same launcher with the same state root and unchanged assignment configuration. Startup must reconcile the saved actions, verify readiness, queue the exact placement proof through the real client and avoid duplicate effects. The crash marker is durable and does not fire again for that fixture. A separate local child-process regression covers a hard stop immediately after the place effect, before placement proof, and verifies the remaining bounded recovery.

`--crash-after-held-placement-once` tests a different boundary. After an exact verified placement, an unsafe post-place result first persists owner HOLD and unknown device readiness. The hook checks those saved records, atomically writes `crash-after-held-placement.used.json` and exits 78 before returning the completed executor outcome or queueing a client completion. The marker permits only one such exit per state root. A suitable simulator fault is an unknown `post_place_retract` result; unknown placement without verified proof cannot trigger this hook. Restart must install the same bound public hold before recovering the completion, remain PAUSED and preserve one place effect. Actual acceptance is tracked separately in [VALIDATION.md](VALIDATION.md).

For acknowledgment loss, the sole runtime owner controls the existing Socket.IO fault proxy. Keep completion readback pointed directly at the API. Do not replace the real client's acknowledgment/reconnect/readback behavior with a local success flag.

[FAULT-CASES.md](FAULT-CASES.md) preserves the fixture recipes and their required checkpoints; [RUNTIME-ACCEPTANCE.md](RUNTIME-ACCEPTANCE.md) records observed results. A transient owner-HOLD write failure must return unresolved without queueing. A fresh startup may validate the exact ACTIVE placement checkpoint, persist a new bound HOLD and install it before queueing; it cannot treat a failed in-memory write as durable state.

## Trace-based fixture checks

`CELL_TRACE_VERBOSE` alone does not initialize the integration launcher's INFO logger. The accepted partial-case fixture uses a separately captured logging-only wrapper that calls the existing public `platform_common.diagnostics.configure_logging()` before invoking the frozen integration entry point. Its real INFO smoke, source hash and fixture tests are retained with the case. A fixture that requires INFO chronology must verify actual emission before running; absent trace output is not evidence of absent execution. The original `partial-abc-01` remains excluded, with its later read-only API observation recorded separately.

## Ownership and limitations

Each runtime test needs one owner for its API, Socket.IO proxies, simulated ROS provider, database fixture and cleanup. Do not run overlapping fixtures on the same ports, device identity or state. Historical acceptance used API 3121, humanoid proxy 3122, optional Nova proxy 3123 and ROS domain 71, with fresh databases derived from the preserved seed. Those values and the former task owner describe the archived runs; they are not authorization to reuse a live runtime or captured state. The module command above assumes services and fresh settings are already prepared.

The seed contains historical business records; it must not be forcibly cleared to make a scenario pass. Known platform partial-order settlement, cancellation accounting and completion replay limits remain external constraints. The integration must expose their observed behavior rather than modify platform logic or manufacture READY.

Read [PLAN.md](PLAN.md) for stages/ownership and [CONTRACTS.md](CONTRACTS.md) for reviewed public interfaces and source provenance. Software simulation does not establish calibrated reachability, physical stopping, sensor reliability or hardware exactly-once execution.

[BASELINE-RUNS.md](BASELINE-RUNS.md) records the accepted real Rack B order and two baseline failure-report characterizations, including exact identities, retained unsuccessful attempts, source hashes and cleanup. Corrected-client fault/restart, partial-order and mixed-runtime evidence is recorded in [RUNTIME-ACCEPTANCE.md](RUNTIME-ACCEPTANCE.md).
