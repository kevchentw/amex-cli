# amex-cli

Turn your Amex account into something you can actually use outside the website.

`amex-cli` pulls your cards, benefits, and offers into a local cache you can browse in a terminal UI or feed straight into AI tools.

![Interactive demo](./docs/interactive-demo.svg)

Why people use it:

- see all your Amex benefits and offers in one place
- keep a local cache instead of logging into the site every time
- use an interactive terminal UI for quick browsing
- output clean JSON for OpenClaw, ChatGPT, Claude, Codex, scripts, or custom tools

Typical use cases:

- ask an AI assistant to summarize active benefits you have not used
- filter all offers for a specific card and pass them into another tool
- add an offer to one card or all eligible cards from the terminal
- open a local browser UI instead of using the terminal UI
- keep a local cache of cards, benefits, and offers for later analysis
- browse everything in a terminal UI without digging through multiple Amex pages

Coming soon:

- calculate welcome offer progress and spending milestones
- store transaction history locally for richer analysis and tracking

## Quick Start

If you have never used `npx` before:

- install Node.js first
- `npx` is included with `npm`, which comes with Node.js
- after Node.js is installed, you can run `npx amex-cli ...` directly in your terminal

Run directly with `npx`:

```bash
npx amex-cli --help
```

Store your Amex credentials in the system credential manager:

```bash
npx amex-cli auth set
```

Or use non-interactive CLI arguments:

```bash
npx amex-cli auth set --username YOUR_USERNAME --password YOUR_PASSWORD
```

Run a sync:

```bash
npx amex-cli sync
```

Open the interactive app:

```bash
npx amex-cli
```

Or start a local browser UI:

```bash
npx amex-cli ui
```

Recommended browser UI flow:

1. store credentials with `npx amex-cli auth set`
2. run `npx amex-cli sync` once to build the local cache
3. run `npx amex-cli ui`
4. use the browser UI to review cards, benefits, offers, and trigger offer enrollment actions

`sync` currently opens a visible Chrome window for login because the Amex sign-in flow is not reliable in pure headless mode yet.

## What it syncs

One sync pulls:

- cards
- benefits
- offers

The synced results are saved locally as JSON:

- `~/.amex-cli/cache/cards.json`
- `~/.amex-cli/cache/benefits.json`
- `~/.amex-cli/cache/offers.json`

`browser-profile/` is also stored locally and reused for future login sessions:

- `~/.amex-cli/browser-profile/`

You can override the default location with:

```bash
AMEX_CLI_HOME=/custom/path
```

## Install

Requirements:

- Node.js 20+
- Google Chrome installed

No install flow is required for basic usage if you run it with `npx`.

## Commands

Main commands:

```bash
npx amex-cli
npx amex-cli interactive
npx amex-cli ui
npx amex-cli web
npx amex-cli ui --port 43110
npx amex-cli sync
npx amex-cli sync --debug
npx amex-cli show cards
npx amex-cli show benefits
npx amex-cli show offers
npx amex-cli show all
npx amex-cli enroll offer --source-id SOURCE_ID --card 41008
npx amex-cli enroll offer --source-id SOURCE_ID --all-cards
npx amex-cli enroll all-offers
npx amex-cli auth set
npx amex-cli auth set --username YOUR_USERNAME --password YOUR_PASSWORD
npx amex-cli auth status
npx amex-cli auth clear
```

Notes:

- running `npx amex-cli` with no command opens the interactive UI
- `ui` / `web` starts the local web UI on `127.0.0.1` and opens the browser automatically
- `sync` opens a visible Chrome window for login and refreshes local cache
- `sync --debug` keeps the browser visible and prints extra auth/network logs
- `enroll offer` can add one offer to one card, multiple cards, or all eligible cards for that offer
- `enroll all-offers` attempts to add every eligible offer currently in local cache
- `--source-id` is usually easier than `--offer-id` because Amex offer ids often contain shell-hostile characters
- multi-card offer enrollment is still not guaranteed to add the offer to every eligible card; a more reliable approach is still being investigated

## Interactive UI

The interactive UI includes:

- `Members` tab
- `Benefits` tab
- `Offers` tab

It supports keyboard navigation, filtering, and search directly in the terminal.

The `Offers` tab can also enroll offers:

- add the focused offer to selected cards
- add the focused offer to all eligible cards
- add all eligible offers in the current cache
- reuse an existing interactive browser session when possible before falling back to a fresh login

Current limitation:

- multi-card enrollment can still partially fail even when several cards are eligible; the CLI will show which cards succeeded or failed, and a more stable approach is still being researched

## Local Web UI

If you prefer a browser over the terminal UI, you can start a local web app:

```bash
npx amex-cli ui
```

The web UI runs entirely on your machine and uses the same local cache and browser profile as the CLI.

It currently supports:

- viewing cards, benefits, and offers in a browser
- triggering `sync`
- enrolling a focused offer on selected cards
- enrolling a focused offer on all eligible cards
- enrolling all eligible offers from the current cache

## AI-Friendly Output

The project is designed to work well with AI tools.

Use JSON output when you want another tool or agent to read the synced data:

```bash
npx amex-cli show cards --json
npx amex-cli show benefits --json
npx amex-cli show offers --json
npx amex-cli show all --json
```

This makes it easy to plug into:

- local agents
- CLI pipelines
- prompt-based analysis
- notebooks
- custom dashboards

Example workflows:

```bash
npx amex-cli show benefits --json > benefits.json
npx amex-cli show offers --json > offers.json
```

Then ask an AI tool to:

- identify unused statement credits
- summarize enrolled or eligible offers
- generate a weekly action list

## Security Model

Credentials are stored with [`keytar`](https://github.com/atom/node-keytar), which uses the OS credential store:

- macOS Keychain
- Windows Credential Manager
- Secret Service / libsecret on Linux

This avoids storing your Amex username and password in plain text files.

If you use `auth set --password ...`, note that the password may be saved in your shell history. The interactive `auth set` prompt is safer for normal use.

The browser profile is stored locally so Chrome can retain cookies, trusted-device state, and related browser storage between sync runs.

## Login Behavior

Login uses Patchright with a persistent Chrome profile.

Current behavior:

- sync uses a real browser profile
- sync currently relies on a visible, non-headless Chrome session
- headless login still has reliability issues during the Amex sign-in flow and is not supported yet
- two-step verification may be required during login
- MFA is supported in the visible browser flow
- trusted-device state can be reused across runs through the saved browser profile

At the moment, pure headless sign-in is not reliable enough for normal use. The goal is to support a fully headless flow in the future, but the current Amex login experience still requires a visible browser session.

If Amex changes their login flow, device checks, or bot detection, login behavior may also change.

## Data Shape

Each synced dataset is stored as structured JSON with a consistent wrapper:

```json
{
  "syncedAt": "2026-03-01T03:06:49.359Z",
  "source": "...",
  "items": [],
  "raw": {}
}
```

This is useful for both:

- human-readable CLI views
- machine-readable downstream processing

## Current Status

Implemented today:

- Amex login through Patchright + Chrome profile
- local JSON cache for cards, benefits, and offers
- interactive terminal UI
- offer enrollment from both CLI and interactive UI
- human-readable CLI views
- JSON output for automation and AI use

## Example AI Prompts

Once you have synced data locally, you can hand JSON to an AI assistant and ask things like:

- "Which benefits are in progress and likely worth using this month?"
- "Show me enrolled offers that expire soon."
- "Which cards have overlapping offers?"
- "Create a weekly summary of unused Amex benefits."
- "Find statement credits I have not started but should use before month-end."

## Disclaimer

This project is an independent tool and is not affiliated with or endorsed by American Express.

It is also a vibe-coded project. Use it at your own risk.

You are responsible for reviewing the code, protecting your credentials, and deciding whether it is appropriate for your own account and environment.
