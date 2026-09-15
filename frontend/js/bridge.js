/* Bridge to the Python side — pywebview edition.

   The original app talked to Python over Qt's QWebChannel. This build runs on
   pywebview, where Python is reachable as window.pywebview.api.<method>(...)
   returning a Promise. This module rebuilds the exact PA.bridge surface the
   views expect (onReady/get/unwrap, a `vault` object, and `backend`
   helpers) on top of that flat API, so the original UI runs unchanged.

   The QWebChannel original is kept alongside as bridge.qwebchannel.js.bak. */
window.PA = window.PA || {};

PA.bridge = (function () {
    var objects = null;
    var waiting = [];
    var handlers = [];

    // Auto-lock: the page drops the vault key after this much inactivity. The
    // real value arrives from vault_status(); this is only a placeholder.
    var autolockMs = 15 * 60 * 1000;
    var autolockTimer = null;
    var unlocked = false;

    function api() {
        return (window.pywebview && window.pywebview.api) ? window.pywebview.api : null;
    }

    // --- vault auto-lock + clipboard ------------------------------------
    var lockedHandlers = [];

    function fireLocked() {
        for (var i = 0; i < lockedHandlers.length; i++) {
            lockedHandlers[i]();
        }
    }

    function stopAutolock() {
        if (autolockTimer) {
            clearTimeout(autolockTimer);
            autolockTimer = null;
        }
    }

    function armAutolock() {
        stopAutolock();
        if (!unlocked) {
            return;
        }
        autolockTimer = setTimeout(function () {
            var a = api();
            if (!a) { return; }
            a.vault_lock().then(function () {
                unlocked = false;
                fireLocked();
            });
        }, autolockMs);
    }

    /* Note the lock state carried in a response so the timer and the locked
       signal stay in step with Python. */
    function observe(raw) {
        try {
            var parsed = JSON.parse(raw);
            if (parsed && parsed.ok && parsed.data && typeof parsed.data === "object") {
                if (typeof parsed.data.unlocked === "boolean") {
                    unlocked = parsed.data.unlocked;
                }
                if (typeof parsed.data.autolockMinutes === "number") {
                    autolockMs = parsed.data.autolockMinutes * 60 * 1000;
                }
            }
        } catch (e) { /* leave raw untouched */ }
        return raw;
    }

    /* Wrap a pywebview call as  method(...args, callback)  returning the raw
       JSON envelope string, exactly like the old QWebChannel slots did. */
    function slot(name) {
        return function () {
            var args = Array.prototype.slice.call(arguments);
            var callback = args.pop();
            var a = api();
            if (!a || typeof a[name] !== "function") {
                callback(JSON.stringify({ ok: false, error: "Bridge not ready yet." }));
                return;
            }
            a[name].apply(a, args).then(function (raw) {
                observe(raw);
                armAutolock();
                callback(raw);
            }, function (err) {
                callback(JSON.stringify({ ok: false, error: String(err) }));
            });
        };
    }

    function copySlot() {
        // vault.copy(id, callback): fetch the secret, put it on the clipboard,
        // wipe it after the returned number of seconds, and hand the view an
        // envelope that only mentions the delay (never the secret).
        return function (id, callback) {
            var a = api();
            if (!a) {
                callback(JSON.stringify({ ok: false, error: "Bridge not ready yet." }));
                return;
            }
            a.vault_copy(id).then(function (raw) {
                armAutolock();
                var parsed;
                try { parsed = JSON.parse(raw); } catch (e) { return callback(raw); }
                if (!parsed.ok) { return callback(raw); }
                var seconds = parsed.data.seconds;
                writeClipboard(parsed.data.secret, seconds);
                callback(JSON.stringify({ ok: true, data: { seconds: seconds } }));
            }, function (err) {
                callback(JSON.stringify({ ok: false, error: String(err) }));
            });
        };
    }

    function writeClipboard(text, seconds) {
        if (!navigator.clipboard || !navigator.clipboard.writeText) {
            return;
        }
        navigator.clipboard.writeText(text).then(function () {
            setTimeout(function () {
                // Only clear if we still own what we wrote.
                navigator.clipboard.readText().then(function (current) {
                    if (current === text) {
                        navigator.clipboard.writeText("");
                    }
                }, function () {
                    navigator.clipboard.writeText("");
                });
            }, (seconds || 20) * 1000);
        }, function () { /* clipboard blocked; nothing we can do */ });
    }

    function buildVault() {
        return {
            status: slot("vault_status"),
            create: slot("vault_create"),
            unlock: slot("vault_unlock"),
            lock: (function () {
                var base = slot("vault_lock");
                return function (cb) {
                    stopAutolock();
                    base(cb);
                };
            })(),
            ping: slot("vault_ping"),
            list: slot("vault_list"),
            reveal: slot("vault_reveal"),
            copy: copySlot(),
            save: slot("vault_save"),
            remove: slot("vault_remove"),
            generate: slot("vault_generate"),
            parseFields: slot("vault_parse_fields"),
            rate: slot("vault_rate"),
            // Emulated Qt signal: views call vault.locked.connect(handler).
            locked: { connect: function (handler) { lockedHandlers.push(handler); } }
        };
    }

    /* A forgiving `backend` for views not yet ported. Any method call becomes
       window.pywebview.api.<name>(...args) if that exists, otherwise the
       callback receives a benign "not built yet" JSON envelope so the UI
       degrades instead of throwing. Wire the matching Python methods and the
       corresponding view lights up with no bridge change. */
    function buildBackend() {
        var cache = {};
        function make(name) {
            return function () {
                var args = Array.prototype.slice.call(arguments);
                var callback = typeof args[args.length - 1] === "function" ? args.pop() : function () {};
                var a = api();
                if (a && typeof a[name] === "function") {
                    a[name].apply(a, args).then(callback, function (err) {
                        callback(JSON.stringify({ success: false, error: String(err) }));
                    });
                } else {
                    callback(JSON.stringify({ success: false, error: name + " is not available in this build yet." }));
                }
            };
        }
        if (typeof Proxy === "function") {
            return new Proxy({}, {
                get: function (target, prop) {
                    if (typeof prop !== "string") { return undefined; }
                    if (!cache[prop]) { cache[prop] = make(prop); }
                    return cache[prop];
                }
            });
        }
        return {};  // very old engines: no backend methods, views degrade
    }

    /* Calendar bridge: CRUD methods plus two emulated Qt signals.
       - reminderFired: pushed from Python via window.__paReminder(payload).
       - eventsChanged: emitted client-side after a successful save/delete so
         other views can refresh, matching the old server-side signal. */
    function buildCalendar() {
        var reminderHandlers = [];
        var changedHandlers = [];

        window.__paReminder = function (payloadStr) {
            for (var i = 0; i < reminderHandlers.length; i++) {
                reminderHandlers[i](payloadStr);
            }
        };

        function fireChanged() {
            for (var i = 0; i < changedHandlers.length; i++) {
                changedHandlers[i]();
            }
        }

        function mutating(name) {
            var base = slot(name);
            return function () {
                var args = Array.prototype.slice.call(arguments);
                var callback = args.pop();
                base.apply(null, args.concat([function (raw) {
                    try {
                        var parsed = JSON.parse(raw);
                        if (parsed && parsed.ok) { fireChanged(); }
                    } catch (e) { /* ignore */ }
                    callback(raw);
                }]));
            };
        }

        return {
            listEvents: slot("calendar_list_events"),
            repeatRules: slot("calendar_repeat_rules"),
            upcoming: slot("calendar_upcoming"),
            saveEvent: mutating("calendar_save_event"),
            deleteEvent: mutating("calendar_delete_event"),
            snooze: slot("calendar_snooze"),
            reminderFired: { connect: function (h) { reminderHandlers.push(h); } },
            eventsChanged: { connect: function (h) { changedHandlers.push(h); } }
        };
    }

    // --- lifecycle -------------------------------------------------------
    function ready() {
        objects = { vault: buildVault(), backend: buildBackend(), calendar: buildCalendar() };
        while (waiting.length) {
            waiting.shift()(objects);
        }
    }

    function init() {
        if (window.pywebview && window.pywebview.api) {
            ready();
        } else {
            window.addEventListener("pywebviewready", ready, { once: true });
        }
    }

    function onReady(callback) {
        if (objects) {
            callback(objects);
        } else {
            waiting.push(callback);
        }
    }

    function get(name) {
        return objects ? objects[name] : null;
    }

    /* Unwraps the {ok, data, error} envelope the Python vault methods return. */
    function unwrap(raw, onSuccess, onError) {
        var parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            (onError || function () {})("Malformed response from Python.");
            return;
        }
        if (parsed.ok) {
            onSuccess(parsed.data);
        } else {
            (onError || function () {})(parsed.error);
        }
    }

    function onMessage(handler) {
        handlers.push(handler);
    }

    function greet(name, callback) {
        var a = api();
        if (a && typeof a.greet === "function") {
            a.greet(name).then(callback, function () { callback("Hello, " + name + "!"); });
        } else {
            callback("Hello, " + name + "!");
        }
    }

    // --- notes / checklist helpers (for views ported later) --------------
    // These mirror the original helper names; they call the backend proxy and
    // JSON.parse the response, degrading to a safe default when the Python
    // method is not present yet.
    function jsonCall(method, args, fallback) {
        var backend = get("backend");
        var cb = args.pop();
        function done(response) {
            try { cb(JSON.parse(response)); }
            catch (e) { cb(fallback); }
        }
        backend[method].apply(backend, args.concat([done]));
    }

    function createNote(title, content, imageData, cb) {
        jsonCall("createNote", [title, content, imageData || "", cb], { success: false });
    }
    function updateNote(noteId, title, content, imageData, cb) {
        jsonCall("updateNote", [noteId, title, content, imageData || "", cb], { success: false });
    }
    function deleteNote(noteId, cb) { jsonCall("deleteNote", [noteId, cb], { success: false }); }
    function getAllNotes(cb) { jsonCall("getAllNotes", [cb], { notes: [] }); }
    function createChecklist(title, description, cb) {
        jsonCall("createChecklist", [title, description || "", cb], { success: false });
    }
    function getAllChecklists(cb) { jsonCall("getAllChecklists", [cb], { checklists: [] }); }
    function getChecklist(id, cb) { jsonCall("getChecklist", [id, cb], { success: false }); }
    function updateChecklist(id, title, description, cb) {
        jsonCall("updateChecklist", [id, title, description || "", cb], { success: false });
    }
    function deleteChecklist(id, cb) { jsonCall("deleteChecklist", [id, cb], { success: false }); }
    function duplicateChecklist(id, cb) { jsonCall("duplicateChecklist", [id, cb], { success: false }); }
    function createItem(id, title, description, cb) {
        jsonCall("createItem", [id, title, description || "", cb], { success: false });
    }
    function createItemAt(id, title, description, position, cb) {
        if (typeof position === "function") { cb = position; position = null; }
        if (position === null || position === undefined) {
            return createItem(id, title, description, cb || function () {});
        }
        jsonCall("createItemAt", [id, title, description || "", position, cb || function () {}], { success: false });
    }
    function updateItem(itemId, title, description, cb) {
        jsonCall("updateItem", [itemId, title, description || "", cb], { success: false });
    }
    function toggleItem(itemId, completed, cb) {
        jsonCall("toggleItem", [itemId, completed, cb], { success: false });
    }
    function deleteItem(itemId, cb) { jsonCall("deleteItem", [itemId, cb], { success: false }); }
    function reorderItems(id, itemIds, cb) {
        jsonCall("reorderItems", [id, JSON.stringify(itemIds), cb], { success: false });
    }
    function clearCompleted(id, cb) { jsonCall("clearCompleted", [id, cb], { success: false }); }

    return {
        init: init,
        onReady: onReady,
        get: get,
        unwrap: unwrap,
        onMessage: onMessage,
        greet: greet,
        createNote: createNote,
        updateNote: updateNote,
        deleteNote: deleteNote,
        getAllNotes: getAllNotes,
        createChecklist: createChecklist,
        getAllChecklists: getAllChecklists,
        getChecklist: getChecklist,
        updateChecklist: updateChecklist,
        deleteChecklist: deleteChecklist,
        duplicateChecklist: duplicateChecklist,
        createItem: createItem,
        createItemAt: createItemAt,
        updateItem: updateItem,
        toggleItem: toggleItem,
        deleteItem: deleteItem,
        reorderItems: reorderItems,
        clearCompleted: clearCompleted
    };
})();
