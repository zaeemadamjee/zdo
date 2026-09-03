import { expect, test } from "bun:test"
import { parseSubtaskId, parseTaskId, parseTodoTitle, type TodoState } from "../src/domain/todos"
import {
  chooseSelection,
  flattenRows,
  revealSelection,
  taskIdForSubtaskInsertion,
} from "../src/app/todo-rows"

const taskId = parseTaskId("task")!
const nextTaskId = parseTaskId("next-task")!
const subtaskId = parseSubtaskId("subtask")!
const state: TodoState = {
  tasks: [
    {
      id: taskId,
      title: parseTodoTitle("Parent")!,
      completed: true,
      subtasks: [{ id: subtaskId, title: parseTodoTitle("Child")!, completed: false }],
    },
    { id: nextTaskId, title: parseTodoTitle("Next")!, completed: false, subtasks: [] },
  ],
}

test("flattening keeps each child immediately after its parent", () => {
  const rows = flattenRows(state)
  expect(rows.map((row) => [row.ref.kind, String(row.title), row.depth])).toEqual([
    ["task", "Parent", 0],
    ["subtask", "Child", 1],
    ["task", "Next", 0],
  ])
})

test("adding a sibling from a subtask still resolves the owning parent", () => {
  expect(taskIdForSubtaskInsertion({ kind: "subtask", taskId, subtaskId })).toBe(taskId)
})

test("deleting a selected parent moves selection to the row that replaces its old position", () => {
  const before = flattenRows(state)
  const after = flattenRows({ tasks: [state.tasks[1]!] })
  const selected = chooseSelection(before, after, { kind: "task", taskId }, { kind: "removed" })

  expect(selected).toEqual({ kind: "task", taskId: nextTaskId })
})

test("keyboard selection is revealed without resetting a user's valid scroll position", () => {
  const rows = flattenRows(state)
  expect(revealSelection(rows, rows[2]!.ref, 0, 2)).toBe(1)
  expect(revealSelection(rows, rows[1]!.ref, 1, 2)).toBe(1)
})
