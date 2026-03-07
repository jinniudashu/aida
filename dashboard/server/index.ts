import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import app from './routes.js'
import path from 'node:path'
import fs from 'node:fs'

const port = Number(process.env.BPS_API_PORT) || 3456

// Serve static files from dist/client/ in production
const clientDir = path.resolve(import.meta.dirname, '..', 'dist', 'client')
if (fs.existsSync(clientDir)) {
  const staticRoot = path.relative(process.cwd(), clientDir) || '.'
  app.use('/*', serveStatic({ root: staticRoot }))
  // SPA fallback: serve index.html for non-API, non-file routes
  app.get('*', (c) => {
    return c.html(fs.readFileSync(path.join(clientDir, 'index.html'), 'utf-8'))
  })
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`[bps-api] Server running at http://localhost:${port}`)
})
