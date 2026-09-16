/* Tasks feature: plan gallery, task list, and task detail modal */
window.PA = window.PA || {};

PA.tasksApp = (function () {
    var currentView = "gallery"; // "gallery" or "task-list"
    var plans = [];
    var filteredPlans = [];
    var currentPlanId = null;
    var currentPlanData = null;
    var tasks = [];
    var expandedTasks = {};
    var editingTaskId = null;
    var activeMenu = null;

    var container, galleryView, taskListView;
    var plansGallery, emptyState, searchInput;
    var tasksTree;
    var taskModal, taskModalContent, taskModalTitle, taskModalClose;
    var taskTitleInput;
    var taskDescInput;
    var taskQuickNotesInput;
    var taskStatusSelect;
    var taskSaveBtn;
    var taskCancelBtn;

    function formatDate(isoString) {
        if (!isoString) return "";
        var date = new Date(isoString);
        return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function findPlanById(planId) {
        for (var i = 0; i < plans.length; i++) {
            if (plans[i].id === planId) return plans[i];
        }
        return null;
    }

    function findTaskByIdRecursive(taskList, taskId) {
        for (var i = 0; i < taskList.length; i++) {
            if (taskList[i].id === taskId) return taskList[i];
            if (taskList[i].subtasks) {
                var found = findTaskByIdRecursive(taskList[i].subtasks, taskId);
                if (found) return found;
            }
        }
        return null;
    }

    function findTaskById(taskId) {
        return findTaskByIdRecursive(tasks, taskId);
    }

    function apiCall(method, args, callback) {
        if (window.pywebview && window.pywebview.api) {
            window.pywebview.api[method](...args).then(function (result) {
                callback(null, result);
            }).catch(function (err) {
                console.error("API error:", err);
                callback(err, null);
            });
        } else {
            callback(new Error("API not available"), null);
        }
    }

    function closeAllMenus() {
        if (window.PA && PA.cardMenu) {
            PA.cardMenu.close();
        }
        activeMenu = null;
    }

    // ===== PLAN OPERATIONS =====

    function loadPlans() {
        apiCall("get_all_plans", [], function (err, result) {
            if (err) {
                console.error("Failed to load plans:", err);
                return;
            }

            plans = result || [];
            filteredPlans = plans.slice();
            renderGallery();
        });
    }

    function createPlan() {
        closeAllMenus();
        showCreatePlanDialog();
    }

    function showCreatePlanDialog() {
        var dialog = document.createElement("div");
        dialog.className = "task-modal";

        var content = document.createElement("div");
        content.className = "task-modal__content";

        var title = document.createElement("h2");
        title.textContent = "Create Plan";
        title.className = "task-modal__title";

        var nameField = document.createElement("div");
        nameField.className = "form-group";

        var nameLabel = document.createElement("label");
        nameLabel.className = "form-label";
        nameLabel.textContent = "Plan Name";

        var nameInput = document.createElement("input");
        nameInput.className = "form-input";
        nameInput.type = "text";
        nameInput.placeholder = "e.g., Project Alpha";

        nameField.appendChild(nameLabel);
        nameField.appendChild(nameInput);

        var descField = document.createElement("div");
        descField.className = "form-group";

        var descLabel = document.createElement("label");
        descLabel.className = "form-label";
        descLabel.textContent = "Description";

        var descInput = document.createElement("textarea");
        descInput.className = "form-textarea";
        descInput.placeholder = "What is this plan about?";

        descField.appendChild(descLabel);
        descField.appendChild(descInput);

        var statusesLabel = document.createElement("label");
        statusesLabel.className = "form-label";
        statusesLabel.textContent = "Custom Statuses";
        statusesLabel.style.marginTop = "var(--space-4)";

        var statusesContainer = document.createElement("div");
        statusesContainer.className = "plan-form__statuses";

        var defaultStatuses = ["Not Started", "In Progress", "On Hold", "Completed"];
        var statusInputs = [];

        function updateRemoveButtons() {
            var visibleCount = statusInputs.length;
            statusInputs.forEach(function (field) {
                var btn = field.querySelector(".status-input__remove-btn");
                btn.style.visibility = visibleCount <= 2 ? "hidden" : "visible";
            });
        }

        defaultStatuses.forEach(function (status) {
            var statusField = document.createElement("div");
            statusField.className = "status-input";

            var input = document.createElement("input");
            input.className = "form-input status-input__field";
            input.type = "text";
            input.value = status;

            var removeBtn = document.createElement("button");
            removeBtn.className = "status-input__remove-btn";
            removeBtn.type = "button";
            removeBtn.textContent = "−";
            removeBtn.style.visibility = defaultStatuses.length <= 2 ? "hidden" : "visible";

            removeBtn.addEventListener("click", function () {
                statusField.remove();
                statusInputs = statusInputs.filter(function (item) {
                    return item !== statusField;
                });
                updateRemoveButtons();
            });

            statusField.appendChild(input);
            statusField.appendChild(removeBtn);
            statusesContainer.appendChild(statusField);
            statusInputs.push(statusField);
        });

        var addStatusBtn = document.createElement("button");
        addStatusBtn.className = "btn btn--ghost add-status-btn";
        addStatusBtn.type = "button";
        addStatusBtn.textContent = "+ Add Status";

        addStatusBtn.addEventListener("click", function () {
            var statusField = document.createElement("div");
            statusField.className = "status-input";

            var input = document.createElement("input");
            input.className = "form-input status-input__field";
            input.type = "text";
            input.placeholder = "Status name";

            var removeBtn = document.createElement("button");
            removeBtn.className = "status-input__remove-btn";
            removeBtn.type = "button";
            removeBtn.textContent = "−";

            removeBtn.addEventListener("click", function () {
                statusField.remove();
                statusInputs = statusInputs.filter(function (item) {
                    return item !== statusField;
                });
                updateRemoveButtons();
            });

            statusField.appendChild(input);
            statusField.appendChild(removeBtn);
            statusesContainer.appendChild(statusField);
            statusInputs.push(statusField);
            updateRemoveButtons();
        });

        var actions = document.createElement("div");
        actions.className = "form-actions";

        var cancelBtn = document.createElement("button");
        cancelBtn.className = "btn btn--ghost";
        cancelBtn.type = "button";
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", function () {
            dialog.remove();
        });

        var saveBtn = document.createElement("button");
        saveBtn.className = "btn btn--primary";
        saveBtn.type = "button";
        saveBtn.textContent = "Create Plan";

        saveBtn.addEventListener("click", function () {
            var name = nameInput.value.trim();
            var desc = descInput.value.trim();

            if (!name) {
                alert("Plan name is required");
                return;
            }

            var statuses = [];
            statusInputs.forEach(function (field) {
                var val = field.querySelector(".status-input__field").value.trim();
                if (val) statuses.push(val);
            });

            if (statuses.length === 0) {
                alert("At least one status is required");
                return;
            }

            apiCall("create_plan", [name, desc, statuses], function (err) {
                if (err) {
                    alert("Failed to create plan");
                    return;
                }
                dialog.remove();
                loadPlans();
            });
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(saveBtn);

        content.appendChild(title);
        content.appendChild(nameField);
        content.appendChild(descField);
        content.appendChild(statusesLabel);
        content.appendChild(statusesContainer);
        content.appendChild(addStatusBtn);
        content.appendChild(actions);

        dialog.appendChild(content);
        document.body.appendChild(dialog);
        nameInput.focus();
    }

    function openPlan(planId) {
        currentPlanId = planId;
        currentPlanData = findPlanById(planId);
        expandedTasks = {};

        if (!currentPlanData) return;
        loadPlanTasks();
    }

    function loadPlanTasks() {
        apiCall("get_plan_tasks", [currentPlanId], function (err, result) {
            if (err) {
                console.error("Failed to load tasks:", err);
                return;
            }

            tasks = result || [];

            var loadSubtasksRecursively = function (taskList, callback) {
                if (!taskList || taskList.length === 0) {
                    callback();
                    return;
                }

                var completed = 0;

                taskList.forEach(function (task) {
                    apiCall("get_task_subtasks", [task.id], function (subErr, subtasks) {
                        if (subErr) {
                            console.error("Failed to load subtasks:", subErr);
                            task.subtasks = [];
                        } else {
                            task.subtasks = subtasks || [];
                        }

                        loadSubtasksRecursively(task.subtasks, function () {
                            completed++;
                            if (completed === taskList.length) {
                                callback();
                            }
                        });
                    });
                });
            };

            loadSubtasksRecursively(tasks, function () {
                renderTaskList();
            });
        });
    }

    function searchPlans(query) {
        if (!query.trim()) {
            filteredPlans = plans.slice();
        } else {
            var q = query.toLowerCase();
            filteredPlans = [];

            for (var i = 0; i < plans.length; i++) {
                var title = (plans[i].title || "").toLowerCase();
                var desc = (plans[i].description || "").toLowerCase();

                if (title.indexOf(q) !== -1 || desc.indexOf(q) !== -1) {
                    filteredPlans.push(plans[i]);
                }
            }
        }

        renderGallery();
    }

    function renderGallery() {
        currentView = "gallery";
        taskListView.hidden = true;
        galleryView.hidden = false;

        if (filteredPlans.length === 0) {
            emptyState.hidden = false;
            plansGallery.hidden = true;
        } else {
            emptyState.hidden = true;
            plansGallery.hidden = false;
            plansGallery.innerHTML = "";

            for (var i = 0; i < filteredPlans.length; i++) {
                var plan = filteredPlans[i];
                var card = document.createElement("div");
                card.className = "plan-card";
                card.setAttribute("data-plan-id", plan.id);

                var cardHeader = document.createElement("div");
                cardHeader.className = "plan-card__header";

                var titleEl = document.createElement("h3");
                titleEl.className = "plan-card__title";
                titleEl.textContent = plan.title || "(Untitled)";

                var menuBtn = document.createElement("button");
                menuBtn.className = "plan-card__menu-btn";
                menuBtn.type = "button";
                menuBtn.setAttribute("aria-label", "Plan options");
                menuBtn.innerHTML =
                    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
                    '<circle cx="12" cy="5" r="2"/>' +
                    '<circle cx="12" cy="12" r="2"/>' +
                    '<circle cx="12" cy="19" r="2"/>' +
                    "</svg>";

                cardHeader.appendChild(titleEl);
                cardHeader.appendChild(menuBtn);

                var description = document.createElement("p");
                description.className = "plan-card__description";
                description.textContent = plan.description || "";

                var meta = document.createElement("div");
                meta.className = "plan-card__meta";
                meta.innerHTML =
                    '<div class="plan-card__meta-item">' +
                    '<span>Created:</span>' +
                    '<span>' + formatDate(plan.created_at) + '</span>' +
                    "</div>";

                card.appendChild(cardHeader);
                card.appendChild(description);
                card.appendChild(meta);

                (function (pid, cardElement, menuButtonElement) {
                    cardElement.addEventListener("click", function (e) {
                        if (e.target && e.target.closest && e.target.closest(".plan-card__menu-btn")) {
                            return;
                        }
                        openPlan(pid);
                    });

                    menuButtonElement.addEventListener("click", function (e) {
                        e.stopPropagation();

                        PA.cardMenu.open(menuButtonElement, [
                            {
                                label: "Edit",
                                onClick: function () { editPlan(pid); }
                            },
                            {
                                label: "Delete",
                                danger: true,
                                onClick: function () {
                                    PA.dialog.confirm(
                                        "This plan and all its tasks will be permanently removed.",
                                        { title: "Delete plan", confirmLabel: "Delete" },
                                        function (ok) {
                                            if (ok) deletePlan(pid);
                                        }
                                    );
                                }
                            }
                        ]);
                    });
                })(plan.id, card, menuBtn);

                plansGallery.appendChild(card);
            }
        }
    }

    function renderTaskList() {
        currentView = "task-list";
        galleryView.hidden = true;
        taskListView.hidden = false;

        if (!currentPlanData) return;

        var headerTitle = taskListView.querySelector(".task-list-header__title");
        var headerDesc = taskListView.querySelector(".task-list-header__description");
        headerTitle.textContent = currentPlanData.title || "(Untitled)";
        headerDesc.textContent = currentPlanData.description || "";

        renderTaskTree();
    }

    function renderTaskTree() {
        tasksTree.innerHTML = "";

        if (tasks.length === 0) {
            tasksTree.classList.add("empty");
            tasksTree.innerHTML = "<p>No tasks yet. Create one to get started!</p>";
            return;
        }

        tasksTree.classList.remove("empty");

        tasks.forEach(function (task) {
            var taskNode = createTaskElement(task, 0);
            tasksTree.appendChild(taskNode);
        });
    }

    function createTaskElement(task, depth) {
        var node = document.createElement("div");
        node.className = "task-node";

        if (depth > 0) {
            node.classList.add("task-node--nested");
        }

        node.setAttribute("data-task-id", task.id);

        var item = document.createElement("div");
        item.className = "task-item";

        var hasSubtasks = task.subtasks && task.subtasks.length > 0;

        var expandBtn = document.createElement("button");
        expandBtn.className = "task-item__expand-btn";
        expandBtn.type = "button";
        expandBtn.setAttribute("aria-label", hasSubtasks ? "Expand or collapse subtasks" : "No subtasks");

        expandBtn.innerHTML =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M9 6l6 6-6 6"/>' +
            "</svg>";

        if (!hasSubtasks) {
            expandBtn.classList.add("no-subtasks");
        } else {
            if (expandedTasks[task.id]) {
                expandBtn.classList.add("expanded");
            }

            expandBtn.addEventListener("click", function (event) {
                event.stopPropagation();
                expandedTasks[task.id] = !expandedTasks[task.id];
                renderTaskTree();
            });
        }

        var content = document.createElement("div");
        content.className = "task-item__content";

        var titleEl = document.createElement("div");
        titleEl.className = "task-item__title";
        titleEl.textContent = task.title || "(Untitled)";

        content.appendChild(titleEl);

        if (task.description) {
            var descEl = document.createElement("div");
            descEl.className = "task-item__description";
            descEl.textContent = task.description;
            content.appendChild(descEl);
        }

        var statusBadge = document.createElement("span");
        statusBadge.className = "task-item__status";
        statusBadge.textContent = task.status || "Not Started";

        var menuBtn = document.createElement("button");
        menuBtn.className = "task-item__menu-btn";
        menuBtn.type = "button";
        menuBtn.setAttribute("aria-label", "Task options");
        menuBtn.innerHTML =
            '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
            '<circle cx="12" cy="5" r="2"/>' +
            '<circle cx="12" cy="12" r="2"/>' +
            '<circle cx="12" cy="19" r="2"/>' +
            "</svg>";

        item.appendChild(expandBtn);
        item.appendChild(content);
        item.appendChild(statusBadge);
        item.appendChild(menuBtn);

        item.addEventListener("click", function (event) {
            if (event.target && event.target.closest && event.target.closest(".task-item__menu-btn")) {
                return;
            }
            if (event.target && event.target.closest && event.target.closest(".task-item__expand-btn")) {
                return;
            }

            openTaskModal(task.id);
        });

        menuBtn.addEventListener("click", function (event) {
            event.stopPropagation();

            PA.cardMenu.open(menuBtn, [
                {
                    label: "Edit",
                    onClick: function () { openTaskModal(task.id); }
                },
                {
                    label: "Add Subtask",
                    onClick: function () { createSubtask(task.id); }
                },
                {
                    label: "Delete",
                    danger: true,
                    onClick: function () {
                        PA.dialog.confirm(
                            "This task and its subtasks will be permanently removed.",
                            { title: "Delete task", confirmLabel: "Delete" },
                            function (ok) {
                                if (ok) deleteTask(task.id);
                            }
                        );
                    }
                }
            ]);
        });

        node.appendChild(item);

        if (hasSubtasks && expandedTasks[task.id]) {
            var subtasksContainer = document.createElement("div");
            subtasksContainer.className = "task-item__subtasks";

            task.subtasks.forEach(function (subtask) {
                var subtaskNode = createTaskElement(subtask, depth + 1);
                subtasksContainer.appendChild(subtaskNode);
            });

            node.appendChild(subtasksContainer);
        }

        return node;
    }

    function createSubtask(parentTaskId) {
        showCreateTaskDialog(parentTaskId);
    }

    function showCreateTaskDialog(parentTaskId) {
        closeAllMenus();

        var dialog = document.createElement("div");
        dialog.className = "task-modal";

        var content = document.createElement("div");
        content.className = "task-modal__content";

        var title = document.createElement("h2");
        title.textContent = parentTaskId ? "Create Subtask" : "Create Task";
        title.className = "task-modal__title";

        var titleField = document.createElement("div");
        titleField.className = "form-group";

        var titleLabel = document.createElement("label");
        titleLabel.className = "form-label";
        titleLabel.textContent = "Task Title";

        var titleInput = document.createElement("input");
        titleInput.className = "form-input";
        titleInput.type = "text";
        titleInput.placeholder = "Task name";

        titleField.appendChild(titleLabel);
        titleField.appendChild(titleInput);

        var descField = document.createElement("div");
        descField.className = "form-group";

        var descLabel = document.createElement("label");
        descLabel.className = "form-label";
        descLabel.textContent = "Description";

        var descInput = document.createElement("textarea");
        descInput.className = "form-textarea";
        descInput.placeholder = "Brief description";

        descField.appendChild(descLabel);
        descField.appendChild(descInput);

        var actions = document.createElement("div");
        actions.className = "form-actions";

        var cancelBtn = document.createElement("button");
        cancelBtn.className = "btn btn--ghost";
        cancelBtn.type = "button";
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", function () {
            dialog.remove();
        });

        var saveBtn = document.createElement("button");
        saveBtn.className = "btn btn--primary";
        saveBtn.type = "button";
        saveBtn.textContent = "Create";

        saveBtn.addEventListener("click", function () {
            var taskTitle = titleInput.value.trim();
            var taskDesc = descInput.value.trim();

            if (!taskTitle) {
                alert("Task title is required");
                return;
            }

            apiCall("create_task", [currentPlanId, taskTitle, taskDesc, parentTaskId || null], function (err) {
                if (err) {
                    alert("Failed to create task");
                    return;
                }

                dialog.remove();
                loadPlanTasks();
            });
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(saveBtn);

        content.appendChild(title);
        content.appendChild(titleField);
        content.appendChild(descField);
        content.appendChild(actions);

        dialog.appendChild(content);
        document.body.appendChild(dialog);
        titleInput.focus();
    }

    function openTaskModal(taskId) {
        editingTaskId = taskId;

        var task = findTaskById(taskId);
        if (!task) return;

        taskTitleInput.value = task.title || "";
        taskDescInput.value = task.description || "";
        taskQuickNotesInput.value = task.quick_notes || "";
        taskStatusSelect.innerHTML = "";

        if (currentPlanData && currentPlanData.statuses) {
            currentPlanData.statuses.forEach(function (status) {
                var option = document.createElement("option");
                option.value = status;
                option.textContent = status;
                if (status === task.status) option.selected = true;
                taskStatusSelect.appendChild(option);
            });
        }

        taskModal.hidden = false;
    }

    function closeTaskModal() {
        taskModal.hidden = true;
        editingTaskId = null;
    }

    function saveTask() {
        if (!editingTaskId) return;

        var title = taskTitleInput.value.trim();
        var desc = taskDescInput.value.trim();
        var quickNotes = taskQuickNotesInput.value.trim();
        var status = taskStatusSelect.value;

        if (!title) {
            alert("Task title is required");
            return;
        }

    apiCall(
        "update_task",
        [editingTaskId, title, desc, status, quickNotes],
        function (err) {
            if (err) {
                alert("Failed to save task");
                return;
            }

            closeTaskModal();
            loadPlanTasks();
        }
    );
    }

    function deleteTask(taskId) {
        apiCall("delete_task", [taskId], function (err) {
            if (err) {
                alert("Failed to delete task");
                return;
            }
            loadPlanTasks();
        });
    }

    function deletePlan(planId) {
        apiCall("delete_plan", [planId], function (err) {
            if (err) {
                alert("Failed to delete plan");
                return;
            }

            loadPlans();
        });
    }

    function editPlan(planId) {
        closeAllMenus();

        var plan = findPlanById(planId);
        if (!plan) return;

        var dialog = document.createElement("div");
        dialog.className = "task-modal";

        var content = document.createElement("div");
        content.className = "task-modal__content";

        var title = document.createElement("h2");
        title.textContent = "Edit Plan";
        title.className = "task-modal__title";

        var nameField = document.createElement("div");
        nameField.className = "form-group";

        var nameLabel = document.createElement("label");
        nameLabel.className = "form-label";
        nameLabel.textContent = "Plan Name";

        var nameInput = document.createElement("input");
        nameInput.className = "form-input";
        nameInput.type = "text";
        nameInput.value = plan.title || "";

        nameField.appendChild(nameLabel);
        nameField.appendChild(nameInput);

        var descField = document.createElement("div");
        descField.className = "form-group";

        var descLabel = document.createElement("label");
        descLabel.className = "form-label";
        descLabel.textContent = "Description";

        var descInput = document.createElement("textarea");
        descInput.className = "form-textarea";
        descInput.value = plan.description || "";

        descField.appendChild(descLabel);
        descField.appendChild(descInput);

        var statusesLabel = document.createElement("label");
        statusesLabel.className = "form-label";
        statusesLabel.textContent = "Custom Statuses";

        var statusesContainer = document.createElement("div");
        statusesContainer.className = "plan-form__statuses";

        var statuses = plan.statuses || ["Not Started", "In Progress", "On Hold", "Completed"];

        statuses.forEach(function (status) {
            var statusField = document.createElement("div");
            statusField.className = "status-input";

            var statusInput = document.createElement("input");
            statusInput.className = "form-input status-input__field";
            statusInput.type = "text";
            statusInput.value = status;

            var removeBtn = document.createElement("button");
            removeBtn.className = "status-input__remove-btn";
            removeBtn.type = "button";
            removeBtn.textContent = "−";

            removeBtn.addEventListener("click", function () {
                statusField.remove();
            });

            statusField.appendChild(statusInput);
            statusField.appendChild(removeBtn);
            statusesContainer.appendChild(statusField);
        });

        var addStatusBtn = document.createElement("button");
        addStatusBtn.className = "btn btn--ghost add-status-btn";
        addStatusBtn.type = "button";
        addStatusBtn.textContent = "+ Add Status";

        addStatusBtn.addEventListener("click", function () {
            var statusField = document.createElement("div");
            statusField.className = "status-input";

            var statusInput = document.createElement("input");
            statusInput.className = "form-input status-input__field";
            statusInput.type = "text";
            statusInput.placeholder = "Status name";

            var removeBtn = document.createElement("button");
            removeBtn.className = "status-input__remove-btn";
            removeBtn.type = "button";
            removeBtn.textContent = "−";

            removeBtn.addEventListener("click", function () {
                statusField.remove();
            });

            statusField.appendChild(statusInput);
            statusField.appendChild(removeBtn);
            statusesContainer.appendChild(statusField);
            statusInput.focus();
        });

        var actions = document.createElement("div");
        actions.className = "form-actions";

        var cancelBtn = document.createElement("button");
        cancelBtn.className = "btn btn--ghost";
        cancelBtn.type = "button";
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", function () {
            dialog.remove();
        });

        var saveBtn = document.createElement("button");
        saveBtn.className = "btn btn--primary";
        saveBtn.type = "button";
        saveBtn.textContent = "Save Changes";

        saveBtn.addEventListener("click", function () {
            var name = nameInput.value.trim();
            var description = descInput.value.trim();

            if (!name) {
                alert("Plan name is required");
                return;
            }

            var updatedStatuses = [];
            statusesContainer.querySelectorAll(".status-input__field").forEach(function (input) {
                var value = input.value.trim();
                if (value) updatedStatuses.push(value);
            });

            if (updatedStatuses.length === 0) {
                alert("At least one status is required");
                return;
            }

            apiCall("update_plan", [planId, name, description, updatedStatuses], function (err) {
                if (err) {
                    console.error("Failed to update plan:", err);
                    alert("Failed to update plan");
                    return;
                }

                dialog.remove();
                loadPlans();
            });
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(saveBtn);

        content.appendChild(title);
        content.appendChild(nameField);
        content.appendChild(descField);
        content.appendChild(statusesLabel);
        content.appendChild(statusesContainer);
        content.appendChild(addStatusBtn);
        content.appendChild(actions);

        dialog.appendChild(content);
        document.body.appendChild(dialog);

        nameInput.focus();
    }

    function goBackToGallery() {
        searchInput.value = "";
        loadPlans();
    }

    function init() {
        var toolView = document.querySelector('[data-view="tool"]');
        if (!toolView) return;

        container = document.createElement("div");
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.gap = "var(--space-4)";
        container.style.height = "100%";

        // ===== GALLERY VIEW =====
        galleryView = document.createElement("div");
        galleryView.className = "card";

        var galleryHeader = document.createElement("div");
        galleryHeader.className = "tasks-header";

        var titleSection = document.createElement("div");

        titleSection.innerHTML = ""
            + '<h2 class="card__title">Task Plans</h2>'
            + '<p class="card__subtitle">Productivity &middot; Create and organize tasks</p>';

        var headerRight = document.createElement("div");
        headerRight.className = "tasks-header__actions";

        searchInput = document.createElement("input");
        searchInput.className = "tasks-search";
        searchInput.type = "text";
        searchInput.placeholder = "Search plans...";
        searchInput.addEventListener("input", function () {
            searchPlans(this.value);
        });

        var addBtn = document.createElement("button");
        addBtn.className = "btn btn--primary";
        addBtn.type = "button";
        addBtn.textContent = "+ New Plan";
        addBtn.addEventListener("click", createPlan);

        headerRight.appendChild(searchInput);
        headerRight.appendChild(addBtn);

        galleryHeader.appendChild(titleSection);
        galleryHeader.appendChild(headerRight);

        emptyState = document.createElement("div");
        emptyState.style.textAlign = "center";
        emptyState.style.padding = "var(--space-6)";
        emptyState.style.color = "var(--color-text-muted)";
        emptyState.textContent = "No plans yet. Create one to get started!";

        plansGallery = document.createElement("div");
        plansGallery.className = "plans-gallery";

        galleryView.appendChild(galleryHeader);
        galleryView.appendChild(plansGallery);
        galleryView.appendChild(emptyState);

        // ===== TASK LIST VIEW =====
        taskListView = document.createElement("div");
        taskListView.className = "card task-list-view";
        taskListView.hidden = true;

        var listHeader = document.createElement("div");
        listHeader.className = "task-list-header";

        var listHeaderInfo = document.createElement("div");
        listHeaderInfo.className = "task-list-header__info";

        var listTitle = document.createElement("h2");
        listTitle.className = "task-list-header__title";

        var listDesc = document.createElement("p");
        listDesc.className = "task-list-header__description";

        listHeaderInfo.appendChild(listTitle);
        listHeaderInfo.appendChild(listDesc);

        var listHeaderActions = document.createElement("div");
        listHeaderActions.className = "task-list-header__actions";

        var addTaskBtn = document.createElement("button");
        addTaskBtn.className = "btn btn--primary";
        addTaskBtn.type = "button";
        addTaskBtn.textContent = "+ Add Task";
        addTaskBtn.addEventListener("click", function () {
            showCreateTaskDialog(null);
        });

        var backBtn = document.createElement("button");
        backBtn.className = "btn btn--ghost";
        backBtn.type = "button";
        backBtn.textContent = "Back";
        backBtn.addEventListener("click", goBackToGallery);

        listHeaderActions.appendChild(addTaskBtn);
        listHeaderActions.appendChild(backBtn);

        listHeader.appendChild(listHeaderInfo);
        listHeader.appendChild(listHeaderActions);

        tasksTree = document.createElement("div");
        tasksTree.className = "tasks-tree";

        taskListView.appendChild(listHeader);
        taskListView.appendChild(tasksTree);

        // ===== TASK MODAL =====
        taskModal = document.createElement("div");
        taskModal.className = "task-modal";
        taskModal.hidden = true;

        taskModalContent = document.createElement("div");
        taskModalContent.className = "task-modal__content";
        taskModalContent.style.position = "relative";

        taskModalTitle = document.createElement("h2");
        taskModalTitle.textContent = "Task Details";
        taskModalTitle.className = "task-modal__title";

        taskModalClose = document.createElement("button");
        taskModalClose.className = "task-modal__close-btn";
        taskModalClose.type = "button";
        taskModalClose.innerHTML =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<line x1="18" y1="6" x2="6" y2="18"/>' +
            '<line x1="6" y1="6" x2="18" y2="18"/>' +
            "</svg>";
        taskModalClose.addEventListener("click", closeTaskModal);

        var titleGroup = document.createElement("div");
        titleGroup.className = "form-group";

        var titleLabel = document.createElement("label");
        titleLabel.className = "form-label";
        titleLabel.textContent = "Title";

        taskTitleInput = document.createElement("input");
        taskTitleInput.className = "form-input";
        taskTitleInput.type = "text";

        titleGroup.appendChild(titleLabel);
        titleGroup.appendChild(taskTitleInput);

        var descGroup = document.createElement("div");
        descGroup.className = "form-group";

        var descLabel = document.createElement("label");
        descLabel.className = "form-label";
        descLabel.textContent = "Description";

        taskDescInput = document.createElement("textarea");
        taskDescInput.className = "form-textarea";

        descGroup.appendChild(descLabel);
        descGroup.appendChild(taskDescInput);

        var quickNotesGroup = document.createElement("div");
        quickNotesGroup.className = "form-group task-quick-notes";

        var quickNotesLabel = document.createElement("label");
        quickNotesLabel.className = "form-label";
        quickNotesLabel.textContent = "Quick Notes";

        taskQuickNotesInput = document.createElement("textarea");
        taskQuickNotesInput.className = "form-textarea task-quick-notes__input";
        taskQuickNotesInput.placeholder =
            "Add a quick note, reminder, link, or next step...";
        taskQuickNotesInput.rows = 5;

        quickNotesGroup.appendChild(quickNotesLabel);
        quickNotesGroup.appendChild(taskQuickNotesInput);

        var statusGroup = document.createElement("div");
        statusGroup.className = "form-group";

        var statusLabel = document.createElement("label");
        statusLabel.className = "form-label";
        statusLabel.textContent = "Status";

        taskStatusSelect = document.createElement("select");
        taskStatusSelect.className = "form-select";

        statusGroup.appendChild(statusLabel);
        statusGroup.appendChild(taskStatusSelect);

        var modalActions = document.createElement("div");
        modalActions.className = "form-actions";

        taskCancelBtn = document.createElement("button");
        taskCancelBtn.className = "btn btn--ghost";
        taskCancelBtn.type = "button";
        taskCancelBtn.textContent = "Cancel";
        taskCancelBtn.addEventListener("click", closeTaskModal);

        taskSaveBtn = document.createElement("button");
        taskSaveBtn.className = "btn btn--primary";
        taskSaveBtn.type = "button";
        taskSaveBtn.textContent = "Save";
        taskSaveBtn.addEventListener("click", saveTask);

        modalActions.appendChild(taskCancelBtn);
        modalActions.appendChild(taskSaveBtn);

        taskModalContent.appendChild(taskModalTitle);
        taskModalContent.appendChild(taskModalClose);
        taskModalContent.appendChild(titleGroup);
        taskModalContent.appendChild(descGroup);
        taskModalContent.appendChild(quickNotesGroup);
        taskModalContent.appendChild(statusGroup);
        taskModalContent.appendChild(modalActions);

        taskModal.appendChild(taskModalContent);

        taskModal.addEventListener("click", function (e) {
            if (e.target === taskModal) closeTaskModal();
        });

        container.appendChild(galleryView);
        container.appendChild(taskListView);

        toolView.appendChild(container);
        document.body.appendChild(taskModal);

        loadPlans();
    }

    return { init: init };
})();