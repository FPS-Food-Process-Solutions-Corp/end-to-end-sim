# Humanoid integration validation

Date: 2026-09-22. Branch: `codex/humanoid-platform-integration`, based on standalone commit `02fabbec015d9444ece79ec38c089e69ec1faeaa`.

## Local acceptance

**43 integration tests and all 21 existing standalone tests pass** with durable failure reporting and public recovery-hold adoption. The client production pin is `b4b055765e801b7edd93d0abf4e87d226d6b9bee`, tested at documentation HEAD `5969a0167aedbc7c7cbe5b03f5cafe90ec9de4ee`. These isolated tests use real client types, client construction and temporary stores with synthetic exact acknowledgment evidence. They do not establish an actual platform order result. No service, network, device or package installation was involved.

Integration command inside the existing Ubuntu-22.04 environment:

```bash
PYTHONPATH=/mnt/c/Users/andyl/.codex/worktrees/durable-failure-recovery/platform-client:/mnt/c/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim /home/user/.venvs/end-to-end-sim-ros/bin/python -m unittest discover -s tests/humanoid_integration -p 'test_*.py' -q
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

The independent test owner ran the final 43-test integration suite in 20.985 seconds. All ten integration test files passed ASCII, syntax and module-level-import checks; the diff check passed. The 21 standalone tests passed in the preceding capture, before the final integration-only history guard, and were not needlessly repeated. Independent Sol review found no remaining blocker in the ledger, physical evidence, bound hold, startup ordering or direct executor gates. The production owner separately passed ASCII, syntax, module-level-import and compilation checks on all three changed integration modules.

Tested client raw hashes are `client.py` `70ad4509c788d2736c2a38b029e17a498e7ce48a39c60e47bedee558120f9cd4`, `pending_failure.py` `8a9c8822cfbca96c48af2401793220a8e2694f941111423327b9087da63fc80a`, and `settings.py` `01904c2c675fcd38645f508e4601796a07bb2b5f895df2fe019a58d6a271e584`. The source manifest records all simulator production hashes. [RECOVERY-ADOPTION.md](RECOVERY-ADOPTION.md) records the separately reviewed client checks and the settings-loader defect caught by the real launcher test.

Historical checkpoints remain distinct: `da0f09f` had 16 integration tests, the accepted `597ec2c` readiness baseline had 29, and `57f856a` had 32, all with the older dfcb client. The new result does not replace their source attribution or establish actual-platform acceptance.

Hard-stop regressions cover failure-retract effects, placement before proof, post-place retract effects, placement before client queueing, and verified placement after entering a hold. Eligible ACTIVE recovery reconciles exact actions into verified release or a bound placement hold, preserving one place. Explicit holds cannot auto-clear. Actual held reporting, fixed failure-loss cases and other fresh runtime acceptance remain pending.

## Actual platform acceptance

**The real Rack B happy case is accepted**, along with two baseline failure-report characterizations on production commit `597ec2c21da1540e11ebd999d3552f84f9859a3c` and the unchanged client above. Order A008 reached READY on counter 2 with exactly one pick, place and post-place retract; database stock changed 8 to 7 and the client confirmed completion in one attempt. See [BASELINE-RUNS.md](BASELINE-RUNS.md) for exact identities, source pins, audits, unsuccessful attempts and cleanup.

The baseline failure cases demonstrate missing durable failure-report recovery while preserving physical effects. They are not acceptance of the future client fix. Fixed-client reruns, held-placement reporting after restart, the remaining fault cases and mixed Nova/Rack A plus humanoid/Rack B routing remain pending.

Two fixture attempts stopped before any API, proxy or humanoid launcher started and before any order was created. They are not platform acceptance runs. Their fresh cloned databases and evidence remain retained:

| Attempt | Database | Result and evidence |
| --- | --- | --- |
| `happy-01` | `taska_20260922_humanoid_happy_01` | Linux Git could not resolve the Windows worktree pointer. The fixture was corrected to pass converted Git/worktree paths explicitly. Evidence: `.humanoid-runs/integration/happy-01/driver-error.json`, `driver-events.jsonl`, `cleanup.json`. |
| `happy-02` | `taska_20260922_humanoid_happy_02` | The fixture logger received a duplicate `path` argument while recording settings. Evidence: the corresponding files under `.humanoid-runs/integration/happy-02/`, plus a full pre-run source capture. |

Before the readiness correction, the sole owner confirmed that `happy-03` had not yet created a database, evidence directory, service or order. Its temporary offline preflight was console-only, with no retained report. The actual `happy-03` run occurred afterward on the reviewed `597ec2c` pin. The mistimed `failure-drop-01` attempt is also retained and excluded from the post-exhaustion checkpoint claim, as detailed in the baseline report.

The client task's Sol `/root/sol_combined_harness` alone owns services, fresh databases, process provenance and cleanup. Case artifacts belong beneath `.humanoid-runs/integration/`. Historical seed state and the sealed prior combined-recovery evidence remain untouched. Actual failures and external platform limitations must be retained here when observed, rather than replaced with an assumed passing outcome.

The following matrix separates accepted baseline evidence from work still pending:

| Case | Required evidence |
| --- | --- |
| Happy Rack B | Accepted in `happy-03`: READY, counter 2, one pick/place/retract, verified release, stock decrease of one. |
| Safe retries and confirmed loss | Separate bounded navigation, VLA and full-cycle budgets; stable IDs for reconciliation, new IDs only for authorized physical attempts; exact successful placement and inventory effects. |
| Completion acknowledgment loss | Real client pending queue/readback/reconnect settles the exact completion; no additional physical pick or place. |
| Placement before client queue, then restart | A real process stop after a durable place; restart preserves placement and verifies safe release; public client recovery queue settles once. |
| Held-placement reporting restart | Public seam adopted and locally checked; actual run pending. Recover the exact placement report while retaining PAUSED and the physical hold; no FREE, next-task request or additional motion. |
| Physical uncertainty and cancellation | Persistent hold, no unjustified terminal failure/success, no dependent motion; same-identity redelivery cannot clear a safety hold. |
| Partial A/B/C | A completes; B exhausts known no-effect attempts and recovers safely; C completes before B's platform retry; B is not picked again. Preserve the platform's terminal failed task, unconsumed failed reservation and PREPARING order if observed. |
| Lost outbound failure report | Baseline `failure-drop-02` characterization accepted. Fixed-client rerun remains pending with a separate pin and fresh fixture. |
| Committed failure with lost responses | Baseline `failure-commit-01` characterization accepted. Fixed-client acceptance/readback and reporting holds remain to be tested. |
| Mixed Rack A and Rack B | One real mixed order routes through the pinned Nova bridge and humanoid executor; verify device-specific execution counts, assigned counter, stock deltas and settlement. |

Each actual case must retain source and compiled API/configuration provenance, fixture baseline, exact order/session/task identities and retry generations, physical action evidence, client pending records, platform readback, failures, owned process identities and cleanup results. A process exit code alone cannot satisfy any row.

## Assurance limits

Local tests demonstrate software contracts and simulated physical recovery; the accepted happy run additionally demonstrates an actual platform READY transition. No hardware, camera, VLA policy endpoint or calibrated motion is exercised. Persistent physical holds have no manual resolver. The known real platform partial-order settlement and cancellation-accounting defects remain outside this task's source-edit scope. Failure-report durability belongs to the client recovery work and must be assessed separately from those platform limitations.

The initial checkpoint persisted a separate world per unit and ended successful placement at symbolic `SIM_POSE_PLACE_DONE`, without a current device-level travel-readiness proof. Review identified this as insufficient for continuing physical work. The revision adds a versioned latest device release, current-readback validation, carry-forward of robot state and verified post-place travel recovery. Historical failure proof remains separate from current readiness. Shared physical sensors, calibrated safe postures and actual motion clearance remain requirements for a hardware adapter, not claims established by these simulations.
