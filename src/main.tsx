#!/usr/bin/env bun

import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { homedir } from "node:os"
import { join } from "node:path"
import { openTodoSession } from "./app/todo-session"
import { JsonTodoStore } from "./storage/json-todo-store"
import { TodoScreen } from "./ui/TodoScreen"

export function defaultDataPath(environment: NodeJS.ProcessEnv = process.env): string {
  const override = environment.ZDO_DATA_PATH?.trim()
  if (override) return override

  const dataHome = environment.XDG_DATA_HOME?.trim()
  return join(dataHome || join(homedir(), ".local", "share"), "zdo", "todos.json")
}

async function main(): Promise<void> {
  const store = new JsonTodoStore(defaultDataPath())
  const session = await openTodoSession(store)
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    exitSignals: [],
    useMouse: true,
    enableMouseMovement: true,
    screenMode: "alternate-screen",
  })
  const root = createRoot(renderer)
  let shutdownPromise: Promise<void> | null = null

  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise
    shutdownPromise = (async () => {
      process.off("SIGINT", handleSignal)
      process.off("SIGTERM", handleSignal)
      await session.close()
      root.unmount()
      renderer.destroy()
    })()
    return shutdownPromise
  }

  const handleSignal = () => {
    void shutdown()
  }

  process.on("SIGINT", handleSignal)
  process.on("SIGTERM", handleSignal)
  root.render(<TodoScreen session={session} onQuit={shutdown} />)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`zdo could not start: ${message}`)
    process.exitCode = 1
  })
}
