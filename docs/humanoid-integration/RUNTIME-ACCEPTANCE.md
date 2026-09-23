# Actual humanoid integration acceptance

Date: 2026-09-23. This report records eight accepted isolated cases on the first corrected client, accepted mixed and held-placement reruns on the later lifecycle client, and separately reviewed Nova controls, using the real platform and simulated hardware. The sole runtime operator was Task A's GPT-6 Sol `/root/sol_combined_harness`; Task C's independent Sol reviewers inspected stopped captures. Astra owns this report. Raw captures and journals were not rewritten to mark them accepted.

## Source and evidence boundary

The eight isolated cases below are accepted at simulator production commit `6d0111a951dd9506472b7149cb8ab426844a9b93` and client production commit `b4b055765e801b7edd93d0abf4e87d226d6b9bee` (client documentation HEAD `5969a0167aedbc7c7cbe5b03f5cafe90ec9de4ee`). The launch-time simulator manifest SHA256 is `01492605fd47ea3a0435ffce73f62bc881075391a21c1114711a3265642bfaa7`. Later documentation commits do not change which source ran.

| Loaded client source | SHA256 |
| --- | --- |
| `hr_client/client.py` | `70ad4509c788d2736c2a38b029e17a498e7ce48a39c60e47bedee558120f9cd4` |
| `hr_client/pending_failure.py` | `8a9c8822cfbca96c48af2401793220a8e2694f941111423327b9087da63fc80a` |
| `hr_client/settings.py` | `01904c2c675fcd38645f508e4601796a07bb2b5f895df2fe019a58d6a271e584` |

The captured [source manifest](source-pin.json) remains unchanged at SHA256 `5a9c6a584d295913ffb6b3d8b58dc143c20a96e8b4ea598da56ba9a193b0551b`; it retains the 19 production-file hashes and historical baseline pins. The separate [acceptance index](runtime-acceptance.json) records final acceptance across the distinct source epochs. Local verification remains 43 integration tests, 21 standalone tests and independent source review, with the exact scopes in [VALIDATION.md](VALIDATION.md). The older happy run and two failure characterizations used simulator `597ec2c` and client `948fd23c`; see [BASELINE-RUNS.md](BASELINE-RUNS.md). They remain accepted historical evidence, separate from the corrected-client runs.

Raw case roots are `.humanoid-runs/integration/<case>/` in this simulator worktree. Machine audits are `<case>.json` under `C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/humanoid-happy-stage/audits/`. These local evidence directories are retained outside the committed documentation. Acceptance comes from the owner checker and independent artifact reviews; a retained raw result may still say that strict audit is pending. No claim depends on changing that result.

Each isolated case used a fresh database cloned from the original `coffee_platform_sim`: `taska_20260922_humanoid_` followed by the case name with hyphens replaced by underscores. Existing A007 stayed READY at counter 1. The new A008 order used counter 2. Moon-cake Rack B level 1/slot 1 began at database/available stock 8/8; creating a one-item order reserved stock to 8/7. A three-item partial order reserved it to 8/5. Database stock and available stock are distinct.

## Accepted isolated cases

| Case | Physical and reporting result | Final platform result; database/available stock | Captured source files |
| --- | --- | --- | --- |
| `failure-drop-fixed-02` | Five complete outbound-report timeouts; reconnect; both failure generations confirmed with callbacks; no repeated physical action. | Task FAILED retry 1, session COMPLETED, order PREPARING; 8/7. | 295 |
| `failure-commit-fixed-01` | First failure committed with responses withheld; exact readback confirms retry 0, then retry 1 confirms directly; no repeated physical action. | Task FAILED retry 1, session COMPLETED, order PREPARING; 8/7. | 295 |
| `held-placement-restart-01` | Exit 78 after verified place and bound HOLD, before queueing; restart reports once while PAUSED and preserves the hold. | Task COMPLETED, order READY; 7/7. | 299 |
| `safe-retry-loss-01` | Separate navigation, VLA and confirmed-loss recovery; one replacement placement and safe release. | Task COMPLETED, order READY; 7/7. | 301 |
| `unknown-pick-hold-01` | Unknown pick retains HOLD without terminal report; restart refuses before connection with exit 2. | Task IN_PROGRESS retry 0, session CREATED, order PREPARING; 8/7. | 301 |
| `cancel-unknown-hold-01` | Poll exhaustion, cancellation and unknown result retain HOLD; restart refuses before connection with exit 2. | Task IN_PROGRESS retry 0, session CREATED, order PREPARING; 8/7. | 301 |
| `exit76-completion-loss-02` | Three-process recovery: exit 76 before release proof/queue, five full response-loss timeouts, then exact readback confirmation; one pick/place/retract. | Task COMPLETED, order READY; 7/7. | 299 |
| `partial-abc-02` | A completes, B fails safely, C completes and is acknowledged, then B retry reuses its proof; C remains the latest device release. | A/C COMPLETED retry 0, B FAILED retry 1, session COMPLETED, order PREPARING; 6/5. | 300 |

### Exact identities

For single-item cases the task is exactly `hr_pick_task_<order-id>_1`. The partial case has tasks `hr_pick_task_ord_muee248r_6dp4t8_1`, `_2` and `_3` for A, B and C.

| Case | Order | Session |
| --- | --- | --- |
| `failure-drop-fixed-02` | `ord_muddrf2w_f1ag8n` | `hr_pick_sess_muddrf4s_ds80mb` |
| `failure-commit-fixed-01` | `ord_muddz7cq_7m16rx` | `hr_pick_sess_muddz7en_w8fbj4` |
| `held-placement-restart-01` | `ord_mudej77y_7p1lod` | `hr_pick_sess_mudej79t_9501zt` |
| `safe-retry-loss-01` | `ord_mudf6hru_edv9pz` | `hr_pick_sess_mudf6htp_g4pyla` |
| `unknown-pick-hold-01` | `ord_mudfl78i_r6krno` | `hr_pick_sess_mudfl7ad_fwmcyu` |
| `cancel-unknown-hold-01` | `ord_mudfojaa_9xggqg` | `hr_pick_sess_mudfojca_gvylk8` |
| `exit76-completion-loss-02` | `ord_mudghu1y_so0pea` | `hr_pick_sess_mudghu3v_jrhatx` |
| `partial-abc-02` | `ord_muee248r_6dp4t8` | `hr_pick_sess_muee24as_ib7f9p` |

### Machine audit digests

The owner's consolidated eight-case index is `C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/astra-docs/accepted-humanoid-audit-index.json`, SHA256 `623d52b1f13feeecbf7994e68698416cd423a0d1dcda834a3c832602d4cbc689`. It includes the mandatory transport correction and is explicitly scoped to these eight cases; it is not a full-series completion index.

| Case | Audit SHA256 |
| --- | --- |
| [failure-drop-fixed-02](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/humanoid-happy-stage/audits/failure-drop-fixed-02.json) | `a3ce1e7d7632de7159d7ded33b3c71221f00d0e49e07ccc1f1d2cb53f93ed8b9` |
| [failure-commit-fixed-01](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/humanoid-happy-stage/audits/failure-commit-fixed-01.json) | `740c26aa4d8f7bfdfb60457796e94cdba28a6b05c169280531b9caa717a2d9ef` |
| [held-placement-restart-01](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/humanoid-happy-stage/audits/held-placement-restart-01.json) | `0e156527cd3b2f4be76448a9c9d40f1cf696ecbdd6d6c025c88819f80cff1084` |
| [safe-retry-loss-01](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/humanoid-happy-stage/audits/safe-retry-loss-01.json) | `1502cfbdcffd3352733233005ce417b4d43b5a358140fac1449cd366ded0c2ae` |
| [unknown-pick-hold-01](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/humanoid-happy-stage/audits/unknown-pick-hold-01.json) | `aedf67500f419c7e69981fc183bb1116f15ea5566d984166b41f0a6e25f41748` |
| [cancel-unknown-hold-01](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/humanoid-happy-stage/audits/cancel-unknown-hold-01.json) | `873d25203af143661726e91ccfa951a04bdcfab40550757adff561ac62d16e6e` |
| [exit76-completion-loss-02](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/humanoid-happy-stage/audits/exit76-completion-loss-02.json) | `328505476ec188653b61b94d3ebdd6bb3d32dc02a13b70c287eb9da0895599a2` |
| [partial-abc-02](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/humanoid-happy-stage/audits/partial-abc-02.json) | `6ad09a521ed4f06f8f9c0ec4e8c7bb3e8cb0c9dca29dfc807b06b71293dccf1e` |

The completion-loss audit has a separate verified transport correction, [exit76 transport correction](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/humanoid-happy-stage/audits/exit76-completion-loss-02-transport-correction.json), SHA256 `12bdeeace553e33a63c4b21a40cd0a5c9c17feb360bca51f9083308f36994a53`. The original audit is retained unchanged.

## Evidence details and qualifications

### Failure-report loss

Both failure cases physically execute three known no-effect failed picks and one successful failure retract, with no place. Exact source readback, empty hands, the stocked rack and travel readiness support safe failure. Reporting reuses that physical proof.

The outbound-loss case makes seven actual report sends. Five complete 10-second timeouts precede reconnect; retry-zero confirmation and callback are saved by 00:45:21.579890 UTC, before the retry-one send at 00:45:21.664248. Both generations have direct confirmation. Public attempt counts are six and one. Physical checkpoint and final records are unchanged.

The committed-failure case makes three sends. The first commits FAILED retry zero with acknowledgment and direct response withheld; its timeout lasts 10.011 seconds. The second receives the same-task `PICK_TASK_NOT_IN_PROGRESS` error, triggering exact readback; retry-zero confirmation and callback are saved by 00:50:31.412764 UTC, before retry one's direct report at 00:50:31.505158. Public attempt counts are two and one. There is no forced reconnect. The saved fault checkpoint was captured after both confirmations and is identical to the final state; it is not a pending-instant snapshot. The raw proxy sequence establishes the lost responses.

In both cases, the terminal failed task ends the session while the unchanged platform leaves the order PREPARING and the failed reservation unconsumed. Acknowledgment of failure is not order READY.

### Placement reported while held

`held-placement-restart-01` exits 78 with exactly one proven place and an unknown post-place retract. It retains owner HOLD version 1 and current UNKNOWN readiness version 2, the bound recovery token and exact proof, without a completion queue or outbound report; the platform still shows IN_PROGRESS.

On restart the client reports the same placement once and confirms it while connected in PAUSED state. The held physical, owner and readiness records remain byte-identical. The run contains two PAUSED wire reports and 176 PAUSED API observations, with no FREE, next-task request, default delivery or new physical action. Seven initial OFFLINE observations precede startup; they are not shutdown evidence. PAUSED is observed at 01:05:55.344975 UTC before the completion send at 01:05:55.355465 and confirmation at 01:05:55.400786.

The token is `sim-placement/81c6a9385a9cc364ee309ab5bb823f7306bc38850565d47ac10af332af1c5b86`; the placement-proof digest is `7654d85c5da8103d23e61e6bc797551cf2b0bea11d20b585fa9af2b0d46c7c16`. Source ordering, the startup manifest and wire behavior corroborate synchronous hold installation before reporting; there is no separate timestamped hold-method trace. The proxy's reduced completion projection omits some identities, which are bound by the launcher trace and durable records.

### Independent physical budgets

`safe-retry-loss-01` contains three navigation executions, four picks, one place, one jolt and one reset. Cycle zero retries navigation, recovers a stuck first pick with jolt/reset, observes no transfer on its second pick, and acquires the original bun on its third pick. A separate pre-place check then confirms loss. Cycle one acquires a replacement, places once and retracts safely.

The second pick's generic `effect_applied` flag does not prove transfer: source/world observations show the bun still at the rack and empty hands. The loss at the later pre-place check is separate. The simulated replacement count falls from one to zero; that local accounting is distinct from the platform stock change from 8/8 to 7/7. There is one platform assignment at retry zero, 27 progress reports, no failure report and one confirmed completion.

No complete physical byte snapshot exists at the settled checkpoint. Its summary agrees semantically with final actions, identities and world state; the final copies equal the stopped state. Do not describe this as settled-to-final byte equality. Direct response and acknowledgment precede confirmation, but the completion record lacks a source tag identifying which handler confirmed it.

### Unknown pick and cancellation

The immediate unknown-pick case has zero polls and no cancellation. The cancellation case persists three polls, followed by intent, timeout/cancel, an UNKNOWN result for the same action and HOLD; individual poll timestamps are not captured. Each stops after navigation, lift, pre-pick posture and the uncertain pick, with no terminal proof, completion/failure queue or terminal report.

Each restart exits 2 with `Physical HOLD lacks exact verified placement`, before Socket.IO connection, new events or motion. Fourteen durable files remain identical. An UNKNOWN result with `effect_applied: false` does not establish safe no-effect failure. An ordinary unresolved HOLD can retain an older owner readiness version while the current readiness is UNKNOWN; that mismatch cannot authorize startup.

### Exit 76 and completion response loss

`exit76-completion-loss-02` has three process phases:

1. Exit 76 after one durable pick, place and post-place retract, at `post_place_ready_check`, before release proof, executor return or client queueing. Ownership is ACTIVE and readiness UNKNOWN version 1; the platform task remains IN_PROGRESS.
2. Restart reconciles the exact effects and adds only readiness observation/proof and events 37/38, releasing IDLE/READY version 2. Five forwarded completion calls each exhaust a full 10-second timeout. A complete checkpoint at 02:01:53.229680 UTC retains local PENDING while the API order is READY; the process stops afterward.
3. Another restart sends once at 02:01:55.301794 UTC, receives the same-task error and confirms the exact order through readback at 02:01:55.325697. No additional physical execution occurs.

There are **six actual wire sends**, although the public completion store's `attempts` remains zero in pending and final records. That field is not a wire-send counter.

The proxy retained **ten actual withheld response frames**: one direct session-completed event, four direct errors and five acknowledgment frames. Six other log entries are summary markers, not six withheld frames. The supplemental correction above records this distinction; raw proxy SHA256 is `cf9e8fee20b34e5d16f52edf550f9a1b4955958cb9d787e7ce31b442a2e17381`.

There is no HTTP access/packet trace of the readback GET itself. Pinned readback code, the triggering error and the persisted exact order object matching final API state support the readback conclusion. No raw-byte comparison of differently projected API JSON is claimed. Phase-two and final physical files are byte-identical; phase one to phase two legitimately changes recovery metadata.

### Partial A/B/C and current readiness

`partial-abc-02` has units A `9108d026d7efc341c843`, B `c63eca16a0519474b674` and C `a35342402a6b7f525b96`. A and C each perform ten physical executions, including one pick, one place at counter 2 and one post-place retract. B performs seven: three known no-effect failed picks and one successful failure retract, with no place, empty hands and the bun still at its rack.

Actual INFO traces show C's executor completion at 17:40:24.340 UTC, completion acknowledgment at 17:40:24.401, then B retry-one assignment at 17:40:24.420. There are four scheduled/executor entries and four terminal forwards: two completion and two failure reports. Eight assignment-received traces include four duplicate request-ACK receipts, which are ignored; they are not eight executions.

B's device, controller and action-event files are byte-identical between its retry-zero checkpoint and final state. Both public and bridge failure generations are confirmed with acknowledged callbacks and exact immutable assignment, source, execution, message and proof. The shared proof SHA256 is `f5c4043ace75d558a791529fad4060bbc959066dad4e42e1c2cf3e226fb7ba0f`, linked to `unit-c63eca16a0519474b674/c0/failure_retract/a1`. Direct responses correctly distinguish retry zero/`willRetry: true` and retry one/`willRetry: false`.

Final ownership is IDLE with no hold, and current READY version 6 still refers to C's post-place release, digest `296b9c8cbb99cf0b70f949af69facba9af73277f55d443412bdd350df03de666`. B's historical unit world does not replace that current device state. The retry-zero API checkpoint has stock 7/5 and C IN_PROGRESS. The original final API snapshot at 2026-09-23T17:41:33.058890Z shows A/C COMPLETED retry zero, B FAILED retry one, session COMPLETED, order PREPARING and stock 6/5.

All 300 archived source files passed independent byte-length/hash checks, and all 16 loaded-module path/hash pairs match capture. The source manifest SHA256 is `9c5d3bf9abd0edd5a9a8ed61992ce7ee574b18bfc0e4bbc71dcd62ef09680a12`. The strict checker SHA256 is `e2b654d749d7400bd8f969e87fc4ae522487e0ce58e0e66b9f0137c1359d7ee5`; its audit matches raw evidence. The JSON has no literal PASS field; PASS is the checker's reported result.

## Retained unsuccessful attempts

| Attempt | Why it is excluded; retained evidence |
| --- | --- |
| `failure-drop-fixed-01` | The fixture checked an unavailable `retryCount` projection in GET order. Five complete timeouts occurred, but it stopped before reconnect. It does not establish the full recovery case. |
| `exit76-completion-loss-01` | The fixture required live `completion_queued` tracing for startup `completion_replay`. Five complete timeouts and the pending record exist, but no post-loss API snapshot, phase-three restart or final settlement capture. The owner's later live READY observation is separate; the raw session-completed event supports backend commitment. |
| `partial-abc-01` | The fixture required INFO CELL_TRACE events without initializing the public diagnostics logger. Actual A/B0/C/B1 activity occurred, but the original final API snapshot is absent. The attempt remains excluded. |

The partial-case failure was observability, not an executor correction: setting `CELL_TRACE_VERBOSE` alone does not install an INFO handler in the integration launcher. The accepted second fixture uses a separate logging-only wrapper that calls the existing public `platform_common.diagnostics.configure_logging()` before the frozen entry point. Its SHA256 is `514a532b24a1784fedba9f4be4c4155781e86569796c268ea2bd5e2e1984da6b`; real INFO smoke and six offline fixture tests are retained. The driver SHA256 is `54da6d567c111e10a0d206513729df6a1df0d46a1d4e0c6227d184af2c59fbc8`. No production source was changed.

The separate `partial-abc-01-supplement/read-only-api-snapshot.json` observes the old database at **2026-09-23T02:25:39.256Z**: order `ord_mudh640v_3vzsps`, session `hr_pick_sess_mudh642u_wi9iq5`, A/C completed at retry zero, B failed at retry one, session COMPLETED, order PREPARING at counter 2, stock 6/5 and A007 still READY. Independent review verified a GET-only helper, the original staged API hash, retained owner provenance and stop 0. This is a later observation, not the missing original final snapshot, and it does not change the first attempt's excluded status.

Earlier unsuccessful happy fixtures and the mistimed baseline failure-drop attempt remain separately documented in [BASELINE-RUNS.md](BASELINE-RUNS.md).

## Shared runtime and cleanup

The operator alone controlled API 3121, humanoid proxy 3122, optional Nova proxy 3123 and ROS domain 71 in localhost-only mode. Fresh databases and captured journals remain retained. For the eight isolated humanoid cases, ordinary API/launcher stops returned 0 and proxies -15; intentional hooks returned 76 or 78, and unresolved-hold startup returned 2 as required by those cases. Owner manifests and start ticks identify the processes; saved cleanup and source checks support each acceptance. Independent Task C reviewers did not run live probes during another capture. The owner separately checked that owned services were absent.

## Affected Nova controls

Before mixed routing, Task A and the Nova task's independent Sol reviewers accepted three fresh controls using the frozen Nova production commit `39c6aff523e95bc03a1db10bb854aec8746d0df9` with client `b4b0557`. These controls use the real staged API, Socket.IO and ROS transport with a fake ROS provider. Task C did not operate or independently re-audit Nova's runtime scope. The [scoped Nova acceptance index](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/astra-docs/accepted-nova-audit-index.json), SHA256 `60a1393962908d70b5377603f2d5423938347c70c37a687141861ccaf0ffd41a`, records each immutable export index and qualification.

The retained evidence root is `C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/nova-b4-stage/docs/verification/2026-09-22-combined-nova-client-recovery/`.

| Accepted control directory | Evidence and scope |
| --- | --- |
| [combined-b4-retry-queued-02](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/nova-b4-stage/docs/verification/2026-09-22-combined-nova-client-recovery/combined-b4-retry-queued-02/result.json) | Five-timeout checkpoint, exact readback/callback recovery and two READY orders; two execution starts and database stock 6 to 4. The base export has 46 files and requires the separate checkpoint supplement below. |
| [combined-b4-callback-boundary-01](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/nova-b4-stage/docs/verification/2026-09-22-combined-nova-client-recovery/combined-b4-callback-boundary-01/result.json) | A test wrapper kills the bridge after client CONFIRMED but before its callback; Nova remains pending. Restart replays only the callback, without resending the original report, before distinct follow-up work. Two starts, two READY orders and stock 6 to 4; 54 exported evidence files. |
| [combined-b4-readiness-false-02](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/nova-b4-stage/docs/verification/2026-09-22-combined-nova-client-recovery/combined-b4-readiness-false-02/result.json) | Exact controller success with fresh false readiness correctly refuses release; a later callback settles reporting while the device stays PAUSED, the next order stays QUEUED and execution starts remain one. The export has 53 files, with a bounded observation about 8.1 seconds after refusal. No final-inventory claim is made. |

The mandatory `combined-b4-retry-queued-02-checkpoint-supplement/` exports three unchanged raw five-timeout checkpoint payloads with a separate [supplement manifest](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/nova-b4-stage/docs/verification/2026-09-22-combined-nova-client-recovery/combined-b4-retry-queued-02-checkpoint-supplement/supplement-manifest.json). Its manifest identifies this as a post-run copy of existing raw evidence, created at 2026-09-23T18:24:54.7899345Z, not a new runtime observation. Task A rechecked the base exports and the three supplemental payloads; the Nova task independently reviewed the controls. The supplement manifest SHA256 is `a8b1d60e26c87b08d8af92a3de8b21022b3a5c6bb07e09bbeabdeb44d4176bb8`.

Two fixture attempts remain excluded. `combined-b4-retry-queued-01` stopped before order/provider/proxy because its evidence directory conflicted with a fresh-empty runtime requirement; API cleanup returned 0. The corrected driver separates the live harness. `combined-b4-readiness-false-01` stopped before the recovery CLI because a copied status observer was missing, after one execution start and without follow-up. The exact historical observer was then copied, captured and exported before the fresh accepted second run. These are fixture corrections, not Nova production changes. Their retained exports contain 26 and 41 files respectively. Nova cleanup distinguishes driver/harness/API stop 0 from the intentional original bridge kill -9, proxy -15 and bridge/provider teardown 1; the owner and Nova reviewer assessed those expected exits in context. Reduced proxy markers omit order payloads, so identities use correlated chronology, API, provider and store evidence.

## Mixed first attempt and lifecycle correction

`mixed-positive-01` remains **excluded**. It used the original simulator `6d0111a951dd9506472b7149cb8ab426844a9b93` and client `b4b055765e801b7edd93d0abf4e87d226d6b9bee` and stopped at the strict 90-second gate with driver exit 1. Its order was `ord_muehdvb1_omsstv`, session `hr_pick_sess_muehdvcy_20fkwa`, humanoid task `hr_pick_task_ord_muehdvb1_omsstv_2`, and unit `acaab914ca6d751acf59`. The fresh database was `taska_20260922_humanoid_mixed_positive_01`.

Independent physical review found exactly ten completed, applied actions and one pick/place/post-place retract, events 1 through 38 with matched intent/terminal identities, one bun at counter 2, empty hands and no lost bun. The owner was IDLE without a recovery hold; current READY version 2 correctly bound the release proof. Physical proof SHA256 was `e5977bfc164adf8d3808c6e68ab3143b39f1ca2e78efa37886364f45e6ee3942`; release proof SHA256 was `aeb62d4e9c607c87fae34bf8d8170213fed207c10351680c66330391d82aab38`. The completion store was CONFIRMED with the exact physical proof.

The latest saved API snapshot at **2026-09-23T19:15:02.411Z** showed the order READY at counter 2, session COMPLETED, both tasks COMPLETED, croissant Rack A/1/1 stock 5/5 and moon-cake Rack B/1/1 stock 7/7. Nova was FREE, but the humanoid remained publicly PAUSED/Working with `currentTaskId: null`. The client still retained its internal active task and the message `Completion recovery pending platform reconciliation`. Those public and internal fields are different observations. Only two humanoid PAUSED status frames were captured, both before physical completion; no later FREE frame appeared before stop.

This was a generic client lifecycle defect after safe physical release and accepted reporting. Physical success did not satisfy the full mixed case. The required FREE gate was retained. There was no settled/final/post-stop API snapshot or matching physical checkpoint, so no settled-to-stop byte-equality claim is made. Saved cleanup has no issues, API stop 0 and no reserved listeners; provider/bridge teardown returned 1. The original capture remains immutable.

The reviewed client correction is production `9be6207a6c286d5f2f441f37b97b663a6256291a`. Its authoritative same-order/session reconciliation continues beyond the earlier finite window, using bounded requests and backoff with a single worker and guards for physical, report and session changes. Task C adopted only its expected-client hash in the launcher. Simulator adoption commit `1fb043c4f056223e1e7d27b6fa5fabb7fdf5c75d` and launch manifest SHA256 `5a9c6a584d295913ffb6b3d8b58dc143c20a96e8b4ea598da56ba9a193b0551b` identify the subsequent reruns. The unchanged other 18 simulator production files and all prior case attributions are preserved.

### Excluded second mixed attempt

`mixed-positive-02` used the new lifecycle client and simulator pins above. Its order was `ord_muejetfv_l4fvux`, session `hr_pick_sess_muejethm_rxo5wb`, humanoid task suffix `_2`, unit `653abbff84b1b417a1bd`, and Nova execution `nova5-8f892d130b0243f187c74299ee408eb5`. The saved chronology on 2026-09-23 shows humanoid completion acknowledged at **20:10:13.337Z**, `NO_TASK_FOR_DEVICE` at **20:10:13.374Z** while Nova was still pending, Nova terminal success at **20:10:20.095361Z** (epoch `1790194220.0953612`), exact same-session readback at **20:10:22.317Z**, and FREE at **20:10:22.318Z**. There was one humanoid socket connection and no reconnect before FREE.

The fixture then failed at **20:10:48.412881Z** because it required the public humanoid status to be OFFLINE immediately after its process stopped. The post-stop API snapshot still reported FREE/online/Ready. Final and post-stop business fields agreed: A008 READY at counter 2, the session and both tasks COMPLETED at retry zero, croissant stock 5/5 and moon-cake 7/7, unused croissant slot 2 at 0/0, and unchanged A007 READY at counter 1. Public presence after shutdown is therefore a separate observation; these records do not prove immediate OFFLINE or accurate administrative presence.

Independent physical review found exactly ten completed applied actions, one placement and one post-place retract, no physical hold, owner IDLE and current READY version 2. Placement proof SHA256 was `5831ff87e11dada5ec66bb611762e2a9a001cc6dcffba1b52143db67a66df8ce`; release proof SHA256 was `df97b6489f94ec0e8c4d057c5f5d66d853a2dd73e6ca1036cd1cc5ee57cae3a9`. The stopped fields matched the retained settlement proof, action IDs and readiness. There was no full pre-stop physical file snapshot, so this is semantic field equality, not blanket byte equality.

The later read-only diagnostic with the observed FREE status produced a strict result semantically equal to the saved settlement audit. Its initial tuple-versus-JSON-list comparison difference was confined to that diagnostic; the original driver compared two in-memory audit objects. The original failure was the hardcoded OFFLINE expectation. The attempt remains **excluded**, with no retroactive acceptance or raw rewrite.

The [sealed excluded index](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/mixed-9be-stage/mixed-positive-02-stopped-index.json), SHA256 `927174caa932b8718a0b0b0c5eb465dcee902275189be069ed50db4bef9c8380`, contains 369 artifacts. Independent review checked all indexed hashes and byte counts, including 310 source copies; the actual run's source-manifest SHA256 is `464e7af55d1d177f46c074711dd9438d18751f88d050a7f46bb67e11254aee3b`. The source post-check found no changes. Saved cleanup records API and humanoid exit 0, no issues and no reserved listeners, separately from owner live absence checks.

## Accepted lifecycle-client runtime cases

These selected cases use client `9be6207a6c286d5f2f441f37b97b663a6256291a`. The humanoid source is simulator `1fb043c4f056223e1e7d27b6fa5fabb7fdf5c75d`, with launch manifest SHA256 `5a9c6a584d295913ffb6b3d8b58dc143c20a96e8b4ea598da56ba9a193b0551b`; Nova remains at `39c6aff523e95bc03a1db10bb854aec8746d0df9`. They do not replace the earlier b4 attribution.

The owner's [consolidated selected-control acceptance index](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/astra-docs/accepted-client-lifecycle-audit-index.json), SHA256 `97dedf15a84276bb2125919fe8eddf2914ce09ea176409ded83aa9621c889e2d`, records formal acceptance of all three controls, the two excluded mixed attempts and the required supplements. The original pending-audit labels remain unchanged in raw captures.

### Mixed order: mixed-positive-03

**Accepted** after the owner's strict driver exited 0, three independent Task C reviews cleared physical, transport and API/provenance evidence, the Nova reviewer cleared its bounded scope, and the owner completed cleanup and live absence checks. The immutable raw result retains `case_complete_pending_independent_audit`; formal acceptance is separate.

The fresh database is `taska_20260922_humanoid_mixed_positive_03`. A008 is order `ord_muejtul5_v3tz3g`, session `hr_pick_sess_muejtun4_tf2w6y`, counter 2. Task `hr_pick_task_ord_muejtul5_v3tz3g_1` routes Rack A/level 1/slot 1 croissant to Nova execution `nova5-c4a5173971a04927b108893ef03196d4`; task suffix `_2` routes Rack B/level 1/slot 1 moon-cake to humanoid unit `d64fa3d35da53e150456`.

| Event on 2026-09-23 | UTC |
| --- | --- |
| Humanoid socket connected | 20:21:53.811 |
| Humanoid completion acknowledged via `pick_session_updated` | 20:21:54.714 |
| Same-session `NO_TASK_FOR_DEVICE` acknowledgment, before Nova starts | 20:21:54.748 |
| Nova controller starts | 20:21:55.619 |
| Nova controller reports terminal success | 20:22:00.6662605 |
| Client trace records validated same-session readback | 20:22:02.784 |
| Humanoid emits FREE, with no reconnect since startup | 20:22:02.785 |
| Humanoid disconnects during normal exit 0 | 20:22:28.798 |

Nova's bridge process began at 20:21:54.774, after the humanoid received the no-task response. Each proxy captured one assignment and one forwarded completion for its device. Duplicate INFO assignment receipts are event/acknowledgment delivery, not additional executions. The humanoid completion store is CONFIRMED, attempts 1, with the exact placement identity and proof; its completion callback flag is false and not applicable. Nova's completion store is CONFIRMED, attempts 1, with its configured callback acknowledged and matching confirmed journal outbox. The same-session readback is supported by structured client trace, pinned loaded code and matching saved API snapshots; no HTTP GET request/response body or packet trace was captured.

The humanoid has exactly ten completed, applied generation-1 actions, matched intent/terminal IDs and no orphan actions. One pick, place and post-place retract leave one bun at counter 2, empty hands, no lost bun, travel posture, IDLE ownership without a hold, and current READY version 2. Placement proof SHA256 is `50962e281b5d5dfb9ac64ffbf62281f4653d1a75c4e1cc3f899dfcaa27805c37`; release proof SHA256 is `ed37642c1525466b4451220904b3125028327919fc58610e3ff8805df80e82ac`. Exact assignment, readbacks, configuration and StubDevice provenance agree.

Final API at **20:22:03.162Z** and post-stop API at **20:22:28.861Z** show A008 READY at counter 2, the session COMPLETED, both exact tasks COMPLETED at retry zero, completed count 2 and failed count 0. Croissant stock is 5/5 from 6/6; the unused Rack A slot 2 remains 0/0; moon-cake stock is 7/7 from 8/8. A007 and its full pick-session data remain unchanged and READY at counter 1. Final and post-stop order, fulfillment and queue-session objects match. Both public devices still read FREE/online after the recorded humanoid shutdown; acceptance does not treat that administrative field as evidence of a live connection.

The settled and post-stop audit JSON files themselves are byte-identical, SHA256 `fce079257d06a03dde9eaab148fbccbe12fb0ef1790f1fdde18169538595ae52`. Their strict physical fields agree with the stopped state. No full pre-stop physical file snapshot exists, so this does not establish blanket byte equality of physical files.

The [sealed stopped index](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/mixed-9be-stage-03/mixed-positive-03-stopped-index.json), SHA256 `d20430cf3c6ee4f8c1bb606c2792d7fe195d827a8531cc7d512bae86d77b7b4a`, contains 368 artifacts; all hashes and byte counts passed independent inventory. The run source manifest SHA256 is `6f8a3ba262a27abf72d19e92a079a0abd1c4b0bead6a97617863fb5a99de97f4`, covering 310 captured files. All 16 humanoid and 12 Nova loaded-module path/hash pairs match captured source; the source post-check reports no changes. The revised fixture's unchanged strict audit retains the original live FREE, physical and inventory gates. Only shutdown handling now uses measured FREE or OFFLINE with no active task, normal exit and one disconnect after live FREE. Eleven offline fixture checks passed before launch. Saved cleanup records API and humanoid exit 0, no issues and no reserved listeners; provider/bridge teardown 1 and proxy -15 remain separately qualified.

### Held placement after restart: held-placement-restart-02

**Accepted** on the lifecycle client pin. The fresh database is `taska_20260922_humanoid_held_placement_restart_02`; A008 is order `ord_muek8efj_hsy89y`, session `hr_pick_sess_muek8ehj_9fepcq`, task `hr_pick_task_ord_muek8efj_hsy89y_1`, at counter 2. The exact placement is `unit-366550f01cfe83be2e0b/c0/place/a1`.

Phase 1 exits **78** after one verified placement and a durable bound HOLD, before creating a completion record or sending a completion report. Baseline stock is 8/8. The crash API snapshot at **2026-09-23T20:33:13.681Z** shows order PREPARING, session CREATED, task IN_PROGRESS at retry zero and reserved stock 8/7.

The checkpoint has ten generation-1 executions: nine COMPLETED/applied and an UNKNOWN, unapplied, non-retryable post-place retract. There is one bun at counter 2, empty hands, no lost bun and PLACE_DONE posture. Placement proof SHA256 is `e6477ea8101249c652ee16967bdc193eb7e76b7062e0219872881f073a0df02a`. Its exact hold token is `sim-placement/eb554c3ad157e5164ad71f05f364ea37085869f56220b72f31ade30dbc205789`, bound to assignment, source, configuration, placement and proof, hold version 1 and readiness version 2. Current owner stays HOLD and readiness stays UNKNOWN. No release-readiness observation or post-place release proof exists.

Restart uses the pinned synchronous hold-installation path before the recovered-completion queue and client connection. The startup manifest contains that exact hold and recovered identity. The phase-2 socket connects at **20:33:15.741Z**, replay is logged at **20:33:15.764Z**, and the proxy records PAUSED with the hold reason at **20:33:15.766Z**. Exactly one completion is forwarded at **20:33:15.773733Z**, followed by the direct `pick_session_completed` event at **20:33:15.811753Z** and socket acknowledgment at **20:33:15.822141Z**. The second status report at **20:33:15.838183Z** is also PAUSED. There are zero phase-2 FREE reports, next-task requests or assignments. This case confirms through the direct captured event and socket acknowledgment; no HTTP readback is claimed.

The final completion record is CONFIRMED, attempts 1, with the same order/session/task/placement and exact controller proof. Its false callback flag is not applicable because the launcher has no completion callback. Phase 2 exits **0**. The final API snapshot at **20:34:01.592Z** shows order READY, session and task COMPLETED at retry zero, stock 7/7 and unchanged A007 order/pick session at counter 1. During phase 2, 185 saved admin observations comprise seven startup OFFLINE reads, then **178 PAUSED and zero FREE** from 20:33:15.804Z through 20:34:01.337Z. Final API OFFLINE is after client shutdown and is separate from that live observation window.

Independent raw-byte comparison found 15 checkpoint files and 16 final files: **14 shared files are byte-identical**. These include owner, readiness, crash marker, controller, device, events, summary and world replay. The integration manifest changes only to record the recovered completion and hold ID; the confirmed completion store is newly created. No second placement or new physical action occurred. This does not claim byte equality for the entire journal.

Use the separate [hold-byte supplement](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/humanoid-9be-stage/held-placement-restart-02-hold-byte-supplement.json), SHA256 `ee4e645f2f2c03f32a4b350c2493eb24f70c10727f5417a9286031499bce9fa0`, for the owner/readiness/marker comparison. The original physical-byte audit's generic scope phrase about owner/readiness changes does not describe a mutation of those files in this run; the original file remains preserved. Independent review directly compared the raw checkpoint and final copies.

The [sealed stopped index](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/humanoid-9be-stage/held-placement-restart-02-stopped-index.json), SHA256 `c9a73c723ffd05ec408325c28124a188af2c2a563313bddcb9466461c46ee23a`, contains **378 artifacts**, all independently checked for exact hash and byte count. The actual source-manifest SHA256 is `ca166f2bf4c312aec2e56196d068941831c0fcd011c1fcc12ecb8839c1048640`, with 300 captured source files and no changed sources. Both phases load the same 16 module identities with the reviewed client hashes. The owner strict-audit SHA256 is `fcfc644c006881245f08ee6cc9b891e598ac26d989182b060eea98404b1bbb36`; the raw result retains its pending-audit label. Saved cleanup records API stop 0, phase-1 hook exit 78, phase-2 exit 0, proxy -15, no error and the retained database. Owner live absence checks remain separate from Task C's saved-artifact reviews.


### Nova callback recovery: combined-9be-callback-boundary-01

Task A and the independent Nova Sol reviewer **accepted** this fresh callback-boundary control on client `9be6207a6c286d5f2f441f37b97b663a6256291a` and frozen Nova `39c6aff523e95bc03a1db10bb854aec8746d0df9`. Task C verified the exported references and hashes; it did not independently re-audit Nova's runtime.

The retained [55-file export index](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/nova-9be-stage/docs/verification/2026-09-23-combined-nova-client-9be-recovery/combined-9be-callback-boundary-01/index.json) has SHA256 `4874948c99bf9984a3d57a7f594ab637f24ecadf3f65c7934e5f91c6a25a8687`; [result.json](C:/Users/andyl/.codex/worktrees/dfcb/platform-client/.local/nova-9be-stage/docs/verification/2026-09-23-combined-nova-client-9be-recovery/combined-9be-callback-boundary-01/result.json) has SHA256 `ee744ff220c679a77a5659e5ca97732292c89a6ffe6b4a3b032b41e78b628d60`. All indexed file hashes and byte counts were independently checked. The database is `taska_20260922_combined_9be_callback_boundary_01`.

| Identity | Original order | Follow-up order |
| --- | --- | --- |
| Order | `ord_muejo63z_l1bt0r` | `ord_muejod0h_vwv1hc` |
| Session | `hr_pick_sess_muejo658_p0g1ct` | `hr_pick_sess_muejod1g_qb02bo` |
| Task | `hr_pick_task_ord_muejo63z_l1bt0r_1` | `hr_pick_task_ord_muejod0h_vwv1hc_1` |
| Execution | `nova5-6e9be9127e424025b7ff6309f6b06ba7` | `nova5-972a95cbf2d94745a83313d656b9788f` |

The test wrapper kills the original bridge after client completion is CONFIRMED, attempts 1 and callback false, while the Nova outbox is still pending without platform confirmation. Restart performs only the configured callback for that original record. The durable callback journal update at **2026-09-23T20:17:35.871Z** precedes FREE at **20:17:35.877Z**, follow-up order creation at **20:17:36.000Z**, its bridge start request at **20:17:36.086Z**, and provider acceptance at **20:17:36.102Z**. The first record remains at attempts 1 and becomes callback-acknowledged with the exact confirmed outbox identity.

The export records exactly two completion forwards in total, one per distinct order, with no original report resend after restart. Provider metrics record two accepted execution IDs and two starts. Both orders finish READY; both completion records are CONFIRMED with callbacks acknowledged. Rack A/level 1/slot 1 croissant database/available stock changes 6/6 to 4/4.

The runtime source binding explicitly records client 9be and all four module hashes. It also pins the frozen Nova source-manifest bytes. That copied Nova manifest retains historical generation metadata, including an older client commit and an uncommitted flag; those fields are not the current runtime client or production status. Nova commit 39 is attributed through the separately reviewed frozen checkout and matching source bytes.

Harness and API cleanup returned 0, the database remains retained, and the original bridge kill was intentional at the test boundary. The earlier qualifications for fake ROS, wrapper-triggered failure, reduced proxy metadata and expected ROS shutdown exits still apply. The portable index excludes `proxy-control.json`, environment files and process environment. Saved cleanup is separate from owner live absence checks.


## Assurance limits

These runs establish real platform/client behavior over simulated physical adapters. They do not exercise robot hardware, cameras, a live VLA policy, calibrated reachability, stopping distances or shared physical sensors, and do not establish hardware exactly-once execution. Unit worlds retain their own inventory and history; only the validated latest device release governs the simulated robot's next motion.

The humanoid integration launcher configures the failure-confirmation callback, but no completion callback. Therefore `callback_acknowledged: false` in a confirmed completion record is not an unacknowledged platform completion; the callback field is not applicable. Failure generations require their configured callbacks to be acknowledged. Completion-store attempt counts and reduced proxy projections must not be substituted for actual send/frame counts or full payload schemas.

An explicit physical HOLD does not automatically clear on reporting, readback, reconnection or repeat assignment. No operator resolver is implemented. Failed-task settlement can leave a PREPARING order and unconsumed reservation; platform cancellation accounting and replay limits remain outside the source-edit scope. No coffee-platform business logic or schema was changed to force READY.

Compiled API entrypoint hashes identify `main.js`; they do not establish integrity of the entire compiled distribution. Independent saved-cleanup reviews remain separate from the owner's live absence checks.

Per-unit world replay files received structural checks; rendered browser QA remains unverified because the earlier local-file preview was blocked. No alternative browser/server route was used to bypass that block.
