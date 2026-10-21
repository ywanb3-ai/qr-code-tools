# QR Studio

Private, browser-only **QR code generator & scanner**. No backend, no uploads, no tracking, no accounts — everything runs locally.

> 需求文档见 [REQUIREMENTS.md](REQUIREMENTS.md)（含竞品调研与验收标准）。

## Features

**Generate**
- 9 content types: URL, text, Wi-Fi, email, SMS, phone, contact (vCard), location, calendar event
- Live preview with debounced re-render
- Error correction L / M / Q / H with byte-capacity readout (`version · used bytes · module count`)
- Design: foreground/background colors, linear gradient, 3 dot styles, 3 corner styles, logo upload with coverage warning, WCAG contrast warning, 4 presets
- Export: PNG at current size / 1024px / 2048px, vector SVG, copy to clipboard

**Scan**
- Camera scanning (jsQR, device switching, flashlight where supported)
- Image scanning via file picker, drag & drop, or clipboard paste
- Smart result parsing: Wi-Fi credentials, vCard (save `.vcf`), events, geo (Google Maps), mailto / SMS / tel, URLs with host preview
- Local history (localStorage, max 100 entries) with re-show and "Edit as new QR code" round-trip

**General**
- Responsive (single column on mobile), dark mode (system + manual, persisted)
- Installable as a PWA (manifest + SVG icon), keyboard accessible, WCAG-AA targeted contrast

## Run

No build step. Either:

```bash
# any static server works
python3 -m http.server 8080
# or
npx serve .
```

Then open <http://localhost:8080>. `file://` works too, except camera access on some browsers (needs a secure context) — image scanning always works.

## Tests

```bash
node tests/parse.test.js   # 87 assertions on the protocol parser (pure Node)
```

Browser end-to-end suites (real Chrome via CDP, zero npm dependencies — Node 18+ built-in WebSocket):

```bash
# 1. serve the app
python3 -m http.server 8931 &

# 2. start headless Chrome
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox \
  --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-cdp-profile-qr \
  --use-fake-device-for-media-stream \
  --use-file-for-fake-video-capture=/path/to/qr.y4m \
  about:blank &

# 3. run the suites
node tests/e2e-generator.mjs   # 42 assertions: encoding, design, export, logo, theme, privacy
node tests/e2e-scanner.mjs     # 37 assertions: image scan, parsing, history, round-trip, responsive
node tests/e2e-camera.mjs      # 12 assertions: getUserMedia + live decode (needs the fake .y4m device)
```

`e2e-camera.mjs` expects a Y4M video showing a QR code (the app under test decodes
`https://example.com/camera-e2e` from it). Any QR Y4M generator works; the frame is
640×480, QR centered, ~12px modules.

Last run: 87 + 42 + 37 + 12 = **178 assertions, all passing** (Chrome 155, macOS).

## Layout

```
qr-code-tools/
├── index.html              # single page, Generate / Scan tabs
├── css/styles.css          # theme tokens + layout
├── js/
│   ├── app.js              # entry: theme + tab routing
│   ├── generator.js        # F1–F3 generation
│   ├── scanner.js          # F4–F5 scanning & history
│   └── parse.js            # protocol parser (pure, unit-tested)
├── vendor/                 # qr-code-styling 1.9.2, jsQR 1.4.0 (UMD)
├── icons/qr-icon.svg
├── manifest.webmanifest
├── tests/parse.test.js
└── REQUIREMENTS.md
```

## Deploy

Static hosting only (GitHub Pages, Netlify, Vercel, S3, nginx, …). For camera access in production, serve over HTTPS.

## Privacy

Network requests are limited to the page's own assets (the two vendored libraries). There is no analytics, no font CDN, no beacon. Scan history never leaves `localStorage`.
