"""Shared scenario and helpers for the real-capture scripts.

Every framework runs the same story so the results are comparable: the user asks for the
weather in Paris and Atlantis, the model calls get_weather for both (Atlantis fails), then
answers. Models are scripted fakes, so no API key is needed and runs are reproducible.
"""
import asyncio
import contextlib
import datetime
import importlib.metadata as md
import inspect
import io
import json
import pathlib
import platform

ROOT = pathlib.Path(__file__).resolve().parents[2]
REAL = ROOT / "tests" / "fixtures" / "real"

PROMPT = "What's the weather in Paris and in Atlantis? Answer in one line."
SYSTEM = "You are a concise weather assistant."
FINAL = "Paris is 18C with light rain; there is no weather data for Atlantis."
CALLS = [("call_paris", "Paris"), ("call_atlantis", "Atlantis")]


def weather(city):
    """The tool every framework calls. Atlantis fails the way real tools usually do: as text."""
    if city == "Atlantis":
        return json.dumps({"error": f"no weather station found for {city}"})
    return json.dumps({"city": city, "temp_c": 18, "conditions": "light rain"})


def capture(out_dir, name, fn):
    """Run fn (sync or async) with stdout captured into <out_dir>/<name>.log."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        result = fn()
        if inspect.iscoroutine(result):
            asyncio.run(result)
    out_dir.mkdir(parents=True, exist_ok=True)
    text = buf.getvalue()
    (out_dir / f"{name}.log").write_text(text, encoding="utf-8")
    print(f"  {name:<22} {len(text):>7} bytes")
    return text


def write_manifest(out_dir, key, framework, packages, fixtures, generator, note=None):
    """Record exact versions and what the viewer must recover from each fixture."""
    manifest = {
        "key": key,
        "framework": framework,
        "versions": {p: md.version(p) for p in packages},
        "python": platform.python_version(),
        "captured_at": datetime.date.today().isoformat(),
        "generator": generator,
        "fixtures": fixtures,
    }
    if note:
        manifest["note"] = note
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("  manifest:", ", ".join(f"{k} {v}" for k, v in manifest["versions"].items()))
