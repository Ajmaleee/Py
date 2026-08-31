# PyLogic Bench

A small web app for learning Python logic through **algorithms**, **pseudocode**,
and **drag-and-drop flowcharts** — with an in-character AI tutor ("Py") that
turns your logic into runnable Python and explains mistakes in plain words.

## Why two  deployments?

This is deliberately split into two pieces:

1. **Frontend** (`index.html`, `style.css`, `app.js`, `flowchart.js`) — a static
   site. Deploy it anywhere static (Cloudflare Pages, GitHub Pages, etc.).
2. **Backend Worker** (`worker.js`, `wrangler.toml`) — a Cloudflare Worker that
   holds your AI provider API key **as a secret**, never sent to the browser.

You mentioned adding the API key via Cloudflare's "Add env var" screen on a
Pages project — **don't do that for the key itself.** Env vars on a static
Pages project are readable by anyone who opens dev tools, because the
frontend has to read them to use them. Secrets are only safe on a server
(the Worker), set via `wrangler secret put`, which never ships to the client.

## 1. Deploy the Worker (backend)

```bash
npm install -g wrangler
cd site
wrangler login

# Secrets (never go in wrangler.toml, never touch the browser):
wrangler secret put GEMINI_API_KEY
# and/or
wrangler secret put OPENAI_API_KEY
# and/or (adjust callOpenCode() in worker.js to match the real endpoint)
wrangler secret put OPENCODE_API_KEY

# Optional: a shared access code so randoms can't hit your Worker even
# if they find the URL. If set, the frontend must send the same value
# (entered in the app's Settings dialog).
wrangler secret put CLIENT_CODE

wrangler deploy
```

Edit `wrangler.toml` first:
- Set `ALLOWED_ORIGIN` to the exact URL your frontend will be served from.
- Enable **one** of the two rate-limiting options (native Rate Limiting
  binding, or the KV fallback) — see the comments in the file.

## 2. Deploy the frontend

Upload `index.html`, `style.css`, `app.js`, `flowchart.js` to Cloudflare
Pages (or any static host) as-is — no build step needed.

Open the deployed site, click the gear icon top-right, and paste your
Worker's URL (e.g. `https://pylogic-bench.yourname.workers.dev`) plus the
client access code if you set one. This is stored only in the visitor's
`localStorage`, never sent anywhere except to your own Worker.

## Security checklist (already implemented, verify before going live)

- [x] API keys live only as Worker secrets — never in HTML/JS/env vars shipped to the browser.
- [x] CORS locked to `ALLOWED_ORIGIN` (set this before deploying).
- [x] Optional shared `CLIENT_CODE` header as a light extra gate.
- [x] Rate limiting per IP (native binding preferred, KV fallback included) — **enable one before launch**, the Worker logs a warning and fails open otherwise.
- [x] Input length caps (`MAX_INPUT_CHARS`, `MAX_SELECTION_CHARS`) to bound cost and abuse.
- [x] Request timeout (`AbortController`, 25s) so a hung provider call can't pile up.
- [x] Model responses are parsed as strict JSON and never `eval`'d or injected as raw HTML (the frontend uses `textContent`/escaping).
- [x] The persona/system prompt lives only in the Worker, so the client can't read or override it.
- [ ] **You should still add:** Cloudflare's built-in Bot Fight Mode / Turnstile on the Worker route if you expect public traffic, and periodically rotate keys.

## Notes on the AI tutor staying "in character"

The Worker's system prompt instructs the model to always identify itself
only as "Py" and never name the underlying provider or model, even under
direct or indirect pressure to reveal it. Because this is enforced by
instructions to the model rather than a hard technical guarantee, treat it
as strong-effort, not airtight — don't rely on it for anything security
critical.

## Running generated code

"Run this code" executes entirely in the visitor's browser using
[Pyodide](https://pyodide.org) (Python compiled to WebAssembly) — no code is
ever executed on your Worker or sent anywhere else to run. It has no file
or network access from inside the sandboxed page.

## Extending providers

`worker.js` has one `call<Provider>()` function per backend
(`callGemini`, `callOpenAI`, `callOpenCode`). Add a new one and a branch in
`callProvider()` to support another API — the frontend's "Model" dropdown
already sends a `provider` field (`gemini` / `openai` / `opencode` / `auto`).
