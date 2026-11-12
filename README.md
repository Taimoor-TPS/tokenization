# IRIS Tokenization Operations Portal

Back-office demo for card tokenization. Plain HTML, CSS and JavaScript — **no npm dependencies** and no install step.

## How to run

```bash
node server.js
```

Open [http://127.0.0.1:8080](http://127.0.0.1:8080) (port **8080**).

On first load the portal writes seed configuration into `/database`. Collections are shared across tabs via the local file store.

## Login

| Username | Password | Display | Role |
| --- | --- | --- | --- |
| `token.admin` | `Token@IRIS2026` | Token Admin | Administrator |

## File layout

| Path | Role |
| --- | --- |
| `server.js` | Static server + `/database` JSON persistence (port 8080) |
| `index.html` | Operations portal UI |
| `config.js` | Data base path (`TKN_DATA_BASE`) |
| `tkn-engine.js` | Shared tokenization business rules |
| `IRIS-Tokenization-Simulator.html` | Device / wallet / POS simulator |
| `engine-test.html` | Engine harness against §12 seed scenarios |
| `database/` | Persisted JSON collections (created at runtime) |

## Simulator

- **In portal:** Operations → Simulator embeds `IRIS-Tokenization-Simulator.html` in an iframe.
- **Open in new window:** use the button on the Simulator screen (same HTML file).
- The simulator polls the shared store; portal resets and lifecycle changes show up without a reload.
- Use **Guided storyline** in the simulator for the 8-step demo path (provision → pay → suspend → decline → unsuspend → pay).

## Engine harness

Open [http://127.0.0.1:8080/engine-test.html](http://127.0.0.1:8080/engine-test.html) to run `tkn-engine.js` checks against the PRD §12 seed scenarios (fixed clock).

## Reset demo data

From the user menu (avatar, next to **Logout**): **Reset demo data**.

Confirms, then restores every collection to the in-memory seed snapshot (config back to §12 seeds; tokens, transactions and audits cleared), writes the store, audits `RESET_DEMO_DATA`, and re-renders the current screen. An open Simulator iframe picks up the change via its poll.

## Notice

All cards, tokens, customers, merchants, OTPs and response codes are **fictitious test data**. Nothing connects to Visa VTS, Mastercard MDES, IRIS CMS or any live network.
"# tokenization" 
