"""Capture real Pydantic AI message output (FunctionModel scripts the replies, no API key).

Run: python tools/capture/pydantic_ai_capture.py  ->  tests/fixtures/real/pydantic_ai/
"""
import os

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")   # keep the promo banner out of captured output

from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from _common import CALLS, FINAL, PROMPT, REAL, SYSTEM, capture, weather, write_manifest

OUT = REAL / "pydantic_ai"


def scripted(messages, info):
    """First turn asks for both cities; once tool results are back, answer."""
    returned = any(getattr(p, "part_kind", "") == "tool-return" for m in messages for p in getattr(m, "parts", []))
    if not returned:
        return ModelResponse(parts=[ToolCallPart("get_weather", {"city": city}, tool_call_id=cid) for cid, city in CALLS])
    return ModelResponse(parts=[TextPart(FINAL)])


def run():
    agent = Agent(FunctionModel(scripted, model_name="scripted-fake-model"), system_prompt=SYSTEM)

    @agent.tool_plain
    def get_weather(city: str) -> str:
        """Return the current weather for a city."""
        return weather(city)

    return agent.run_sync(PROMPT)


if __name__ == "__main__":
    result = run()
    usage = result.usage() if callable(result.usage) else result.usage   # a property since 2.x
    tokens = {"input_tokens": getattr(usage, "input_tokens", None) or getattr(usage, "request_tokens", 0),
              "output_tokens": getattr(usage, "output_tokens", None) or getattr(usage, "response_tokens", 0)}
    base = {"tool_calls": 2, "paired": 2, "tool_errors": 1, "model_calls": 2, "user_prompt": True, **tokens}
    print("pydantic_ai:")
    capture(OUT, "all_messages_repr", lambda: print(result.all_messages()))
    capture(OUT, "messages_per_line", lambda: [print(m) for m in result.all_messages()])
    capture(OUT, "all_messages_json", lambda: print(result.all_messages_json().decode()))
    write_manifest(OUT, "pydantic_ai", "Pydantic AI", ["pydantic-ai-slim"], {
        "all_messages_repr.log": {"adapter": "python-literal", **base},
        "messages_per_line.log": {"adapter": "repr-stream", **base},
        "all_messages_json.log": {"adapter": "json", **base},
    }, "tools/capture/pydantic_ai_capture.py (FunctionModel, no API key)",
        note="token counts are Pydantic AI's own usage accounting for the run")
