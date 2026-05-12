import express from "express"

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(express.json())

app.get("/health", (_req, res) => {
  res.json({ status: "ok" })
})

app.listen(PORT, () => {
  console.log(`MCP server running on http://localhost:${PORT}`)
})
