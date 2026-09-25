# Deterministic failure and recovery summary

This records one staged software-only partial-result scenario. It did not run native Nova motion, vision, a gripper, delivery, or hardware.

## Evidence levels

The 39 bridge mock tests are isolated checks of bridge behavior. They are useful regression coverage, but they do not establish the behavior of the kiosk, platform API, Socket.IO connection, real bridge process, or fake ROS services together.

The A004 scenario is live staged integration evidence. It used the real local frontend, platform API and scheduler, `platform_bridge`, and the fake ROS provider. Its pre-run inventory and A003 preservation baseline is in [2026-09-18-recovery-baseline.json](verification/2026-09-18-recovery-baseline.json); raw platform state is in [2026-09-18-recovery-order.json](verification/2026-09-18-recovery-order.json); bridge/provider correlation and journal evidence are in [2026-09-18-recovery-middleware.json](verification/2026-09-18-recovery-middleware.json).

## Controlled provider selection

The provider normally starts with `success`. For a bounded two-item diagnostic, stop the managed stack and select three outcomes so that the retry cannot silently become a success:

```powershell
wsl.exe -d Ubuntu-22.04 -u user -- /usr/bin/python3 /mnt/d/Work/FPS/Robotics/end-to-end-sim/tools/local_sim_runtime.py stop
wsl.exe -d Ubuntu-22.04 -u user -- /usr/bin/python3 /mnt/d/Work/FPS/Robotics/end-to-end-sim/tools/local_sim_runtime.py start --mode bridge --provider-outcomes success,failed,failed
```

An outcome is consumed only by a newly accepted execution ID. An identical replay leaves the sequence unchanged. Once the sequence is exhausted, its final outcome repeats. A configured failure is a known terminal ROS status: `FAILED` with `NO_DETECTION` and `robot_ready=true`. The provider does not emulate a lost correlated execution; that `UNKNOWN` recovery path remains separate.

## A004 observation and cleanup

A004's first pick completed. The second pick failed with `NO_DETECTION`, received its configured platform retry, and failed again. The pick session then reported completed work with one completed and one failed task, while the order remained `PREPARING` and held counter 2. At that point the croissant total was 9 and available quantity was 8: the successful pick consumed one item and the failed task retained one reservation.

This is a characterization finding, not a policy change. The scenario does not treat the session-completed notification as permission to release the counter or mark the order ready.

The bounded proposed correction is in [partial-fulfillment-fix-plan.md](partial-fulfillment-fix-plan.md); this record remains evidence of the pre-fix behavior.

The same pre-fix partial outcome is reproducible without ROS through the dedicated API and one Socket.IO HR client; use [partial-order-api-socketio-reproduction.md](partial-order-api-socketio-reproduction.md). Its clean A006 trace is separate API-only evidence, while A004 remains the live bridge and fake-ROS integration case.

After evidence capture, A004 was cancelled through the platform status endpoint. The platform removed its fulfillment session details, released counter 2 and the remaining reservation, and preserved the completed pick's stock decrement: total and available quantities were both 9. A003 remained `READY` at counter 1 without changes.

The normal safe mode was then restored:

```powershell
wsl.exe -d Ubuntu-22.04 -u user -- /usr/bin/python3 /mnt/d/Work/FPS/Robotics/end-to-end-sim/tools/local_sim_runtime.py stop
wsl.exe -d Ubuntu-22.04 -u user -- /usr/bin/python3 /mnt/d/Work/FPS/Robotics/end-to-end-sim/tools/local_sim_runtime.py start --mode bridge
```

Do not cancel an order before saving its API, queue, inventory, provider, bridge, and journal evidence. Do not use cancellation as a way to bypass a pending physical outcome in a future non-simulated workflow.
