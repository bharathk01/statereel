"""Capture real Google ADK event output (a scripted BaseLlm, no API key).

Run: python tools/capture/google_adk_capture.py  ->  tests/fixtures/real/google_adk/
"""
import asyncio
import json

from google.adk.agents import LlmAgent
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.runners import InMemoryRunner
from google.genai import types

from _common import CALLS, FINAL, PROMPT, REAL, SYSTEM, capture, weather, write_manifest

OUT = REAL / "google_adk"
USAGE = [(410, 36), (520, 21)]


class ScriptedLlm(BaseLlm):
    """Fake Gemini: asks for both cities, then answers once the function responses are in."""
    model: str = "scripted-fake-model"

    async def generate_content_async(self, llm_request, stream=False):
        answered = any(p.function_response for c in llm_request.contents for p in (c.parts or []))
        i = 1 if answered else 0
        usage = types.GenerateContentResponseUsageMetadata(
            prompt_token_count=USAGE[i][0], candidates_token_count=USAGE[i][1], total_token_count=sum(USAGE[i]))
        if not answered:
            parts = [types.Part(function_call=types.FunctionCall(id=cid, name="get_weather", args={"city": city}))
                     for cid, city in CALLS]
        else:
            parts = [types.Part(text=FINAL)]
        yield LlmResponse(content=types.Content(role="model", parts=parts), usage_metadata=usage)


def get_weather(city: str) -> dict:
    """Return the current weather for a city."""
    return json.loads(weather(city))


async def events():
    """Run once; return the streamed events and the full session history (incl. the user turn)."""
    agent = LlmAgent(name="weather_agent", model=ScriptedLlm(), tools=[get_weather], instruction=SYSTEM)
    runner = InMemoryRunner(agent=agent, app_name="weather_app")
    session = await runner.session_service.create_session(app_name="weather_app", user_id="u1")
    msg = types.Content(role="user", parts=[types.Part(text=PROMPT)])
    streamed = [ev async for ev in runner.run_async(user_id="u1", session_id=session.id, new_message=msg)]
    done = await runner.session_service.get_session(app_name="weather_app", user_id="u1", session_id=session.id)
    return streamed, done.events


if __name__ == "__main__":
    streamed, history = asyncio.run(events())
    tokens = {"input_tokens": sum(u[0] for u in USAGE), "output_tokens": sum(u[1] for u in USAGE)}
    base = {"tool_calls": 2, "paired": 2, "tool_errors": 1, "model_calls": 2, **tokens}
    print("google_adk:")
    capture(OUT, "print_event", lambda: [print(e) for e in streamed])            # str(): pydantic's field=value form
    capture(OUT, "repr_event", lambda: [print(repr(e)) for e in streamed])       # Event(...) form
    capture(OUT, "event_json", lambda: [print(e.model_dump_json(exclude_none=True)) for e in streamed])
    capture(OUT, "session_events", lambda: [print(repr(e)) for e in history])
    write_manifest(OUT, "google_adk", "Google ADK", ["google-adk", "google-genai"], {
        "print_event.log": {"adapter": "pydantic-str", **base, "user_prompt": False},
        "repr_event.log": {"adapter": "repr-stream", **base, "user_prompt": False},
        "event_json.log": {"adapter": "ndjson-events", **base, "user_prompt": False},
        "session_events.log": {"adapter": "repr-stream", **base, "user_prompt": True},
    }, "tools/capture/google_adk_capture.py (scripted BaseLlm, no API key)")
