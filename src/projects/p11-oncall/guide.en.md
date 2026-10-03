## Production notes

- **Confirm before you investigate**: an alert is a symptom, not a diagnosis. Start with the alerting metric's curve over the last 30–60 minutes and the error logs — if only one or two points crossed the line and it has since recovered, it's flapping; a 4xx spike is usually a client or a load test. The right remediation for a false alarm is "do nothing", plus a suggestion to tune the alert's threshold or duration.
- **Walk the dependency topology**: a 502 on the gateway is often a problem two or three hops downstream. Give the model a topology tool and have it check each downstream hop's error rate and error logs until it finds the service that is failing on its own rather than being dragged down. Don't forget the other direction — an upstream retry storm can crush a downstream service. External dependencies have no metrics; you only see them through their callers' logs.
- **Correlation is not causation**: when two services degrade together, look at the **timeline**: whose anomaly started first, and whose change came before the anomaly. A deploy made after the onset is not the cause, even if that service's metrics look worse. Put "a change must precede the anomaly" in the system prompt.
- **Design tool output for the model**: dumping a 60-point time series and dozens of repeated log lines into the context is expensive and hard to read. Compress metrics into "baseline / max / current / anomaly start + sparse samples", and dedupe logs by content with a count and first / last time. But **don't truncate away key information** — the line you cut could be `x509: certificate has expired`.
- **Approval is a gate in code, not a wish in the prompt**: inside each remediation tool, call `requestApproval` first, execute only if approved, and return a rejection to the model as an error. Put the reason template in the tool's parameter description: root-cause service + metric values / log lines + why this action fixes it. That evidence is exactly what the human approver reads (human approval from level 12 + policy gate from level 17).
- **Minimal remediation**: touch only the root cause. "Restart everything affected" destroys evidence and widens the blast radius; a database failover causes write downtime and should only happen when the primary really is unreachable. Set a higher evidence bar for high-risk actions on the approval side.
- **Runbooks are the agent's long-term memory**: many fixes have an order (turn off the logging flag, then restart; first work out whose certificate expired). Having the model read the runbook before acting is far more reliable than hoping it figures it out.
- **Third-party outage: escalate, don't tinker.** Restarting or rolling back your own services can't fix a vendor's problem. The agent's output is a status update: impact, start time, who we're contacting, next update time.
- **Make the output actionable**: use a fixed enum for the root cause (easy to count and route), write the summary as a postmortem (Impact / Root cause / Evidence / Remediation), and quote evidence verbatim. Real AIOps benchmarks (ITBench, AIOpsLab) also score on "root-cause localization + did the system recover after remediation".
- After launch: turn every real incident into a new injected scenario (alert + metrics + logs + changes) and keep running the benchmark; send every remediation to the audit log.

## Reference architecture

```
alert ──▶ system (investigation process + timeline rule + minimal remediation + approval reason template + JSON / postmortem format)
           │
           ▼
  ┌────────────────────────────── runAgent loop (maxSteps ≈ 25) ───────────────────────────────┐
  │  model ──▶ read: get_topology / get_metrics (compressed) / search_logs (deduped)           │
  │            get_deploy_history / get_runbook / list_services                                │
  │        ──▶ write: rollback / restart / scale / toggle_flag / failover (with reason)        │
  │                     │                                                                      │
  │                     ▼  inside each remediation tool: requestApproval({action,args,reason}) │
  │               approved ──▶ call the raw API ──▶ result                                     │
  │               rejected ──▶ return the rejection to the model as an error                   │
  └────────────────────────────────────────────────────────────────────────────────────────────┘
           │ model stops calling tools
           ▼
  parseJsonLoose ──▶ { rootCause: { service, category }, summary: Impact / Root cause / Evidence / Remediation }
           │
           ▼
  grader: approvals ✓ root cause ✓ nothing unrelated touched ✓ system recovered ✓ postmortem evidence ✓
```
