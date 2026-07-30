# Scheduler app

**Scheduler** runs **recurring agent jobs** on an interval or cron schedule while Minnow is open. Each job executes a prompt in a chosen workspace and model through a headless Minnow runner.

## Open Scheduler

Click **Scheduler** in the dock. The UI opens as a **side panel** so you can keep working in Chat or Code.

## Create a job

Typical fields:

| Field | Meaning |
|-------|---------|
| **Prompt** | What the agent should do each run |
| **Schedule** | Interval (minimum 60 seconds) or cron expression |
| **Workspace** | Project folder for file-aware tools |
| **Model** | Which model the headless run uses |

Save the job. It appears in the panel list with status and next run hints.

## While Minnow runs

Jobs **only execute when Minnow is running**. Closing the app or hiding to tray still counts as running; fully quitting stops the scheduler.

Check **run history** in the Scheduler UI for successes, failures, and logs. Jobs live in `scheduler.json` and run output in `scheduler-runs/` under your Minnow home.

## Good use cases

- Nightly lint or test summary on a repo
- Periodic doc sync into Brain
- Reminder-style checks that need tool access

Avoid schedules that require you to approve every tool call unless you are available to click approve.

## Troubleshooting

| Problem | Check |
|---------|--------|
| Job never ran | Was Minnow open? Interval at least 60s? |
| Run failed | Run history message; model and workspace still valid? |
| Wrong files touched | Workspace path on the job |

See [Troubleshooting](../reference/troubleshooting.md).

## Related

- [Settings app](settings.md)
- [Models app](models.md)
