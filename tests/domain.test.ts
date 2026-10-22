import { describe, expect, test } from "bun:test"
import {
  applyMutation,
  parseSubtaskId,
  parseTaskId,
  parseTodoTitle,
  type ItemRef,
  type TodoState,
} from "../src/domain/todos"

function fixture(): TodoState {
  const taskOne = parseTaskId("task-one")!
  const taskTwo = parseTaskId("task-two")!
  const subtaskOne = parseSubtaskId("subtask-one")!
  const subtaskTwo = parseSubtaskId("subtask-two")!

  return {
    tasks: [
      {
        id: taskOne,
        title: parseTodoTitle("Ship terminal app")!,
        completed: false,
        subtasks: [
          { id: subtaskOne, title: parseTodoTitle("Build UI")!, completed: false },
          { id: subtaskTwo, title: parseTodoTitle("Write docs")!, completed: true },
        ],
      },
      {
        id: taskTwo,
        title: parseTodoTitle("Celebrate")!,
        completed: false,
        subtasks: [],
      },
    ],
  }
}

function toggle(state: TodoState, target: ItemRef): TodoState {
  const result = applyMutation(state, { kind: "toggle", target })
  if (result.kind !== "changed") throw new Error("Fixture target should exist")
  return result.state
}

describe("independent completion", () => {
  test("toggling a parent cannot overwrite either child completion value", () => {
    const before = fixture()
    const after = toggle(before, { kind: "task", taskId: before.tasks[0]!.id })

    expect(after.tasks[0]!.completed).toBe(true)
    expect(after.tasks[0]!.subtasks).toEqual(before.tasks[0]!.subtasks)
  })

  test("completing the last open subtask cannot complete its parent", () => {
    const before = fixture()
    const target = before.tasks[0]!.subtasks[0]!
    const after = toggle(before, {
      kind: "subtask",
      taskId: before.tasks[0]!.id,
      subtaskId: target.id,
    })

    expect(after.tasks[0]!.subtasks.every((subtask) => subtask.completed)).toBe(true)
    expect(after.tasks[0]!.completed).toBe(false)
  })

  test("a child ID is resolved within its parent, not another task", () => {
    const before = fixture()
    const target = before.tasks[0]!.subtasks[0]!
    const result = applyMutation(before, {
      kind: "toggle",
      target: { kind: "subtask", taskId: before.tasks[1]!.id, subtaskId: target.id },
    })

    expect(result).toEqual({ kind: "rejected", reason: "missing-target" })
    expect(before.tasks[0]!.subtasks[0]!.completed).toBe(false)
  })
})

test("deleting a parent removes its subtree without touching adjacent tasks", () => {
  const before = fixture()
  const result = applyMutation(before, {
    kind: "remove",
    target: { kind: "task", taskId: before.tasks[0]!.id },
  })

  expect(result.kind).toBe("changed")
  if (result.kind === "changed") expect(result.state.tasks).toEqual([before.tasks[1]!])
})

describe("rename", () => {
  test("renaming a task changes only its title", () => {
    const before = fixture()
    const result = applyMutation(before, {
      kind: "rename",
      target: { kind: "task", taskId: before.tasks[0]!.id },
      title: parseTodoTitle("Ship it")!,
    })

    expect(result.kind).toBe("changed")
    if (result.kind !== "changed") return
    expect(String(result.state.tasks[0]!.title)).toBe("Ship it")
    expect(result.state.tasks[0]!.completed).toBe(before.tasks[0]!.completed)
    expect(result.state.tasks[0]!.subtasks).toEqual(before.tasks[0]!.subtasks)
    expect(result.state.tasks[1]).toEqual(before.tasks[1]!)
  })

  test("renaming a subtask changes only that subtask", () => {
    const before = fixture()
    const target = before.tasks[0]!.subtasks[1]!
    const result = applyMutation(before, {
      kind: "rename",
      target: { kind: "subtask", taskId: before.tasks[0]!.id, subtaskId: target.id },
      title: parseTodoTitle("Write the docs")!,
    })

    expect(result.kind).toBe("changed")
    if (result.kind !== "changed") return
    const renamed = result.state.tasks[0]!.subtasks[1]!
    expect(String(renamed.title)).toBe("Write the docs")
    expect(renamed.completed).toBe(target.completed)
    expect(result.state.tasks[0]!.subtasks[0]).toEqual(before.tasks[0]!.subtasks[0]!)
    expect(String(result.state.tasks[0]!.title)).toBe("Ship terminal app")
  })

  test("renaming a missing item is rejected", () => {
    const before = fixture()
    const result = applyMutation(before, {
      kind: "rename",
      target: { kind: "task", taskId: parseTaskId("nope")! },
      title: parseTodoTitle("Anything")!,
    })

    expect(result).toEqual({ kind: "rejected", reason: "missing-target" })
  })
})
