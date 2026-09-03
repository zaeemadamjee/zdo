const checks = [
  { name: "TypeScript", command: ["bun", "run", "typecheck"] },
  { name: "Behavior tests", command: ["bun", "test"] },
] as const

for (const check of checks) {
  console.log(`\n[verify] ${check.name}`)
  const child = Bun.spawn([...check.command], {
    cwd: import.meta.dir + "/..",
    stdout: "inherit",
    stderr: "inherit",
  })

  const exitCode = await child.exited
  if (exitCode !== 0) {
    console.error(`[verify] ${check.name} failed with exit code ${exitCode}`)
    process.exitCode = exitCode
    break
  }
}
