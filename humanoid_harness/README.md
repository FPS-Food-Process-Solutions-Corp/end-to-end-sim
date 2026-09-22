# Humanoid pick-loop harness

Start with the [runbook](../docs/humanoid-harness/README.md). It covers demonstrations, failure injection, restart recovery and test commands.

- [Reconstructed flow](../docs/humanoid-harness/FLOW.md)
- [Architecture and acceptance plan](../docs/humanoid-harness/PLAN.md)
- [Hardware stub replacement points](../docs/humanoid-harness/ADAPTERS.md)
- [Source contracts and provenance](../docs/humanoid-harness/SOURCE_CONTRACTS.md)
- [Validation and limitations](../docs/humanoid-harness/VALIDATION.md)

Run from the repository root with Python 3.12 or newer:

```text
python -m humanoid_harness --scenario happy --state-dir .humanoid-runs/my-demo
```

This package runs software simulation only. All real tags, poses, policies and placement targets remain uncalibrated placeholders until a separately verified real adapter is implemented.
