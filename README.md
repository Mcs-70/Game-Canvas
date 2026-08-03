# Game Canvas (لوحة الألعاب)

Entertainment Designed for Everyone.

Game Canvas provides digital and physical entertainment services for companies and groups, targeting ages 10–30: board games, on-site entertainment for corporate clients, and playable digital games.

## Project

Static site — plain HTML, CSS, and vanilla JavaScript. No build step, no framework, no dependencies.

```
.
├── index.html        # main page: hero, board games, services, play games, about, footer
├── play.html          # placeholder page for the future digital games hub
├── css/
│   └── styles.css     # design tokens (:root custom properties) + layout + responsive rules
├── js/
│   └── script.js       # mobile nav toggle + scroll-spy active-link highlighting
└── README.md
```

## Running locally

This project needs no build tools. Open the folder in VS Code and run it with the **Live Server** extension (right-click `index.html` → "Open with Live Server"), or serve it with any static file server, e.g.:

```bash
python3 -m http.server
```

Then visit `http://localhost:8000`.

## Design

- Colors, spacing, and radii are defined once as CSS custom properties in `:root` in `css/styles.css` — adjust the palette from that one place.
- Primary: deep teal/blue. Accents: coral and gold.
- All shapes (hexagons, circles, triangles, diamonds) are pure CSS (`clip-path`) or inline SVG — no image assets.

## Bilingual readiness

The site ships English-first (`<html lang="en" dir="ltr">`). Text elements that will need an Arabic version carry `data-en` / `data-ar` attributes so a language switch can swap content without restructuring markup. The stylesheet uses logical/direction-aware custom properties (`--dir-start`, `--dir-end`) and an `[dir="rtl"]` override block so flipping `dir="rtl"` on `<html>` re-mirrors layout (e.g. the mobile nav drawer) without extra CSS.

## Status

v1 is a single scrollable page (`index.html`) with anchor navigation. `play.html` is a placeholder for the future digital games hub.
