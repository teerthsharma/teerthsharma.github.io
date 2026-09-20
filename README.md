# teerthsharma.github.io

A portfolio site for Teerth Sharma, a performance and systems engineer. The site showcases eleven landed contributions at Google DeepMind, Google, TensorFlow, OpenXLA, NVIDIA, OpenAI's Triton, Meta and dsx-ai-factory, plus a flagship set of personal repositories on computational topology, GPU kernels and ML infrastructure.

## Pages

- `index.html` — Hero, the eleven landed contributions each with its own visualisation, and an assembling mosaic that cycles through their numbers. CTAs link to email, resume (PDF) and GitHub.
- `work.html` — Personal projects, each with its own graphic and numbers. Filterable by language and DOI.

## Preview

```bash
python -m http.server
```

Then open http://localhost:8000.

## Build

No build step. Plain HTML, CSS and vanilla JavaScript. All SVGs are hand-authored inline. The only external request is the Google Fonts stylesheet.
