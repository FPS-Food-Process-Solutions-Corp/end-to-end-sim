# Humanoid integration validation

Date: 2026-09-23. Branch: `codex/humanoid-platform-integration`, based on standalone commit `02fabbec015d9444ece79ec38c089e69ec1faeaa`.

## Local acceptance

**43 integration checks pass on the current lifecycle client pin; the prior 21 standalone passes are inherited.** The current client is `9be6207a6c286d5f2f441f37b97b663a6256291a`, adopted by simulator `1fb043c4f056223e1e7d27b6fa5fabb7fdf5c75d` through the launcher's expected hash only. These isolated tests use real client types, client construction and temporary stores with synthetic exact acknowledgment evidence. They do not establish an actual platform order result. No service, network, device or package installation was involved. Earlier durable-recovery verification used client `b4b055765e801b7edd93d0abf4e87d226d6b9bee` at documentation HEAD `5969a0167aedbc7c7cbe5b03f5cafe90ec9de4ee`; its evidence remains separately attributed.

Integration command inside the existing Ubuntu-22.04 environment:

```bash
PYTHONPATH=/mnt/c/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client:/mnt/c/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim /home/user/.venvs/end-to-end-sim-ros/bin/python -m unittest discover -s tests/humanoid_integration -p 'test_*.py' -v
```

Standalone command from this worktree on Windows:

```powershell
& 'C:/Users/andyl/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -m unittest discover -s tests/humanoid_harness -p 'test_*.py' -q
```

| Boundary | Local evidence |
| --- | --- |
| Assigned execution | Stops at physical proof without local platform reports, task selection or front-idle motion. |
| Public client seam | Actual context/outcome, completion/failure identities and stores, awaited progress, public recovery queues and synchronous recovery hold. |
| Identity | Rejects changed order/session/task/counter or item/source slot; retry metadata does not repick a completed unit. |
| Counter 4 | Real `LocationTable` loads the simulation overlay; original relative trajectory references remain valid after relocation. |
| Safe failure | Exact no-effect source evidence, empty-hand/stocked-rack observation and bounded travel recovery precede FAILED with readiness true. Unknown/collision/cancel evidence holds. |
| Current device readiness | New units inherit the latest verified robot state. B failure, C success, then B retry preserves C's current release and adds no B motion. Corrupted release pointer, posture or source fails closed. |
| Placement and readiness | Verified placement survives an unsafe post-place recovery as COMPLETED with readiness false and a hold. Same-identity delivery cannot clear an explicit hold. |
| Recovery | Child process exits after a durable place effect before proof; a fresh process recovers through the public queue with exactly one pick and place. |
| Held-placement crash | Real child exits 78 after exact placement proof, durable HOLD and unknown readiness, before returning its outcome; no pending-completion file exists. Recovery requires installing the bound public hold before queueing, preserving one place. An existing marker suppresses another crash. Default mode and unknown pick without proof cannot trigger it. |
| Failure reporting | Exact retry intent persists before FAILED; confirmed public-store callback audit precedes a new report generation. Changed identity/source/proof/message, ambiguous predecessors, orphan public records and missing physical journals fail closed. |
| Persistence failure | Failed intent/audit writes cannot appear saved in memory. A failed bound-HOLD write returns unresolved without queueing; fresh exact ACTIVE reconciliation may persist and install a new hold before recovering the same placement. |
| Real client hold | Real client with fresh stores stays PAUSED before queueing and across restart. Wrong token/version/source and direct recovery without synchronous installation are rejected. These local checks do not establish server reporting while held. |
| Cancellation | Cleanup timeout cannot orphan an unguarded worker; late physical effects remain held and the device lock stays protected. |
| Startup and corruption | Unresolved owner gates client startup; corrupt/stale/mismatched proof cannot become completion. |
| Launcher | Loads unchanged checked-in settings, constructs the actual client with fresh stores, performs recovery/setup, writes its manifest and stops. Only run/stop network loops are stubbed; no optional key is injected. |

The earlier durable-recovery test owner ran 43 integration checks in 20.985 seconds on b4. All ten integration test files passed ASCII, syntax and module-level-import checks; the diff check passed. The 21 standalone tests passed in the preceding capture, before the final integration-only history guard, and were not needlessly repeated. Independent Sol review found no remaining blocker in the ledger, physical evidence, bound hold, startup ordering or direct executor gates. The production owner separately passed ASCII, syntax, module-level-import and compilation checks on all three changed integration modules.

For the lifecycle client adoption, the unchanged 43-test suite passed in **23.462 seconds, exit 0**, including `test_launcher_stops_idle_client_without_network_and_records_pinned_sources`. The retained packet is `.humanoid-runs/local-verification/client-lifecycle-pin-01/`, with `verification-summary.json`, `imported-provenance.json` and the definitive `integration-43-verified` stdout/stderr/exit files. The initial capture recorded a blank wrapper exit despite 43 OK; the definitive repeated run retained exit 0. Independent read-only Sol review verified the one-line launcher change, all 19 simulator hashes, four actual client hashes and the test evidence. The other 18 simulator production files, including all standalone code, are unchanged; the 21 standalone tests were not rerun for this pin-only change.

Current `client.py` SHA256 is `481163dc187fff8e62fdd9d2af6c919f3ed9f1ccae43d4f463acd900111a3f9d`; `pending_completion.py` is `3f2d33d94dd838af21b5e49c64cab1cf5c0a5bd34bb759fa63062e50af5bf228`. Pending-failure/settings hashes are unchanged from b4. The current launcher SHA256 is `fc0553497955077048e8bf3d62ecf1a18514d269d44568fc9d89af2ff51264fb`. [RECOVERY-ADOPTION.md](RECOVERY-ADOPTION.md) gives the separately reviewed client test scopes and all four module hashes.

Earlier b4 client raw hashes were `client.py` `70ad4509c788d2736c2a38b029e17a498e7ce48a39c60e47bedee558120f9cd4`, `pending_failure.py` `8a9c8822cfbca96c48af2401793220a8e2694f941111423327b9087da63fc80a`, and `settings.py` `01904c2c675fcd38645f508e4601796a07bb2b5f895df2fe019a58d6a271e584`. The source manifest records all simulator production hashes. [RECOVERY-ADOPTION.md](RECOVERY-ADOPTION.md) records the separately reviewed client checks and the settings-loader defect caught by the real launcher test.

Historical checkpoints remain distinct: `da0f09f` had 16 integration tests, the accepted `597ec2c` readiness baseline had 29, and `57f856a` had 32, all with the older dfcb client. The local-test result does not replace their source attribution or independently establish actual-platform acceptance.

Hard-stop regressions cover failure-retract effects, placement before proof, post-place retract effects, placement before client queueing, and verified placement after entering a hold. Eligible ACTIVE recovery reconciles exact actions into verified release or a bound placement hold, preserving one place. Explicit holds cannot auto-clear. Actual held reporting, both fixed failure-loss cases and the remaining isolated fault/restart/partial cases are accepted in the separately audited runtime evidence below.

## Actual platform acceptance

**Eight corrected-client isolated cases are accepted**, in addition to the accepted happy baseline and two historical failure-report characterizations. The new cases ran simulator production `6d0111a951dd9506472b7149cb8ab426844a9b93` with client production `b4b055765e801b7edd93d0abf4e87d226d6b9bee`. The historical cases used simulator `597ec2c21da1540e11ebd999d3552f84f9859a3c` and client `948fd23c1204f94983cc2e35865e3796f81b8a9c`; they did not run the later correction.

[RUNTIME-ACCEPTANCE.md](RUNTIME-ACCEPTANCE.md) gives exact case identities, source counts, audit SHA256s, physical evidence, platform outcomes, retained unsuccessful fixtures and cleanup. [BASELINE-RUNS.md](BASELINE-RUNS.md) preserves the separately attributed baseline and its failed fixture attempts. The selected latest-client mixed, held-placement and Nova callback reruns are also accepted. The [acceptance index](runtime-acceptance.json) records their separate epochs; the captured source pin remains unchanged.

| Case | Accepted evidence |
| --- | --- |
| Happy Rack B baseline | `happy-03`: READY at counter 2, one pick/place/post-place retract, verified release, stock 8 to 7; historical pins above. |
| Safe retries and confirmed loss | `safe-retry-loss-01`: separate navigation, VLA and full-cycle budgets; stuck/jolt/reset, empty pick, subsequent acquired-bun loss and one replacement placement; READY, platform stock 7/7. Local replacement accounting stays separate. |
| Placement before queue, restart and completion response loss | `exit76-completion-loss-02`: real exit 76 before release proof/queue; restart verifies release, then five full timeouts with local PENDING/API READY checkpoint; third process sends once and exact readback confirms. Six wire sends, one physical pick/place/retract. |
| Held-placement reporting restart | `held-placement-restart-01`: exit 78 after verified placement and bound HOLD; restart reports once while PAUSED, without FREE, next request or new physical action. Order READY does not clear the physical hold. |
| Physical uncertainty | `unknown-pick-hold-01`: immediate UNKNOWN, persistent hold, no terminal report; restart refuses before connection with exit 2 and identical durable records. |
| Cancellation uncertainty | `cancel-unknown-hold-01`: three persisted polls followed by timeout/cancel and unknown outcome; same hold/refusal and no terminal report. Individual poll timestamps are absent. |
| Partial A/B/C | `partial-abc-02`: A completes, B exhausts known no-effect attempts and retracts, C completes and is acknowledged before B retry. Both B reporting generations confirm the same physical proof; C stays the latest READY version 6. Session COMPLETED/order PREPARING, stock 6/5. |
| Lost outbound failure report | `failure-drop-fixed-02`: five complete timeouts, reconnect, seven total sends; exact confirmations/callbacks for retries 0/1, no repeat motion. Order PREPARING, stock 8/7. |
| Committed failure with lost responses | `failure-commit-fixed-01`: first report commits with responses withheld, second receives same-task error, exact readback confirms retry 0 before retry 1 confirms directly. Three sends; no repeat motion. Order PREPARING, stock 8/7. |
| Affected Nova controls | Accepted `combined-b4-retry-queued-02` (with mandatory checkpoint supplement), `combined-b4-callback-boundary-01` and `combined-b4-readiness-false-02` on frozen Nova `39c6aff`/client `b4b0557`; owner and independent Nova reviews. Exact references and fixture exclusions are in the runtime report. |
| Lifecycle held-placement rerun | `held-placement-restart-02`: accepted on `1fb043c`/`9be6207`; exit 78 then report-only restart, 178 live PAUSED observations and zero FREE; 14 shared checkpoint/final files byte-identical, physical HOLD/UNKNOWN retained and order READY. |
| Lifecycle Nova callback rerun | `combined-9be-callback-boundary-01`: accepted by owner/Nova reviewer on `39c6aff`/`9be6207`; callback-only restart precedes FREE/follow-up, no original resend, two starts and stock 6/6 to 4/4. |
| Mixed Rack A and Rack B | `mixed-positive-03`: accepted on simulator `1fb043c`/client `9be6207`/Nova `39c6aff`; human completion then no-task response while Nova is pending, exact same-session readback trace, FREE without reconnect, one execution per device, READY at counter 2 and stock A 5/5, B 7/7. |

Each new case retained a fresh original-seed database, source and compiled API/configuration provenance, task/order/session identities, physical journals, public pending records, API snapshots, owned process identities and cleanup. Seed A007 remained READY at counter 1; new A008 used counter 2. No old business records, captured journals or platform logic were changed to produce the result.

The client task's Sol `/root/sol_combined_harness` alone owned the shared services and fresh databases. Independent Sol reviewers checked stopped artifacts, including physical proof, transport chronology, exact retry generations, source hashes, API outcomes and saved cleanup. Ordinary stop 0 is cleanup evidence, not evidence of order READY.

Failed fixture attempts remain visible. `failure-drop-fixed-01` stopped before reconnect because it checked the wrong API projection. `exit76-completion-loss-01` required a live trace event on a startup replay path. `partial-abc-01` lacked INFO logging initialization and its original final snapshot; its later GET-only API supplement is a separate observation and does not turn that attempt into acceptance. `mixed-positive-01` remains excluded for the original client lifecycle defect. `mixed-positive-02` remains excluded for its immediate post-stop OFFLINE assumption; the reviewed third fixture retains the mandatory live FREE transition and records shutdown state separately. Fresh corrected fixtures supply the accepted cases.

The completion-loss base audit counted summary markers rather than actual withheld frames. Its separate verified correction records ten frames versus six markers, preserving the original audit. The public completion store's `attempts` is not a send count; `callback_acknowledged: false` is not applicable when this launcher has no completion callback. Configured failure callbacks are independently confirmed. The runtime report documents remaining checkpoint and projection limits without inferring unavailable evidence.

## Assurance limits

Local tests demonstrate software contracts and simulated physical recovery. The accepted actual cases additionally establish the documented real platform/client transitions and preserve failures and holds where required. No hardware, camera, VLA policy endpoint or calibrated motion is exercised. Persistent physical holds have no manual resolver. The known real platform partial-order settlement and cancellation-accounting defects remain outside this task's source-edit scope. Failure-report durability belongs to the client recovery work and must be assessed separately from those platform limitations.

The initial checkpoint persisted a separate world per unit and ended successful placement at symbolic `SIM_POSE_PLACE_DONE`, without a current device-level travel-readiness proof. Review identified this as insufficient for continuing physical work. The revision adds a versioned latest device release, current-readback validation, carry-forward of robot state and verified post-place travel recovery. Historical failure proof remains separate from current readiness. Shared physical sensors, calibrated safe postures and actual motion clearance remain requirements for a hardware adapter, not claims established by these simulations.
