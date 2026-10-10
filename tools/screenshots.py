"""Regenerate the README screenshots in docs/ from publishable built-in samples.

Run: python tools/screenshots.py
Uses only the real deepagents capture and the fictional framework samples, never private logs.
"""
import pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
VIEWER = ROOT / "statereel.html"
DOCS = ROOT / "docs"

SHOTS = [
    # (sample, tab, file, prices to type so the cost tile is filled)
    ("deepagents", "overview", "overview.png", {"input": "1.25", "cached": "0.125", "output": "10"}),
    ("deepagents", "flow", "flow.png", None),
    ("deepagents", "timeline", "timeline.png", None),
    ("crewai", "flow", "crewai-flow.png", None),
]


def main():
    DOCS.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 920}, device_scale_factor=1)
        page.goto(VIEWER.as_uri())
        page.evaluate("localStorage.clear()")
        for sample, tab, name, prices in SHOTS:
            if page.is_visible("#btnInput") and not page.is_visible("#inputPanel"):
                page.click("#btnInput")
            page.select_option("#sampleSel", sample)
            page.wait_for_selector("#tabs:not([hidden])")
            page.click(f'.tab[data-view="{tab}"]')
            if prices:
                for field, value in prices.items():
                    page.locator(f"#pricing input[data-field={field}]").first.fill(value)
            page.wait_for_timeout(250)
            page.screenshot(path=str(DOCS / name))
            print("wrote", (DOCS / name).relative_to(ROOT))
        page.evaluate("localStorage.clear()")
        browser.close()


if __name__ == "__main__":
    main()
