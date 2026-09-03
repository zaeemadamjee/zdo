import {
  parentTaskId,
  sameItemRef,
  type ItemRef,
  type TaskId,
  type TodoState,
  type TodoTitle,
} from "../domain/todos"

export type TodoRow = Readonly<{
  ref: ItemRef
  title: TodoTitle
  completed: boolean
  depth: 0 | 1
  completedSubtasks?: number
  totalSubtasks?: number
}>

export type SelectionEffect =
  | Readonly<{ kind: "retain" }>
  | Readonly<{ kind: "created"; target: ItemRef }>
  | Readonly<{ kind: "removed" }>

export function flattenRows(state: TodoState): readonly TodoRow[] {
  return state.tasks.flatMap((task) => [
    {
      ref: { kind: "task", taskId: task.id } as const,
      title: task.title,
      completed: task.completed,
      depth: 0 as const,
      completedSubtasks: task.subtasks.filter((subtask) => subtask.completed).length,
      totalSubtasks: task.subtasks.length,
    },
    ...task.subtasks.map((subtask) => ({
      ref: { kind: "subtask", taskId: task.id, subtaskId: subtask.id } as const,
      title: subtask.title,
      completed: subtask.completed,
      depth: 1 as const,
    })),
  ])
}

export function taskIdForSubtaskInsertion(selection: ItemRef | null): TaskId | null {
  return selection === null ? null : parentTaskId(selection)
}

export function moveSelection(
  rows: readonly TodoRow[],
  selection: ItemRef | null,
  delta: -1 | 1,
): ItemRef | null {
  if (rows.length === 0) return null
  const currentIndex = rows.findIndex((row) => sameItemRef(row.ref, selection))
  const startIndex = currentIndex < 0 ? (delta > 0 ? -1 : rows.length) : currentIndex
  const nextIndex = Math.max(0, Math.min(rows.length - 1, startIndex + delta))
  return rows[nextIndex]?.ref ?? null
}

export function chooseSelection(
  beforeRows: readonly TodoRow[],
  afterRows: readonly TodoRow[],
  priorSelection: ItemRef | null,
  effect: SelectionEffect,
): ItemRef | null {
  if (afterRows.length === 0) return null
  if (effect.kind === "created") return effect.target

  const retained = afterRows.find((row) => sameItemRef(row.ref, priorSelection))
  if (retained) return retained.ref
  if (effect.kind === "retain") return afterRows[0]?.ref ?? null

  const oldIndex = Math.max(0, beforeRows.findIndex((row) => sameItemRef(row.ref, priorSelection)))
  return afterRows[Math.min(oldIndex, afterRows.length - 1)]?.ref ?? null
}

export function clampScrollTop(totalRows: number, viewportRows: number, scrollTop: number): number {
  return Math.max(0, Math.min(scrollTop, Math.max(0, totalRows - Math.max(1, viewportRows))))
}

export function revealSelection(
  rows: readonly TodoRow[],
  selection: ItemRef | null,
  scrollTop: number,
  viewportRows: number,
): number {
  const clamped = clampScrollTop(rows.length, viewportRows, scrollTop)
  const index = rows.findIndex((row) => sameItemRef(row.ref, selection))
  if (index < 0 || index < clamped) return index < 0 ? clamped : index
  if (index >= clamped + viewportRows) return index - viewportRows + 1
  return clamped
}
