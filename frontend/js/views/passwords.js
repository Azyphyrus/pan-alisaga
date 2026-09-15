/* Password Management.

   Three states: set up a vault, unlock it, or use it. The page never holds
   the master password beyond the call that uses it, and never receives a
   stored password until it explicitly asks for one entry.

   Anything typed or clicked pings the bridge so the auto-lock timer only
   fires during real inactivity. */
window.PA = window.PA || {};
PA.views = PA.views || {};

PA.views["password-manager"] = (function () {
    var PING_THROTTLE_MS = 20000;

    var root = null;
    var lockedHandler = null;
    var lastPing = 0;
    var state = {
        ready: false,
        exists: false,
        unlocked: false,
        // Placeholder only, replaced by status() with the real value from
        // config.VAULT_AUTOLOCK_MINUTES. Change the interval there, not here.
        autolock: 15,
        entries: [],
        filter: "",
        editing: null,      // entry being edited, {} for a new one
        revealed: {},       // id -> plaintext, cleared on lock
        message: "",
        pasteNote: "",
        error: ""
    };

    function escapeHtml(value) {
        return String(value === null || value === undefined ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function api() {
        return PA.bridge.get("vault");
    }

    function call(method, args, onDone) {
        var vault = api();
        if (!vault) {
            PA.bridge.onReady(function () {
                call(method, args, onDone);
            });
            return;
        }
        var callback = function (raw) {
            PA.bridge.unwrap(raw, function (data) {
                state.error = "";
                onDone(data);
            }, function (message) {
                state.error = message;
                // A locked vault invalidates everything on screen.
                if (/locked/i.test(message)) {
                    forgetSecrets();
                    state.unlocked = false;
                }
                render();
            });
        };
        if (args === null || args === undefined) {
            vault[method](callback);
        } else if (args.length === 2) {
            vault[method](args[0], args[1], callback);
        } else {
            vault[method](args, callback);
        }
    }

    function forgetSecrets() {
        state.revealed = {};
        state.editing = null;
        state.entries = [];
    }

    function ping() {
        var now = Date.now();
        if (!state.unlocked || now - lastPing < PING_THROTTLE_MS) {
            return;
        }
        lastPing = now;
        var vault = api();
        if (vault) {
            vault.ping(function () {});
        }
    }

    // --- data -----------------------------------------------------------
    function refreshStatus(then) {
        call("status", null, function (data) {
            state.ready = true;
            state.exists = data.exists;
            state.unlocked = data.unlocked;
            state.autolock = data.autolockMinutes;
            if (then) {
                then();
            } else {
                render();
            }
        });
    }

    function loadEntries() {
        call("list", null, function (items) {
            state.entries = items || [];
            render();
        });
    }

    function visibleEntries() {
        if (!state.filter) {
            return state.entries;
        }
        var needle = state.filter.toLowerCase();
        var out = [];
        for (var i = 0; i < state.entries.length; i++) {
            var entry = state.entries[i];
            if ((entry.title || "").toLowerCase().indexOf(needle) !== -1
                    || (entry.username || "").toLowerCase().indexOf(needle) !== -1
                    || (entry.url || "").toLowerCase().indexOf(needle) !== -1) {
                out.push(entry);
            }
        }
        return out;
    }

    // --- gate screens ----------------------------------------------------
    function setupMarkup() {
        return '<div class="vault-gate">'
            + '<form class="vault-gate__card card">'
            + '<h2 class="card__title">Create your vault</h2>'
            + '<p class="card__subtitle">One master password unlocks everything stored here.</p>'
            + (state.error ? '<p class="form-error">' + escapeHtml(state.error) + '</p>' : "")
            + '<label class="label" for="vMaster">Master password</label>'
            + '<input class="input" type="password" id="vMaster" autocomplete="new-password" />'
            + '<label class="label" for="vConfirm">Confirm</label>'
            + '<input class="input" type="password" id="vConfirm" autocomplete="new-password" />'
            + '<p class="vault-warn">There is no recovery. If you forget this password the'
            + ' stored secrets cannot be read again - not by this app, not by anyone.</p>'
            + '<div class="form-actions">'
            + '<button class="btn btn--primary" type="submit" data-action="create">Create vault</button>'
            + '</div></form></div>';
    }

    function unlockMarkup() {
        return '<div class="vault-gate">'
            + '<form class="vault-gate__card card">'
            + '<h2 class="card__title">Vault locked</h2>'
            + '<p class="card__subtitle">Enter your master password to continue.</p>'
            + (state.error ? '<p class="form-error">' + escapeHtml(state.error) + '</p>' : "")
            + '<label class="label" for="vMaster">Master password</label>'
            + '<input class="input" type="password" id="vMaster" autocomplete="current-password" />'
            + '<div class="form-actions">'
            + '<button class="btn btn--primary" type="submit" data-action="unlock">Unlock</button>'
            + '</div></form></div>';
    }

    // --- vault list -------------------------------------------------------
    function secretMarkup(shown) {
        var html = '<div class="cred__secret">' + escapeHtml(shown.secret) + '</div>';
        if (shown.fields && shown.fields.length) {
            html += '<dl class="cred__fields">';
            for (var i = 0; i < shown.fields.length; i++) {
                // A text marker, not a lock emoji: U+1F512 is outside the
                // BMP and returning it from JS to Python crashes the Qt
                // string marshalling, which makes this view untestable.
                html += '<dt>' + escapeHtml(shown.fields[i].label)
                    + (shown.fields[i].hidden ? ' <span class="cf-lock">hidden</span>' : "") + '</dt>'
                    + '<dd>' + escapeHtml(shown.fields[i].value) + '</dd>';
            }
            html += '</dl>';
        }
        return html;
    }

    function entryMarkup(entry) {
        var shown = state.revealed[entry.id];
        return '<li class="cred">'
            + '<div class="cred__main">'
            + '<div class="cred__title">' + escapeHtml(entry.title) + '</div>'
            + '<div class="cred__meta">'
            + (entry.username ? escapeHtml(entry.username) : '<span class="cred__empty">no username</span>')
            + (entry.url ? ' &middot; ' + escapeHtml(entry.url) : "")
            + (entry.field_count ? ' &middot; ' + entry.field_count
                + (entry.field_count === 1 ? ' field' : ' fields') : "")
            + '</div>'
            + (shown ? secretMarkup(shown) : "")
            + '</div>'
            + '<div class="cred__actions">'
            + '<button class="btn btn--ghost btn--sm" type="button" data-copy="' + entry.id + '">Copy</button>'
            + '<button class="btn btn--ghost btn--sm" type="button" data-reveal="' + entry.id + '">'
            + (shown ? "Hide" : "Show") + '</button>'
            + '<button class="btn btn--ghost btn--sm" type="button" data-edit="' + entry.id + '">Edit</button>'
            + '<button class="btn btn--ghost btn--sm" type="button" data-delete="' + entry.id + '">Delete</button>'
            + '</div></li>';
    }

    function listMarkup() {
        var items = visibleEntries();
        var html = '<div class="vault">'
            + '<div class="vault__bar">'
            + '<input class="input vault__search" id="vSearch" type="search" placeholder="Search"'
            + ' value="' + escapeHtml(state.filter) + '" />'
            + '<button class="btn btn--primary btn--sm" type="button" data-action="new">New entry</button>'
            + '<button class="btn btn--ghost btn--sm" type="button" data-action="lock">Lock</button>'
            + '</div>'
            + (state.message ? '<p class="vault-note">' + escapeHtml(state.message) + '</p>' : "")
            + (state.error ? '<p class="form-error">' + escapeHtml(state.error) + '</p>' : "");

        if (!state.entries.length) {
            html += '<div class="empty"><p class="empty__text">Nothing stored yet.</p></div>';
        } else if (!items.length) {
            html += '<div class="empty"><p class="empty__text">No entries match that search.</p></div>';
        } else {
            html += '<ul class="cred-list">';
            for (var i = 0; i < items.length; i++) {
                html += entryMarkup(items[i]);
            }
            html += '</ul>';
        }

        html += '<p class="vault-foot">Locks itself after ' + state.autolock
            + ' minutes of inactivity.</p></div>';
        return html;
    }

    function fieldRowMarkup(field, index) {
        var hidden = !!field.hidden;
        return '<div class="cf-row" data-field-row="' + index + '">'
            + '<input class="input cf-label" placeholder="Label" value="'
            + escapeHtml(field.label || "") + '" />'
            + '<input class="input cf-value" type="' + (hidden ? "password" : "text")
            + '" placeholder="Value" value="' + escapeHtml(field.value || "") + '" />'
            + '<label class="cf-hide" title="Mask this value">'
            + '<input type="checkbox" class="cf-hidden"' + (hidden ? " checked" : "") + ' />'
            + '<span>Hide</span></label>'
            + '<button class="btn btn--ghost btn--sm" type="button" data-remove-field="'
            + index + '" aria-label="Remove field">&times;</button>'
            + '</div>';
    }

    function customFieldsMarkup(fields) {
        var html = '<div class="cf-block">'
            + '<div class="cf-head"><span class="label">Custom fields</span>'
            + '<button class="btn btn--ghost btn--sm" type="button" data-action="add-field">Add field</button>'
            + '</div>';
        html += '<p class="cf-hint">Paste a block like <code>Host: db.example.com</code>'
            + ' anywhere in this form and the lines become fields automatically.</p>';
        if (state.pasteNote) {
            html += '<p class="cf-note">' + escapeHtml(state.pasteNote) + '</p>';
        }
        if (!fields.length) {
            html += '<p class="cf-empty">No custom fields yet.</p>';
        }
        for (var i = 0; i < fields.length; i++) {
            html += fieldRowMarkup(fields[i], i);
        }
        return html + '</div>';
    }

    /* Reading a row in or out of the list re-renders the dialog, which would
       throw away anything typed. Capture the form into state first. */
    function readFieldRows() {
        var rows = document.querySelectorAll(".cf-row");
        var out = [];
        for (var i = 0; i < rows.length; i++) {
            out.push({
                label: rows[i].querySelector(".cf-label").value,
                value: rows[i].querySelector(".cf-value").value,
                hidden: rows[i].querySelector(".cf-hidden").checked
            });
        }
        return out;
    }

    function captureForm() {
        if (!state.editing || !document.getElementById("cTitle")) {
            return;
        }
        state.editing.title = document.getElementById("cTitle").value;
        state.editing.username = document.getElementById("cUser").value;
        state.editing.secret = document.getElementById("cSecret").value;
        state.editing.url = document.getElementById("cUrl").value;
        state.editing.notes = document.getElementById("cNotes").value;
        state.editing.fields = readFieldRows();
    }

    function dialogMarkup() {
        var entry = state.editing || {};
        var isNew = !entry.id;
        return '<div class="modal" data-action="backdrop">'
            + '<form class="modal__card card" data-stop="1">'
            + '<div class="modal__head">'
            + '<h3 class="modal__title">' + (isNew ? "New entry" : "Edit entry") + '</h3>'
            + '<button class="modal__close" type="button" data-action="cancel" aria-label="Close">&times;</button>'
            + '</div>'
            + (state.error ? '<p class="form-error">' + escapeHtml(state.error) + '</p>' : "")
            + '<label class="label" for="cTitle">Name</label>'
            + '<input class="input" id="cTitle" value="' + escapeHtml(entry.title || "") + '" placeholder="GitHub" />'
            + '<label class="label" for="cUser">Username <span class="opt">optional</span></label>'
            + '<input class="input" id="cUser" value="' + escapeHtml(entry.username || "") + '"'
            + ' autocomplete="off" placeholder="Leave blank to store a password on its own" />'
            + '<label class="label" for="cSecret">Password</label>'
            + '<div class="pw-row">'
            + '<input class="input" id="cSecret" type="password" autocomplete="new-password"'
            + ' value="' + escapeHtml(entry.secret || "") + '"'
            + ' placeholder="' + (isNew ? "Required" : "Leave blank to keep the current one") + '" />'
            + '<button class="btn btn--ghost btn--sm" type="button" data-action="peek">Show</button>'
            + '<button class="btn btn--ghost btn--sm" type="button" data-action="generate">Generate</button>'
            + '</div>'
            + '<div class="pw-meter" id="cMeter"><span class="pw-meter__bar" style="width:0%"></span></div>'
            + '<div class="pw-meter__label" id="cMeterLabel"></div>'
            + '<label class="label" for="cUrl">Website <span class="opt">optional</span></label>'
            + '<input class="input" id="cUrl" value="' + escapeHtml(entry.url || "") + '" placeholder="https://" />'
            + '<label class="label" for="cNotes">Notes <span class="opt">optional</span></label>'
            + '<textarea class="input textarea" id="cNotes" rows="2">' + escapeHtml(entry.notes || "") + '</textarea>'
            + customFieldsMarkup(entry.fields || [])
            + '<div class="form-actions">'
            + '<button class="btn btn--primary" type="submit" data-action="save">' + (isNew ? "Add" : "Save") + '</button>'
            + '<button class="btn btn--ghost" type="button" data-action="cancel">Cancel</button>'
            + '</div></form></div>';
    }

    function render() {
        if (!root) {
            return;
        }
        var body;
        if (!state.ready) {
            body = '<div class="vault-gate"><p class="empty__text">Loading...</p></div>';
        } else if (!state.exists) {
            body = setupMarkup();
        } else if (!state.unlocked) {
            body = unlockMarkup();
        } else {
            body = listMarkup();
        }
        root.innerHTML = body + (state.editing ? dialogMarkup() : "");

        var focusId = state.editing ? "cTitle" : (!state.unlocked ? "vMaster" : null);
        if (focusId) {
            var node = document.getElementById(focusId);
            if (node) {
                node.focus();
            }
        }
        if (state.editing) {
            updateMeter();
        }
    }

    // --- strength meter ----------------------------------------------------
    function updateMeter() {
        var field = document.getElementById("cSecret");
        var bar = document.querySelector("#cMeter .pw-meter__bar");
        var label = document.getElementById("cMeterLabel");
        if (!field || !bar || !label) {
            return;
        }
        var vault = api();
        if (!vault) {
            return;
        }
        vault.rate(field.value, function (raw) {
            PA.bridge.unwrap(raw, function (data) {
                bar.style.width = (data.score * 25) + "%";
                bar.className = "pw-meter__bar is-score-" + data.score;
                label.textContent = field.value ? data.label : "";
            }, function () {});
        });
    }

    // --- actions ------------------------------------------------------------
    function doCreate() {
        var master = document.getElementById("vMaster").value;
        var confirm = document.getElementById("vConfirm").value;
        if (master !== confirm) {
            state.error = "The two passwords do not match.";
            return render();
        }
        call("create", master, function () {
            state.exists = true;
            state.unlocked = true;
            state.message = "";
            loadEntries();
        });
    }

    function doUnlock() {
        call("unlock", document.getElementById("vMaster").value, function () {
            state.unlocked = true;
            loadEntries();
        });
    }

    function doSave() {
        var payload = {
            id: (state.editing && state.editing.id) ? state.editing.id : null,
            title: document.getElementById("cTitle").value,
            username: document.getElementById("cUser").value,
            secret: document.getElementById("cSecret").value,
            url: document.getElementById("cUrl").value,
            notes: document.getElementById("cNotes").value,
            fields: readFieldRows()
        };
        call("save", JSON.stringify(payload), function () {
            state.editing = null;
            state.message = "";
            loadEntries();
        });
    }

    function doReveal(id) {
        if (state.revealed[id]) {
            delete state.revealed[id];
            return render();
        }
        call("reveal", parseInt(id, 10), function (data) {
            state.revealed[id] = { secret: data.secret, fields: data.fields || [] };
            render();
        });
    }

    function doEdit(id) {
        call("reveal", parseInt(id, 10), function (data) {
            var found = null;
            for (var i = 0; i < state.entries.length; i++) {
                if (String(state.entries[i].id) === String(id)) {
                    found = state.entries[i];
                }
            }
            state.editing = {
                id: parseInt(id, 10),
                title: found ? found.title : "",
                username: found ? found.username : "",
                url: found ? found.url : "",
                secret: data.secret,
                notes: data.notes,
                fields: data.fields || []
            };
            state.error = "";
            render();
        });
    }

    function onClick(event) {
        ping();
        var node = event.target;
        while (node && node !== root) {
            if (!node.getAttribute) {
                node = node.parentNode;
                continue;
            }
            var id = node.getAttribute("data-reveal");
            if (id) { return doReveal(id); }
            if (node.getAttribute("data-copy")) {
                return call("copy", parseInt(node.getAttribute("data-copy"), 10), function (data) {
                    state.message = "Password copied. The clipboard clears in "
                        + data.seconds + " seconds.";
                    render();
                });
            }
            if (node.getAttribute("data-edit")) { return doEdit(node.getAttribute("data-edit")); }
            if (node.getAttribute("data-delete")) {
                if (!window.confirm("Delete this entry? This cannot be undone.")) {
                    return;
                }
                return call("remove", parseInt(node.getAttribute("data-delete"), 10), function () {
                    state.message = "";
                    loadEntries();
                });
            }

            var action = node.getAttribute("data-action");
            if (action === "new") {
                state.editing = { fields: [] };
                state.error = "";
                state.pasteNote = "";
                return render();
            }
            if (action === "add-field") {
                captureForm();
                state.editing.fields = (state.editing.fields || []);
                state.editing.fields.push({ label: "", value: "", hidden: false });
                return render();
            }
            if (node.getAttribute("data-remove-field")) {
                var index = parseInt(node.getAttribute("data-remove-field"), 10);
                captureForm();
                state.editing.fields.splice(index, 1);
                return render();
            }
            if (action === "cancel" || action === "backdrop") {
                state.editing = null;
                state.error = "";
                return render();
            }
            if (action === "lock") {
                return call("lock", null, function () {
                    state.unlocked = false;
                    forgetSecrets();
                    state.message = "";
                    render();
                });
            }
            if (action === "peek") {
                var field = document.getElementById("cSecret");
                field.type = field.type === "password" ? "text" : "password";
                node.textContent = field.type === "password" ? "Show" : "Hide";
                return;
            }
            if (action === "generate") {
                return call("generate", JSON.stringify({ length: 20 }), function (data) {
                    var secret = document.getElementById("cSecret");
                    secret.value = data.password;
                    secret.type = "text";
                    updateMeter();
                });
            }
            if (node.getAttribute("data-stop")) {
                return;
            }
            node = node.parentNode;
        }
    }

    /* A pasted block only counts if it spans lines and at least one of them
       looks like "Label: value". Anything else pastes normally. */
    var FIELDISH_LINE = new RegExp(
        "^[ \\t>|*\\-]*[^\\n:=]{1,40}[:=][^\\n]*$", "m");

    function onPaste(event) {
        if (!state.editing) {
            return;
        }
        var clipboard = event.clipboardData || window.clipboardData;
        if (!clipboard) {
            return;
        }
        var text = clipboard.getData("text");
        if (!text || text.indexOf("\n") === -1 || !FIELDISH_LINE.test(text)) {
            return;     // ordinary paste
        }
        event.preventDefault();
        captureForm();
        call("parseFields", text, applyParsed);
    }

    function applyParsed(data) {
        var entry = state.editing;
        if (!entry) {
            return;
        }
        // Drop the blank rows the form leaves behind before appending.
        var kept = [];
        var existing = entry.fields || [];
        for (var i = 0; i < existing.length; i++) {
            if ((existing[i].label || "").trim() || (existing[i].value || "").trim()) {
                kept.push(existing[i]);
            }
        }
        entry.fields = kept.concat(data.fields || []);

        var filled = [];
        if (data.username) {
            if (!entry.username) {
                entry.username = data.username;
                filled.push("username");
            } else {
                entry.fields.push({ label: "Username", value: data.username, hidden: false });
            }
        }
        if (data.password) {
            if (!entry.secret) {
                entry.secret = data.password;
                filled.push("password");
            } else {
                entry.fields.push({ label: "Password", value: data.password, hidden: true });
            }
        }

        var count = (data.fields || []).length;
        state.pasteNote = "Added " + count + (count === 1 ? " field" : " fields")
            + (filled.length ? ", filled the " + filled.join(" and ") : "") + ".";
        render();
    }

    function onSubmit(event) {
        event.preventDefault();
        ping();
        if (state.editing) {
            return doSave();
        }
        if (!state.exists) {
            return doCreate();
        }
        return doUnlock();
    }

    function onInput(event) {
        ping();
        if (event.target.id === "vSearch") {
            state.filter = event.target.value;
            var focused = document.activeElement === event.target;
            var caret = event.target.selectionStart;
            render();
            if (focused) {
                var field = document.getElementById("vSearch");
                if (field) {
                    field.focus();
                    field.selectionStart = field.selectionEnd = caret;
                }
            }
        } else if (event.target.id === "cSecret") {
            updateMeter();
        } else if (event.target.className.indexOf("cf-hidden") !== -1) {
            var row = event.target.parentNode.parentNode;
            var value = row.querySelector(".cf-value");
            value.type = event.target.checked ? "password" : "text";
        }
    }

    function onKeydown(event) {
        if (event.key === "Escape" && state.editing) {
            state.editing = null;
            render();
        }
    }

    function mount(container) {
        root = container;
        root.addEventListener("click", onClick);
        root.addEventListener("submit", onSubmit);
        root.addEventListener("input", onInput);
        root.addEventListener("paste", onPaste);
        document.addEventListener("keydown", onKeydown);

        // The bridge tells us when the auto-lock fires so the UI can drop
        // anything it is showing.
        PA.bridge.onReady(function (objects) {
            if (objects.vault && !lockedHandler) {
                lockedHandler = function () {
                    state.unlocked = false;
                    forgetSecrets();
                    state.message = "Locked automatically after inactivity.";
                    render();
                };
                objects.vault.locked.connect(lockedHandler);
            }
        });

        state.ready = false;
        render();
        refreshStatus(function () {
            if (state.unlocked) {
                loadEntries();
            } else {
                render();
            }
        });
    }

    function unmount() {
        if (root) {
            root.removeEventListener("click", onClick);
            root.removeEventListener("submit", onSubmit);
            root.removeEventListener("input", onInput);
            root.removeEventListener("paste", onPaste);
        }
        document.removeEventListener("keydown", onKeydown);
        // Leaving the view should not leave plaintext in memory.
        forgetSecrets();
        state.message = "";
        state.error = "";
        root = null;
    }

    return { mount: mount, unmount: unmount };
})();
