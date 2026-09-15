/* Checklist feature: complete checklist management app with advanced UX */
window.PA = window.PA || {};

PA.checklistApp = (function () {
    var currentView = "gallery"; // "gallery", "detail", or "edit"
    var checklists = [];
    var editingChecklistId = null;
    var viewingChecklistId = null;
    var editingItemId = null; // Track which item is being edited
    // Unsaved inline row: null, true (append at end, legacy), or
    // { afterId: <item id> } to insert directly below that row.
    var pendingNewItem = null; // Track unsaved new item

    var container, galleryView, detailView, editView;
    var galleryGrid, emptyState;
    var detailTitle, detailDescription, itemsList, progressBar, progressText;
    var editTitleInput, editDescInput;

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

    function findChecklistById(id) {
        for (var i = 0; i < checklists.length; i++) {
            if (checklists[i].id === id) {
                return checklists[i];
            }
        }
        return null;
    }

    function renderGallery() {
        currentView = "gallery";
        detailView.hidden = true;
        editView.hidden = true;
        galleryView.hidden = false;

        if (checklists.length === 0) {
            emptyState.hidden = false;
            galleryGrid.hidden = true;
        } else {
            emptyState.hidden = true;
            galleryGrid.hidden = false;
            galleryGrid.innerHTML = "";

            for (var i = 0; i < checklists.length; i++) {
                var list = checklists[i];
                var card = document.createElement("div");
                card.className = "checklist-card";
                card.setAttribute("data-checklist-id", list.id);

                // Header with title and menu
                var cardHeader = document.createElement("div");
                cardHeader.className = "checklist-card__header";

                var titleEl = document.createElement("h3");
                titleEl.className = "checklist-card__title";
                titleEl.textContent = list.title || "(Untitled)";

                var menuBtn = document.createElement("button");
                menuBtn.className = "checklist-card__menu-btn";
                menuBtn.type = "button";
                menuBtn.setAttribute("aria-label", "Checklist options");
                menuBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
                    + '<circle cx="12" cy="5" r="2"/>'
                    + '<circle cx="12" cy="12" r="2"/>'
                    + '<circle cx="12" cy="19" r="2"/>'
                    + '</svg>';

                cardHeader.appendChild(titleEl);
                cardHeader.appendChild(menuBtn);

                // Stats
                var stats = document.createElement("div");
                stats.className = "checklist-card__stats";
                stats.innerHTML = list.description ? '<p class="checklist-card__desc">' + escapeHtml(list.description) + '</p>' : '';
                stats.innerHTML += '<p class="checklist-card__meta">Created: ' + formatDate(list.created_at) + '</p>';

                card.appendChild(cardHeader);
                card.appendChild(stats);

                // Event listeners
                (function (cid, cardEl, menuBtnEl) {
                    cardEl.addEventListener("click", function (e) {
                        var t = e.target;
                        if (t && t.closest) {
                            if (t.closest(".card-menu")) {
                                return;
                            }
                            if (t.closest(".checklist-card__menu-btn")) {
                                return;
                            }
                        }
                        viewChecklist(cid);
                    });

                    // Shared floating menu (body-level): never clipped by the
                    // scrolling gallery, unlike the old in-card menu.
                    menuBtnEl.addEventListener("click", function (e) {
                        e.stopPropagation();
                        PA.cardMenu.open(menuBtnEl, [
                            {
                                label: "View",
                                onClick: function () { viewChecklist(cid); }
                            },
                            {
                                label: "Edit",
                                onClick: function () { editChecklist(cid); }
                            },
                            {
                                label: "Duplicate",
                                onClick: function () { duplicateChecklist(cid); }
                            },
                            {
                                label: "Delete",
                                danger: true,
                                onClick: function () {
                                    PA.dialog.confirm(
                                        "Delete this checklist? Its items are removed too.",
                                        { title: "Delete checklist", confirmLabel: "Delete" },
                                        function (ok) {
                                            if (ok) {
                                                deleteChecklist(cid);
                                            }
                                        }
                                    );
                                }
                            }
                        ]);
                    });
                })(list.id, card, menuBtn);

                galleryGrid.appendChild(card);
            }
        }
    }

    function closeAllMenus() {
        if (galleryGrid) {
            var menus = galleryGrid.querySelectorAll(".checklist-card__menu.visible");
            for (var i = 0; i < menus.length; i++) {
                menus[i].classList.remove("visible");
            }
        }
        // Also dismiss the shared floating menu when switching views.
        if (window.PA && PA.cardMenu) {
            PA.cardMenu.close();
        }
    }

    function goBackToGallery() {
        pendingNewItem = null;
        viewingChecklistId = null;
        editingItemId = null;
        // Show the cached gallery immediately so Back always responds, even
        // if the reload request fails or is still in flight; the reload then
        // refreshes the cards in the background.
        if (galleryView && detailView && editView) {
            renderGallery();
        }
        loadChecklists();
    }

    function saveItemEdit(itemId, newTitle, options) {
        options = options || {};
        newTitle = newTitle.trim();

        // Position for positional insert: index of the "+ new slot" row
        // among saved rows (1-based position the new row should take).
        function pendingPosition() {
            if (!options.afterId) {
                return null;
            }
            var pos = 1;
            var rows = itemsList.querySelectorAll(".checklist-item");
            for (var i = 0; i < rows.length; i++) {
                var id = parseInt(rows[i].getAttribute("data-item-id"), 10);
                if (id === options.afterId) {
                    return pos + 1;
                }
                if (id >= 0) {
                    pos++;
                }
            }
            return null; // anchor gone (deleted mid-edit) -> append
        }

        // If empty and it's a new item (negative ID), don't save
        if (!newTitle && itemId < 0) {
            pendingNewItem = null;
            viewChecklist(viewingChecklistId);
            return;
        }

        // If empty but existing item, delete it
        if (!newTitle && itemId > 0) {
            PA.bridge.deleteItem(itemId, function (res) {
                if (res && res.success) {
                    viewChecklist(viewingChecklistId);
                }
            });
            return;
        }

        if (itemId < 0) {
            // Create new item - at the pending slot when one was requested,
            // otherwise appended at the end (legacy behavior).
            var at = pendingPosition();
            var done = function (result) {
                if (result && result.success) {
                    pendingNewItem = null;
                    editingItemId = null;
                    viewChecklist(viewingChecklistId);
                }
            };
            if (at !== null && PA.bridge.createItemAt) {
                PA.bridge.createItemAt(viewingChecklistId, newTitle, "", at, done);
            } else {
                PA.bridge.createItem(viewingChecklistId, newTitle, "", done);
            }
        } else {
            // Update existing item
            PA.bridge.updateItem(itemId, newTitle, "", function (result) {
                if (result && result.success) {
                    editingItemId = null;
                    viewChecklist(viewingChecklistId);
                }
            });
        }
    }

    function viewChecklist(checklistId, options) {
        closeAllMenus();
        var requestId = checklistId;
        viewingChecklistId = checklistId;
        editingItemId = null;
        currentView = "detail";
        galleryView.hidden = true;
        editView.hidden = true;
        detailView.hidden = false;
        // The row-level "+" sets pendingNewItem then reloads via this
        // function — don't wipe it, or the blank row never renders.
        if (!options || !options.keepPending) {
            pendingNewItem = null;
        }
        itemsList.innerHTML = "";
        detailTitle.textContent = "...";
        detailDescription.textContent = "";
        progressBar.style.width = "0%";
        progressText.textContent = "";

        PA.bridge.getChecklist(checklistId, function (result) {
            // The user may have hit Back while this request was in flight;
            // a stale reply must not resurrect the detail view.
            if (viewingChecklistId !== requestId) {
                return;
            }
            if (!result || !result.success) {
                console.error("Failed to load checklist:", result);
                alert("Failed to load checklist: " + (result && result.error ? result.error : "Unknown error"));
                return;
            }

            var checklist = result.checklist;
            detailTitle.textContent = checklist.title;
            detailDescription.textContent = checklist.description || "";

            // Update progress bar
            var stats = checklist.stats;
            var percentage = stats.percentage || 0;
            progressBar.style.width = percentage + "%";
            progressText.textContent = stats.completed + " of " + stats.total + " completed";

            // Render items
            itemsList.innerHTML = "";
            var items = checklist.items || [];

            if (items.length === 0 && !pendingNewItem) {
                // Show one blank row instead of an empty-state message.
                pendingNewItem = true;
                renderItemElement({ id: -1, title: "", completed: 0 }, items, null);
            } else {
                // pendingNewItem is null (nothing pending), true (append at
                // end, legacy), or { afterId } (insert below that row).
                var afterId = (pendingNewItem && typeof pendingNewItem === "object")
                    ? pendingNewItem.afterId : null;
                var anchorFound = (afterId === null);
                for (var i = 0; i < items.length; i++) {
                    renderItemElement(items[i], items, null);
                    if (afterId !== null && items[i].id === afterId) {
                        renderItemElement(
                            { id: -1, title: "", completed: 0 }, items, afterId);
                        anchorFound = true;
                    }
                }
                if (afterId !== null && !anchorFound) {
                    // Anchor row vanished (deleted elsewhere) -> append.
                    renderItemElement(
                        { id: -1, title: "", completed: 0 }, items, null);
                }

                // Legacy boolean flag: pending row goes at the end.
                if (pendingNewItem === true) {
                    renderItemElement({ id: -1, title: "", completed: 0 }, items, null);
                }
            }
        });
    }

    function renderItemElement(item, allItems, afterId) {
        var itemEl = document.createElement("div");
        itemEl.className = "checklist-item" + (item.completed && item.id > 0 ? " completed" : "");
        itemEl.setAttribute("data-item-id", item.id);
        // Rows are never draggable — reordering is via the move buttons.
        itemEl.draggable = false;

        // Move buttons: reliable one-slot reordering (replaces the drag grip,
        // which was glitchy in QtWebEngine's HTML5 drag-and-drop).
        var moveUpBtn = document.createElement("button");
        moveUpBtn.className = "checklist-item__move-up";
        moveUpBtn.type = "button";
        moveUpBtn.setAttribute("aria-label", "Move item up");
        moveUpBtn.setAttribute("title", "Move up");
        moveUpBtn.textContent = "\u2191";

        var moveDownBtn = document.createElement("button");
        moveDownBtn.className = "checklist-item__move-down";
        moveDownBtn.type = "button";
        moveDownBtn.setAttribute("aria-label", "Move item down");
        moveDownBtn.setAttribute("title", "Move down");
        moveDownBtn.textContent = "\u2193";

        // Checkbox
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "checklist-item__checkbox";
        checkbox.checked = item.completed;
        if (item.id < 0) checkbox.disabled = true; // Disable for new items

        // Title input (editable)
        var titleInput = document.createElement("input");
        titleInput.type = "text";
        titleInput.className = "checklist-item__title";
        titleInput.value = item.title || "";
        titleInput.placeholder = "Item title...";

        // Delete button
        var deleteBtn = document.createElement("button");
        deleteBtn.className = "checklist-item__delete";
        deleteBtn.type = "button";
        deleteBtn.setAttribute("aria-label", "Delete item");
        deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
            + '<path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6l1.4 1.4L12 13.4l5.6 5.6 1.4-1.4L13.4 12z"/>'
            + '</svg>';

        // Add item after this one
        var addAfterBtn = document.createElement("button");
        addAfterBtn.className = "checklist-item__add-after";
        addAfterBtn.type = "button";
        addAfterBtn.setAttribute("aria-label", "Add item after this");
        addAfterBtn.innerHTML = '+';

        // Save icon: shown only on the unsaved temp row, in place of the
        // "+" button (a "+" makes no sense on a row that doesn't exist yet).
        // Clicking it persists the row, after which it re-renders as a
        // normal row with the move arrows and "+" button.
        var saveBtn = document.createElement("button");
        saveBtn.className = "checklist-item__save";
        saveBtn.type = "button";
        saveBtn.setAttribute("aria-label", "Save item");
        saveBtn.setAttribute("title", "Save item");
        // Save glyph from SVG Repo (save-icon-svgrepo-com.svg): classic
        // floppy-with-arrow. Paths inlined so no extra file request is
        // needed; fill is currentColor so it picks up the row's green.
        saveBtn.innerHTML = '<svg viewBox="0 0 407.096 407.096" fill="currentColor" aria-hidden="true">'
            + '<g>'
            + '<path d="M402.115,84.008L323.088,4.981C319.899,1.792,315.574,0,311.063,0H17.005C7.613,0,0,7.614,0,17.005v373.086c0,9.392,7.613,17.005,17.005,17.005h373.086c9.392,0,17.005-7.613,17.005-17.005V96.032C407.096,91.523,405.305,87.197,402.115,84.008z M300.664,163.567H67.129V38.862h233.535V163.567z"/>'
            + '<path d="M214.051,148.16h43.08c3.131,0,5.668-2.538,5.668-5.669V59.584c0-3.13-2.537-5.668-5.668-5.668h-43.08c-3.131,0-5.668,2.538-5.668,5.668v82.907C208.383,145.622,210.92,148.16,214.051,148.16z"/>'
            + '</g>'
            + '</svg>';

        itemEl.appendChild(checkbox);
        itemEl.appendChild(titleInput);
        // The unsaved temp row has no real database slot to move, so its
        // move buttons are omitted entirely.
        if (item.id >= 0) {
            itemEl.appendChild(moveUpBtn);
            itemEl.appendChild(moveDownBtn);
        }
        itemEl.appendChild(deleteBtn);
        if (item.id < 0) {
            itemEl.appendChild(saveBtn);
        } else {
            itemEl.appendChild(addAfterBtn);
        }

        // Event listeners
        // afterId: for the temporary new row, the id of the row it sits
        // below (passed as the 3rd renderItemElement argument).
        (function (iid, itemElement, titleInputEl, newAfterId) {
            // Move up/down: swap with the immediate neighbour in the DOM,
            // then persist via persistItemOrder(). No drag required.
            moveUpBtn.addEventListener("click", function (e) {
                e.preventDefault();
                if (iid < 0) {
                    return;
                }
                var prev = itemElement.previousElementSibling;
                while (prev && !prev.classList.contains("checklist-item")) {
                    prev = prev.previousElementSibling;
                }
                if (!prev) {
                    return;
                }
                itemElement.parentNode.insertBefore(itemElement, prev);
                persistItemOrder();
            });

            moveDownBtn.addEventListener("click", function (e) {
                e.preventDefault();
                if (iid < 0) {
                    return;
                }
                var next = itemElement.nextElementSibling;
                while (next && !next.classList.contains("checklist-item")) {
                    next = next.nextElementSibling;
                }
                if (!next) {
                    return;
                }
                itemElement.parentNode.insertBefore(itemElement, next.nextSibling);
                persistItemOrder();
            });

            // Checkbox
            checkbox.addEventListener("change", function () {
                PA.bridge.toggleItem(iid, this.checked, function (res) {
                    if (res && res.success) {
                        viewChecklist(viewingChecklistId);
                    }
                });
            });

            // Title edit
            titleInputEl.addEventListener("blur", function () {
                saveItemEdit(iid, this.value, { afterId: newAfterId });
            });

            titleInputEl.addEventListener("keydown", function (e) {
                if (e.key === "Enter") {
                    saveItemEdit(iid, this.value, { afterId: newAfterId });
                } else if (e.key === "Escape") {
                    editingItemId = null;
                    if (iid < 0) {
                        pendingNewItem = null;
                        viewChecklist(viewingChecklistId);
                    } else {
                        this.value = item.title;
                    }
                }
            });

            // Delete
            deleteBtn.addEventListener("click", function (e) {
                e.preventDefault();
                if (iid < 0) {
                    pendingNewItem = null;
                    viewChecklist(viewingChecklistId);
                } else {
                    PA.bridge.deleteItem(iid, function (res) {
                        if (res && res.success) {
                            viewChecklist(viewingChecklistId);
                        }
                    });
                }
            });

            // Add after: insert the new slot directly below this row.
            addAfterBtn.addEventListener("click", function (e) {
                e.preventDefault();

                // Do nothing if this is the empty temporary row.
                if (iid < 0) {
                    return;
                }

                pendingNewItem = { afterId: iid };
                viewChecklist(viewingChecklistId, { keepPending: true });
            });

            // Save icon (temp row only): persist the new row immediately,
            // same behaviour as pressing Enter / clicking away. On success
            // the reload re-renders it as a normal row with the arrows and
            // "+" button.
            saveBtn.addEventListener("click", function (e) {
                e.preventDefault();
                saveItemEdit(iid, titleInputEl.value, { afterId: newAfterId });
            });

            // Auto-focus if this is new item. Scoped to this list so a
            // remount can't steal focus, and guarded so a mid-flight view
            // switch (Back pressed) doesn't focus a stale row.
            if (iid < 0) {
                (function (inputEl, ownerList) {
                    setTimeout(function () {
                        if (ownerList !== itemsList) {
                            return;
                        }
                        if (!inputEl.parentNode) {
                            return;
                        }
                        inputEl.focus();
                    }, 50);
                })(titleInputEl, itemsList);
            }
        })(item.id, itemEl, titleInput, afterId || null);

        itemsList.appendChild(itemEl);
    }

    function persistItemOrder() {
        if (!viewingChecklistId) {
            return;
        }
        var order = [];
        var rows = itemsList.querySelectorAll(".checklist-item");
        for (var i = 0; i < rows.length; i++) {
            var id = parseInt(rows[i].getAttribute("data-item-id"), 10);
            if (id >= 0) {
                order.push(id);
            }
        }

        PA.bridge.reorderItems(
            viewingChecklistId,
            order,
            function (result) {
                if (!result || !result.success) {
                    console.error("Failed to reorder items:", result);
                    return;
                }

                viewChecklist(viewingChecklistId);
            }
        );
    }

    function editChecklist(checklistId) {
        closeAllMenus();
        editingChecklistId = checklistId;
        var checklist = findChecklistById(checklistId);
        
        if (!checklist) return;

        editTitleInput.value = checklist.title;
        editDescInput.value = checklist.description || "";

        currentView = "edit";
        galleryView.hidden = true;
        detailView.hidden = true;
        editView.hidden = false;
        editTitleInput.focus();
    }

    function saveChecklist() {
        var title = editTitleInput.value.trim();
        var desc = editDescInput.value.trim();

        if (!title) {
            alert("Please enter a title");
            return;
        }

        if (editingChecklistId) {
            // UPDATE existing checklist
            PA.bridge.updateChecklist(editingChecklistId, title, desc, function (result) {
                if (result && result.success) {
                    editingChecklistId = null;
                    loadChecklists();
                } else {
                    alert("Failed to update checklist: " + (result ? result.error : "Unknown error"));
                }
            });
        } else {
            // CREATE new checklist
            PA.bridge.createChecklist(title, desc, function (result) {
                if (result && result.success) {
                    editingChecklistId = null;
                    loadChecklists();
                } else {
                    alert("Failed to create checklist: " + (result ? result.error : "Unknown error"));
                }
            });
        }
    }

    function deleteChecklist(checklistId) {
        PA.bridge.deleteChecklist(checklistId, function (result) {
            if (result && result.success) {
                loadChecklists();
            } else {
                alert("Failed to delete checklist");
            }
        });
    }

    function duplicateChecklist(checklistId) {
        PA.bridge.duplicateChecklist(checklistId, function (result) {
            if (result && result.success) {
                loadChecklists();
            } else {
                alert("Failed to duplicate checklist");
            }
        });
    }

    function loadChecklists() {
        PA.bridge.getAllChecklists(function (result) {
            if (result && result.checklists) {
                checklists = result.checklists;
            }
            // Always render: on bridge failure keep the cached cards rather
            // than leaving the user stuck on the detail/header-less view.
            if (galleryView && detailView && editView) {
                renderGallery();
            }
        });
    }

    function init(toolView) {
        // The router clears the tool container and re-runs init on every
        // visit, so tear down the previous mount first. Without this each
        // visit appends a second gallery/detail/edit triple; the module
        // vars then point at the newest (detached-after-clear) nodes and
        // the visible back button / rows stop responding.
        if (container) {
            container.innerHTML = "";
        }
        container = toolView;
        currentView = "gallery";
        checklists = [];
        editingChecklistId = null;
        viewingChecklistId = null;
        editingItemId = null;
        pendingNewItem = null;

        // ===== GALLERY VIEW =====
        galleryView = document.createElement("div");
        galleryView.className = "card";

        var galleryHeader = document.createElement("div");
        galleryHeader.className = "checklists-header";

        var titleSection = document.createElement("div");
        titleSection.innerHTML = ''
            + '<h2 class="card__title">Checklists</h2>'
            + '<p class="card__subtitle">Productivity &middot; Create reusable checklists</p>';

        var addBtn = document.createElement("button");
        addBtn.className = "btn btn--primary";
        addBtn.type = "button";
        addBtn.textContent = "+ New Checklist";
        addBtn.addEventListener("click", function () {
            editingChecklistId = null;
            editTitleInput.value = "";
            editDescInput.value = "";
            currentView = "edit";
            galleryView.hidden = true;
            detailView.hidden = true;
            editView.hidden = false;
            editTitleInput.focus();
        });

        galleryHeader.appendChild(titleSection);
        galleryHeader.appendChild(addBtn);

        galleryGrid = document.createElement("div");
        galleryGrid.className = "checklists-gallery";

        emptyState = document.createElement("div");
        emptyState.className = "empty";
        emptyState.innerHTML = ''
            + '<svg class="empty__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
            + ' stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<path d="M10 6h10M10 12h10M10 18h10"/>'
            + '<path d="M4 6.5l1.2 1.2L7.5 5.4M4 12.5l1.2 1.2L7.5 11.4M4 18.5l1.2 1.2L7.5 17.4"/>'
            + '</svg>'
            + '<p class="empty__text">No checklists yet. Create one to get started!</p>';

        galleryView.appendChild(galleryHeader);
        galleryView.appendChild(galleryGrid);
        galleryView.appendChild(emptyState);

        // ===== DETAIL VIEW =====
        detailView = document.createElement("div");
        detailView.className = "card checklist-detail";
        detailView.hidden = true;

        var detailHeader = document.createElement("div");
        detailHeader.className = "checklist-detail__header";

        var backBtn = document.createElement("button");
        backBtn.className = "icon-btn";
        backBtn.type = "button";
        backBtn.setAttribute("aria-label", "Back to checklists");
        backBtn.innerHTML = '<svg class="icon-btn__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<path d="M19 12H5M12 19l-7-7 7-7"/>'
            + '</svg>';
        backBtn.addEventListener("click", function () {
            goBackToGallery();
        });

        detailTitle = document.createElement("h2");
        detailTitle.className = "checklist-detail__title";

        detailDescription = document.createElement("p");
        detailDescription.className = "checklist-detail__description";

        var detailActions = document.createElement("div");
        detailActions.className = "checklist-detail__actions";

        var clearBtn = document.createElement("button");
        clearBtn.className = "btn btn--ghost";
        clearBtn.type = "button";
        clearBtn.textContent = "Clear Completed";
        clearBtn.addEventListener("click", function () {
            PA.dialog.confirm(
                "Remove all completed items from this checklist?",
                { title: "Clear completed", confirmLabel: "Remove" },
                function (ok) {
                    if (!ok) {
                        return;
                    }
                    PA.bridge.clearCompleted(viewingChecklistId, function (result) {
                        if (result && result.success) {
                            viewChecklist(viewingChecklistId);
                        }
                    });
                }
            );
        });

        var editBtn = document.createElement("button");
        editBtn.className = "btn btn--primary";
        editBtn.type = "button";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", function () {
            editChecklist(viewingChecklistId);
        });

        detailActions.appendChild(clearBtn);
        detailActions.appendChild(editBtn);

        detailHeader.appendChild(backBtn);
        detailHeader.appendChild(detailTitle);
        detailHeader.appendChild(detailActions);

        // Progress
        var progressContainer = document.createElement("div");
        progressContainer.className = "checklist-progress";

        progressBar = document.createElement("div");
        progressBar.className = "checklist-progress__bar";

        progressText = document.createElement("p");
        progressText.className = "checklist-progress__text";

        progressContainer.appendChild(progressBar);
        progressContainer.appendChild(progressText);

        // Items
        itemsList = document.createElement("div");
        itemsList.className = "checklist-items";

        detailView.appendChild(detailHeader);
        detailView.appendChild(progressContainer);
        detailView.appendChild(itemsList);

        // ===== EDIT VIEW =====
        editView = document.createElement("div");
        editView.className = "card";
        editView.hidden = true;

        var editHeader = document.createElement("div");
        editHeader.innerHTML = '<h2 class="card__title">Checklist Details</h2>';

        editTitleInput = document.createElement("input");
        editTitleInput.type = "text";
        editTitleInput.className = "input";
        editTitleInput.placeholder = "Checklist Title";

        var titleLabel = document.createElement("label");
        titleLabel.className = "label";
        titleLabel.textContent = "Title";

        var titleField = document.createElement("div");
        titleField.className = "field";
        titleField.appendChild(titleLabel);
        titleField.appendChild(editTitleInput);

        editDescInput = document.createElement("textarea");
        editDescInput.className = "note-form__textarea";
        editDescInput.placeholder = "Description (optional)";

        var descLabel = document.createElement("label");
        descLabel.className = "label";
        descLabel.textContent = "Description";

        var descField = document.createElement("div");
        descField.className = "note-form__textarea-wrapper";
        descField.appendChild(descLabel);
        descField.appendChild(editDescInput);

        var saveBtnEdit = document.createElement("button");
        saveBtnEdit.className = "btn btn--primary";
        saveBtnEdit.type = "button";
        saveBtnEdit.textContent = "Save";
        saveBtnEdit.addEventListener("click", saveChecklist);

        var cancelBtnEdit = document.createElement("button");
        cancelBtnEdit.className = "btn btn--ghost";
        cancelBtnEdit.type = "button";
        cancelBtnEdit.textContent = "Cancel";
        cancelBtnEdit.addEventListener("click", function () {
            editingChecklistId = null;
            loadChecklists();
        });

        var editActions = document.createElement("div");
        editActions.className = "note-form__actions";
        editActions.appendChild(cancelBtnEdit);
        editActions.appendChild(saveBtnEdit);

        editView.appendChild(editHeader);
        editView.appendChild(titleField);
        editView.appendChild(descField);
        editView.appendChild(editActions);

        container.appendChild(galleryView);
        container.appendChild(detailView);
        container.appendChild(editView);

        loadChecklists();
    }

    return { init: init };
})();