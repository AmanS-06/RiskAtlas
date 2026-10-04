"""Check that relative links and images in the Markdown files resolve, including #anchors.

    python docs/build/check_links.py [file.md ...]     # default: README.md, ASSETS_AND_LICENSES.md and docs/*.md

External (http, https, mailto) links are not fetched. Anchors are checked against GitHub-style heading slugs.
Exit status 1 if anything is broken.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LINK = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
FENCE = re.compile(r"^```.*?^```", re.S | re.M)


def slug(heading: str) -> str:
    h = re.sub(r"<[^>]+>", "", heading).strip().lower()
    h = re.sub(r"[`*_]", "", h)
    h = re.sub(r"[^\w\- ]", "", h)
    return h.replace(" ", "-")


def anchors(path: Path) -> set:
    text = FENCE.sub("", path.read_text(encoding="utf-8"))
    return {slug(m.group(1)) for m in re.finditer(r"^#{1,6}\s+(.*)$", text, re.M)}


def main(files) -> int:
    bad = 0
    for f in files:
        text = FENCE.sub("", f.read_text(encoding="utf-8"))
        for m in LINK.finditer(text):
            target = m.group(1)
            if re.match(r"^(https?:|mailto:)", target):
                continue
            path, _, frag = target.partition("#")
            dest = (f.parent / path).resolve() if path else f
            if not dest.exists():
                print(f"{f.relative_to(ROOT)}: broken link -> {target}")
                bad += 1
            elif frag and dest.suffix == ".md" and slug(frag) not in anchors(dest):
                print(f"{f.relative_to(ROOT)}: missing anchor -> {target}")
                bad += 1
    print("links OK" if not bad else f"{bad} broken link(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    args = [Path(a).resolve() for a in sys.argv[1:]]
    files = args or [ROOT / "README.md", ROOT / "ASSETS_AND_LICENSES.md", *sorted((ROOT / "docs").glob("*.md"))]
    sys.exit(main(files))
