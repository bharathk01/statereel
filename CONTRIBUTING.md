# Contributing

The most valuable contributions are **logs StateReel can't read yet**, and **support for a new framework or version**.

## A log doesn't parse well

Open an issue with:

- the framework and version, and how you printed the log (`debug=True`, `verbose=True`, a stream mode…)
- a **redacted** sample: remove prompts, file contents, keys and anything else private
- what the **State & diagnostics** tab says: the adapter it chose, and any *unrecognised types*

## Adding a framework

Every framework's debug output falls into one of three families:

| Family | Looks like | Lives in |
|---|---|---|
| Object reprs | `Event(author=...)`, `AIMessage(content=...)` | `expandMessage`, `absorbParts`, `KIND_BY_TYPE`, `MSGISH` |
| Structured records | NDJSON lines, a JSON document | `ndjson-events` / `json` adapters, `expandSdkRecord` |
| Console traces | `## Thought:`, `Action:`, `---------- TextMessage (user) ----------` | the `*-console` adapters |

Try these in order. Each step is smaller than the next:

1. **New names for known things.** If turns show up but tool calls or tokens don't, add the field alias to `pick(...)`, `readUsage`, or a block type to `absorbParts`.
2. **New message types.** If nothing shows up, add the type name to `KIND_BY_TYPE` and `MSGISH`.
3. **A new shape.** Add an adapter to `ADAPTERS` with `detect(text)` returning a 0–1 score and `parse(text, res)`.
4. **A real capture**, ideally. Add `tools/capture/<framework>.py`, which drives the framework with a fake or test model (no API key) and writes logs plus a `manifest.json` (versions and expected results) to `tests/fixtures/real/<framework>/`. `tests/real.test.js` picks it up automatically. Then run `python tools/update_compat.py`.

## A framework changed its format

The weekly `compat` workflow will open an issue naming the field that changed. Teach the parser the new name, **keep the old one** (older versions are still in use), re-capture, and commit the fixtures with the fix.

## Ground rules

- `statereel.html` stays one file with no dependencies, no build and no network access. The CSP in its `<head>` must not be loosened.
- Keep the `/*<<<CORE_START>>>*/`, `INSIGHT`, `TEXT` and `VERIFIED` markers. The tests and the background parser load code from between them.
- Run `tests/run-all.sh` before opening a PR. CI runs it too, including the browser tests.
- Run `python tools/scan_private.py` before committing fixtures, to catch keys and private data.
