"""
main.py
-------
Entry point. Run with:  python main.py

This creates the native desktop window, points it at frontend/index.html,
and exposes the Api class so JS can call Python functions directly
(no HTTP server, no Flask needed).

Linux notes
-----------
pywebview needs a web-rendering backend to draw the window. On Windows/macOS
this is built into the OS (Edge WebView2 / WKWebView) automatically. On
Linux this project uses the GTK + WebKit2 backend (no Qt/PyQt involved) —
see the "Linux setup" section of README.md for the exact system packages
to install for your distro.

You normally don't need to touch anything below — GTK is selected
automatically on Linux. If you ever need to override it (e.g. you've
installed an alternative backend), you can with:
    PYWEBVIEW_GUI=cef python main.py
"""

import os
import platform
import subprocess
import sys

from backend.api import Api
from backend.database import init_db

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")
INDEX_FILE = os.path.join(FRONTEND_DIR, "index.html")


def auto_install_requirements():
    """
    Check if requirements are installed; if not, run pip install automatically.
    This way users can just run 'python main.py' without manual venv setup.
    """
    try:
        import webview
        return True  # requirements already installed
    except ImportError:
        pass

    req_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "requirements.txt")
    if not os.path.exists(req_file):
        sys.exit("ERROR: requirements.txt not found.")

    print("Installing requirements from requirements.txt...")
    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-r", req_file])
        print("✓ Requirements installed successfully.")
        return True
    except subprocess.CalledProcessError as e:
        sys.exit(f"ERROR: pip install failed: {e}")


def resolve_gui_backend():
    """
    Decide which pywebview rendering backend to use.

    - Respects PYWEBVIEW_GUI env var if the user explicitly sets one.
    - Otherwise defaults to 'gtk' on Linux (so pywebview never tries to
      fall back to importing PyQt, which we deliberately don't use/install).
    - Returns None on Windows/macOS so pywebview uses the native OS backend.
    """
    env_choice = os.environ.get("PYWEBVIEW_GUI")
    if env_choice:
        return env_choice
    if platform.system() == "Linux":
        return "gtk"
    return None


def main():
    # Auto-install requirements if not already present
    auto_install_requirements()

    gui = resolve_gui_backend()

    try:
        import webview
    except ImportError:
        sys.exit(
            "ERROR: the 'pywebview' package isn't installed.\n"
            "Run: pip install -r requirements.txt"
        )

    init_db()  # make sure the sqlite tables exist before the UI loads

    api = Api()

    webview.create_window(
        title="PyWebView + SQLite Todo",
        url=INDEX_FILE,
        js_api=api,
        width=900,
        height=650,
        min_size=(500, 400),
    )

    try:
        # debug=True gives you right-click "Inspect Element" dev tools while developing
        webview.start(debug=True, gui=gui)
    except Exception as exc:
        sys.exit(
            "ERROR: pywebview couldn't start the GTK rendering backend "
            f"({exc}).\n\n"
            "On Linux this usually means the GTK/WebKit2 system packages "
            "aren't installed yet. See the 'Linux setup' section of README.md "
            "for the exact apt/dnf/pacman command for your distro, then "
            "re-run: python main.py"
        )


if __name__ == "__main__":
    main()
