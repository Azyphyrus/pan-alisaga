/**
 * todo-item.js
 * ------------
 * A tiny "component" pattern for plain JS (no framework/build step).
 * It's just a function that returns a DOM node for one todo, given
 * the todo's data and callback handlers for its interactions.
 *
 * This keeps app.js focused on state/orchestration, while rendering
 * logic for a single item lives here — the same idea as a React/Vue
 * component, just without the tooling.
 */

function createTodoItem(todo, { onToggle, onDelete }) {
  const li = document.createElement("li");
  li.className = "todo-item" + (todo.done ? " done" : "");
  li.dataset.id = todo.id;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = !!todo.done;
  checkbox.addEventListener("change", () => onToggle(todo.id));

  const title = document.createElement("span");
  title.className = "todo-title";
  title.textContent = todo.title;

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "delete-btn";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", () => onDelete(todo.id));

  li.appendChild(checkbox);
  li.appendChild(title);
  li.appendChild(deleteBtn);

  return li;
}
