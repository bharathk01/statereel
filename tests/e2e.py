"""Real-browser check of the viewer: every sample, every tab, no JS errors.

Run: python tests/e2e.py [--shots DIR]
Exits non-zero on any failure so CI can gate on it.
"""
import json
import pathlib
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
VIEWER = ROOT / "statereel.html"
REAL = ROOT / "tests" / "fixtures" / "real"
SHOTS = pathlib.Path(sys.argv[sys.argv.index("--shots") + 1]) if "--shots" in sys.argv else None

fails = 0


def check(cond, msg):
    global fails
    if not cond:
        fails += 1
    print(("PASS" if cond else "FAIL") + " - " + msg)


def load_text(page, text):
    """Paste a log the way a user would and build the report."""
    if page.is_visible("#btnInput"):
        page.click("#btnInput")
    page.fill("#src", text)
    page.click("#btnRender")
    page.wait_for_selector("#tabs:not([hidden])", timeout=15000)


def walk_tabs(page, label):
    """Visit each tab and assert it actually rendered content."""
    page.click('.tab[data-view="overview"]')
    check(page.locator("#kpisHealth .kpi").count() >= 3, f"{label}: overview KPI tiles rendered")
    check(page.locator("#insList li").count() >= 1, f"{label}: insights rendered")

    page.click('.tab[data-view="flow"]')
    check(page.locator("#fchain .fitem").count() >= 1, f"{label}: flow nodes rendered")

    page.click('.tab[data-view="timeline"]')
    check(page.locator("#timeline .card").count() >= 1, f"{label}: timeline cards rendered")

    page.click('.tab[data-view="tools"]')
    check(page.locator("#tt tbody tr").count() >= 1, f"{label}: tools table rendered")

    page.click('.tab[data-view="data"]')
    check("adapter used" in page.inner_text("#diagBody"), f"{label}: diagnostics rendered")
    page.click('.tab[data-view="overview"]')


def big_run(n_msgs, payload=2400):
    """A LangGraph-style log: one [values] snapshot holding n_msgs messages."""
    msgs = []
    for i in range(n_msgs):
        if i % 3 == 0:
            msgs.append(f"HumanMessage(content='request {i}', id='h{i}')")
        elif i % 3 == 1:
            msgs.append(f"AIMessage(content='', id='a{i}', tool_calls=[{{'name': 'lookup', 'args': {{'q': 'item {i}'}}, "
                        f"'id': 'c{i}', 'type': 'tool_call'}}], usage_metadata={{'input_tokens': {1000 + i}, 'output_tokens': 40}})")
        else:
            body = json.dumps({"result": "x" * payload, "row": i}).replace("\\", "\\\\").replace("'", "\\'")
            msgs.append(f"ToolMessage(content='{body}', name='lookup', id='t{i}', tool_call_id='c{i - 1}')")
    return "[values] {'messages': [" + ", ".join(msgs) + "]}\n"


def wait_parsed(page, timeout=60.0):
    """Poll for the 'Parsed ...' note. wait_for_function needs eval, which the page's CSP forbids."""
    end = time.time() + timeout
    while time.time() < end:
        if page.inner_text("#parseNote").startswith("Parsed"):
            return
        page.wait_for_timeout(50)
    raise TimeoutError("report never finished building")


def show_input(page):
    if page.is_visible("#btnInput") and not page.is_visible("#inputPanel"):
        page.click("#btnInput")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(VIEWER.as_uri())

        samples = page.eval_on_selector_all("#sampleSel option", "os => os.map(o => o.value).filter(Boolean)")
        check(len(samples) >= 7, f"sample picker lists {len(samples)} samples")

        for key in samples:
            if page.is_visible("#btnInput"):
                page.click("#btnInput")
            page.select_option("#sampleSel", key)
            page.wait_for_selector("#tabs:not([hidden])", timeout=15000)
            before = len(errors)
            walk_tabs(page, key)
            check(len(errors) == before, f"{key}: no JavaScript errors" + (f" -> {errors[before:]}" if len(errors) > before else ""))
            if SHOTS:
                SHOTS.mkdir(parents=True, exist_ok=True)
                for view in ("overview", "flow", "timeline"):
                    page.click(f'.tab[data-view="{view}"]')
                    page.screenshot(path=str(SHOTS / f"{key}-{view}.png"), full_page=False)
                page.click('.tab[data-view="overview"]')

        # ---- real framework captures pasted into the UI ----
        for log in sorted(REAL.glob("*/*.log")):
            before = len(errors)
            load_text(page, log.read_text(encoding="utf-8"))
            walk_tabs(page, f"real {log.parent.name}/{log.name}")
            check(len(errors) == before, f"real {log.name}: no JavaScript errors" + (f" -> {errors[before:]}" if len(errors) > before else ""))

        # ---- big run through "Open file": memory input, worker, progress, lazy cards ----
        tmp = pathlib.Path(tempfile.mkdtemp())
        big = tmp / "big-run.log"
        big.write_text(big_run(1800), encoding="utf-8")
        size_mb = big.stat().st_size / 1048576
        show_input(page)
        before = len(errors)
        page.evaluate("document.querySelector('#parseNote').textContent = ''")   # no stale note from the last run
        t0 = time.time()
        page.set_input_files("#fileInp", str(big))
        page.wait_for_selector("#tabs:not([hidden])", timeout=60000)
        wait_parsed(page)
        took = time.time() - t0
        note = page.inner_text("#parseNote")
        check("background worker" in note, f"big run ({size_mb:.1f} MB) parsed in the worker -> {note!r}")
        check(page.is_hidden("#progress"), "progress bar hidden once done")
        page.click("#btnInput")
        check(page.is_visible("#fileChip"), "big file shown as a file chip")
        check(page.input_value("#src") == "", "big file kept out of the textarea")
        page.click('.tab[data-view="timeline"]')
        total = page.locator("#timeline .card").count()
        built = page.evaluate("[...document.querySelectorAll('#timeline .card .cbody')].filter(b => b.childElementCount).length")
        check(page.evaluate("document.querySelector('#timeline').classList.contains('lazy')"), "timeline switched to lazy mode")
        check(total == 1800 and built < 200, f"lazy cards: {built} of {total} bodies built on first paint")
        last_key = page.evaluate("STATE.cards[STATE.cards.length - 1].dataset.key")
        page.evaluate(f"gotoStep({json.dumps(last_key)})")
        page.wait_for_timeout(300)
        check(page.evaluate("STATE.cards[STATE.cards.length - 1].querySelector('.cbody').childElementCount > 0"),
              "jumping to an unbuilt card builds it")
        check(len(errors) == before, "big run: no JavaScript errors" + (f" -> {errors[before:]}" if len(errors) > before else ""))
        check(size_mb > 1.0, f"big run is over the 1 MB memory threshold ({size_mb:.1f} MB)")
        print(f"      big run: {size_mb:.1f} MB, 1800 messages, ready in {took:.2f}s")

        # ---- a huge paste goes to memory, not into the textarea ----
        show_input(page)
        page.click("#fileChipClear")
        page.evaluate("""(t) => { const dt = new DataTransfer(); dt.setData('text/plain', t);
            document.querySelector('#src').dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true})); }""",
                      big.read_text(encoding="utf-8"))
        check(page.is_visible("#fileChip") and page.input_value("#src") == "", "huge paste stored in memory, textarea empty")

        # ---- pricing: enter prices once, cost shows up everywhere, and is remembered ----
        show_input(page)
        page.click("#fileChipClear")
        page.select_option("#sampleSel", "langgraph")
        page.wait_for_selector("#tabs:not([hidden])")
        page.click('.tab[data-view="overview"]')
        check(page.inner_text("#kpiCost") == "—", "cost tile empty before any price is entered")
        page.locator("#pricing input[data-field=input]").first.fill("1.25")
        page.locator("#pricing input[data-field=cached]").first.fill("0.125")
        page.locator("#pricing input[data-field=output]").first.fill("10")
        tile = page.inner_text("#kpiCost")
        total = page.evaluate("STATE.cost.total")
        per_call = page.evaluate("Object.values(STATE.cost.perCall).reduce((a, b) => a + b, 0)")
        check(tile.startswith("$") and total > 0, f"cost tile shows the estimate ({tile})")
        check(abs(per_call - total) < 1e-9, "per-call costs add up to the total")
        check(page.locator("#tchart .ccost").filter(has_text="$").count() >= 1, "token chart shows cost per call")
        check(page.locator("#insCost").count() == 1, "most-expensive-call insight added")
        page.reload()
        page.select_option("#sampleSel", "langgraph")
        page.wait_for_selector("#tabs:not([hidden])")
        check(page.inner_text("#kpiCost") == tile, "prices remembered across a reload")
        page.locator("#pricing input[data-field=output]").first.fill("1x")
        check(page.locator("#pricing input.bad").count() == 1, "non-numeric price is flagged, not used")
        if SHOTS:
            page.locator("#pricing input[data-field=output]").first.fill("10")
            page.screenshot(path=str(SHOTS / "pricing-overview.png"), full_page=True)

        # ---- privacy is enforced by the browser, not just promised ----
        page.select_option("#sampleSel", "deepagents") if page.is_visible("#sampleSel") else None
        blocked = page.evaluate("""async () => {
            const seen = new Promise(res => document.addEventListener('securitypolicyviolation',
                e => res(e.effectiveDirective), { once: true }));
            fetch('https://example.com/collect', { method: 'POST', body: 'log' }).catch(() => {});
            return await Promise.race([seen, new Promise(res => setTimeout(() => res('none'), 3000))]);
        }""")
        check(blocked == "connect-src", f"outbound network request blocked by CSP ({blocked})")
        errors[:] = [e for e in errors if "Content Security Policy" not in e and "example.com" not in e]
        if page.is_visible("#btnExport"):
            with page.expect_download() as dl:
                page.click("#btnExport")
            check(dl.value.suggested_filename == "agent-run.json", "Export JSON still downloads under the CSP")
        check(len(errors) == 0, "no CSP violations from the app itself" + (f" -> {errors}" if errors else ""))

        browser.close()
    print("\n" + (f"{fails} FAILURE(S)" if fails else "all e2e checks passed"))
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
