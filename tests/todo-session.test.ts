import { expect, test } from "bun:test"
import { openTodoSession } from "../src/app/todo-session"
import { parseSubtaskId, parseTaskId, parseTodoTitle, type TodoState } from "../src/domain/todos"
import type { TodoStore } from "../src/storage/json-todo-store"

function sessionFixture(): TodoState {
  return {
    tasks: [{
      id: parseTaskId("parent")!,
      title: parseTodoTitle("Parent")!,
      completed: false,
      subtasks: [{ id: parseSubtaskId("child")!, title: parseTodoTitle("Child")!, completed: false }],
    }],
  }
}

test("a failed replacement cannot publish unpersisted state", async () => {
  const initial = sessionFixture()
  const store: TodoStore = {
    load: async () => initial,
    replace: async () => { throw new Error("disk full") },
  }
  const session = await openTodoSession(store)
  const result = await session.execute({
    kind: "toggle",
    target: { kind: "task", taskId: initial.tasks[0]!.id },
  })

  expect(result.kind).toBe("failed")
  expect(session.snapshot()).toEqual(initial)
})

test("rapid parent and child toggles serialize through persistence in call order", async () => {
  const initial = sessionFixture()
  const replacements: TodoState[] = []
  const store: TodoStore = {
    load: async () => initial,
    replace: async (state) => {
      await Promise.resolve()
      replacements.push(state)
    },
  }
  const session = await openTodoSession(store)
  const parentToggle = session.execute({
    kind: "toggle",
    target: { kind: "task", taskId: initial.tasks[0]!.id },
  })
  const childToggle = session.execute({
    kind: "toggle",
    target: {
      kind: "subtask",
      taskId: initial.tasks[0]!.id,
      subtaskId: initial.tasks[0]!.subtasks[0]!.id,
    },
  })

  await Promise.all([parentToggle, childToggle])
  expect(replacements).toHaveLength(2)
  expect(replacements[0]!.tasks[0]!.completed).toBe(true)
  expect(replacements[0]!.tasks[0]!.subtasks[0]!.completed).toBe(false)
  expect(replacements[1]!.tasks[0]!.completed).toBe(true)
  expect(replacements[1]!.tasks[0]!.subtasks[0]!.completed).toBe(true)
})

test("close drains accepted work and rejects new intents", async () => {
  const initial = sessionFixture()
  const store: TodoStore = { load: async () => initial, replace: async () => undefined }
  const session = await openTodoSession(store)
  const accepted = session.execute({
    kind: "toggle",
    target: { kind: "task", taskId: initial.tasks[0]!.id },
  })
  await session.close()

  expect((await accepted).kind).toBe("committed")
  expect((await session.execute({ kind: "remove", target: { kind: "task", taskId: initial.tasks[0]!.id } })).kind).toBe("failed")
})
