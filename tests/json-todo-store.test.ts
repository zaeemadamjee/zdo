import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { parseSubtaskId, parseTaskId, parseTodoTitle, type TodoState } from "../src/domain/todos"
import { JsonTodoStore } from "../src/storage/json-todo-store"

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function tempPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "zdo-test-"))
  tempDirectories.push(directory)
  return join(directory, "nested", "todos.json")
}

function allCompletionCombinations(): TodoState {
  return {
    tasks: [
      {
        id: parseTaskId("open-parent")!,
        title: parseTodoTitle("Open parent")!,
        completed: false,
        subtasks: [{ id: parseSubtaskId("done-child")!, title: parseTodoTitle("Done child")!, completed: true }],
      },
      {
        id: parseTaskId("done-parent")!,
        title: parseTodoTitle("Done parent")!,
        completed: true,
        subtasks: [{ id: parseSubtaskId("open-child")!, title: parseTodoTitle("Open child")!, completed: false }],
      },
    ],
  }
}

test("a missing data file starts as an empty todo list", async () => {
  const store = new JsonTodoStore(await tempPath())
  expect(await store.load()).toEqual({ tasks: [] })
})

test("storage round-trips contradictory parent and child completion states", async () => {
  const store = new JsonTodoStore(await tempPath())
  const state = allCompletionCombinations()
  await store.replace(state)

  expect(await store.load()).toEqual(state)
})

test("recursive subtasks are rejected and the malformed source file remains untouched", async () => {
  const path = await tempPath()
  const malformed = JSON.stringify({
    version: 1,
    tasks: [{
      id: "parent",
      title: "Parent",
      completed: false,
      subtasks: [{ id: "child", title: "Child", completed: false, subtasks: [] }],
    }],
  })
  await writeFile(path, malformed, { encoding: "utf8", flag: "w" }).catch(async (error) => {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    const { mkdir } = await import("node:fs/promises")
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, malformed, "utf8")
  })

  const store = new JsonTodoStore(path)
  await expect(store.load()).rejects.toThrow("must not contain nested subtasks")
  expect(await readFile(path, "utf8")).toBe(malformed)
})
