declare const taskIdBrand: unique symbol
declare const subtaskIdBrand: unique symbol
declare const todoTitleBrand: unique symbol

export type TaskId = string & { readonly [taskIdBrand]: true }
export type SubtaskId = string & { readonly [subtaskIdBrand]: true }
export type TodoTitle = string & { readonly [todoTitleBrand]: true }

export type Subtask = Readonly<{
  id: SubtaskId
  title: TodoTitle
  completed: boolean
}>

export type Task = Readonly<{
  id: TaskId
  title: TodoTitle
  completed: boolean
  subtasks: readonly Subtask[]
}>

export type TodoState = Readonly<{
  tasks: readonly Task[]
}>

export type ItemRef =
  | Readonly<{ kind: "task"; taskId: TaskId }>
  | Readonly<{ kind: "subtask"; taskId: TaskId; subtaskId: SubtaskId }>

export type TodoMutation =
  | Readonly<{ kind: "insert-task"; task: Task }>
  | Readonly<{ kind: "insert-subtask"; taskId: TaskId; subtask: Subtask }>
  | Readonly<{ kind: "toggle"; target: ItemRef }>
  | Readonly<{ kind: "rename"; target: ItemRef; title: TodoTitle }>
  | Readonly<{ kind: "remove"; target: ItemRef }>

export type MutationResult =
  | Readonly<{ kind: "changed"; state: TodoState }>
  | Readonly<{ kind: "rejected"; reason: "missing-target" | "duplicate-id" }>

export type CompletionCounts = Readonly<{
  completedTasks: number
  totalTasks: number
  completedSubtasks: number
  totalSubtasks: number
}>

export const emptyTodoState = (): TodoState => ({ tasks: [] })

export function parseTaskId(value: unknown): TaskId | null {
  return typeof value === "string" && value.trim().length > 0 ? (value as TaskId) : null
}

export function parseSubtaskId(value: unknown): SubtaskId | null {
  return typeof value === "string" && value.trim().length > 0 ? (value as SubtaskId) : null
}

export function parseTodoTitle(value: unknown): TodoTitle | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized.length > 0 ? (normalized as TodoTitle) : null
}

export function makeTask(title: TodoTitle, id = crypto.randomUUID()): Task {
  const parsedId = parseTaskId(id)
  if (!parsedId) throw new Error("Task IDs must not be blank")
  return { id: parsedId, title, completed: false, subtasks: [] }
}

export function makeSubtask(title: TodoTitle, id = crypto.randomUUID()): Subtask {
  const parsedId = parseSubtaskId(id)
  if (!parsedId) throw new Error("Subtask IDs must not be blank")
  return { id: parsedId, title, completed: false }
}

export function sameItemRef(left: ItemRef | null, right: ItemRef | null): boolean {
  if (left === null || right === null) return left === right
  if (left.kind !== right.kind || left.taskId !== right.taskId) return false
  return left.kind === "task" || left.subtaskId === (right as Extract<ItemRef, { kind: "subtask" }>).subtaskId
}

export function parentTaskId(target: ItemRef): TaskId {
  return target.taskId
}

function hasId(state: TodoState, candidate: string): boolean {
  return state.tasks.some(
    (task) => task.id === candidate || task.subtasks.some((subtask) => subtask.id === candidate),
  )
}

type ItemPatch = <T extends Task | Subtask>(item: T) => T

function updateItem(state: TodoState, target: ItemRef, patch: ItemPatch): MutationResult {
  let found = false
  const tasks = state.tasks.map((task) => {
    if (task.id !== target.taskId) return task
    if (target.kind === "task") {
      found = true
      return patch(task)
    }
    const subtasks = task.subtasks.map((subtask) => {
      if (subtask.id !== target.subtaskId) return subtask
      found = true
      return patch(subtask)
    })
    return found ? { ...task, subtasks } : task
  })
  return found ? { kind: "changed", state: { tasks } } : { kind: "rejected", reason: "missing-target" }
}

export function applyMutation(state: TodoState, mutation: TodoMutation): MutationResult {
  switch (mutation.kind) {
    case "insert-task": {
      if (hasId(state, mutation.task.id)) return { kind: "rejected", reason: "duplicate-id" }
      return { kind: "changed", state: { tasks: [...state.tasks, mutation.task] } }
    }
    case "insert-subtask": {
      if (hasId(state, mutation.subtask.id)) return { kind: "rejected", reason: "duplicate-id" }
      let found = false
      const tasks = state.tasks.map((task) => {
        if (task.id !== mutation.taskId) return task
        found = true
        return { ...task, subtasks: [...task.subtasks, mutation.subtask] }
      })
      return found ? { kind: "changed", state: { tasks } } : { kind: "rejected", reason: "missing-target" }
    }
    case "toggle":
      return updateItem(state, mutation.target, (item) => ({ ...item, completed: !item.completed }))
    case "rename":
      return updateItem(state, mutation.target, (item) => ({ ...item, title: mutation.title }))
    case "remove": {
      if (mutation.target.kind === "task") {
        const tasks = state.tasks.filter((task) => task.id !== mutation.target.taskId)
        return tasks.length === state.tasks.length
          ? { kind: "rejected", reason: "missing-target" }
          : { kind: "changed", state: { tasks } }
      }

      const target = mutation.target
      let found = false
      const tasks = state.tasks.map((task) => {
        if (task.id !== target.taskId) return task
        const subtasks = task.subtasks.filter((subtask) => subtask.id !== target.subtaskId)
        found = subtasks.length !== task.subtasks.length
        return found ? { ...task, subtasks } : task
      })
      return found ? { kind: "changed", state: { tasks } } : { kind: "rejected", reason: "missing-target" }
    }
  }
}

export function countCompletion(state: TodoState): CompletionCounts {
  let completedSubtasks = 0
  let totalSubtasks = 0

  for (const task of state.tasks) {
    totalSubtasks += task.subtasks.length
    completedSubtasks += task.subtasks.filter((subtask) => subtask.completed).length
  }

  return {
    completedTasks: state.tasks.filter((task) => task.completed).length,
    totalTasks: state.tasks.length,
    completedSubtasks,
    totalSubtasks,
  }
}
