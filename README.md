# teerthsharma.github.io

A portfolio site for Teerth Sharma, a performance and systems engineer. The site showcases eight merged pull requests at Google DeepMind, Google, TensorFlow, NVIDIA and OpenAI Triton, plus fourteen public repositories on computational topology, GPU kernels and ML infrastructure.

## Pages

- `index.html` — Hero, the eight merged pull requests with visualisations, and animated counters. CTAs link to email, resume (PDF) and GitHub.
- `work.html` — Fourteen personal projects, each with its own graphic and numbers. Filterable by language and DOI.

## Preview

```bash
python -m http.server
```

Then open http://localhost:8000.

## Build

No build step. Plain HTML, CSS and vanilla JavaScript. All SVGs are hand-authored inline. The only external request is the Google Fonts stylesheet.
