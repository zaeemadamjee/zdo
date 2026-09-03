import {
  applyMutation,
  makeSubtask,
  makeTask,
  parseTodoTitle,
  type ItemRef,
  type TaskId,
  type TodoMutation,
  type TodoState,
} from "../domain/todos"
import type { TodoStore } from "../storage/json-todo-store"

export type TodoIntent =
  | Readonly<{ kind: "add-task"; title: string }>
  | Readonly<{ kind: "add-subtask"; taskId: TaskId; title: string }>
  | Readonly<{ kind: "toggle"; target: ItemRef }>
  | Readonly<{ kind: "remove"; target: ItemRef }>

export type ExecuteResult =
  | Readonly<{ kind: "committed"; snapshot: TodoState; created: ItemRef | null }>
  | Readonly<{ kind: "rejected"; snapshot: TodoState; message: string }>
  | Readonly<{ kind: "failed"; snapshot: TodoState; message: string }>

export interface TodoSession {
  snapshot(): TodoState
  execute(intent: TodoIntent): Promise<ExecuteResult>
  close(): Promise<void>
}

function prepareMutation(intent: TodoIntent): { mutation: TodoMutation; created: ItemRef | null } | string {
  switch (intent.kind) {
    case "add-task": {
      const title = parseTodoTitle(intent.title)
      if (!title) return "Task title must not be blank"
      const task = makeTask(title)
      return { mutation: { kind: "insert-task", task }, created: { kind: "task", taskId: task.id } }
    }
    case "add-subtask": {
      const title = parseTodoTitle(intent.title)
      if (!title) return "Subtask title must not be blank"
      const subtask = makeSubtask(title)
      return {
        mutation: { kind: "insert-subtask", taskId: intent.taskId, subtask },
        created: { kind: "subtask", taskId: intent.taskId, subtaskId: subtask.id },
      }
    }
    case "toggle":
      return { mutation: intent, created: null }
    case "remove":
      return { mutation: intent, created: null }
  }
}

export async function openTodoSession(store: TodoStore): Promise<TodoSession> {
  let committed = await store.load()
  let accepting = true
  let queue: Promise<void> = Promise.resolve()

  const execute = (intent: TodoIntent): Promise<ExecuteResult> => {
    if (!accepting) {
      return Promise.resolve({ kind: "failed", snapshot: committed, message: "Todo session is closing" })
    }

    let resolveResult!: (result: ExecuteResult) => void
    const result = new Promise<ExecuteResult>((resolve) => {
      resolveResult = resolve
    })

    queue = queue.then(async () => {
      const prepared = prepareMutation(intent)
      if (typeof prepared === "string") {
        resolveResult({ kind: "rejected", snapshot: committed, message: prepared })
        return
      }

      const transition = applyMutation(committed, prepared.mutation)
      if (transition.kind === "rejected") {
        resolveResult({
          kind: "rejected",
          snapshot: committed,
          message: transition.reason === "duplicate-id" ? "An item with that ID already exists" : "That item no longer exists",
        })
        return
      }

      try {
        await store.replace(transition.state)
        committed = transition.state
        resolveResult({ kind: "committed", snapshot: committed, created: prepared.created })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        resolveResult({ kind: "failed", snapshot: committed, message: `Could not save todos: ${message}` })
      }
    })

    return result
  }

  return {
    snapshot: () => committed,
    execute,
    close: async () => {
      accepting = false
      await queue
    },
  }
}
