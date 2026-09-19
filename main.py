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
Linux this project uses the GTK + WebKit2 backend (no Qt/PyQt involved).

The GTK bindings (PyGObject / pycairo) are deliberately NOT installed via
pip here. They need to be compiled against your distro's own GTK/WebKit2
libraries, and pip trying to build them from source is slow and brittle
(it needs cairo-devel, gobject-introspection-devel, etc. as system -devel
packages, and it can end up rebuilding a binding your distro already
ships as a working prebuilt package). Instead, install them with your
system's package manager — see the "Linux setup" section of README.md —
and this script will detect and use them automatically.

You normally don't need to touch anything below — GTK is selected
automatically on Linux. If you ever need to override it (e.g. you've
installed an alternative backend), you can with:
    PYWEBVIEW_GUI=cef python main.py
"""

import json
import os
import platform
import subprocess
import sys

LINUX_GTK_INSTALL_HINT = """
ERROR: the GTK/WebKit2 Python bindings ('gi' / PyGObject) aren't available.

pywebview's Linux backend needs these installed as SYSTEM packages
(pip cannot reliably build them — see requirements.txt for why):

    Fedora:        sudo dnf install python3-gobject python3-cairo gtk3 webkit2gtk4.1
    Debian/Ubuntu: sudo apt install python3-gi python3-gi-cairo gir1.2-webkit2-4.1
    Arch:          sudo pacman -S python-gobject python-cairo gtk3 webkit2gtk

Install the command above for your distro, then re-run: python main.py
"""


def check_linux_gtk_bindings():
    """
    On Linux, verify the system-provided GTK bindings ('gi', i.e. PyGObject)
    are importable before we go any further. These must come from the
    distro's package manager, not pip, so we fail fast with clear
    instructions instead of letting pip attempt (and likely fail) a
    from-source build later.
    """
    if platform.system() != "Linux":
        return
    if os.environ.get("PYWEBVIEW_GUI") and os.environ["PYWEBVIEW_GUI"] != "gtk":
        return  # user opted into a non-GTK backend; not our concern here
    try:
        import gi  # noqa: F401
    except ImportError:
        sys.exit(LINUX_GTK_INSTALL_HINT)


# IMPORTANT: Auto-install requirements BEFORE importing any backend modules
# This prevents ModuleNotFoundError for dependencies like cryptography
def auto_install_requirements():
    """
    Check if requirements are installed; if not, run pip install automatically.
    This way users can just run 'python main.py' without manual venv setup.

    Note: requirements.txt intentionally excludes the GTK bindings
    (PyGObject/pycairo) on Linux — those are checked separately by
    check_linux_gtk_bindings() and must come from the system package
    manager, not pip.
    """
    try:
        import webview
        from cryptography.fernet import Fernet
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


# Check system GTK bindings first (Linux only) — fail fast with a clear
# message rather than letting a much later, more confusing error surface.
check_linux_gtk_bindings()

# Install requirements next, before any other imports
auto_install_requirements()

# Now safe to import backend modules
from backend.api import Api
from backend.database import init_db

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")
INDEX_FILE = os.path.join(FRONTEND_DIR, "index.html")


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

    window = webview.create_window(
        title="pan-alisaga",
        url=INDEX_FILE,
        js_api=api,
        width=900,
        height=650,
        min_size=(500, 400),
    )

    # Background reminder poller: pushes due calendar reminders into the page,
    # where the bridge turns them into calendar.reminderFired handlers.
    from backend.scheduler import ReminderScheduler

    def push_reminder(payload):
        try:
            window.evaluate_js(
                "window.__paReminder && window.__paReminder(%s)" % json.dumps(payload)
            )
        except Exception:
            pass  # window may be closing or not ready; the next tick retries

    scheduler = ReminderScheduler(push_reminder)
    scheduler.start()

    # private_mode=True (pywebview's default) disables persistent browser
    # storage. On Windows/WebView2 that still leaves window.localStorage
    # usable for the session; on Linux/WebKitGTK it goes further and the
    # local file:// page doesn't get a localStorage object at all (any
    # access throws "Can't find variable: localStorage"). Explicitly turn
    # private mode off and give WebKit a real place to persist storage.
    storage_dir = os.path.join(os.path.expanduser("~"), ".pan-alisaga", "webview")
    os.makedirs(storage_dir, exist_ok=True)

    try:
        # debug=True gives you right-click "Inspect Element" dev tools while developing
        webview.start(
            debug=True,  # on compilation: debug=False
            gui=gui,
            private_mode=False,
            storage_path=storage_dir,
        )
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