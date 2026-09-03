import { mkdir, open, readFile, rename, rm } from "node:fs/promises"
import { dirname, basename, join } from "node:path"
import {
  emptyTodoState,
  parseSubtaskId,
  parseTaskId,
  parseTodoTitle,
  type Subtask,
  type Task,
  type TodoState,
} from "../domain/todos"

export interface TodoStore {
  load(): Promise<TodoState>
  replace(state: TodoState): Promise<void>
}

type PersistedDocument = Readonly<{
  version: 1
  tasks: readonly Task[]
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseCompleted(value: unknown, location: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${location}.completed must be a boolean`)
  return value
}

function parseSubtask(value: unknown, location: string, seenIds: Set<string>): Subtask {
  if (!isRecord(value)) throw new Error(`${location} must be an object`)
  if ("subtasks" in value) throw new Error(`${location} must not contain nested subtasks`)

  const id = parseSubtaskId(value.id)
  const title = parseTodoTitle(value.title)
  if (!id) throw new Error(`${location}.id must be a nonblank string`)
  if (!title) throw new Error(`${location}.title must be a nonblank string`)
  if (seenIds.has(id)) throw new Error(`${location}.id duplicates another ID`)
  seenIds.add(id)

  return { id, title, completed: parseCompleted(value.completed, location) }
}

function parseTask(value: unknown, index: number, seenIds: Set<string>): Task {
  const location = `tasks[${index}]`
  if (!isRecord(value)) throw new Error(`${location} must be an object`)

  const id = parseTaskId(value.id)
  const title = parseTodoTitle(value.title)
  if (!id) throw new Error(`${location}.id must be a nonblank string`)
  if (!title) throw new Error(`${location}.title must be a nonblank string`)
  if (seenIds.has(id)) throw new Error(`${location}.id duplicates another ID`)
  if (!Array.isArray(value.subtasks)) throw new Error(`${location}.subtasks must be an array`)
  seenIds.add(id)

  return {
    id,
    title,
    completed: parseCompleted(value.completed, location),
    subtasks: value.subtasks.map((subtask, subtaskIndex) =>
      parseSubtask(subtask, `${location}.subtasks[${subtaskIndex}]`, seenIds),
    ),
  }
}

export function parsePersistedTodoState(value: unknown): TodoState {
  if (!isRecord(value)) throw new Error("Todo file must contain an object")
  if (value.version !== 1) throw new Error("Todo file version must be 1")
  if (!Array.isArray(value.tasks)) throw new Error("Todo file tasks must be an array")

  const seenIds = new Set<string>()
  return { tasks: value.tasks.map((task, index) => parseTask(task, index, seenIds)) }
}

function serialize(state: TodoState): string {
  const document: PersistedDocument = { version: 1, tasks: state.tasks }
  return JSON.stringify(document, null, 2) + "\n"
}

export class JsonTodoStore implements TodoStore {
  public constructor(private readonly filePath: string) {}

  public async load(): Promise<TodoState> {
    let contents: string
    try {
      contents = await readFile(this.filePath, "utf8")
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") return emptyTodoState()
      throw error
    }

    let document: unknown
    try {
      document = JSON.parse(contents) as unknown
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Could not parse ${this.filePath}: ${message}`)
    }

    try {
      return parsePersistedTodoState(document)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Invalid todo data in ${this.filePath}: ${message}`)
    }
  }

  public async replace(state: TodoState): Promise<void> {
    const directory = dirname(this.filePath)
    await mkdir(directory, { recursive: true })
    const tempPath = join(directory, `.${basename(this.filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`)
    let handle: Awaited<ReturnType<typeof open>> | null = null

    try {
      handle = await open(tempPath, "wx", 0o600)
      await handle.writeFile(serialize(state), "utf8")
      await handle.sync()
      await handle.close()
      handle = null
      await rename(tempPath, this.filePath)
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
  }
}
