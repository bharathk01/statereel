# StateReel — architecture

`statereel.html` turns the **debug / verbose state output of an agent framework** into a
readable run report: Overview, Flow + replay, Timeline, Tools, and raw State. One self-contained
file, parsed entirely in the browser, no network calls, no storage.

It is **format-driven, not framework-driven**. That distinction is the whole design, and it is why
frameworks nobody wrote code for still work. Section 3 is the important one.

---

## 1. Pipeline

```
paste / drop text
   |
 (1) PREPROCESS   strip ANSI (real ESC sequences + bare "[1m" from lossy copies), box drawing
   |
 (2) DETECT       every adapter scores the text 0..1; best score wins; user can override
   |
 (3) PARSE        the winning adapter turns text into raw values
   |
 (4) NORMALISE    vocabulary tables map any framework's fields onto ONE message shape
   |
 (5) RECONCILE    dedupe snapshots, merge token chunks, pair tool calls with results
   |
 (6) PROJECT      insights (narrative, failures, markers, artifacts, tools, tokens) -> 5 views
```

Stages 4–6 are framework-agnostic. Only stages 2–3 know anything about a format, and even there the
knowledge is data (regexes, field-name tables) rather than code paths.

---

## 2. The parser under it all

Input is usually `repr()` output, not JSON: single-quoted strings, `None/True/False`, tuples, and
constructor syntax (`AIMessage(content='x', id='y')`). `ToolMessage.content` is typically **a JSON
document embedded in a Python string**, so the text is dense with escaped quotes, and real logs carry
values like `0.90\x111.10 m\xb7daN`.

So there is a ~200-line recursive-descent **Python-literal parser** (`PyParser`) handling strings
(single/double/triple, `r`/`b`/`f`/`u` prefixes, implicit concatenation, `\xHH`/`\uXXXX`/octal
escapes), dicts, lists, tuples, sets, and calls. Two design choices earn their keep:

- **A call becomes a tagged object**: `AIMessage(content='x')` -> `{__type:'AIMessage', content:'x'}`.
  Messages therefore travel the same code path as plain dicts — no message-specific parsing rules.
- **Opaque reprs survive**: `<object at 0x7f…>` -> `{__repr:'…'}` instead of a parse failure. This is
  what later lets `role=<MessageRole.USER: 'user'>` (LlamaIndex, Semantic Kernel) be recovered by
  `enumText()` rather than crashing the parse.

---

## 3. Why it generalises: three input families

Surveying LangGraph, LangChain, deepagents, Claude Agent SDK, Google ADK, CrewAI, AutoGen,
Pydantic AI, LlamaIndex, Semantic Kernel, Vercel AI SDK, Swarm, smolagents and Strands, every
built-in debug print lands in one of **three families**:

| Family | What it looks like | Frameworks |
|---|---|---|
| **A. Tagged object reprs** | `Event(author=…)`, `AgentOutput(response=ChatMessage(…))`, `AssistantMessage(content=[TextBlock(…)])` | LangChain/LangGraph, ADK, Claude SDK, AutoGen, Pydantic AI, LlamaIndex, Semantic Kernel |
| **B. Structured records** | NDJSON lines or a JSON blob: `{"type":"assistant","message":{…}}`, `{role, content, tool_calls}`, `{steps:[{toolCalls,toolResults}]}` | Claude SDK CLI, OpenAI-style, Swarm, Vercel AI SDK, Strands, LangServe, `dumpd()` |
| **C. Console traces** | Human-readable markers: `## Using tool:`, `Thought:/Action:/Observation:`, `---------- TextMessage (user) ----------` | CrewAI, LangChain verbose, AutoGen Console, smolagents |

Three parsers cover all of it. What differs between frameworks inside a family is **vocabulary, not
structure** — so vocabulary lives in tables:

```js
KIND_BY_TYPE   // "aimessage"->ai, "toolcallexecutionevent"->tool, "agentoutput"->ai, ...
pick(o, ...)   // first present alias: pick(b,'input','args','arguments','tool_kwargs')
readUsage()    // input_tokens | prompt_tokens | request_tokens | prompt_token_count | promptTokens
absorbParts()  // TextBlock|TextPart|TextContent -> text
               // ToolUseBlock|ToolCallPart|FunctionCall|ToolSelection|FunctionCallContent -> call
               // ToolResultBlock|ToolReturnPart|FunctionExecutionResult|ToolOutput|
               //   FunctionResultContent|{toolResult:…} -> result (its own message)
```

### Adding a framework is a table entry, not a code path

The measured cost of supporting LlamaIndex, Semantic Kernel, Vercel AI SDK, smolagents and Strands
was: a handful of alias names, five type names, one `enumText()` helper, and one generic
`repr-stream` adapter. No new views, no new insight code, no changes to dedupe/pairing/replay.

Practical recipe when something new appears:
1. Run it. Note which family it is and what the Diagnostics tab says the adapter ranking was.
2. If turns appear but tool calls do not, add the field alias to `absorbParts` / `pick(...)`.
3. If nothing appears, add the type name to `KIND_BY_TYPE` + `MSGISH`, or (family C) add the marker
   regex.
4. Add a fixture to `tests/frameworks.test.js` or `tests/unseen.test.js`.

---

## 4. Adapter registry

```js
{ name, label, frameworks, detect(text) -> 0..1, parse(text, res) }
```

Every adapter scores the text; the highest score parses it; if the winner yields no messages the
ranking is walked downward, so an empty report is never shown silently. The chosen adapter and the
full ranking appear in the header as **"read as: <format> (92%)"** — a dropdown that re-parses with
any adapter, so a wrong guess costs one click instead of a bug report.

| Adapter | Family | Handles |
|---|---|---|
| `langgraph-stream` | A | `[values]`/`[updates]`/`[messages]`/`[custom]` marker events |
| `ndjson-events` | B | one JSON record per line (Claude SDK stream-json, Strands, generic) |
| `crewai-console` | C | CrewAI verbose markers |
| `react-console` | C | `Entering new … chain`, Thought/Action/Action Input/Observation(s)/Final Answer, `Step N` rules |
| `autogen-console` | C | `---------- Type (source) ----------` blocks incl. `FunctionCall` reprs |
| `speaker-log` | C | `[user]: / [agent]:` transcripts |
| `json` | B | any JSON containing message-shaped objects (incl. `lc:1` `dumpd`, AI SDK steps) |
| `python-literal` | A | one whole state dict / message list |
| `repr-stream` | A | a *sequence* of top-level reprs, one per line |
| `salvaged-messages` | A | loose message reprs in a truncated or interleaved log |
| `raw-text` | — | last resort: show the text as one message |

Scoring detail worth knowing: `python-literal` multiplies its score by the fraction of the input its
single literal actually covers. Without that, a 40-line NDJSON log scored 0.78 and only the first
line was read — the report looked fine and was wrong.

---

## 5. Reconciliation

- **Snapshot dedupe.** A `[values]` event is a full state snapshot, so an N-node run prints the same
  message N times. The largest event becomes the ordering **spine**; the rest fold into it by message
  `id` (hash fallback) and the repeat count becomes the `×N snapshots` chip.
  *Spine selection uses strict `>`* — with `>=`, any stream of equal-sized events (NDJSON records,
  token chunks) picked the last event as the spine and played the whole run backwards.
- **Chunk merge.** `stream_mode="messages"` repeats one id with **growing** content, so `*Chunk`
  types concatenate instead of deduping (otherwise only the first token survives).
- **Pairing.** Tool calls pair to results by `tool_call_id`; console traces have no ids, so a call
  claims the next unpaired result with a matching tool name.
- **Wrapper suppression.** A turn whose only payload was tool results (Claude SDK `UserMessage` of
  `ToolResultBlock`s, Semantic Kernel `role=TOOL`) is not emitted as a turn of its own.

---

## 5b. The Overview is a leadership dashboard

The Overview tab is tuned for management / leadership reading of a run, not debugging (that lives in
Timeline / Flow). Design follows agent-observability practice — LangSmith / Langfuse / Arize dashboards
and enterprise agent-KPI guidance all converge on **4–8 curated KPIs grouped by category**, a
plain-English summary, cache-hit as an explicit cost lever, tool-call success rate, a human-review /
escalation count, and anomaly (runaway-loop) detection — never raw lists.

- **Executive summary sentence** — auto-composed: outcome, duration, steps/calls, reported cost, and
  how many outputs are flagged for human review.
- **Two KPI groups (≤8 tiles), health-coloured** — *Outcome & reliability* (outcome, success rate,
  human-review count, duration) and *Cost & usage* (cost/run, total tokens, cache-hit %, model calls).
- **Tokens per model call** chart — where the spend goes; cache vs fresh vs output.
- **Request / Outcome** — one-line each, full text in Timeline.
- **Insights** — plain-English observations replacing raw detail lists: reliability, review load,
  cache utilisation, heaviest generation, deliverables, and a repeated-call/loop heuristic.
- **Moved off the exec view** into *State & diagnostics* (not deleted): the per-item *Needs attention*
  and *Deliverables & references* lists, and they remain in the Copy-summary export.

Rationale sourced from LangSmith/Langfuse/Arize dashboard designs and enterprise agent-KPI guidance
(cost per successful outcome, cache-hit rate, tool-call error rate, escalation rate); "one or two KPIs
per category, ~4–8 total" is the stated leadership sweet spot.

## 5c. Runtime: big logs, privacy, cost, versions

**Parsing off the main thread.** Inputs of 512 KB and up are parsed in a Web Worker built from
the page's own `CORE` section (loaded from a `blob:` URL; one parser, no `eval`, nothing
fetched). Adapters report progress through `reportProgress()`, which drives a progress bar. Below
512 KB the main thread is faster than starting a worker. If a browser refuses the worker, parsing
falls back to the main thread instead of failing. Measured: a 21 MB worst-case LangGraph log is
ready in about 1.1 s, and the page never freezes for more than 200 ms.

**Big inputs never touch the textarea.** Files or pastes over 1 MB are kept in memory and shown
as a file chip. A textarea holding tens of MB is slower to render than the parser is to run.

**Lazy timeline above 500 messages.** Cards render as a header shell. The body (markdown, payload
trees, tool calls) is built when it nears the viewport (IntersectionObserver), on expand, or on
jump-to-step, and `content-visibility: auto` lets the browser skip layout and paint off-screen.
This was chosen over hand-rolled windowing because cards vary in height and expand, so windowing
would break smooth jump-to-step and browser find (Ctrl+F).

**Privacy enforced by the browser.** A Content-Security-Policy meta tag (`default-src 'none'`,
inline script/style only, `worker-src blob:`) blocks every network request. The e2e suite fires an
outbound `fetch` and asserts the browser refuses it (`connect-src`).

**Cost from the user's prices.** Prices are entered per model found in the log (input, cached
input, output, per 1M tokens) and remembered in localStorage (numbers only, never log text).
`computeCosts()` is cache-aware: fresh input × input price + cached input × cached price (defaults
to the input price) + output × output price. Usage is first normalised so *input always includes
cached tokens*, because Anthropic / the Claude Agent SDK report `cache_read_input_tokens` outside
`input_tokens` while LangChain, OpenAI and Google count them inside. Cache-write premiums are not
modelled. A reported cost (Claude SDK `total_cost_usd`) always wins over the estimate.

**Version tracking.** Real captures record the exact framework versions and the expected result
in `tests/fixtures/real/<framework>/manifest.json`. `tools/update_compat.py` turns them into
`COMPATIBILITY.md` and the viewer's `ADAPTER_VERIFIED` table (shown under *verified against* in
Diagnostics). During parsing, types the parser met but could not interpret are collected as
*unrecognised types*, the earliest signal that a framework changed its format. The weekly
`compat` workflow re-captures against the latest releases and opens an issue if parsing breaks.

## 6. Measured coverage

`tests/run-all.sh` runs everything. All numbers below are assertions, not estimates.

### Frameworks with a dedicated adapter or fixture

| Input | Adapter | Result |
|---|---|---|
| LangGraph `[values]`/`[updates]` (this is what `debug=True` prints) | `langgraph-stream` | full, **real capture** |
| LangGraph `stream_mode="updates"` / `"debug"` printed with `print(chunk)` | `dict-stream` | full, **real capture**; debug adds per-node durations |
| LangGraph `stream_mode="messages"` chunks | `langgraph-stream` | full — concatenated by id |
| deepagents (`messages` + `todos` + `files`) | `langgraph-stream` | full — todos/files get panels |
| Claude Agent SDK stream-json (NDJSON) | `ndjson-events` | full — thinking, cost, duration |
| Claude Agent SDK dataclass reprs | `python-literal` / `repr-stream` | full |
| Google ADK `Event(...)` | `repr-stream` | full — incl. `actions.state_delta` |
| CrewAI verbose (plain and ANSI-coloured) | `crewai-console` | full |
| LangChain classic verbose (ReAct) | `react-console` | full |
| AutoGen `Console()` | `autogen-console` | full — incl. parallel `FunctionCall`s |
| Pydantic AI message history | `python-literal` | full — parts split into turns |
| LangChain `dumpd()` / `to_json()` (`lc:1`) | `json` | full |
| `model_dump()` / LangServe / OpenAI chat arrays | `json` | full |
| Anthropic content blocks | `json` | full |

### Frameworks NO adapter was written for (`tests/unseen.test.js`)

The real generalisation test. "Full" = turns, tool calls **and** call/result pairing all recovered.

| Framework | Family | Adapter that claimed it | Result |
|---|---|---|---|
| LlamaIndex AgentWorkflow | A | `repr-stream` | full |
| Microsoft Semantic Kernel | A | `repr-stream` | full |
| Vercel AI SDK (`steps[]`) | B | `json` | full |
| OpenAI Swarm | B | `json` | full |
| smolagents console | C | `react-console` | full |
| AWS Strands Agents | B | `ndjson-events` | full |

**6 / 6 fully understood.** Before the vocabulary work it was 1 / 6 (three produced a single raw
blob) — the fix was tables and detection scoring, not new adapters.

### The one deliberate gap

**Span / trace exports** — OpenTelemetry GenAI (`resourceSpans`, `gen_ai.*`), LangSmith run trees
(`child_runs`), OpenAI Agents SDK spans (`span_data.type`) — are hierarchical **trees**, not state
prints. The tool reads whatever inside them is message-shaped and emits an explicit warning that the
timeline is incomplete, rather than presenting a plausible-looking half-parse. Closing this properly
needs the tree model in section 8.

---

## 6b. What real captures and scale testing found

Six frameworks now have real captures: LangGraph/Deep Agents, Claude Agent SDK, CrewAI,
AutoGen, Google ADK and Pydantic AI, 24 print styles in total, all driven by scripted fake
models (`tools/capture/*.py`). Against the current releases, hand-built fixtures had been wrong in
five places:

| Framework | What it really prints | Fix |
|---|---|---|
| CrewAI 1.15 | rich **panels** ("🤖 Agent Started", "🔧 Tool Execution Started (#1)") instead of `# Agent:` markers. The old marker strings still exist in `show_agent_logs()`, but verbose mode uses the event console formatter | panel parser, old markers kept for older versions |
| Google ADK 2.11, AutoGen 0.7 | `print()` on a Pydantic model: `field=value field=value`, **no class name**, multi-line | `pydantic-str` adapter; the class is inferred (AutoGen's `type=` field, ADK's `author` + `content`) |
| Google ADK | `event.model_dump_json()`: JSON lines with no `type`/`role` | message-shaped records count for NDJSON detection |
| Pydantic AI 2.x | `all_messages_json()`: `{"kind": "request", "parts": [{"part_kind": ...}]}` | `kind` / `part_kind` mapped onto the existing part handling |
| Claude Agent SDK | `SystemMessage(subtype=, data={})` | treated like the CLI's system record |

They also exposed two bugs in our own code. The stream scanner ran the "copy state out of an
update chunk" helper on message objects too, which flagged their parts as unrecognised and copied
junk into the State tab (caught by the unrecognised-type detector). And the dedupe fingerprint
merged two id-less steps that called the same tool.

**Scale.** `tests/scale.js` replicates every real capture into files holding 10, 100 and 500 runs
(unique ids and prompts per run, as separate runs would have) and asserts tool calls, pairing,
failures and model calls are exactly ×N. Results at 500 runs: every print style exact, 10–66 MB/s
in V8, largest file 11.7 MB in under 0.5 s. That test found that one-JSON-array-per-run files
weren't recognised as a stream, and that format detection wasted a full parse plus a sanitise pass on
every non-JSON log. A fast rejection of non-JSON made LangGraph's update and debug streams about 5×
faster.

## 7. Provenance notes

- **CrewAI: source check versus real output.** The `# Agent:` / `## Thought:` markers below were
  confirmed in CrewAI's source, but a real CrewAI 1.15 run prints rich panels instead (section 6b).
  Both formats are supported. The lesson is that a source check is no substitute for running the framework.
  Earlier attempts to confirm the markers from documentation failed because the docs pages are JS-rendered and returned no body. The markers were
  then read directly out of `show_agent_logs()` in
  `lib/crewai/src/crewai/utilities/agent_utils.py` (raw.githubusercontent.com serves plain text, so
  it fetches cleanly): the literals are `"# Agent: "`, `"## Task: "`, `"## Thought: "`,
  `"## Using tool: "`, `"## Tool Input: "`, `"## Tool Output: "`, `"## Final Answer: "`, printed via
  `ColoredText`. Because they are colourised, each marker arrives wrapped in ANSI escapes — which is
  why `stripAnsi()` must run before matching, and why `tests/frameworks.test.js` asserts the
  ANSI-wrapped trace parses identically to the plain one.
- **OpenTelemetry GenAI conventions are pre-stable** (every `gen_ai.*` attribute is still marked
  *Development*, and they moved to a dedicated repo in v1.42.0, June 2026). Mirror the *shape*, keep
  our own versioned schema, pin an adapter per convention version.
- **`repr()` input is lossy by nature**: no timestamps, no durations, `<object at 0x…>` is opaque,
  truncated logs can only be partly salvaged. Console traces additionally carry no token counts and
  no tool-call ids. Section 8 phase 3 is the real fix.

---

## 8. Canonical model and module split (not yet built)

Today the canonical unit is a flat message list. Trace formats are span trees, and deepagents
subagents (`task` tool) have histories that never enter parent state — a flat list cannot express
either. A message list is a depth-1 span tree, so building on the tree generalises.

```ts
type Run = {
  schemaVersion: 1,
  meta: { framework?, adapter, runId?, startedAt?, endedAt?, models[], agents[] },
  events: Event[],            // flat, ordered - drives Timeline / Flow / replay
  roots: string[],            // event ids without a parent - drives the tree view
  state: { snapshots[], extras },
  diagnostics: { adapterScores, issues[], trailing[] }
}
type Event = {
  id, parentId?, seq, kind: 'user'|'system'|'assistant'|'reasoning'|'tool_call'|'tool_result'
    |'agent_start'|'agent_end'|'handoff'|'state_update'|'error'|'custom',
  actor: { type:'user'|'agent'|'tool'|'system', name?, node? },
  ts?, durationMs?, text?, blocks?[],
  toolCall?: {id?, name, args}, toolResult?: {callId?, ok, payload, bytes},
  usage?: {inputTokens?, outputTokens?, cachedInputTokens?, reasoningTokens?, costUsd?},
  model?, finishReason?, provenance: {seenCount, snapshotIds[], rawRef}
}
```

Proposed layout (keeps a zero-dependency dev path):

```
index.html                 # thin shell -> <script type="module" src="src/main.js">
dist/agent-inspector.html  # built single-file artifact (what you share)
build.mjs                  # inlines src/* + css, ~80 lines, no deps
src/core/{ansi,pyliteral,jsonish,vocab,model,reconcile}.js
src/adapters/{registry,langgraph-stream,ndjson-events,crewai-console,react-console,
              autogen-console,repr-stream,json,python-literal,salvage,raw}.js
src/enrich/{deepagents,langgraph,costs,redact}.js
src/insights/{narrative,failures,markers,artifacts,tools,tokens}.js
src/ui/{shell,router,views/*,components/*}.js
tests/fixtures/<framework>/*  +  *.test.mjs
```

dev: `python3 -m http.server 8080` (ES modules will not load over `file://` — the one cost of
splitting) · test: `node --test tests/` importing modules directly · ship: `node build.mjs`.

---

## 9. Phases

**Phase 0 — DONE.** Chunk merge; `lc:1` unwrapping; trace exports flagged instead of half-parsed;
`todos`/`files` panels; 11 scored adapters with UI override; console-trace parsing for
CrewAI/ReAct/AutoGen/smolagents; thinking + reasoning capture; reported cost and duration; enum-repr
recovery; generic `repr-stream`; 6/6 unseen frameworks.

**Publish-readiness pass — DONE.** Real LangGraph/deepagents captures in 7 print styles (found and
fixed: debug/updates dict streams, empty closing chunks, tool-call chunk merging, todos in task
writes); version manifests + generated COMPATIBILITY.md; unrecognised-type warnings; Web Worker
parsing with progress; in-memory big inputs; lazy timeline; CSP lockdown; per-model cache-aware
cost; GitHub Actions for CI, Pages, releases and weekly compatibility; privacy scanner; rename to
StateReel.

**Phase 1 — extract modules, behaviour identical (~2 days).** Split per section 8, introduce
`Run`/`Event`, port the current parser as the first adapter, move tests to `node --test`, add
`build.mjs`. Success = every existing assertion passes against the modular source.

**Phase 2 — tree-native UI (~2–3 days).** Timeline and Flow read `parentId`; subagent and handoff
nesting; then `langsmith-runtree`, `otel-genai` and `openai-agents-sdk` adapters land with no UI work.

**Phase 3 — stop reverse-engineering prints (~1 day).** `tools/dump_run.py`: ~40 lines that serialise
a LangGraph/deepagents run to canonical `Run` JSON *with* timestamps and durations. Parsing prints
stays the always-works fallback; instrumented export becomes the good path.

**Phase 4 — scale.** Web Worker parsing; virtualised timeline past ~500 events; streaming large files.

---

## 10. Testing

| Suite | What it locks down |
|---|---|
| `parse.test.js` | 6 input shapes, escapes, dedupe, salvage, fallbacks |
| `render.test.js` | markdown-lite, XSS neutralisation, code-listing detection, formatters |
| `sample.test.js` | the built-in LangGraph sample end to end |
| `insights.test.js` | narrative, failures, markers, artifacts, tool aggregates |
| `frameworks.test.js` | one fixture per supported framework, incl. ANSI-coloured CrewAI |
| `samples.test.js` | every sample in the picker parses and pairs cleanly |
| `unseen.test.js` | frameworks with no adapter — the generalisation guarantee |
| `real.test.js` | every real capture, driven by its `manifest.json` (versions + expected run) |
| `cost.test.js` | cache-aware cost maths and usage normalisation across providers |
| `scale.js` | every real capture x 10/100/500 runs per file: counts exact, throughput floor |
| `e2e.py` | real Chromium: every sample and real capture, all tabs, big-file worker path, lazy cards, pricing, CSP enforcement |
| `gap-probe.js` | informational: which adapter claims which shape |

`./tests/run-all.sh` runs the lot. They read the shipped HTML and eval the marked
`CORE`/`INSIGHT`/`TEXT` sections, so the tests exercise exactly what the browser runs.

---

## 11. Non-goals and limits

- Not an observability backend: no storage, no server, no auth. It reads what you paste.
- Console traces (family C) inherently lack token counts, ids and timings — the tool shows what is
  there and never invents the rest. Where a format does not echo the user prompt (LangChain verbose),
  the request is reported as absent rather than fabricated; `unseen.test.js` asserts that.
- Redaction (`enrich/redact`) should land before summary export gets heavy use — pasted production
  logs may contain secrets, and Copy summary puts them on the clipboard.
