/* QWebChannel connection to the Python side.

   The channel initialises asynchronously, so anything needing a bridge
   object registers with onReady() instead of assuming it exists. */
window.PA = window.PA || {};

PA.bridge = (function () {
    var objects = null;
    var waiting = [];
    var handlers = [];

    function emit(message) {
        for (var i = 0; i < handlers.length; i++) {
            handlers[i](message);
        }
    }

    function init() {
        // Degrade to an inert UI rather than throwing when opened outside PyQt.
        if (typeof qt === "undefined" || !qt.webChannelTransport) {
            return;
        }
        new QWebChannel(qt.webChannelTransport, function (channel) {
            objects = channel.objects;
            if (objects.backend) {
                objects.backend.dataChanged.connect(emit);
            }
            while (waiting.length) {
                waiting.shift()(objects);
            }
        });
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

    /* Unwraps the {ok, data, error} envelope the Python slots return. */
    function unwrap(raw, onSuccess, onError) {
        var parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            (onError || noop)("Malformed response from Python.");
            return;
        }
        if (parsed.ok) {
            onSuccess(parsed.data);
        } else {
            (onError || noop)(parsed.error);
        }
    }

    function noop() {}

    function greet(name, callback) {
        var backend = get("backend");
        if (!backend) {
            callback("Bridge not ready yet.");
            return;
        }
        backend.greet(name, callback);
    }

    function onMessage(handler) {
        handlers.push(handler);
    }

    /* NOTE FUNCTIONS */
    function createNote(title, content, imageData, cb) {
        var backend = get("backend");
        if (!backend) {
            cb({ success: false, error: "Bridge not ready yet." });
            return;
        }
        backend.createNote(title, content, imageData || "", function (response) {
            try {
                cb(JSON.parse(response));
            } catch (e) {
                cb({ success: false, error: "Failed to parse response: " + e.message });
            }
        });
    }

    function updateNote(noteId, title, content, imageData, cb) {
        var backend = get("backend");
        if (!backend) {
            cb({ success: false, error: "Bridge not ready yet." });
            return;
        }
        backend.updateNote(noteId, title, content, imageData || "", function (response) {
            try {
                cb(JSON.parse(response));
            } catch (e) {
                cb({ success: false, error: "Failed to parse response: " + e.message });
            }
        });
    }

    function deleteNote(noteId, cb) {
        var backend = get("backend");
        if (!backend) {
            cb({ success: false, error: "Bridge not ready yet." });
            return;
        }
        backend.deleteNote(noteId, function (response) {
            try {
                cb(JSON.parse(response));
            } catch (e) {
                cb({ success: false, error: "Failed to parse response: " + e.message });
            }
        });
    }

    function getAllNotes(cb) {
        var backend = get("backend");
        if (!backend) {
            cb({ notes: [] });
            return;
        }
        backend.getAllNotes(function (response) {
            try {
                cb(JSON.parse(response));
            } catch (e) {
                cb({ success: false, error: "Failed to parse response: " + e.message, notes: [] });
            }
        });
    }

    /* CHECKLIST FUNCTIONS */
    function createChecklist(title, description, cb) {
        var backend = get("backend");
        if (!backend) {
            cb({ success: false, error: "Bridge not ready yet." });
            return;
        }
        backend.createChecklist(title, description || "", function (response) {
            try {
                cb(JSON.parse(response));
            } catch (e) {
                cb({ success: false, error: "Failed to parse response: " + e.message });
            }
        });
    }

    function getAllChecklists(cb) {
        var backend = get("backend");
        if (!backend) {
            cb({ checklists: [] });
            return;
        }
        backend.getAllChecklists(function (response) {
            try {
                cb(JSON.parse(response));
            } catch (e) {
                cb({ success: false, error: "Failed to parse response: " + e.message, checklists: [] });
            }
        });
    }

    function getChecklist(checklistId, cb) {
        var backend = get("backend");
        if (!backend) {
            cb({ success: false, error: "Bridge not ready yet." });
            return;
        }
        backend.getChecklist(checklistId, function (response) {
            try {
                cb(JSON.parse(response));
            } catch (e) {
                cb({ success: false, error: "Failed to parse response: " + e.message });
            }
        });
    }

    function updateChecklist(checklistId, title, description, cb) {
        var backend = get("backend");
        if (!backend) {
            cb({ success: false, error: "Bridge not ready yet." });
            return;
        }
        backend.updateChecklist(checklistId, title, description || "", function (response) {
            try {
                cb(JSON.parse(response));
            } catch (e) {
                cb({ success: false, error: "Failed to parse response: " + e.message });
            }
        });
    }

    function deleteChecklist(checklistId, cb) {
        var backend = get("backend");
        if (!backend) {
            cb({ success: false, error: "Bridge not ready yet." });
            return;
        }
        backend.deleteChecklist(checklistId, function (response) {
            try {
                cb(JSON.parse(response));
            } catch (e) {
                cb({ success: false, error: "Failed to parse response: " + e.message });
            }
        });
    }

    function duplicateChecklist(checklistId, cb) {
        var backend = get("backend");
        if (!backend) {
            cb({ success: false, error: "Bridge not ready yet." });
            return;
        }
        backend.duplicateChecklist(checklistId, function (response) {
            try {
                cb(JSON.parse(response));
            } catch (e) {
                cb({ success: false, error: "Failed to parse response: " + e.message });
            }
        });
    }

    function createItem(checklistId, title, description, cb) {
        var backend = get("backend");
        if (!backend) {
            cb({ success: false, error: "Bridge not ready yet." });
            return;
        }
        backend.createItem(checklistId, title, description || "", function (response) {
            try {
                cb(JSON.parse(response));
            } catch (e) {
                cb({ success: false, error: "Failed to parse response: " + e.message });
            }
        });
    }

    /* position is 1-based: the new row takes that slot and later rows shift
       down. Falls back to plain append when the new slot is unavailable
       (older backend / injected stub in tests). */
    function createItemAt(checklistId, title, description, position, cb) {
        if (typeof position === "function") {
            cb = position;
            position = null;
        }
        if (typeof cb !== "function") {
            cb = function () {};
        }
        var backend = get("backend");
        if (!backend) {
            cb({ success: false, error: "Bridge not ready yet." });
            return;
        }
        if (position === null || position === undefined || !backend.createItemAt) {
            createItem(checklistId, title, description, cb);
            return;
        }
        backend.createItemAt(checklistId, title, description || "", position, function (response) {
            try {
                cb(JSON.parse(response));
            } catch (e) {
                cb({ success: false, error: "Failed to parse response: " + e.message });
            }
        });
    }

    function updateItem(itemId, title, description, cb) {
        var backend = get("backend");
        if (!backend) {
            cb({ success: false, error: "Bridge not ready yet." });
            return;
        }
        backend.updateItem(itemId, title, description || "", function (response) {
            try {
                cb(JSON.parse(response));
            } catch (e) {
                cb({ success: false, error: "Failed to parse response: " + e.message });
            }
        });
    }

    function toggleItem(itemId, completed, cb) {
        var backend = get("backend");
        if (!backend) {
            cb({ success: false, error: "Bridge not ready yet." });
            return;
        }
        backend.toggleItem(itemId, completed, function (response) {
            try {
                cb(JSON.parse(response));
            } catch (e) {
                cb({ success: false, error: "Failed to parse response: " + e.message });
            }
        });
    }

    function deleteItem(itemId, cb) {
        var backend = get("backend");
        if (!backend) {
            cb({ success: false, error: "Bridge not ready yet." });
            return;
        }
        backend.deleteItem(itemId, function (response) {
            try {
                cb(JSON.parse(response));
            } catch (e) {
                cb({ success: false, error: "Failed to parse response: " + e.message });
            }
        });
    }

    function reorderItems(checklistId, itemIds, cb) {
        var backend = get("backend");
        if (!backend) {
            cb({ success: false, error: "Bridge not ready yet." });
            return;
        }
        var itemIdJson = JSON.stringify(itemIds);
        backend.reorderItems(checklistId, itemIdJson, function (response) {
            try {
                cb(JSON.parse(response));
            } catch (e) {
                cb({ success: false, error: "Failed to parse response: " + e.message });
            }
        });
    }

    function clearCompleted(checklistId, cb) {
        var backend = get("backend");
        if (!backend) {
            cb({ success: false, error: "Bridge not ready yet." });
            return;
        }
        backend.clearCompleted(checklistId, function (response) {
            try {
                cb(JSON.parse(response));
            } catch (e) {
                cb({ success: false, error: "Failed to parse response: " + e.message });
            }
        });
    }

    return {
        init: init,
        greet: greet,
        onMessage: onMessage,
        onReady: onReady,
        get: get,
        unwrap: unwrap,
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
        clearCompleted: clearCompleted,
    };
})();