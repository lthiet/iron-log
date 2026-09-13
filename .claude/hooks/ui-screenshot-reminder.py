"""PostToolUse hook: after an edit to a file that can change what Iron Log renders,
inject a reminder to actually look at the app in both layouts before calling it done.

A hook cannot take the screenshot itself (it is a shell command, with no access to
the browser tools) -- it steers the model by adding context to the turn.
"""
import json
import os
import sys

UI_SUFFIXES = (".css", ".html", ".js", ".svg")
IGNORE = {"sw.js"}  # service worker: no rendered output of its own

REMINDER = """A UI-affecting file was just edited ({path}).

Before reporting this change as done, verify it visually:
1. Serve the app: `python -m http.server 8777` from the repo root, backgrounded.
2. Open http://localhost:8777/index.html in the Browser pane.
3. Screenshot BOTH layouts -- this app renders differently on each side of the
   1000px breakpoint: resize_window to 1440x900 (desktop dashboard) and to the
   mobile preset 375x812 (tabbed layout).
4. Actually look at both screenshots and confirm the change renders as intended.
5. Stop the server when finished.

If the change only shows with data present, seed it in memory via javascript_tool
(assign to `state` then call `render()`) rather than writing to IndexedDB.

Skip this only if the edit provably cannot affect rendering (a comment, a docstring).
If you skip it, say so explicitly instead of staying silent."""


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return

    tool_input = data.get("tool_input") or {}
    tool_response = data.get("tool_response") or {}
    path = tool_input.get("file_path") or tool_response.get("filePath") or ""
    if not path:
        return

    name = os.path.basename(path)
    if name in IGNORE or not name.lower().endswith(UI_SUFFIXES):
        return

    print(json.dumps({
        "suppressOutput": True,
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": REMINDER.format(path=name),
        },
    }))


if __name__ == "__main__":
    main()
