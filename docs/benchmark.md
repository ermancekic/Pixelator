# Comparing asset quality

A change to the tools, the Pixel Artist skill or the Artist Guide should make agents draw better assets. This procedure compares two versions on the same tasks. It uses the 23 tasks of the [visual sample](testing.md#visual-sample-23-real-tasks); it does not replace the technical checks there.

## Run

1. Note the commit, the client and model, and the Artist Guide version that `get_workflow` returns.
2. Create one project per run, named after date, model and commit, for example `bench 2026-11-09 fable-5.2 537a9f0`.
3. Give the agent each task text verbatim, in a fresh session per task so that nothing carries over. Use the same `quality` in both runs; compare `standard` with `polished` only on purpose.
4. Let the agent work without help. Keep the result even when it finishes as `needs_review`.
5. Per task, record status, duration, and the batches and reviews used (`get_run` → `budget`).

Repeat a task three times when two runs look close: one drawing per task varies too much to carry a small difference.

## Look

Open the contact sheet of each run and place them side by side:

```
http://127.0.0.1:4317/api/projects/<projectId>/contact-sheet?scale=4&background=%23808080
```

Assets appear in creation order with a number. For animations, also export a GIF (`export_asset` with `format: "gif"`). Agents can get the same sheet with `inspect_assets`.

Score blind where possible: the person or the separate agent that scores sees the images and the task texts, not which run they come from. Do not use the drawing agent's own review as the score.

## Score

Give 0, 1 or 2 points per task and checklist point of the Artist Guide:

| Point | Tasks |
| --- | --- |
| Readability | all |
| Clusters/edges | all |
| Palette/light | all |
| Style/context | all; for 10 and 19 against the referenced asset |
| Edit fidelity | 17–20 |
| Motion | 21–23 |

0 means a defect that shows at game size, 1 a flaw that shows only enlarged, 2 no flaw found. Add the points per run, and count the tasks that finished as `completed`.

## Record

Add a dated addendum to the [verification report](verification.md) with both totals, the per-task scores that differ, the cost (duration, batches, reviews) and the two contact sheets. State what was not compared.
