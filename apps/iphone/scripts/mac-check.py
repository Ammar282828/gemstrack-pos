#!/usr/bin/env python3
"""The checks a Mac change needs before it goes to Xcode Cloud, the only compiler (Mac/MAC-CONVENTIONS.md, "Done means").

1. The iPhone is untouched: each changed file's iPhone view (its `#if os(macOS)` branches stripped, its `#else` and
   `#if !os(macOS)` branches kept) is the same as the base's, blank lines and spacing aside.
2. No modifier dangles after `#endif`: when the line after an `#endif` starts with `.`, every branch must itself open with
   a `.` modifier; a branch that opens with a whole view leaves the modifier as a statement of its own ("Reference to
   member … cannot be resolved without a contextual type", which `swiftc -parse` does not catch).
3. `swiftc -parse` on each changed file, where swiftc is installed (/opt/swift/usr/bin in the cloud).

    python3 apps/iphone/scripts/mac-check.py            # files changed against origin/main, committed or not
    python3 apps/iphone/scripts/mac-check.py --base HEAD apps/iphone/App/Screens/Sale/NewSale.swift
"""
import argparse, difflib, os, re, shutil, subprocess, sys

ROOT = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
IPHONE = {"os(macOS)": False, "!os(macOS)": True, "os(iOS)": True, "!os(iOS)": False,
          "canImport(UIKit)": True, "canImport(AppKit)": False}


def iphone_view(text):
    """The lines the iPhone compiles."""
    out, stack, active = [], [], True
    for line in text.split("\n"):
        t = line.strip()
        if t.startswith("#if "):
            c = IPHONE.get(t[4:].strip())
            if c is None:  # a condition both platforms share: keep both sides as text
                stack.append((active, False, None)); continue
            stack.append((active, c and active, c)); active = active and c; continue
        if t.startswith("#elseif ") or t == "#else":
            parent, taken, cond = stack[-1]
            if cond is None: continue
            now = parent and not taken and (t == "#else" or IPHONE.get(t[8:].strip(), False))
            stack[-1] = (parent, taken or now, cond); active = now; continue
        if t == "#endif":
            parent, _, _ = stack.pop(); active = parent; continue
        if active:
            # `.trailingAction` is `.primaryAction` on the iPhone (App/Platform/ToolbarPlacements.swift).
            s = re.sub(r"\s+", " ", t).replace("placement: .trailingAction", "placement: .primaryAction")
            if s and not s.startswith("//"): out.append(s)
    return out


def dangling(path, lines):
    found = []
    for i, line in enumerate(lines):
        if line.strip() != "#endif" or i + 1 >= len(lines) or not lines[i + 1].strip().startswith("."):
            continue
        depth, j, firsts, first = 0, i - 1, [], None
        while j >= 0:
            t = lines[j].strip()
            if t == "#endif": depth += 1
            elif t.startswith("#if "):
                if depth == 0: firsts.append(first); break
                depth -= 1
            elif depth == 0 and (t == "#else" or t.startswith("#elseif")):
                firsts.append(first); first = None
            elif depth == 0 and t and not t.startswith("//"):
                first = t
            j -= 1
        if any(f is not None and not f.startswith(".") for f in firsts):
            found.append(f"{path}:{i + 2}: '{lines[i + 1].strip()[:50]}' after #endif, but a branch opens with a whole view")
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="origin/main")
    ap.add_argument("files", nargs="*")
    a = ap.parse_args()
    files = a.files or subprocess.run(["git", "diff", "--name-only", a.base, "--", "apps/iphone"],
                                      capture_output=True, text=True, cwd=ROOT).stdout.split()
    files = [os.path.relpath(os.path.abspath(f), ROOT) if os.path.exists(f) else f for f in files]
    files = [f for f in files if f.endswith(".swift") and os.path.exists(os.path.join(ROOT, f))]
    swiftc = shutil.which("swiftc") or ("/opt/swift/usr/bin/swiftc" if os.path.exists("/opt/swift/usr/bin/swiftc") else None)
    problems = []
    for f in files:
        text = open(os.path.join(ROOT, f)).read()
        old = subprocess.run(["git", "show", f"{a.base}:{f}"], capture_output=True, text=True, cwd=ROOT)
        if old.returncode == 0 and not f.startswith(("apps/iphone/Mac/", "apps/iphone/MacTests/", "apps/iphone/MacUITests/")):
            diff = list(difflib.unified_diff(iphone_view(old.stdout), iphone_view(text), lineterm="", n=0))
            if diff:
                problems.append(f"{f}: the iPhone's code changed:\n  " + "\n  ".join(diff[2:12]))
        problems += dangling(f, text.split("\n"))
        if swiftc:
            r = subprocess.run([swiftc, "-parse", os.path.join(ROOT, f)], capture_output=True, text=True)
            if r.returncode != 0:
                problems.append(f"{f}: swiftc -parse failed:\n  " + r.stderr.strip()[:600])
    print(f"{len(files)} files checked against {a.base}" + ("" if swiftc else " (no swiftc: parse skipped)"))
    for p in problems: print(p)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
