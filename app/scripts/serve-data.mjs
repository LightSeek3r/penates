// Dev-only static server for pipeline output: CORS + HTTP Range, as R2 serves it.
// usage: node scripts/serve-data.mjs <dir> [port]
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

const root = resolve(process.argv[2] ?? '../data/build/current')
const port = Number(process.argv[3] ?? 8788)
const types = { '.json': 'application/json', '.pmtiles': 'application/octet-stream' }

createServer((req, res) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'range',
    'access-control-expose-headers': 'content-range, content-length, etag',
  }
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end()

  const path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)))
  if (path !== root && !path.startsWith(root + sep)) return res.writeHead(403, cors).end()

  let stat
  try {
    stat = statSync(path)
    if (!stat.isFile()) throw new Error('not a file')
  } catch {
    return res.writeHead(404, cors).end()
  }

  const headers = {
    ...cors,
    'content-type': types[extname(path)] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  if (!range) {
    res.writeHead(200, { ...headers, 'content-length': stat.size })
    return createReadStream(path).pipe(res)
  }
  const start = range[1] === '' ? stat.size - Number(range[2]) : Number(range[1])
  const end = range[1] === '' || range[2] === '' ? stat.size - 1 : Math.min(Number(range[2]), stat.size - 1)
  if (start > end || start >= stat.size) return res.writeHead(416, { ...cors, 'content-range': `bytes */${stat.size}` }).end()
  res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1 })
  createReadStream(path, { start, end }).pipe(res)
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`))
