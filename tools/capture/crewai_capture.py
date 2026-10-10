"""Capture real CrewAI verbose output (a scripted BaseLLM, no API key).

CrewAI needs its own environment (its pins clash with Google ADK's), e.g.:
    PYENV_VERSION=statereel-crewai python tools/capture/crewai_capture.py
Each print style runs in a subprocess, because CrewAI's rich console binds to the real
stdout and colour depends on the environment.  ->  tests/fixtures/real/crewai/
"""
import os
import subprocess
import sys

os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "true")
os.environ.setdefault("OTEL_SDK_DISABLED", "true")
os.environ.setdefault("CREWAI_TRACING_ENABLED", "false")

import sqlite3

if sqlite3.sqlite_version_info < (3, 35, 0):
    # Chroma (a CrewAI dependency) needs SQLite >= 3.35; older distros (Ubuntu 20.04) ship 3.31
    import pysqlite3
    sys.modules["sqlite3"] = pysqlite3

from _common import FINAL, PROMPT, REAL, weather, write_manifest

OUT = REAL / "crewai"


def build_and_run(verbose):
    from crewai import Agent, BaseLLM, Crew, Task
    from crewai.tools import tool

    class ScriptedLLM(BaseLLM):
        """Fake model speaking CrewAI's ReAct text protocol: Paris, then Atlantis, then answer."""

        def __init__(self):
            super().__init__(model="scripted-fake-model")
            self._turn = 0

        def call(self, messages, tools=None, callbacks=None, available_functions=None, **kwargs):
            replies = [
                'Thought: I need the weather for both cities, starting with Paris.\n'
                'Action: get_weather\nAction Input: {"city": "Paris"}',
                'Thought: Now Atlantis.\nAction: get_weather\nAction Input: {"city": "Atlantis"}',
                "Thought: I now know the final answer\nFinal Answer: " + FINAL,
            ]
            reply = replies[min(self._turn, len(replies) - 1)]
            self._turn += 1
            return reply

        def supports_function_calling(self):
            return False

        def supports_stop_words(self):
            return False

        def get_context_window_size(self):
            return 128000

    @tool("get_weather")
    def get_weather(city: str) -> str:
        """Return the current weather for a city."""
        return weather(city)

    analyst = Agent(role="Weather Analyst", goal="Report the weather accurately",
                    backstory="You check weather stations for travellers.", llm=ScriptedLLM(),
                    tools=[get_weather], verbose=verbose, allow_delegation=False)
    task = Task(description=PROMPT, expected_output="One line covering both cities.", agent=analyst)
    return Crew(agents=[analyst], tasks=[task], verbose=verbose).kickoff()


def child(style):
    build_and_run(verbose=True)


def capture_style(style, extra_env):
    env = {**os.environ, **extra_env}
    proc = subprocess.run([sys.executable, __file__, "--child", style], env=env,
                          capture_output=True, text=True, timeout=300)
    if proc.returncode != 0:
        raise SystemExit(f"{style} failed:\n{proc.stderr[-2000:]}")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{style}.log").write_text(proc.stdout, encoding="utf-8")
    print(f"  {style:<22} {len(proc.stdout):>7} bytes")


if __name__ == "__main__":
    if "--child" in sys.argv:
        child(sys.argv[sys.argv.index("--child") + 1])
        sys.exit(0)
    print("crewai:")
    capture_style("verbose_plain", {"NO_COLOR": "1", "TERM": "dumb"})
    capture_style("verbose_ansi", {"FORCE_COLOR": "1", "TERM": "xterm-256color", "COLUMNS": "120"})
    base = {"tool_calls": 2, "paired": 2, "tool_errors": 1, "model_calls": 3, "user_prompt": True}
    write_manifest(OUT, "crewai", "CrewAI", ["crewai"], {
        "verbose_plain.log": {"adapter": "crewai-console", **base},
        "verbose_ansi.log": {"adapter": "crewai-console", **base},
    }, "tools/capture/crewai_capture.py (scripted BaseLLM, no API key)",
        note="CrewAI's ReAct protocol calls tools one at a time, so this run makes 3 model calls")
