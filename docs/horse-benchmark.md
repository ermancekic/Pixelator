# Horse Benchmark

Every model gets the same prompt and draws the same picture in Pixelator over MCP: a 300×300 pixel art horse in side view on a summer meadow. A horse is hard to draw: legs with knees and hocks, the head, mane and tail, and the coat markings all have to be right. The model places every pixel through Pixelator's tools and judges its work only from the images `inspect_asset` returns, so the benchmark tests planning, drawing and self-correction together. The result reflects the model and its client.

All runs are collected in the [results](horse-benchmark-results.md). To check whether a change to Pixelator makes agents draw better, use [Comparing asset quality](benchmark.md).

## How I benchmarked

1. I ran all models against one Pixelator instance with its normal data folder, several of them at the same time. Each model draws in its own project and the prompt forbids opening other projects; the logs showed that no model opened another model's project. For full isolation, start Pixelator with its own data folder per run: `$env:PIXELATOR_DATA_DIR = "data/horse-benchmark/<model>"`, then `npm start`.
2. I opened each client in an empty folder outside this repository, so the model knew Pixelator only through MCP and could not read this page or earlier results. Every vendor ran in its own client: Claude Code for Claude, Codex for OpenAI, Antigravity for Google. I always used the highest reasoning effort the client offered for the model. [Connect MCP](../README.md#connect-mcp)
3. Every run started in a new session with the prompt below, pasted verbatim. I allowed the tool calls and did not help. When a model stopped before `finish_run`, I replied only `Continue.`, at most three times.
4. I noted the client version, the model and its setting, and the time from sending the prompt to the model's last message. I took batches and reviews from `http://127.0.0.1:4317/api/runs`.
5. I saved the picture at 1× from `http://127.0.0.1:4317/api/assets/<assetId>/png` as `docs/assets/horse-benchmark/<model>.png` and added the run to the [results](horse-benchmark-results.md).

A run that uses an image generator, imports an image or computes pixels with code does not count. Clients that lose the connection to Pixelator can use the [stdio bridge](mcp.md#stdio-bridge).

## Prompt

```text
Draw the best pixel art horse you can, using the Pixelator MCP tools.

Setup
- Call get_workflow first and follow the workflow and Artist Guide it returns.
- Create a new project named "Horse Benchmark <model>" with one asset named "Horse <model>", 300×300 pixels. Replace <model> with your own model name, as exactly as you know it. Work only in this project; do not open other projects or assets.
- Start an artist run with quality "polished" and end it with finish_run.

Horse
- One adult horse in strict side view, facing right: head on the right, tail on the left. No rider, saddle or bridle.
- It stands calm but alert: all four hooves on the ground, head up, ears pricked forward. The legs are staggered so that all four are visible; the far legs (away from the viewer) are a little darker than the near legs.
- Coat: bay, a warm reddish-brown body with black mane, black tail and black lower legs. One white sock on the near hind leg.
- A light breeze from the right blows the mane and tail to the left.
- Get the anatomy right: proportions, a muscular neck and hindquarters, knees and hocks that bend the right way, distinct hooves, an eye, a nostril and the line of the jaw.

Scene
- A sunny summer meadow: a blue sky that gets lighter toward the horizon, a few soft clouds, a line of distant hills and grass in the foreground. Fill the whole canvas; no transparent pixels.
- Light comes from the upper left. The horse casts a soft shadow on the ground beneath it.
- The horse is the focus. From tail tip to nose it spans about three quarters of the canvas width, it stays fully inside the canvas with a margin on every side, and its hooves rest on the ground in the lower fifth of the image. Keep the background calmer than the horse: less contrast, less detail.

Style
- Clean, deliberate pixel art: readable clusters, clean curves, no stray pixels, no noisy dithering, no banding.
- At most 32 colors in the whole image; choose the palette yourself.
- Outline the horse with darker shades of its own colors (selective outline), not with pure black.
- Keep the background and the horse on separate layers.

Rules
- Place every pixel with Pixelator's drawing operations. Do not use image generators, do not import images, and do not write scripts or code that compute pixel data.
- Work on your own and do not ask questions; make reasonable decisions yourself.
- Look at your work with inspect_asset after each stage and fix what you see. Keep improving while a correction round still makes a visible difference.
- When you are done, report the asset ID, the final revision ID and the weaknesses you still see.
```
