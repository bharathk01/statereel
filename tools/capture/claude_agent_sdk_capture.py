"""Capture Claude Agent SDK output.

A live session needs the Claude Code CLI and an API key, so by default this feeds
stream-json records (the CLI's documented wire format) through the SDK's OWN parser and
prints the resulting message objects. That pins the real dataclass reprs of the installed
SDK version. With ANTHROPIC_API_KEY set, `--live` captures a real session instead.

Run: python tools/capture/claude_agent_sdk_capture.py [--live]
     ->  tests/fixtures/real/claude_agent_sdk/
"""
import asyncio
import json
import sys

from claude_agent_sdk._internal.message_parser import parse_message

from _common import CALLS, FINAL, PROMPT, REAL, capture, weather, write_manifest

OUT = REAL / "claude_agent_sdk"
MODEL = "claude-opus-5-5"
# Anthropic usage: input_tokens EXCLUDES cache reads, which are reported separately
USAGE = [{"input_tokens": 60, "cache_read_input_tokens": 3900, "output_tokens": 70},
         {"input_tokens": 140, "cache_read_input_tokens": 3960, "output_tokens": 24}]


def records():
    """The stream-json lines the CLI emits for this run."""
    sid = "session-weather-1"
    return [
        {"type": "system", "subtype": "init", "session_id": sid, "cwd": "/work", "model": MODEL,
         "tools": ["Bash", "Read", "mcp__weather__get_weather"], "mcp_servers": [{"name": "weather", "status": "connected"}],
         "permissionMode": "default", "apiKeySource": "none"},
        {"type": "user", "session_id": sid, "parent_tool_use_id": None,
         "message": {"role": "user", "content": PROMPT}},
        {"type": "assistant", "session_id": sid, "parent_tool_use_id": None,
         "message": {"id": "msg_1", "type": "message", "role": "assistant", "model": MODEL, "stop_reason": "tool_use",
                     "content": [{"type": "thinking", "thinking": "Two cities, so two parallel lookups.", "signature": "sig"}] +
                                [{"type": "tool_use", "id": cid, "name": "mcp__weather__get_weather", "input": {"city": city}}
                                 for cid, city in CALLS],
                     "usage": USAGE[0]}},
        {"type": "user", "session_id": sid, "parent_tool_use_id": None,
         "message": {"role": "user", "content": [
             {"type": "tool_result", "tool_use_id": cid, "content": weather(city), "is_error": city == "Atlantis"}
             for cid, city in CALLS]}},
        {"type": "assistant", "session_id": sid, "parent_tool_use_id": None,
         "message": {"id": "msg_2", "type": "message", "role": "assistant", "model": MODEL, "stop_reason": "end_turn",
                     "content": [{"type": "text", "text": FINAL}], "usage": USAGE[1]}},
        {"type": "result", "subtype": "success", "session_id": sid, "is_error": False, "duration_ms": 6240,
         "duration_api_ms": 5110, "num_turns": 2, "result": FINAL, "total_cost_usd": 0.0412,
         "usage": {"input_tokens": 200, "cache_read_input_tokens": 7860, "output_tokens": 94}},
    ]


async def live():
    from claude_agent_sdk import query
    async for message in query(prompt=PROMPT):
        print(message)


if __name__ == "__main__":
    if "--live" in sys.argv:
        capture(OUT, "live_session", live)
        sys.exit(0)
    recs = records()
    parsed = [parse_message(r) for r in recs]          # the SDK's own parser; raises if a record is malformed
    tokens = {"input_tokens": sum(u["input_tokens"] + u["cache_read_input_tokens"] for u in USAGE),
              "output_tokens": sum(u["output_tokens"] for u in USAGE)}
    base = {"tool_calls": 2, "paired": 2, "tool_errors": 1, "model_calls": 2, "user_prompt": True, **tokens}
    print("claude_agent_sdk:")
    capture(OUT, "stream_json", lambda: [print(json.dumps(r)) for r in recs])
    capture(OUT, "sdk_messages", lambda: [print(m) for m in parsed])
    write_manifest(OUT, "claude_agent_sdk", "Claude Agent SDK", ["claude-agent-sdk"], {
        "stream_json.log": {"adapter": "ndjson-events", **base},
        "sdk_messages.log": {"adapter": "repr-stream", **base},
    }, "tools/capture/claude_agent_sdk_capture.py (CLI records through the SDK's parser; --live for a real session)",
        note="no live session: message objects come from the installed SDK's own parser")
