# PyWebView + SQLite

A minimal, complete example of building a **desktop app** with pywebview (native window) + SQLite (database) + vanilla JavaScript (frontend).

No Flask. No HTTP server. No build step. Just Python + HTML/CSS/JS.

[![Python 3.8+](https://img.shields.io/badge/Python-3.8%2B-blue)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## Quick Start

### Requirements
- **Python 3.8+**
- *(Linux only)* GTK + WebKit2 system packages (see [Linux setup](#linux-setup) below)

### Run it
```bash
python main.py
```

**That's it.** Dependencies auto-install on first run, then the app launches. Add/check/delete todos — they persist to a SQLite database automatically.

*(Optional: use a venv first if you prefer dependency isolation)*
```bash
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
python main.py
```

---

## Project Structure

```
pywebview-sqlite-app/
├── main.py                       # Entry point (auto-installs deps + launches window)
├── requirements.txt              # Just pywebview (+ gtk on Linux)
├── backend/
│   ├── __init__.py
│   ├── api.py                    # Python methods exposed to JavaScript
│   └── database.py               # SQLite: tables, CRUD queries
├── frontend/
│   ├── index.html                # HTML layout
│   ├── css/style.css             # Styling
│   ├── js/app.js                 # App orchestration; calls API methods
│   └── components/todo-item.js   # Reusable todo-row component
├── data/
│   └── app.db                    # SQLite database (auto-created)
└── README.md                     # This file
```

---

## How It Works

```
┌─────────────────────────────────────────┐
│  Native Desktop Window (pywebview)      │
├─────────────────────────────────────────┤
│  HTML / CSS / JavaScript (frontend/)    │
│                                         │
│  window.pywebview.api.add_todo(text)    │
│  ──────────────────────────────→        │
├─────────────────────────────────────────┤
│  Python (backend/)                      │
│                                         │
│  Api.add_todo() → database.create_todo()│
│  ──→ INSERT into SQLite                 │
└─────────────────────────────────────────┘
```

1. **main.py** launches a native window (Edge on Windows, WebKit on macOS, GTK on Linux) pointing to `frontend/index.html`.

2. **Frontend** (JavaScript) calls Python methods via `window.pywebview.api.method_name()`.
   - Calls are async — always `await` them.
   - pywebview handles serialization automatically.

3. **Backend** (Python) exposes methods via the `Api` class:
   ```python
   class Api:
       def add_todo(self, text):           # Called from JS
           return database.create_todo(text)
       
       def list_todos(self):
           return database.get_all_todos()
       
       def toggle_todo(self, todo_id):
           return database.toggle_todo(todo_id)
       
       def delete_todo(self, todo_id):
           database.delete_todo(todo_id)
   ```

4. **Database** (SQLite) persists everything — lives in `data/app.db`, survives restarts.

### Why No HTTP Server?

pywebview's **Expose Python to JS** feature eliminates the need for:
- ❌ Flask / FastAPI / any web framework
- ❌ HTTP request/response boilerplate
- ❌ JSON serialization hassles
- ❌ CORS issues
- ❌ Running a separate web server

Just call Python functions directly from JavaScript. They run in the same process.

---

## Extending It

### Add a New Table

1. **backend/database.py** — add schema + functions:
   ```python
   def init_db():
       # ... existing code ...
       c.execute("""
           CREATE TABLE IF NOT EXISTS notes (
               id INTEGER PRIMARY KEY,
               title TEXT,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )
       """)
       conn.commit()
   
   def create_note(title):
       conn = sqlite3.connect(DB_PATH)
       c = conn.cursor()
       c.execute("INSERT INTO notes (title) VALUES (?)", (title,))
       conn.commit()
       note_id = c.lastrowid
       conn.close()
       return {"id": note_id, "title": title}
   ```

2. **backend/api.py** — expose to JavaScript:
   ```python
   def add_note(self, title):
       return database.create_note(title)
   ```

3. **frontend/js/app.js** — call it:
   ```javascript
   const note = await window.pywebview.api.add_note("My note");
   console.log(note);  // {id: 1, title: "My note"}
   ```

### Multiple Views / Pages

pywebview shows one URL per window. For multi-view apps, either:

- **Single-page app style** (recommended): Keep one `index.html`, swap content with JavaScript.
  ```javascript
  // In app.js
  function showTodos() {
      document.getElementById("app").innerHTML = todosHTML;
  }
  function showNotes() {
      document.getElementById("app").innerHTML = notesHTML;
  }
  ```

- **Multi-window**: Open additional windows with `window.pywebview.api.open_new_window()` (if you add that method to Api).

### Package as Standalone Executable

Use [PyInstaller](https://pyinstaller.org/):

```bash
pip install pyinstaller
pyinstaller --onefile --windowed --add-data "frontend:frontend" main.py
```

Output `.exe` / `.app` / binary goes to `dist/`. Users can run it without Python installed.

---

## Linux Setup

**Windows** and **macOS** users can skip this — they use the OS's built-in web view.

**Linux** needs GTK + WebKit2 system libraries (not Python packages, system libraries):

### Ubuntu / Debian
```bash
sudo apt update
sudo apt install python3-gi python3-gi-cairo gir1.2-gtk-3.0 \
    gir1.2-webkit2-4.1 libgirepository1.0-dev libcairo2-dev
```

### Fedora / RHEL
```bash
sudo dnf install python3-gobject python3-cairo-devel gtk3 webkit2gtk4.1 \
    gobject-introspection-devel cairo-gobject-devel
```

### Arch / Manjaro
```bash
sudo pacman -S python-gobject python-cairo gtk3 webkit2gtk-4.1
```

**If GTK version mismatch:** older distros may have `gir1.2-webkit2-4.0` instead of `4.1` — adjust accordingly.

**Virtual environment note:** PyGObject binds to *system* GTK libraries. If `import gi` fails in your venv, recreate it with:
```bash
python -m venv venv --system-site-packages
```

Then just run:
```bash
python main.py
```

---

## Development

### Enable Debug Mode

Edit `main.py`, change:
```python
webview.start(debug=False, gui=gui)
```
to:
```python
webview.start(debug=True, gui=gui)
```

Now right-click in the app → **Inspect Element** to open dev tools. Changes persist until you revert.

### SQLite Best Practices

- **Always commit** after writes: `conn.commit()`
- **Batch inserts** for speed:
  ```python
  conn = sqlite3.connect(DB_PATH)
  c = conn.cursor()
  for item in items:
      c.execute("INSERT INTO todos (text) VALUES (?)", (item,))
  conn.commit()  # One commit for all
  conn.close()
  ```
- **Single-user only**: SQLite locks during writes — fine for desktop apps, not web servers.

### Performance

- **SQLite is good for:** Local apps, < 1 GB data, < 100 concurrent reads.
- **Swap to PostgreSQL if:** Multiple users, network access, > 1 GB data, or strict ACID requirements.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `ImportError: No module named 'webview'` | Run `python main.py` again (should auto-install) or manually `pip install -r requirements.txt` |
| Linux: `gi` import error | Install system packages (see [Linux setup](#linux-setup)), then `python -m venv venv --system-site-packages` |
| Linux: GTK/WebKit2 not found | Re-check distro install commands above; may need to adjust webkit version |
| Database says "locked" | SQLite doesn't support concurrent writes; serialize DB calls or use PostgreSQL |
| Changes don't save | Ensure `conn.commit()` is called after writes in `database.py` |

---

## Deployment

### Windows / macOS

Package with PyInstaller (see [above](#package-as-standalone-executable)), distribute the `.exe` or `.app` to users.

### Linux

Package with PyInstaller, or create a snap/AppImage for easier distribution.

### Docker

For testing in CI/CD:
```dockerfile
FROM python:3.11
RUN apt update && apt install -y libgtk-3-0 libwebkit2gtk-4.0-37
COPY . /app
WORKDIR /app
CMD ["python", "main.py"]
```

---

## What's Next?

- **Real app?** Swap the Todo schema for your actual data model; extend `database.py` and `api.py`.
- **Authentication?** Add a login UI in `frontend/`, validate in `api.py` before returning data.
- **File picker?** Use `tkinter` + `pywebview` together, or trigger file dialogs from JS.
- **Notifications?** Show OS notifications with `plyer` library + pywebview.

---

## License

MIT — use this as a template for any project.

---

## Links

- [pywebview documentation](https://pywebview.kivy.org/)
- [Python sqlite3 docs](https://docs.python.org/3/library/sqlite3.html)
- [PyInstaller](https://pyinstaller.org/)
- [Expose Python to JS example](https://pywebview.kivy.org/latest/examples/expose_python_api.html)

---

**Questions?** Open an issue or check the pywebview docs.
