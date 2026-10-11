#!/usr/bin/env python3
"""Write one short-link page per project and contribution.

teerth.dev/nerve -> work.html#p-nerve, teerth.dev/mujoco-3396 -> index.html#pr-mujoco-3396.
GitHub Pages serves nerve.html at /nerve. Each stub carries the section's own
heading and summary as its link preview, then sends the browser on with
location.replace; crawlers don't run JS, so WhatsApp and Instagram keep the
stub's card instead of the whole page's.

    python shortlinks.py     # rewrites every stub; rerun after adding a section
"""
import html
import re

SITE = "https://teerth.dev"
SOURCES = [("work.html", "p-"), ("index.html", "pr-")]
# These paths already serve the project's own GitHub Pages site, which wins
# over a stub at the same path. Their short link is that site.
TAKEN = {"resolvent", "monodromy", "caustic", "topological-ml-toolkit"}

STUB = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — Teerth Sharma</title>
<meta name="description" content="{desc}">
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Teerth Sharma">
<meta property="og:title" content="{title} — Teerth Sharma">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{SITE}/{slug}">
<meta property="og:image" content="{SITE}/assets/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{SITE}/assets/og.png">
<script>location.replace("/{target}");</script>
</head>
<body><p><a href="/{target}">{title}</a></p></body>
</html>
"""


def text(fragment):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", fragment)).strip()


def sections():
    for page, prefix in SOURCES:
        src = open(page, encoding="utf-8").read()
        for m in re.finditer(rf'<article[^>]*\bid="({prefix}[a-z0-9-]+)"', src):
            anchor = m.group(1)
            body = src[m.end():m.end() + 4000]
            head = re.search(r"<h[23][^>]*>(.*?)</h[23]>", body, re.S)
            para = re.search(r"<p[^>]*>(.*?)</p>", body, re.S)
            assert head and para, f"{page}#{anchor}: no heading or summary"
            desc = html.unescape(text(para.group(1)))
            if len(desc) > 200:
                desc = desc[:197].rsplit(" ", 1)[0] + "..."
            yield anchor[len(prefix):], f"{page}#{anchor}", html.unescape(text(head.group(1))), desc


def main():
    written = []
    for slug, target, title, desc in sections():
        if slug in TAKEN:
            continue
        assert slug not in written, f"duplicate slug {slug}"
        with open(f"{slug}.html", "w", encoding="utf-8", newline="\n") as f:
            f.write(STUB.format(SITE=SITE, slug=slug, target=target,
                                title=html.escape(title), desc=html.escape(desc)))
        written.append(slug)
        print(f"{SITE}/{slug:<22} -> {target}")
    print(f"{len(written)} stubs, {len(TAKEN)} served by project sites")


if __name__ == "__main__":
    main()
