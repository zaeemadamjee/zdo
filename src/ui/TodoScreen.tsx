import type { MouseEvent } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { useMemo, useRef, useState } from "react"
import {
  chooseSelection,
  clampScrollTop,
  flattenRows,
  moveSelection,
  revealSelection,
  taskIdForSubtaskInsertion,
  type SelectionEffect,
  type TodoRow,
} from "../app/todo-rows"
import type { TodoIntent, TodoSession } from "../app/todo-session"
import { countCompletion, sameItemRef, type ItemRef, type TodoState } from "../domain/todos"

type BrowseMode = Readonly<{ kind: "browse" }>
type AddMode = Readonly<{
  kind: "add"
  target: "task" | "subtask"
  parentTaskId?: Extract<ItemRef, { kind: "task" }>["taskId"]
}>
type ConfirmMode = Readonly<{
  kind: "confirm-delete"
  target: Extract<ItemRef, { kind: "task" }>
  childCount: number
}>
type ScreenMode = BrowseMode | AddMode | ConfirmMode

export type TodoScreenProps = Readonly<{
  session: TodoSession
  onQuit: () => void | Promise<void>
}>

const colors = {
  background: "#111827",
  panel: "#182234",
  border: "#45556c",
  selected: "#243b5a",
  hovered: "#1e3049",
  text: "#e5e7eb",
  muted: "#94a3b8",
  accent: "#67e8f9",
  success: "#86efac",
  danger: "#fda4af",
  warning: "#fde68a",
} as const

function itemKey(ref: ItemRef): string {
  return ref.kind === "task" ? `task:${ref.taskId}` : `subtask:${ref.taskId}:${ref.subtaskId}`
}

function isInside(event: MouseEvent): boolean {
  const target = event.currentTarget
  return target !== null
    && event.x >= target.x
    && event.x < target.x + target.width
    && event.y >= target.y
    && event.y < target.y + target.height
}

type PressHandlers = Readonly<{
  onMouseDown: (event: MouseEvent) => void
  onMouseUp: (event: MouseEvent) => void
}>

type ActionButtonProps = Readonly<{
  id: string
  label: string
  tone?: "normal" | "danger"
  disabled?: boolean
  hovered: boolean
  setHovered: (id: string | null) => void
  pressHandlers: (id: string, action: () => void) => PressHandlers
  onPress: () => void
}>

function ActionButton({
  id,
  label,
  tone = "normal",
  disabled = false,
  hovered,
  setHovered,
  pressHandlers,
  onPress,
}: ActionButtonProps) {
  const handlers = pressHandlers(id, () => {
    if (!disabled) onPress()
  })
  return (
    <box
      height={1}
      paddingX={1}
      backgroundColor={hovered && !disabled ? colors.hovered : colors.panel}
      onMouseDown={handlers.onMouseDown}
      onMouseUp={handlers.onMouseUp}
      onMouseOver={(event) => {
        event.stopPropagation()
        if (!disabled) setHovered(id)
      }}
      onMouseOut={(event) => {
        event.stopPropagation()
        setHovered(null)
      }}
    >
      <text fg={disabled ? colors.muted : tone === "danger" ? colors.danger : colors.accent} selectable={false}>
        {label}
      </text>
    </box>
  )
}

type TodoRowViewProps = Readonly<{
  row: TodoRow
  selected: boolean
  hovered: boolean
  showSubtaskCount: boolean
  disabled: boolean
  setHovered: (id: string | null) => void
  select: (target: ItemRef) => void
  toggle: (target: ItemRef) => void
  pressHandlers: (id: string, action: () => void) => PressHandlers
}>

function TodoRowView({
  row,
  selected,
  hovered,
  showSubtaskCount,
  disabled,
  setHovered,
  select,
  toggle,
  pressHandlers,
}: TodoRowViewProps) {
  const key = itemKey(row.ref)
  const rowHandlers = pressHandlers(`row:${key}`, () => select(row.ref))
  const checkboxHandlers = pressHandlers(`checkbox:${key}`, () => {
    select(row.ref)
    if (!disabled) toggle(row.ref)
  })
  const backgroundColor = selected ? colors.selected : hovered ? colors.hovered : colors.background

  return (
    <box
      id={`row-${key}`}
      height={1}
      width="100%"
      flexDirection="row"
      backgroundColor={backgroundColor}
      onMouseDown={(event) => {
        select(row.ref)
        rowHandlers.onMouseDown(event)
      }}
      onMouseUp={rowHandlers.onMouseUp}
      onMouseOver={(event) => {
        event.stopPropagation()
        setHovered(key)
      }}
      onMouseOut={(event) => {
        event.stopPropagation()
        setHovered(null)
      }}
    >
      <box width={2}><text fg={colors.accent} selectable={false}>{selected ? "›" : " "}</text></box>
      <box width={row.depth === 1 ? 2 : 0}><text selectable={false}>{row.depth === 1 ? "└ " : ""}</text></box>
      <box
        width={4}
        onMouseDown={(event) => {
          event.stopPropagation()
          select(row.ref)
          checkboxHandlers.onMouseDown(event)
        }}
        onMouseUp={(event) => {
          event.stopPropagation()
          checkboxHandlers.onMouseUp(event)
        }}
      >
        <text fg={row.completed ? colors.success : colors.muted} selectable={false}>
          {row.completed ? "[x]" : "[ ]"}
        </text>
      </box>
      <box flexGrow={1} minWidth={1}>
        <text
          fg={row.completed ? colors.muted : colors.text}
          wrapMode="none"
          truncate={true}
          selectable={false}
        >
          {row.title}
        </text>
      </box>
      {row.ref.kind === "task" && showSubtaskCount ? (
        <box width={15} alignItems="flex-end">
          <text fg={colors.muted} selectable={false}>
            {row.completedSubtasks}/{row.totalSubtasks} subtasks
          </text>
        </box>
      ) : null}
    </box>
  )
}

export function TodoScreen({ session, onQuit }: TodoScreenProps) {
  const dimensions = useTerminalDimensions()
  const [state, setState] = useState<TodoState>(() => session.snapshot())
  const rows = useMemo(() => flattenRows(state), [state])
  const [selection, setSelection] = useState<ItemRef | null>(() => flattenRows(session.snapshot())[0]?.ref ?? null)
  const [mode, setMode] = useState<ScreenMode>({ kind: "browse" })
  const [draft, setDraft] = useState("")
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState("Ready")
  const [hovered, setHovered] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const pressedControl = useRef<string | null>(null)
  const selectionRef = useRef<ItemRef | null>(selection)
  const pendingRef = useRef(false)

  const extraPanelRows = mode.kind === "browse" ? 0 : 3
  const viewportRows = Math.max(1, dimensions.height - 8 - extraPanelRows)
  const safeScrollTop = clampScrollTop(rows.length, viewportRows, scrollTop)
  const visibleRows = rows.slice(safeScrollTop, safeScrollTop + viewportRows)
  const counts = countCompletion(state)

  const pressHandlers = (id: string, action: () => void): PressHandlers => ({
    onMouseDown: (event) => {
      if (event.button !== 0) return
      event.stopPropagation()
      pressedControl.current = id
    },
    onMouseUp: (event) => {
      if (event.button !== 0) return
      event.stopPropagation()
      const shouldAct = pressedControl.current === id && isInside(event)
      pressedControl.current = null
      if (shouldAct) action()
    },
  })

  const select = (target: ItemRef) => {
    selectionRef.current = target
    setSelection(target)
    setScrollTop((current) => revealSelection(rows, target, current, viewportRows))
  }

  const execute = async (intent: TodoIntent, effect: SelectionEffect) => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    const beforeRows = rows
    const priorSelection = selectionRef.current
    const result = await session.execute(intent)

    if (result.kind === "committed") {
      const afterRows = flattenRows(result.snapshot)
      const resolvedEffect = result.created ? { kind: "created", target: result.created } as const : effect
      const nextSelection = chooseSelection(beforeRows, afterRows, priorSelection, resolvedEffect)
      setState(result.snapshot)
      selectionRef.current = nextSelection
      setSelection(nextSelection)
      setScrollTop((current) => revealSelection(afterRows, nextSelection, current, viewportRows))
      setNotice("Saved")
    } else {
      setNotice(result.message)
    }
    pendingRef.current = false
    setPending(false)
  }

  const beginAddTask = () => {
    if (pendingRef.current) return
    setDraft("")
    setMode({ kind: "add", target: "task" })
    setNotice("Enter a task title")
  }

  const beginAddSubtask = () => {
    if (pendingRef.current) return
    const taskId = taskIdForSubtaskInsertion(selectionRef.current)
    if (!taskId) {
      setNotice("Select a task before adding a subtask")
      return
    }
    setDraft("")
    setMode({ kind: "add", target: "subtask", parentTaskId: taskId })
    setNotice("Enter a subtask title")
  }

  const submitAdd = (title: string) => {
    if (mode.kind !== "add") return
    const intent: TodoIntent = mode.target === "task"
      ? { kind: "add-task", title }
      : { kind: "add-subtask", taskId: mode.parentTaskId!, title }
    setMode({ kind: "browse" })
    void execute(intent, { kind: "retain" })
  }

  const toggle = (target: ItemRef) => {
    if (mode.kind !== "browse") return
    void execute({ kind: "toggle", target }, { kind: "retain" })
  }

  const confirmOrDelete = () => {
    const currentRow = rows.find((row) => sameItemRef(row.ref, selectionRef.current)) ?? null
    if (pendingRef.current || mode.kind !== "browse" || !currentRow) return
    if (currentRow.ref.kind === "task" && (currentRow.totalSubtasks ?? 0) > 0) {
      setMode({
        kind: "confirm-delete",
        target: currentRow.ref,
        childCount: currentRow.totalSubtasks ?? 0,
      })
      setNotice("Deleting a task also deletes its subtasks")
      return
    }
    void execute({ kind: "remove", target: currentRow.ref }, { kind: "removed" })
  }

  const confirmDelete = () => {
    if (mode.kind !== "confirm-delete") return
    const target = mode.target
    setMode({ kind: "browse" })
    void execute({ kind: "remove", target }, { kind: "removed" })
  }

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault()
      void onQuit()
      return
    }

    if (mode.kind === "add") {
      if (key.name === "escape") {
        key.preventDefault()
        setMode({ kind: "browse" })
        setNotice("Add cancelled")
      } else if (key.name === "return") {
        key.preventDefault()
        submitAdd(draft)
      }
      return
    }

    if (mode.kind === "confirm-delete") {
      if (key.name === "y" || key.name === "return") {
        key.preventDefault()
        confirmDelete()
      } else if (key.name === "n" || key.name === "escape") {
        key.preventDefault()
        setMode({ kind: "browse" })
        setNotice("Delete cancelled")
      }
      return
    }

    switch (key.name) {
      case "q":
        key.preventDefault()
        void onQuit()
        break
      case "up":
      case "k": {
        key.preventDefault()
        const next = moveSelection(rows, selectionRef.current, -1)
        selectionRef.current = next
        setSelection(next)
        setScrollTop((current) => revealSelection(rows, next, current, viewportRows))
        break
      }
      case "down":
      case "j": {
        key.preventDefault()
        const next = moveSelection(rows, selectionRef.current, 1)
        selectionRef.current = next
        setSelection(next)
        setScrollTop((current) => revealSelection(rows, next, current, viewportRows))
        break
      }
      case "a":
        key.preventDefault()
        beginAddTask()
        break
      case "s":
        key.preventDefault()
        beginAddSubtask()
        break
      case "space":
        key.preventDefault()
        if (selectionRef.current && !pendingRef.current) toggle(selectionRef.current)
        break
      case "d":
        key.preventDefault()
        confirmOrDelete()
        break
    }
  })

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      paddingX={1}
      paddingY={1}
      backgroundColor={colors.background}
      onMouseUp={() => { pressedControl.current = null }}
    >
      <box height={1} flexDirection="row" justifyContent="space-between">
        <text fg={colors.accent} selectable={false}>zdo</text>
        <text fg={pending ? colors.warning : colors.muted} selectable={false}>{pending ? "saving…" : "local"}</text>
      </box>
      <box height={1}>
        <text fg={colors.muted} selectable={false}>
          Tasks {counts.completedTasks}/{counts.totalTasks} done  |  Subtasks {counts.completedSubtasks}/{counts.totalSubtasks} done
        </text>
      </box>

      <box
        height={viewportRows + 2}
        width="100%"
        flexDirection="column"
        border={true}
        borderColor={colors.border}
        title=" Todos "
        onMouseScroll={(event) => {
          event.stopPropagation()
          if (event.scroll?.direction === "up") {
            setScrollTop((current) => clampScrollTop(rows.length, viewportRows, current - Math.max(1, event.scroll!.delta)))
          } else if (event.scroll?.direction === "down") {
            setScrollTop((current) => clampScrollTop(rows.length, viewportRows, current + Math.max(1, event.scroll!.delta)))
          }
        }}
      >
        {visibleRows.length === 0 ? (
          <box height={1} paddingX={1}><text fg={colors.muted} selectable={false}>No tasks yet. Press a or click Add task.</text></box>
        ) : visibleRows.map((row) => (
          <TodoRowView
            key={itemKey(row.ref)}
            row={row}
            selected={sameItemRef(row.ref, selection)}
            hovered={hovered === itemKey(row.ref)}
            showSubtaskCount={dimensions.width >= 50}
            disabled={pending || mode.kind !== "browse"}
            setHovered={setHovered}
            select={(target) => {
              if (mode.kind === "browse") select(target)
            }}
            toggle={toggle}
            pressHandlers={pressHandlers}
          />
        ))}
      </box>

      {mode.kind === "add" ? (
        <box height={3} width="100%" border={true} borderColor={colors.accent} title={mode.target === "task" ? " New task " : " New subtask "}>
          <input
            focused={true}
            width="100%"
            placeholder="Type a title, then press Enter"
            value={draft}
            onInput={setDraft}
          />
        </box>
      ) : mode.kind === "confirm-delete" ? (
        <box height={3} width="100%" border={true} borderColor={colors.danger} flexDirection="row" gap={1} paddingX={1}>
          <box flexGrow={1}>
            <text fg={colors.warning} truncate={true} selectable={false}>Delete task and {mode.childCount} subtask{mode.childCount === 1 ? "" : "s"}?</text>
          </box>
          <ActionButton
            id="confirm-cancel"
            label="Cancel"
            hovered={hovered === "confirm-cancel"}
            setHovered={setHovered}
            pressHandlers={pressHandlers}
            onPress={() => {
              setMode({ kind: "browse" })
              setNotice("Delete cancelled")
            }}
          />
          <ActionButton
            id="confirm-delete"
            label="Delete"
            tone="danger"
            hovered={hovered === "confirm-delete"}
            setHovered={setHovered}
            pressHandlers={pressHandlers}
            onPress={confirmDelete}
          />
        </box>
      ) : null}

      <box height={1} width="100%">
        <text fg={notice.startsWith("Could not") ? colors.danger : colors.muted} truncate={true} selectable={false}>{notice}</text>
      </box>
      <box height={1} width="100%" flexDirection="row" gap={1}>
        <ActionButton
          id="add-task"
          label="[a] Add task"
          disabled={pending || mode.kind !== "browse"}
          hovered={hovered === "add-task"}
          setHovered={setHovered}
          pressHandlers={pressHandlers}
          onPress={beginAddTask}
        />
        <ActionButton
          id="add-subtask"
          label="[s] Add subtask"
          disabled={pending || mode.kind !== "browse" || selection === null}
          hovered={hovered === "add-subtask"}
          setHovered={setHovered}
          pressHandlers={pressHandlers}
          onPress={beginAddSubtask}
        />
        <ActionButton
          id="delete"
          label="[d] Delete"
          tone="danger"
          disabled={pending || mode.kind !== "browse" || selection === null}
          hovered={hovered === "delete"}
          setHovered={setHovered}
          pressHandlers={pressHandlers}
          onPress={confirmOrDelete}
        />
        <box flexGrow={1} />
        <text fg={colors.muted} selectable={false}>j/k move  space toggle  q quit</text>
      </box>
    </box>
  )
}
