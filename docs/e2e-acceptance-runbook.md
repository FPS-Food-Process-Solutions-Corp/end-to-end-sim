# Run the combined E2E acceptance checks

This runner exercises the real local platform API and client with the canonical Nova bridge and simulated robot actions. It uses the prepared WSL environment on this workstation. It is separate from the browser-based first-order demo and does not validate hardware.

## Prepared environment

Use Ubuntu-22.04, the existing `/home/user/.venvs/end-to-end-sim-ros/bin/python`, ROS Humble, the staged ROS interface overlay, PostgreSQL, the preserved `coffee_platform_sim` seed and the compiled API stage at `/home/user/e2e-stage/coffee-platform`. The runner currently validates that prepared stage location; the argument does not make an arbitrary platform checkout launchable. It creates a new case database from the seed and retains it as evidence. It does not modify the canonical `coffee-platform` checkout or clear the seed's business records.

The explicit client and Nova roots must select the reviewed canonical branches. The launcher accepts equivalent CRLF/LF client checkouts while rejecting different imported source or substantive edits. The runner captures the selected source before creating orders and checks it again after cleanup.

Each independent attempt needs a new absolute run directory, a new owned database name, three available distinct loopback ports and a dedicated nonzero local ROS domain. Generated settings direct journals and pending reports into that run directory. Use the same state again only within a deliberately orchestrated restart case.

## Execute a case

Run these commands from the repository root in PowerShell. The WSL root account is needed for the runner's local PostgreSQL account switch. The runner prepares ROS environments for its owned child processes; no manual overlay sourcing is needed.

Create the parent directory for local run and console output:

```powershell
New-Item -ItemType Directory -Force -Path '.local/acceptance' | Out-Null
```

Choose one case and let it finish before starting the next:

**mixed-positive**

```powershell
wsl.exe -d Ubuntu-22.04 -u root -- bash -lc 'cd /mnt/d/Work/FPS/Robotics/end-to-end-sim && exec /home/user/.venvs/end-to-end-sim-ros/bin/python tools/run_e2e_acceptance.py --execute --case mixed-positive --run-root /mnt/d/Work/FPS/Robotics/end-to-end-sim/.local/acceptance/mixed-user-01 --client-root /mnt/d/Work/FPS/Robotics/platform-client --nova-root /mnt/d/Work/FPS/Robotics/nova5_ros2 --platform-stage /home/user/e2e-stage/coffee-platform --seed-db coffee_platform_sim --database-name taska_20260925_user_mixed_01 --api-port 3131 --humanoid-port 3132 --nova-port 3133 --ros-domain-id 72' > '.local/acceptance/mixed-user-01.console.log' 2>&1
```

**nova-callback-boundary**

```powershell
wsl.exe -d Ubuntu-22.04 -u root -- bash -lc 'cd /mnt/d/Work/FPS/Robotics/end-to-end-sim && exec /home/user/.venvs/end-to-end-sim-ros/bin/python tools/run_e2e_acceptance.py --execute --case nova-callback-boundary --run-root /mnt/d/Work/FPS/Robotics/end-to-end-sim/.local/acceptance/callback-user-01 --client-root /mnt/d/Work/FPS/Robotics/platform-client --nova-root /mnt/d/Work/FPS/Robotics/nova5_ros2 --platform-stage /home/user/e2e-stage/coffee-platform --seed-db coffee_platform_sim --database-name taska_20260925_user_callback_01 --api-port 3141 --humanoid-port 3142 --nova-port 3143 --ros-domain-id 73' > '.local/acceptance/callback-user-01.console.log' 2>&1
```

**held-placement-restart**

```powershell
wsl.exe -d Ubuntu-22.04 -u root -- bash -lc 'cd /mnt/d/Work/FPS/Robotics/end-to-end-sim && exec /home/user/.venvs/end-to-end-sim-ros/bin/python tools/run_e2e_acceptance.py --execute --case held-placement-restart --run-root /mnt/d/Work/FPS/Robotics/end-to-end-sim/.local/acceptance/held-user-01 --client-root /mnt/d/Work/FPS/Robotics/platform-client --nova-root /mnt/d/Work/FPS/Robotics/nova5_ros2 --platform-stage /home/user/e2e-stage/coffee-platform --seed-db coffee_platform_sim --database-name taska_20260925_user_held_01 --api-port 3151 --humanoid-port 3152 --nova-port 3153 --ros-domain-id 74' > '.local/acceptance/held-user-01.console.log' 2>&1
```

The `*-user-01` directories and database names are fresh examples, not existing accepted evidence. For a repeat, change the run directory, database name and console filename together. The runner refuses an existing run directory or test database. Keep the required test-database prefix. The examples use separate port ranges for each case (3131-3133, 3141-3143 and 3151-3153) to avoid immediate socket reuse. Every selected port must be free; reserve ROS domains 72, 73 and 74 respectively for these sequential local fixtures. If a completed run leaves a port temporarily unavailable, wait or select another free three-port range.

The command retains console output beside the run directory. After it returns, inspect `$LASTEXITCODE` and the case records; a nonzero exit requires investigation. Do not rerun into the failed attempt's directory.


The `--execute` flag authorizes the runner to create the isolated database and test orders. The command is intended for the prepared local simulation environment. It owns the processes it starts, cleans them up on completion or failure, and retains the database, snapshots and logs. A failed run must remain separate from a successful repeat.

## Read the result

The run directory contains the request, captured source manifest, generated settings, process and transport logs, API snapshots, case result and cleanup records. For the mixed case, `settled-audit.json` and `post-launcher-stop-audit.json` record the strict proof before and after normal client shutdown. `post-run-source-check.json` reports changed source files; `cleanup-proof.json` records owned-process and listener cleanup. Each case retains its detailed recovery evidence beneath the same run root.

Success requires the case-specific API, task, inventory and physical-effect assertions. A normal process exit alone is not acceptance. Source identity, chronological traces and ownership/cleanup records are part of the evidence.

## Coverage and limits

| Case | Required behavior |
|---|---|
| `mixed-positive` | Humanoid completes first and receives NO_TASK while Nova is pending; exact session readback later returns it to FREE without reconnect. Each item changes stock once and physical effects are not repeated. |
| `nova-callback-boundary` | A confirmed platform completion survives interruption before the bridge callback finishes; restart completes the callback without another physical execution or duplicate completion report. |
| `held-placement-restart` | Exit 78 occurs after verified placement and durable hold, before completion queueing. Restart reports the same placement while preserving the hold, with no FREE signal or new physical task. |

The unchanged platform's partial-order, cancellation-accounting and replay limitations remain in scope as observed behavior, not repaired server behavior. Hardware reachability, calibrated poses, real sensors, controller motion and browser rendering require separate validation. See the [master verification report](master-verification-report.md) for historical coverage and the [dated integration report](e2e-integration-2026-09-25.md) for exact source versions and results.
