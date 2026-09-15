/* The single source of truth for navigation.

   Add an entry here and it appears in the sidebar and gets a route; nothing
   else needs editing. `icon` is the inner markup of a 24x24 stroke icon. */
window.PA = window.PA || {};

PA.tools = (function () {
    var HOME = {
        id: "home",
        label: "Home",
        icon: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>'
    };

    var SETTINGS = {
        id: "settings",
        label: "Settings",
        icon: '<circle cx="12" cy="12" r="3"/>'
            + '<path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.9 6.1l-1.4 1.4'
            + 'M7.5 16.5l-1.4 1.4M17.9 17.9l-1.4-1.4M7.5 7.5 6.1 6.1"/>'
    };

    var GROUPS = [
        {
            id: "productivity",
            label: "Productivity Tools",
            items: [
                {
                    id: "task-maker",
                    label: "Task Maker",
                    hint: "Tasks with subtasks and status",
                    icon: '<path d="M9 4h6v3H9z"/>'
                        + '<path d="M9 5.5H6.5A1.5 1.5 0 0 0 5 7v12a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V7a1.5 1.5 0 0 0-1.5-1.5H15"/>'
                        + '<path d="M9 13l2 2 4-4"/>'
                },
                {
                    id: "notepad",
                    label: "Notes",
                    hint: "Create and organize notes",
                    icon: '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h8L19 8.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19z"/>'
                        + '<path d="M14 4v5h5M8.5 13h5M8.5 16.5h3"/>'
                },
                {
                    id: "checklist",
                    label: "Checklist Creation",
                    hint: "Reusable checklists",
                    icon: '<path d="M10 6h10M10 12h10M10 18h10"/>'
                        + '<path d="M4 6.5l1.2 1.2L7.5 5.4M4 12.5l1.2 1.2L7.5 11.4M4 18.5l1.2 1.2L7.5 17.4"/>'
                },
                {
                    id: "calendar",
                    label: "Calendar and Scheduling",
                    hint: "Events with alerts",
                    icon: '<rect x="4" y="5.5" width="16" height="15" rx="1.5"/>'
                        + '<path d="M4 10h16M9 3.5v4M15 3.5v4"/>'
                },
                {
                    id: "password-manager",
                    label: "Password Management",
                    hint: "Stored credentials",
                    icon: '<path d="M12 3.5l7 2.5v6c0 4-3 7.5-7 8.5-4-1-7-4.5-7-8.5V6z"/>'
                        + '<circle cx="12" cy="11" r="1.8"/><path d="M12 12.8V15.5"/>'
                }
            ]
        },
        {
            id: "development",
            label: "Development Tools",
            items: [
                {
                    id: "hash-generator",
                    label: "Hash Generator",
                    hint: "MD5, SHA family",
                    icon: '<path d="M9 4L7.5 20M16.5 4L15 20M4.5 9h15M4 15h15"/>'
                },
                {
                    id: "cron-secret",
                    label: "Cron Secret Generator",
                    hint: "Shared secrets for jobs",
                    icon: '<circle cx="8" cy="12" r="3.5"/>'
                        + '<path d="M11.5 12H20M17 12v3.5M14 12v2.5"/>'
                },
                {
                    id: "markdown-viewer",
                    label: "Markdown Viewer",
                    hint: "Render and preview",
                    icon: '<rect x="3.5" y="6" width="17" height="12" rx="1.5"/>'
                        + '<path d="M7 15V9l2.5 3L12 9v6M16 9v4M14 12.5l2 2.5 2-2.5"/>'
                },
                {
                    id: "json-formatter",
                    label: "JSON Formatter",
                    hint: "Pretty print and validate",
                    icon: '<path d="M9.5 4.5C7.5 4.5 7 5.5 7 7v2c0 1.5-.5 2.5-2 3 1.5.5 2 1.5 2 3v2c0 1.5.5 2.5 2.5 2.5"/>'
                        + '<path d="M14.5 4.5c2 0 2.5 1 2.5 2.5v2c0 1.5.5 2.5 2 3-1.5.5-2 1.5-2 3v2c0 1.5-.5 2.5-2.5 2.5"/>'
                },
                {
                    id: "uuid-generator",
                    label: "UUID Generator",
                    hint: "v4 and v7 identifiers",
                    icon: '<rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/>'
                        + '<circle cx="9" cy="11" r="2"/>'
                        + '<path d="M6 16c.5-1.5 1.7-2.2 3-2.2s2.5.7 3 2.2M14.5 10h4M14.5 13.5h3"/>'
                },
                {
                    id: "password-generator",
                    label: "Password Generator",
                    hint: "Random, rule based",
                    icon: '<path d="M12 5v14M6 8.5l12 7M18 8.5l-12 7"/>'
                },
                {
                    id: "encryption",
                    label: "Encryption Decryption",
                    hint: "Text and files",
                    icon: '<rect x="5" y="10.5" width="14" height="9.5" rx="1.5"/>'
                        + '<path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>'
                },
                {
                    id: "base64",
                    label: "Base64 Encoder/Decoder",
                    hint: "Encode and decode",
                    icon: '<path d="M8.5 8.5L5 12l3.5 3.5M15.5 8.5L19 12l-3.5 3.5M13.5 6l-3 12"/>'
                },
                {
                    id: "pdf-encryption",
                    label: "PDF Encryption",
                    hint: "Password protect PDFs",
                    icon: '<path d="M6 4.5h7L18 9v10.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z"/>'
                        + '<path d="M13 4.5V9h5"/>'
                        + '<rect x="9" y="12.5" width="6" height="5" rx="1"/>'
                        + '<path d="M10.5 12.5v-1a1.5 1.5 0 0 1 3 0v1"/>'
                },
                {
                    id: "cron-generator",
                    label: "Cron Job Generator",
                    hint: "Build and explain schedules",
                    icon: '<circle cx="12" cy="12" r="7.5"/><path d="M12 8v4.5l3 1.5"/>'
                }
            ]
        }
    ];

    function all() {
        var list = [HOME];
        for (var i = 0; i < GROUPS.length; i++) {
            list = list.concat(GROUPS[i].items);
        }
        return list.concat([SETTINGS]);
    }

    function find(id) {
        var list = all();
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) {
                return list[i];
            }
        }
        return null;
    }

    function groupOf(id) {
        for (var i = 0; i < GROUPS.length; i++) {
            for (var j = 0; j < GROUPS[i].items.length; j++) {
                if (GROUPS[i].items[j].id === id) {
                    return GROUPS[i];
                }
            }
        }
        return null;
    }

    return { HOME: HOME, SETTINGS: SETTINGS, GROUPS: GROUPS, all: all, find: find, groupOf: groupOf };
})();
