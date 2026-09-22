# Real platform baseline runs

These runs use the unchanged coffee-platform and real recovered platform-client with the simulated humanoid executor. They establish a successful real order and characterize the client's missing durable failure-report recovery. They do not establish the later client correction or hardware behavior.

The sole runtime operator was the client task's Sol `/root/sol_combined_harness`. Independent Sol artifact review and Astra provenance checks agree with the operator's strict audits. All evidence is retained locally under `.humanoid-runs/integration/`; these ignored artifacts are not embedded in this Git commit. Original seed databases, captured journals and prior evidence remain unchanged.

## Frozen sources and fixtures

| Component | Baseline |
| --- | --- |
| Humanoid production commit | `597ec2c21da1540e11ebd999d3552f84f9859a3c` |
| Humanoid manifest | `docs/humanoid-integration/source-pin.json`; all 18 production Python files were pinned before launch. The launch-time manifest SHA256 was `b7e9245fa00aab4ff8fb192c86f63b4c43917575dc173e39ba9fa47cb37a9553`. |
| Real client production | `948fd23c1204f94983cc2e35865e3796f81b8a9c`, dfcb worktree documentation HEAD `e6766e8319c9a6a832e8f058135a9d52b869a7c2` |
| Actual client.py bytes | `65bc9effd3c11241517aad58290d109a67f6c792c165c286013267772a91d777` |
| Runtime | Existing Ubuntu-22.04 `/home/user/.venvs/end-to-end-sim-ros/bin/python`; API 3121, humanoid proxy 3122 |
| Fixture | Each case cloned original `coffee_platform_sim` into its own `taska_20260922_humanoid_*` database. Historical order A007 occupied counter 1; the new orders used counter 2. |

Source, compiled API/configuration, process identity and baseline inventory captures are retained per case. The happy case verified 288 captured files; each failure case verified 291. Post-run checks reported no changed sources. The saved copies' sizes and hashes were checked independently. No physical device, live policy endpoint or package installation was used.

## Accepted cases

| Case and database | Order / session / task | Observed result |
| --- | --- | --- |
| `happy-03` / `taska_20260922_humanoid_happy_03` | `ord_mudaf287_ml0s6x` (A008) / `hr_pick_sess_mudaf30o_8b4v9m` / `hr_pick_task_ord_mudaf287_ml0s6x_1` | READY, session/task COMPLETED, counter 2. One pick, one place and one post-place retract. Database and available moon-cake stock changed 8 to 7. |
| `failure-drop-02` / `taska_20260922_humanoid_failure_drop_02` | `ord_mudaxtiz_jni9v9` / `hr_pick_sess_mudaxtly_zpndmh` / `hr_pick_task_ord_mudaxtiz_jni9v9_1` | At the accepted fault checkpoint: IN_PROGRESS, retry 0, after five dropped requests, five TIMEOUT results, retry exhaustion and explicit client deferral. After reconnect: FAILED, retry 1; order PREPARING. |
| `failure-commit-01` / `taska_20260922_humanoid_failure_commit_01` | `ord_mudb29hu_d5vr27` / `hr_pick_sess_mudb29jq_bjp7f4` / `hr_pick_task_ord_mudb29hu_d5vr27_1` | At the fault checkpoint: backend FAILED, retry 0; success ACK and direct event suppressed. A second report received `PICK_TASK_NOT_IN_PROGRESS`, and the client deferred. After reconnect: FAILED, retry 1; order PREPARING. |

The setup connection for failure fixtures used a recorded public subscription to obtain exact task identities without requesting or executing work. Fault files were written for those actual identities before the real client started. The checkpoint was captured before the controlled reconnect.

## Physical and reporting evidence

For `happy-03`, unit `239d47da2c6d332e813c` placed its exact task/bun at `SIM_COUNTER_2`. Place execution was `unit-239d47da2c6d332e813c/c0/place/a1`; post-place retract was `unit-239d47da2c6d332e813c/c0/post_place_retract/a1`. The final owner was idle, and readiness version 2 matched the exact release action, observation and independently recomputed proof hash. Hands were empty and the robot was in its configured travel posture. The real client's completion record was confirmed after one attempt, with `pick_session_completed` platform evidence. No completion callback was configured: `callback_acknowledged=false` is not applicable, not a claimed callback success.

Both accepted failure cases retained the same seven device execution records across fault checkpoint, reconnect and final state: one initial navigation, one lift, one pre-pick, three failed pick attempts with no effects, and one completed failure retract. There was no place. Device files were byte-identical across those checkpoints. The owner stayed idle with verified travel posture, empty hands and readiness version 2. The bridge reused its physical proof when the client called the executor again; it did not repeat physical actions.

`failure-drop-02` recorded seven total proxy failure-report attempts: the first five were not forwarded, and the last two were forwarded after reconnect. It had three client executor/failure-report invocations, including retry-generation redelivery. `failure-commit-01` recorded three proxy attempts and two executor/failure-report invocations. The second committed-case attempt passed the backend's nonretryable error rather than pretending every attempt timed out.

The frozen client had no durable pending-failure store. The configured completion-store file was absent in these failure-only runs; a failed task was not stored as completion. Final backend state does not prove that the client had durably confirmed the earlier failure attempt. These are accepted characterizations of that gap, not passing failure-recovery results.

These cases had one controlled client owner. The platform's FAILED request has no retry-generation or execution guard. Public readback followed by replay cannot establish atomicity against a second actor advancing a task between those operations. Local physical proof and report-attempt identities must remain separate from what an actual server acknowledgment proves.

For both failure cases, database stock stayed **8 to 8**, while available stock changed **8 to 7 because of the reservation**. No pastry was successfully picked, placed or consumed. The final PREPARING order and retained failed reservation are separate platform settlement/accounting limitations; platform business logic was not changed to force READY.

## Retained unsuccessful attempts

| Attempt | Scope of failure or exclusion |
| --- | --- |
| `happy-01`, database `taska_20260922_humanoid_happy_01` | Stopped before services/order creation because Linux Git could not resolve the Windows worktree pointer. The generic error was "Task C commit is not frozen reviewed head"; `driver-events.jsonl` records the underlying Git error. |
| `happy-02`, database `taska_20260922_humanoid_happy_02` | Stopped before services/order creation because fixture logging passed the `path` argument twice. Full pre-run source capture, error and cleanup files are retained. |
| `failure-drop-01`, database `taska_20260922_humanoid_failure_drop_01` | Order `ord_mudasxgn_5aaxz7`, session `hr_pick_sess_mudasxir_zjypwx`, task `hr_pick_task_ord_mudasxgn_5aaxz7_1`. Its checkpoint followed the fifth outbound drop, but preceded that attempt's timeout and explicit deferral. The fifth drop was at 23:22:22 UTC; exhaustion/deferral appeared at 23:22:31 UTC. Excluded from the claim that the checkpoint followed all five timeouts and deferral. Retained final task state was IN_PROGRESS, retry 0. |

No attempt was overwritten to turn a fixture error or mistimed checkpoint into a passing result. Before `happy-03` was launched, a separate temporary offline preflight was console-only and left no saved report; it is not cited as retained evidence.

## Strict audits and cleanup

| Audit | SHA256 |
| --- | --- |
| [happy-03 strict audit](../../.humanoid-runs/integration/happy-03/strict-happy-audit.json) | `96cee6ce47d6d9baff1de1a38a2cf6ab745a1b2d3c44d67bca65fea722181b83` |
| [failure-drop-02 strict audit](../../.humanoid-runs/integration/failure-drop-02/strict-failure-baseline-audit.json) | `2432e1412cd70486ddab29d20c2bc439c50d9b0e9f6f255fe51db237344ae56e` |
| [failure-commit-01 strict audit](../../.humanoid-runs/integration/failure-commit-01/strict-failure-baseline-audit.json) | `03c51404e7049d903f0a418e6498560d5b672d1ae9b6f889cef053ff552f46af` |

The strict audits are authoritative for acceptance. Earlier `result.json` snapshots may still say acceptance pending or retain the initial creation response's null counter; later API snapshots and strict audits establish counter 2.

For each executed case, launcher exit was 0, API stop returned 0 and the intentionally stopped proxy returned -15. The sole owner explicitly confirmed that no owned integration processes remained and ports 3121 through 3123 were free before releasing the source freeze. All fresh databases and evidence were retained. The next stages require separately reviewed client/bridge pins, fresh fixtures, and new acceptance evidence for durable failure reporting, held-placement restart, remaining faults and mixed Nova/humanoid routing.
