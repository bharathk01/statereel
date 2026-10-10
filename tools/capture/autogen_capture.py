"""Capture real AutoGen AgentChat output (ReplayChatCompletionClient, no API key).

Run: python tools/capture/autogen_capture.py  ->  tests/fixtures/real/autogen/
"""
import json

from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.ui import Console
from autogen_core import FunctionCall
from autogen_core.models import CreateResult, RequestUsage
from autogen_ext.models.replay import ReplayChatCompletionClient

from _common import CALLS, FINAL, PROMPT, REAL, SYSTEM, capture, weather, write_manifest

OUT = REAL / "autogen"
USAGE = [(420, 38), (540, 22)]   # (prompt, completion) tokens for the two model calls


def client():
    return ReplayChatCompletionClient(
        chat_completions=[
            CreateResult(finish_reason="function_calls", cached=False,
                         content=[FunctionCall(id=cid, name="get_weather", arguments=json.dumps({"city": city}))
                                  for cid, city in CALLS],
                         usage=RequestUsage(prompt_tokens=USAGE[0][0], completion_tokens=USAGE[0][1])),
            CreateResult(finish_reason="stop", cached=False, content=FINAL,
                         usage=RequestUsage(prompt_tokens=USAGE[1][0], completion_tokens=USAGE[1][1])),
        ],
        model_info={"vision": False, "function_calling": True, "json_output": False,
                    "family": "unknown", "structured_output": False},
    )


async def get_weather(city: str) -> str:
    """Return the current weather for a city."""
    return weather(city)


def agent():
    # reflect_on_tool_use: the model answers after the tools, like most production agents
    return AssistantAgent("weather_agent", model_client=client(), tools=[get_weather],
                          reflect_on_tool_use=True, system_message=SYSTEM)


async def run_console():
    await Console(agent().run_stream(task=PROMPT))


async def run_task_result():
    print(await agent().run(task=PROMPT))


async def run_stream_reprs():
    async for item in agent().run_stream(task=PROMPT):
        print(item)


if __name__ == "__main__":
    tokens = {"input_tokens": sum(u[0] for u in USAGE), "output_tokens": sum(u[1] for u in USAGE)}
    base = {"tool_calls": 2, "paired": 2, "tool_errors": 1, "model_calls": 2, "user_prompt": True}
    print("autogen:")
    capture(OUT, "console", run_console)
    capture(OUT, "task_result", run_task_result)
    capture(OUT, "stream_reprs", run_stream_reprs)
    write_manifest(OUT, "autogen", "Microsoft AutoGen", ["autogen-agentchat", "autogen-ext", "autogen-core"], {
        # Console() does not print token usage, so no token expectation there
        "console.log": {"adapter": "autogen-console", **base},
        "task_result.log": {"adapter": "pydantic-str", **base, **tokens},
        "stream_reprs.log": {"adapter": "pydantic-str", **base, **tokens},
    }, "tools/capture/autogen_capture.py (ReplayChatCompletionClient, no API key)")
