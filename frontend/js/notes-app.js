/* Notes feature: gallery view, detail view, add-note form */
window.PA = window.PA || {};

PA.notesApp = (function () {
    var currentView = "gallery"; // "gallery", "detail", or "add-note"
    var notes = [];
    var filteredNotes = [];
    var editingNoteId = null;
    var viewingNoteId = null;
    var activeMenu = null; // Track the currently open menu

    var container, galleryView, detailView, addNoteView;
    var titleInput, contentTextarea, imageInput, imagePreview;
    var galleryGrid, emptyState, searchInput;
    var detailTitle, detailContent, detailImage, detailCreated, detailModified;
    var addNoteBtn, saveBtn, cancelBtn;

    function formatDate(isoString) {
        if (!isoString) return "";
        var date = new Date(isoString);
        return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function escapeHtml(text) {
        var map = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        };
        return text.replace(/[&<>"']/g, function (m) { return map[m]; });
    }

    function findNoteById(noteId) {
        for (var i = 0; i < notes.length; i++) {
            if (notes[i].id === noteId) {
                return notes[i];
            }
        }
        return null;
    }

    function searchNotes(query) {
        if (!query.trim()) {
            filteredNotes = notes.slice();
        } else {
            var q = query.toLowerCase();
            filteredNotes = [];
            for (var i = 0; i < notes.length; i++) {
                if (notes[i].title.toLowerCase().indexOf(q) !== -1) {
                    filteredNotes.push(notes[i]);
                }
            }
        }
        renderGallery();
    }

    function closeAllMenus() {
        // Menus are body-level floating panels now (PA.cardMenu), so there
        // is nothing per-card to hide. Kept as a no-conflict hook: closing
        // one gallery must not kill the other gallery's open menu (the old
        // querySelectorAll on a detached grid threw / closed everything).
        if (window.PA && PA.cardMenu) {
            PA.cardMenu.close();
        }
        activeMenu = null;
    }

    function renderGallery() {
        currentView = "gallery";
        detailView.hidden = true;
        addNoteView.hidden = true;
        galleryView.hidden = false;

        if (filteredNotes.length === 0) {
            emptyState.hidden = false;
            galleryGrid.hidden = true;
        } else {
            emptyState.hidden = true;
            galleryGrid.hidden = false;
            galleryGrid.innerHTML = "";

            for (var i = 0; i < filteredNotes.length; i++) {
                var note = filteredNotes[i];
                var card = document.createElement("div");
                card.className = "note-card";
                card.setAttribute("data-note-id", note.id);

                // Card header with title and 3-dot menu
                var cardHeader = document.createElement("div");
                cardHeader.className = "note-card__header";

                var titleEl = document.createElement("h3");
                titleEl.className = "note-card__title";
                titleEl.textContent = note.title || "(Untitled)";

                var menuBtn = document.createElement("button");
                menuBtn.className = "note-card__menu-btn";
                menuBtn.type = "button";
                menuBtn.setAttribute("aria-label", "Note options");
                menuBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
                    + '<circle cx="12" cy="5" r="2"/>'
                    + '<circle cx="12" cy="12" r="2"/>'
                    + '<circle cx="12" cy="19" r="2"/>'
                    + '</svg>';

                cardHeader.appendChild(titleEl);
                cardHeader.appendChild(menuBtn);

                // Preview and dates
                var preview = document.createElement("p");
                preview.className = "note-card__preview";
                preview.textContent = note.content || "";

                var dates = document.createElement("div");
                dates.className = "note-card__dates";
                dates.innerHTML = ''
                    + '<div class="note-card__date">'
                    + '<span>Created:</span>'
                    + '<span>' + formatDate(note.created_at) + '</span>'
                    + '</div>'
                    + (note.modified_at && note.modified_at !== note.created_at
                        ? '<div class="note-card__date"><span>Modified:</span><span>' + formatDate(note.modified_at) + '</span></div>'
                        : '');

                card.appendChild(cardHeader);
                card.appendChild(preview);
                card.appendChild(dates);

                // Event listeners for this specific card
                (function (nid, cardElement, menuButtonElement) {
                    // Click card to view (but not the menu button)
                    cardElement.addEventListener("click", function (e) {
                        var t = e.target;
                        if (t && t.closest) {
                            if (t.closest(".card-menu")) {
                                return;
                            }
                            if (t.closest(".note-card__menu-btn")) {
                                return;
                            }
                        }
                        viewNote(nid);
                    });

                    // Menu button opens the shared floating menu (body-level,
                    // so it is never clipped by the scrolling gallery).
                    menuButtonElement.addEventListener("click", function (e) {
                        e.stopPropagation();
                        PA.cardMenu.open(menuButtonElement, [
                            {
                                label: "Edit",
                                onClick: function () { editNote(nid); }
                            },
                            {
                                label: "Delete",
                                danger: true,
                                onClick: function () {
                                    PA.dialog.confirm(
                                        "This note will be permanently removed.",
                                        { title: "Delete note", confirmLabel: "Delete" },
                                        function (ok) {
                                            if (ok) {
                                                deleteNote(nid);
                                            }
                                        }
                                    );
                                }
                            }
                        ]);
                    });
                })(note.id, card, menuBtn);

                galleryGrid.appendChild(card);
            }
        }
    }

    function viewNote(noteId) {
        closeAllMenus();
        viewingNoteId = noteId;
        var note = findNoteById(noteId);
        if (!note) return;

        detailTitle.textContent = note.title || "(Untitled)";
        detailContent.textContent = note.content || "";
        detailCreated.textContent = "Created: " + formatDate(note.created_at);
        
        if (note.modified_at && note.modified_at !== note.created_at) {
            detailModified.textContent = "Modified: " + formatDate(note.modified_at);
            detailModified.hidden = false;
        } else {
            detailModified.hidden = true;
        }

        if (note.image_data) {
            detailImage.src = note.image_data;
            detailImage.hidden = false;
        } else {
            detailImage.hidden = true;
        }

        currentView = "detail";
        galleryView.hidden = true;
        addNoteView.hidden = true;
        detailView.hidden = false;
    }

    function editNote(noteId) {
        closeAllMenus();
        editingNoteId = noteId;
        var note = findNoteById(noteId);
        if (!note) return;

        titleInput.value = note.title || "";
        contentTextarea.value = note.content || "";
        
        imagePreview.hidden = true;
        imagePreview.classList.remove("visible");
        imageInput.value = "";

        if (note.image_data) {
            imagePreview.src = note.image_data;
            imagePreview.hidden = false;
            imagePreview.classList.add("visible");
        }

        saveBtn.textContent = "Update Note";
        showAddNoteView();
    }

    function deleteNote(noteId) {
        closeAllMenus();
        PA.bridge.deleteNote(noteId, function (result) {
            if (result && result.success) {
                loadNotes();
            } else {
                alert("Failed to delete note: " + (result ? result.error : "Unknown error"));
            }
        });
    }

    function showAddNoteView() {
        currentView = "add-note";
        galleryView.hidden = true;
        detailView.hidden = true;
        addNoteView.hidden = false;
        titleInput.focus();
    }

    function cancelAdd() {
        closeAllMenus();
        editingNoteId = null;
        titleInput.value = "";
        contentTextarea.value = "";
        imageInput.value = "";
        imagePreview.hidden = true;
        imagePreview.classList.remove("visible");
        saveBtn.textContent = "Save Note";
        searchInput.value = "";
        loadNotes();
    }

    function saveNote() {
        var title = titleInput.value.trim();
        var content = contentTextarea.value.trim();

        if (!title || !content) {
            alert("Please fill in both title and content.");
            return;
        }

        var imageData = null;
        if (imagePreview.classList.contains("visible")) {
            imageData = imagePreview.src;
        }

        if (editingNoteId) {
            PA.bridge.updateNote(editingNoteId, title, content, imageData, function (result) {
                if (result && result.success) {
                    loadNotes();
                } else {
                    alert("Failed to update note: " + (result ? result.error : "Unknown error"));
                }
            });
        } else {
            PA.bridge.createNote(title, content, imageData, function (result) {
                if (result && result.success) {
                    loadNotes();
                } else {
                    alert("Failed to create note: " + (result ? result.error : "Unknown error"));
                }
            });
        }
    }

    function loadNotes() {
        PA.bridge.getAllNotes(function (result) {
            if (result && result.notes) {
                notes = result.notes;
                searchInput.value = "";
                filteredNotes = notes.slice();
                renderGallery();
            }
        });
    }

    function handleImageSelect(event) {
        var file = event.target.files[0];
        if (file && file.type.startsWith("image/")) {
            var reader = new FileReader();
            reader.onload = function (e) {
                imagePreview.src = e.target.result;
                imagePreview.hidden = false;
                imagePreview.classList.add("visible");
            };
            reader.readAsDataURL(file);
        } else {
            alert("Please select a valid image file.");
        }
    }

    function init(toolView) {
        // Same remount trap as the checklist app: the router re-runs init on
        // every visit, so drop the previous triple first or the module vars
        // end up pointing at detached nodes. Also close any floating menu:
        // it is body-level and would otherwise outlive this mount.
        if (container) {
            container.innerHTML = "";
        }
        if (window.PA && PA.cardMenu) {
            PA.cardMenu.close();
        }
        container = toolView;
        currentView = "gallery";
        notes = [];
        filteredNotes = [];
        editingNoteId = null;
        viewingNoteId = null;
        activeMenu = null;

        // ===== GALLERY VIEW =====
        galleryView = document.createElement("div");
        galleryView.className = "card";

        var galleryHeader = document.createElement("div");
        galleryHeader.className = "notes-header";

        var titleSection = document.createElement("div");
        titleSection.innerHTML = ''
            + '<h2 class="card__title">Notes</h2>'
            + '<p class="card__subtitle">Productivity &middot; Create and organize notes</p>';

        var headerActions = document.createElement("div");
        headerActions.className = "notes-header__actions";

        searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.className = "notes-search";
        searchInput.placeholder = "Search notes...";
        searchInput.addEventListener("input", function () {
            searchNotes(this.value);
        });

        addNoteBtn = document.createElement("button");
        addNoteBtn.className = "btn btn--primary";
        addNoteBtn.type = "button";
        addNoteBtn.textContent = "+ Add Note";

        headerActions.appendChild(searchInput);
        headerActions.appendChild(addNoteBtn);

        galleryHeader.appendChild(titleSection);
        galleryHeader.appendChild(headerActions);

        galleryGrid = document.createElement("div");
        galleryGrid.className = "notes-gallery";

        emptyState = document.createElement("div");
        emptyState.className = "empty notes-gallery empty";
        emptyState.innerHTML = ''
            + '<div>'
            + '<svg class="empty__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
            + ' stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h8L19 8.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19z"/>'
            + '<path d="M14 4v5h5M8.5 13h5M8.5 16.5h3"/></svg>'
            + '<p class="empty__text">No notes yet. Add one to get started!</p>'
            + '</div>';

        galleryView.appendChild(galleryHeader);
        galleryView.appendChild(galleryGrid);
        galleryView.appendChild(emptyState);

        // ===== DETAIL VIEW =====
        detailView = document.createElement("div");
        detailView.className = "card note-detail";
        detailView.hidden = true;

        var detailHeader = document.createElement("div");
        detailHeader.className = "note-detail__header";

        var backBtn = document.createElement("button");
        backBtn.className = "icon-btn";
        backBtn.type = "button";
        backBtn.setAttribute("aria-label", "Back to notes");
        backBtn.innerHTML = '<svg class="icon-btn__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<path d="M19 12H5M12 19l-7-7 7-7"/>'
            + '</svg>';
        backBtn.addEventListener("click", function () {
            searchInput.value = "";
            loadNotes();
        });

        var detailTitleWrapper = document.createElement("div");
        detailTitleWrapper.className = "note-detail__title-wrapper";

        detailTitle = document.createElement("h2");
        detailTitle.className = "note-detail__title";

        detailTitleWrapper.appendChild(detailTitle);

        var detailActions = document.createElement("div");
        detailActions.className = "note-detail__actions";

        var editBtn = document.createElement("button");
        editBtn.className = "btn btn--primary";
        editBtn.type = "button";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", function () {
            editNote(viewingNoteId);
        });

        var deleteBtn = document.createElement("button");
        deleteBtn.className = "btn btn--ghost";
        deleteBtn.type = "button";
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", function () {
            PA.dialog.confirm(
                "This note will be permanently removed.",
                { title: "Delete note", confirmLabel: "Delete" },
                function (ok) {
                    if (ok) {
                        deleteNote(viewingNoteId);
                    }
                }
            );
        });

        detailActions.appendChild(editBtn);
        detailActions.appendChild(deleteBtn);

        detailHeader.appendChild(backBtn);
        detailHeader.appendChild(detailTitleWrapper);
        detailHeader.appendChild(detailActions);

        detailImage = document.createElement("img");
        detailImage.className = "note-detail__image";
        detailImage.hidden = true;

        detailContent = document.createElement("p");
        detailContent.className = "note-detail__content";

        var detailFooter = document.createElement("div");
        detailFooter.className = "note-detail__footer";

        detailCreated = document.createElement("p");
        detailCreated.className = "note-detail__date";

        detailModified = document.createElement("p");
        detailModified.className = "note-detail__date";
        detailModified.hidden = true;

        detailFooter.appendChild(detailCreated);
        detailFooter.appendChild(detailModified);

        detailView.appendChild(detailHeader);
        detailView.appendChild(detailImage);
        detailView.appendChild(detailContent);
        detailView.appendChild(detailFooter);

        // ===== ADD/EDIT NOTE VIEW =====
        addNoteView = document.createElement("div");
        addNoteView.className = "card";
        addNoteView.hidden = true;

        titleInput = document.createElement("input");
        titleInput.className = "input";
        titleInput.placeholder = "Note Title";
        titleInput.type = "text";

        var titleLabel = document.createElement("label");
        titleLabel.className = "label";
        titleLabel.textContent = "Title";

        var titleField = document.createElement("div");
        titleField.className = "field";
        titleField.appendChild(titleLabel);
        titleField.appendChild(titleInput);

        contentTextarea = document.createElement("textarea");
        contentTextarea.className = "note-form__textarea";
        contentTextarea.placeholder = "Write your note here...";

        var contentLabel = document.createElement("label");
        contentLabel.className = "label";
        contentLabel.textContent = "Content";

        var contentWrapper = document.createElement("div");
        contentWrapper.className = "note-form__textarea-wrapper";
        contentWrapper.appendChild(contentLabel);
        contentWrapper.appendChild(contentTextarea);

        imageInput = document.createElement("input");
        imageInput.type = "file";
        imageInput.accept = "image/*";
        imageInput.className = "note-form__file-input";
        imageInput.id = "noteImageInput";

        imagePreview = document.createElement("img");
        imagePreview.className = "note-form__image-preview";
        imagePreview.hidden = true;

        var imageLabel = document.createElement("label");
        imageLabel.className = "label";
        imageLabel.htmlFor = "noteImageInput";
        imageLabel.textContent = "Attach Image (Optional)";

        var imageBtn = document.createElement("button");
        imageBtn.className = "btn btn--ghost";
        imageBtn.type = "button";
        imageBtn.textContent = "Choose Image";
        imageBtn.addEventListener("click", function (e) {
            e.preventDefault();
            imageInput.click();
        });

        var imageSection = document.createElement("div");
        imageSection.className = "note-form__image-upload";
        imageSection.appendChild(imageLabel);
        imageSection.appendChild(imageBtn);
        imageSection.appendChild(imageInput);
        imageSection.appendChild(imagePreview);

        saveBtn = document.createElement("button");
        saveBtn.className = "btn btn--primary";
        saveBtn.type = "button";
        saveBtn.textContent = "Save Note";

        cancelBtn = document.createElement("button");
        cancelBtn.className = "btn btn--ghost";
        cancelBtn.type = "button";
        cancelBtn.textContent = "Cancel";

        var actions = document.createElement("div");
        actions.className = "note-form__actions";
        actions.appendChild(cancelBtn);
        actions.appendChild(saveBtn);

        addNoteView.innerHTML = '<h2 class="card__title">Add Note</h2>'
            + '<p class="card__subtitle">Productivity &middot; Create a new note</p>';
        addNoteView.appendChild(titleField);
        addNoteView.appendChild(contentWrapper);
        addNoteView.appendChild(imageSection);
        addNoteView.appendChild(actions);

        // Append all views to container
        container.appendChild(galleryView);
        container.appendChild(detailView);
        container.appendChild(addNoteView);

        // ===== GLOBAL EVENT LISTENERS =====
        // The floating card menu closes itself on outside click / Escape /
        // scroll, so no per-gallery document handler is needed here (the old
        // one also fired for the checklist gallery and stole its menus).

        // ===== BUTTON EVENT LISTENERS =====
        addNoteBtn.addEventListener("click", function () {
            closeAllMenus();
            editingNoteId = null;
            titleInput.value = "";
            contentTextarea.value = "";
            imageInput.value = "";
            imagePreview.hidden = true;
            imagePreview.classList.remove("visible");
            saveBtn.textContent = "Save Note";
            showAddNoteView();
        });

        saveBtn.addEventListener("click", saveNote);
        cancelBtn.addEventListener("click", cancelAdd);
        imageInput.addEventListener("change", handleImageSelect);

        // Load notes on init
        loadNotes();
    }

    return { init: init };
})();