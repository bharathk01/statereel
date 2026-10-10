"""Capture REAL LangGraph / deepagents debug output for fixtures, with no API key.

A scripted fake chat model drives a genuine deepagents graph, so every print below is
exactly what the frameworks emit; only the model's replies are canned.
Run: python tools/capture/langgraph_deepagents.py  ->  writes tests/fixtures/real/langgraph/*.log
"""
import contextlib
import datetime
import importlib.metadata as md
import io
import json
import pathlib
import platform

from deepagents import create_deep_agent
from langchain.agents.middleware import TodoListMiddleware
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage, AIMessageChunk
from langchain_core.outputs import ChatGenerationChunk
from langchain_core.tools import tool

OUT = pathlib.Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "real" / "langgraph"


MODEL_NAME = "scripted-fake-model"


class ScriptedToolModel(GenericFakeChatModel):
    """Fake model that accepts bind_tools() and streams like a real provider."""

    def bind_tools(self, tools, **kwargs):
        return self

    def _stream(self, messages, stop=None, run_manager=None, **kwargs):
        # word-sized content chunks, then one closing chunk with tool calls + usage,
        # which is the shape real providers stream (and what stream_mode="messages" prints)
        msg = next(self.messages)
        words = msg.content.split(" ") if msg.content else []
        for i, w in enumerate(words):
            piece = w if i == 0 else " " + w
            chunk = ChatGenerationChunk(message=AIMessageChunk(content=piece, id=msg.id))
            if run_manager:
                run_manager.on_llm_new_token(piece, chunk=chunk)
            yield chunk
        yield ChatGenerationChunk(message=AIMessageChunk(
            content="", id=msg.id,
            tool_call_chunks=[{"name": tc["name"], "args": json.dumps(tc["args"]), "id": tc["id"], "index": i}
                              for i, tc in enumerate(msg.tool_calls)],
            usage_metadata=msg.usage_metadata,
            response_metadata={"finish_reason": "tool_calls" if msg.tool_calls else "stop",
                               "model_name": MODEL_NAME}))


def usage(i, o, cached=0):
    return {"input_tokens": i, "output_tokens": o, "total_tokens": i + o,
            "input_token_details": {"cache_read": cached}}


def script():
    """Canned replies: plan -> two parallel tool calls (one fails) -> save a file -> answer."""
    return iter([
        AIMessage(content="", id="ai-1", usage_metadata=usage(1800, 60), tool_calls=[{
            "name": "write_todos", "id": "call_todos",
            "args": {"todos": [{"content": "Look up the weather in Paris", "status": "in_progress"},
                               {"content": "Write a short report", "status": "pending"}]}}]),
        AIMessage(content="Checking both cities.", id="ai-2", usage_metadata=usage(2300, 41, 1792), tool_calls=[
            {"name": "get_weather", "id": "call_paris", "args": {"city": "Paris"}},
            {"name": "get_weather", "id": "call_atlantis", "args": {"city": "Atlantis"}}]),
        AIMessage(content="", id="ai-3", usage_metadata=usage(2600, 70, 2304), tool_calls=[{
            "name": "write_file", "id": "call_file",
            "args": {"file_path": "/report.md", "content": "# Paris weather\n\n18C and light rain."}}]),
        AIMessage(content="Done: Paris is 18C with light rain; there is no weather data for Atlantis. "
                          "The report is saved to /report.md.",
                  id="ai-4", usage_metadata=usage(2900, 22, 2560)),
    ])


@tool
def get_weather(city: str) -> str:
    """Return the current weather for a city."""
    if city == "Atlantis":
        # tools usually report failures as text rather than raising, so the run continues
        return f'{{"error": "no weather station found for {city}"}}'
    return f'{{"city": "{city}", "temp_c": 18, "conditions": "light rain"}}'


def agent():
    # deepagents leaves write_todos off by default; the todo middleware puts a plan in state
    return create_deep_agent(model=ScriptedToolModel(messages=script()), tools=[get_weather],
                             middleware=[TodoListMiddleware()],
                             system_prompt="You are a concise weather assistant.")


PROMPT = {"messages": [{"role": "user", "content": "What's the weather in Paris? Save a short report."}]}


def capture(name, fn):
    """Run fn with stdout captured and write it to a fixture file."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        fn()
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.log"
    path.write_text(buf.getvalue(), encoding="utf-8")
    print(f"{name:<22} {len(buf.getvalue()):>8} bytes -> {path.relative_to(OUT.parents[3])}")


def run_values_updates():
    # the pattern most apps use: print every (mode, chunk) pair from a multi-mode stream
    for mode, chunk in agent().stream(PROMPT, stream_mode=["updates", "values"]):
        print(f"[{mode}] {chunk}")


def run_values_only():
    for chunk in agent().stream(PROMPT, stream_mode="values"):
        print(f"[values] {chunk}")


def run_updates_only():
    for chunk in agent().stream(PROMPT, stream_mode="updates"):
        print(chunk)


def run_messages():
    for mode, chunk in agent().stream(PROMPT, stream_mode=["messages"]):
        print(f"[{mode}] {chunk}")


def run_debug_flag():
    # LangGraph's built-in debug=True printing (checkpoint / tasks / writes per step)
    agent().invoke(PROMPT, debug=True)


def run_debug_stream():
    for chunk in agent().stream(PROMPT, stream_mode="debug"):
        print(chunk)


def run_final_state():
    print(agent().invoke(PROMPT))


# What the scripted run must look like in the viewer, whatever the framework version.
# A framework release that changes its print format shows up as a broken expectation.
RUN = {"tool_calls": 4, "paired": 4, "tool_errors": 1, "model_calls": 4,
       "input_tokens": 9600, "output_tokens": 193}
STATE = {"todos": 2, "files": 1}
MODES = {
    # name: (runner, expected adapter, carries state keys, includes the user prompt)
    "values_updates":  (run_values_updates, "langgraph-stream", True,  True),
    "values_only":     (run_values_only,    "langgraph-stream", True,  True),
    "updates_only":    (run_updates_only,   "dict-stream",      True,  False),
    "messages_stream": (run_messages,       "langgraph-stream", False, False),
    "debug_true":      (run_debug_flag,     "langgraph-stream", True,  True),
    "debug_stream":    (run_debug_stream,   "dict-stream",      True,  False),
    "final_state":     (run_final_state,    "python-literal",   True,  True),
}


def versions():
    pkgs = ["deepagents", "langgraph", "langchain", "langchain-core"]
    return {p: md.version(p) for p in pkgs}


if __name__ == "__main__":
    fixtures = {}
    for name, (fn, adapter, has_state, has_prompt) in MODES.items():
        capture(name, fn)
        fixtures[name + ".log"] = {"adapter": adapter, **RUN,
                                   **({"state": STATE} if has_state else {}),
                                   "user_prompt": has_prompt}
    manifest = {
        "key": "langgraph",
        "framework": "LangGraph / Deep Agents",
        "versions": versions(),
        "python": platform.python_version(),
        "captured_at": datetime.date.today().isoformat(),
        "generator": "tools/capture/langgraph_deepagents.py (scripted fake model, no API key)",
        "fixtures": fixtures,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("manifest ->", (OUT / "manifest.json").relative_to(OUT.parents[3]), manifest["versions"])
