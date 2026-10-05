import { importNetworkFile } from "../lib/server/network-store.mjs"
import { migrateDatabaseFile, resolveDatabasePath } from "../lib/server/database.mjs"

const [command, ...args] = process.argv.slice(2)

try {
  if (command === "migrate") {
    const version = migrateDatabaseFile()
    console.log(`Database migrated to schema version ${version}: ${resolveDatabasePath()}`)
  } else if (command === "import") {
    const sourcePath = args[0] === "--" ? args[1] : args[0]
    if (!sourcePath) throw new Error("Usage: pnpm db:import -- <path-to-network.json>")
    const result = importNetworkFile(sourcePath)
    console.log(
      result.alreadyImported
        ? `Dataset already imported; no changes made: ${sourcePath}`
        : `Dataset imported: ${sourcePath}`
    )
  } else {
    throw new Error("Usage: node scripts/database.mjs <migrate|import> [path]")
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
