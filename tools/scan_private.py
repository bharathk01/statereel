"""Pre-publish scan: find secrets and private project data before anything goes public.

Built-in patterns cover common credentials. Project-specific terms (client names, internal
IDs) go in .private-patterns, one regex per line. That file is gitignored, so the list of
what you are hiding never gets published itself.

Run: python tools/scan_private.py     exit code 1 when anything is found
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKIP_DIRS = {".git", "backups", "node_modules", "__pycache__", "_site", "test-results"}
SKIP_FILES = {".private-patterns", "scan_private.py"}   # the pattern list would match itself
TEXT_EXT = {".html", ".md", ".js", ".py", ".json", ".log", ".yml", ".yaml", ".txt", ".sh", ".toml", ".cfg", ""}

BUILTIN = [
    ("OpenAI/Anthropic-style API key", r"\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}"),
    ("AWS access key", r"\bAKIA[0-9A-Z]{16}\b"),
    ("GitHub token", r"\b(?:ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}"),
    ("Google API key", r"\bAIza[0-9A-Za-z_-]{35}\b"),
    ("Slack token", r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    ("private key block", r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    ("bearer token", r"\bBearer\s+[A-Za-z0-9._~+/-]{24,}"),
    ("Azure storage account", r"\b(?!example\b)[a-z0-9]{3,24}\.(?:blob|queue|table|file)\.core\.windows\.net"),
    ("Azure key / SAS", r"AccountKey=|SharedAccessSignature=|[?&]sig=[A-Za-z0-9%]{20,}"),
    ("email address", r"\b[A-Za-z0-9._%+-]+@(?!example\.(?:com|org))(?!anthropic\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
]


def load_private():
    f = ROOT / ".private-patterns"
    if not f.exists():
        return []
    out = []
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            out.append(("private term", line))
    return out


def files():
    for p in ROOT.rglob("*"):
        if p.is_file() and not (set(p.relative_to(ROOT).parts) & SKIP_DIRS) and p.name not in SKIP_FILES \
                and p.suffix.lower() in TEXT_EXT:
            yield p


def mask(s):
    # show enough to locate the hit without reprinting the secret in CI logs
    return s if len(s) <= 8 else s[:4] + "…" + s[-2:]


def main():
    patterns = [(name, re.compile(rx)) for name, rx in BUILTIN + load_private()]
    hits = 0
    for path in sorted(files()):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            for name, rx in patterns:
                for m in rx.finditer(line):
                    hits += 1
                    if hits <= 200:
                        print(f"{path.relative_to(ROOT)}:{lineno}: {name}: {mask(m.group(0))}")
    private = "yes" if (ROOT / ".private-patterns").exists() else "no (.private-patterns not found)"
    print(f"\n{hits} finding(s). Project-specific terms checked: {private}")
    sys.exit(1 if hits else 0)


if __name__ == "__main__":
    main()
