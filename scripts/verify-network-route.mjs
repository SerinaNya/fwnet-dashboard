import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { GET } from "../app/api/network/route.ts"
import { isSameOriginMutation } from "../lib/server/request-origin.mjs"

function postRequest(url, headers) {
  return new Request(url, { method: "POST", headers })
}

assert.equal(
  isSameOriginMutation(
    postRequest("http://0.0.0.0:3000/api/network", {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "sec-fetch-site": "same-origin",
    }),
    undefined
  ),
  true
)
assert.equal(
  isSameOriginMutation(
    postRequest("http://0.0.0.0:3000/api/network", {
      host: "localhost:3000",
      origin: "http://attacker.localhost:3000",
      "sec-fetch-site": "same-site",
    }),
    undefined
  ),
  false
)
assert.equal(
  isSameOriginMutation(
    postRequest("http://0.0.0.0:3000/api/network", {
      host: "localhost:3000",
      origin: "http://localhost:3000",
    }),
    "   "
  ),
  true
)
assert.equal(
  isSameOriginMutation(
    postRequest("http://0.0.0.0:3000/api/network", {
      host: "localhost:3000",
      origin: "https://dashboard.example",
    }),
    "not an origin"
  ),
  false
)
assert.equal(
  isSameOriginMutation(
    postRequest("http://0.0.0.0:3000/api/network", {
      host: "localhost:3000",
      origin: "http://localhost:3000/path",
    }),
    undefined
  ),
  false
)
assert.equal(
  isSameOriginMutation(
    postRequest("http://0.0.0.0:3000/api/network", {
      host: "localhost:3000/path",
      origin: "http://localhost:3000",
    }),
    undefined
  ),
  false
)
assert.equal(
  isSameOriginMutation(
    postRequest("http://0.0.0.0:3000/api/network", {
      host: "0.0.0.0:3000",
      origin: "https://dashboard.example",
      "x-forwarded-host": "dashboard.example",
      "sec-fetch-site": "same-origin",
    }),
    "https://dashboard.example"
  ),
  true
)
assert.equal(
  isSameOriginMutation(
    postRequest("http://0.0.0.0:3000/api/network", {
      host: "0.0.0.0:3000",
      origin: "https://dashboard.example",
      "x-forwarded-host": "dashboard.example",
    }),
    undefined
  ),
  false
)
assert.equal(
  isSameOriginMutation(
    postRequest("http://0.0.0.0:3000/api/network", {
      host: "localhost:3000",
      origin: "http://localhost:3000",
      "sec-fetch-site": "cross-site",
    }),
    undefined
  ),
  false
)

const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "fwnet-route-verify-"))
const previousDatabasePath = process.env.DATABASE_PATH
process.env.DATABASE_PATH = path.join(tempDirectory, "empty.sqlite")
try {
  const response = await GET()
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    error: null,
    data: { maintainers: [], asns: [], roas: [], isAdmin: false },
  })
} finally {
  if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH
  else process.env.DATABASE_PATH = previousDatabasePath
  rmSync(tempDirectory, { recursive: true, force: true })
}

console.log("Network route verification passed.")
