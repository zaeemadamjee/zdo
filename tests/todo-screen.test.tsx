import { afterEach, expect, test } from "bun:test"
import { testRender } from "@opentui/react/test-utils"
import { act } from "react"
import { openTodoSession } from "../src/app/todo-session"
import { parseSubtaskId, parseTaskId, parseTodoTitle, type TodoState } from "../src/domain/todos"
import type { TodoStore } from "../src/storage/json-todo-store"
import { TodoScreen } from "../src/ui/TodoScreen"

const renderers: Array<{ destroy(): void }> = []

afterEach(async () => {
  await act(async () => {
    for (const renderer of renderers.splice(0)) renderer.destroy()
  })
})

function fixture(): TodoState {
  return {
    tasks: [{
      id: parseTaskId("parent")!,
      title: parseTodoTitle("Parent")!,
      completed: false,
      subtasks: [{ id: parseSubtaskId("child")!, title: parseTodoTitle("Child")!, completed: false }],
    }],
  }
}

async function renderFixture() {
  let persisted = fixture()
  const store: TodoStore = {
    load: async () => persisted,
    replace: async (state) => { persisted = state },
  }
  const session = await openTodoSession(store)
  const setup = await testRender(<TodoScreen session={session} onQuit={() => undefined} />, {
    width: 72,
    height: 18,
  })
  renderers.push(setup.renderer)
  await setup.renderOnce()
  return { setup, persisted: () => persisted }
}

test("Space toggles only the selected parent", async () => {
  const { setup, persisted } = await renderFixture()
  await act(async () => {
    setup.mockInput.pressKey(" ")
    await setup.waitFor(() => persisted().tasks[0]!.completed)
  })

  expect(persisted().tasks[0]!.completed).toBe(true)
  expect(persisted().tasks[0]!.subtasks[0]!.completed).toBe(false)
})

test("clicking a child checkbox selects and toggles only that child", async () => {
  const { setup, persisted } = await renderFixture()
  await act(async () => {
    await setup.mockMouse.click(8, 5)
    await setup.waitFor(() => persisted().tasks[0]!.subtasks[0]!.completed)
  })

  expect(persisted().tasks[0]!.completed).toBe(false)
  expect(persisted().tasks[0]!.subtasks[0]!.completed).toBe(true)
})

test("clicking a child title changes selection without changing completion", async () => {
  const { setup, persisted } = await renderFixture()
  await act(async () => {
    await setup.mockMouse.click(15, 5)
    setup.mockInput.pressKey(" ")
    await setup.waitFor(() => persisted().tasks[0]!.subtasks[0]!.completed)
  })

  expect(persisted().tasks[0]!.completed).toBe(false)
  expect(persisted().tasks[0]!.subtasks[0]!.completed).toBe(true)
})

test("navigation and Space in one input burst toggle the newly selected row", async () => {
  const { setup, persisted } = await renderFixture()
  await act(async () => {
    setup.mockInput.pressKey("j")
    setup.mockInput.pressKey(" ")
    await setup.waitFor(() => persisted().tasks[0]!.subtasks[0]!.completed)
  })

  expect(persisted().tasks[0]!.completed).toBe(false)
  expect(persisted().tasks[0]!.subtasks[0]!.completed).toBe(true)
})

test("adding a subtask from the keyboard persists it under the selected parent", async () => {
  const { setup, persisted } = await renderFixture()
  await act(async () => {
    setup.mockInput.pressKey("s")
  })
  await setup.flush()
  await act(async () => {
    await setup.mockInput.typeText("New child")
  })
  await setup.flush()
  await act(async () => {
    setup.mockInput.pressEnter()
    await setup.waitFor(() => persisted().tasks[0]!.subtasks.length === 2)
  })

  expect(String(persisted().tasks[0]!.subtasks[1]!.title)).toBe("New child")
  expect(persisted().tasks[0]!.completed).toBe(false)
})

test("the clickable Add task footer action opens the task prompt", async () => {
  const { setup, persisted } = await renderFixture()
  await act(async () => {
    await setup.mockMouse.click(5, 16)
  })
  await setup.flush()
  expect(setup.captureCharFrame()).toContain("New task")

  await act(async () => {
    await setup.mockInput.typeText("Mouse task")
  })
  await setup.flush()
  await act(async () => {
    setup.mockInput.pressEnter()
    await setup.waitFor(() => persisted().tasks.length === 2)
  })

  expect(String(persisted().tasks[1]!.title)).toBe("Mouse task")
})

test("deleting a parent with children waits for confirmation", async () => {
  const { setup, persisted } = await renderFixture()
  await act(async () => {
    setup.mockInput.pressKey("d")
  })
  await setup.flush()
  expect(persisted().tasks).toHaveLength(1)
  expect(setup.captureCharFrame()).toContain("Delete task and 1 subtask?")

  await act(async () => {
    setup.mockInput.pressKey("y")
    await setup.waitFor(() => persisted().tasks.length === 0)
  })
  expect(persisted().tasks).toHaveLength(0)
})
