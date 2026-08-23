/**
 * @deepseek-ai/dsh-host-frontend-static — SPA dist server over the webserver
 * fallback seat: serves the built frontend directory with explicit index
 * entry points. A readable index renders at the dist root and configured index
 * path; a missing route-like path that accepts HTML serves the shell too, so
 * deep links survive a refresh. Missing static assets and non-HTML-accept
 * misses return 404, traversal outside the dist root is 403, unknown
 * extensions ship as octet-stream, and non-GET/HEAD is 405. Every
 * index response runs through the webserver's index render (structured
 * injection rows, then raw taps). The dist location is workspace knowledge of
 * the composing application, so `distIndex` is typically supplied through a
 * `!!js` expression, never hardcoded by a deployment.
 * @module @deepseek-ai/dsh-host-frontend-static
 */

import type { ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'frontend-static'

/** Service required before the fallback seat can be claimed. */
export const inject = ['webServer']

/** Plugin config: the dist anchor. */
export interface Config {
  /** Absolute path of index.html inside the dist root. */
  distIndex: string
}

export const Config: z<Config> = z.object({
  distIndex: z.string().required(),
})

const HTML_MIME = 'text/html; charset=utf-8'

const MIME: Record<string, string> = {
  '.html': HTML_MIME,
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

const STATIC_MISS_CODES: ReadonlySet<string | undefined> = new Set([
  'ENOENT',
  'EISDIR',
  'ENOTDIR',
])

/**
 * Static asset extensions that never fall back to the shell: a missing bundle
 * (a `.js`/`.css`/… path requested even with HTML accept) must surface as a
 * hard 404, not a disguised HTML page. Route-like paths (no such extension)
 * fall back when the request accepts HTML.
 */
const SPA_ASSET_EXTENSIONS: ReadonlySet<string> = new Set([
  '.js', '.mjs', '.cjs', '.css', '.map', '.svg', '.json', '.webmanifest',
])

/** Whether the request accepts an HTML response (the SPA deep-link gate). */
function acceptsHtml(accept: string | undefined): boolean {
  return accept !== undefined && accept.includes('text/html')
}

/**
 * Serve one GET/HEAD static request from the dist root.
 * @param pathname - decoded URL pathname of the request.
 * @param res - the node:http response to write.
 * @param distRoot - absolute dist root directory (resolved by the caller).
 * @param distIndex - absolute path of index.html inside distRoot.
 * @param renderIndex - produces the index.html body (structured injection
 * rendering) for the dist root and configured index path.
 * @param accept - the request's Accept header; a missing route-like target
 * that accepts HTML serves the shell (deep-link refresh), asset misses stay 404.
 */
export async function serveStatic(
  pathname: string, res: ServerResponse, distRoot: string, distIndex: string,
  renderIndex: () => Promise<string>, accept: string | undefined,
): Promise<void> {
  const target = resolve(normalize(join(distRoot, pathname)))
  // Traversal rejection: the target must be distRoot itself (`/`) or stay under
  // it. `sep`, not '/': resolve() emits backslash paths on Windows, where a '/'
  // suffix would reject every legitimate subpath as traversal.
  if (target !== distRoot && !target.startsWith(distRoot + sep)) {
    res.writeHead(403)
    res.end()
    return
  }
  let body: string | Buffer
  let type: string
  try {
    if (target === distRoot || target === distIndex) {
      body = await renderIndex()
      type = HTML_MIME
    } else {
      body = await readFile(target)
      type = MIME[extname(target)] ?? 'application/octet-stream'
    }
  } catch (error) {
    // Only absent or non-file targets are 404; other filesystem failures reach
    // the webserver's request-failure handling. A missing route-like target
    // that accepts HTML serves the shell instead (deep links survive a
    // refresh); missing static assets and non-HTML accepts stay 404.
    if (!STATIC_MISS_CODES.has((error as NodeJS.ErrnoException).code)) throw error
    if (acceptsHtml(accept) && !SPA_ASSET_EXTENSIONS.has(extname(target))) {
      body = await renderIndex()
      type = HTML_MIME
    } else {
      res.writeHead(404)
      res.end()
      return
    }
  }
  res.writeHead(200, { 'content-type': type })
  res.end(body)
}

/**
 * Claim the webserver fallback seat and serve the dist.
 * @param ctx - plugin context carrying the webServer service.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const distIndex = config.distIndex
  const distRoot = dirname(distIndex)
  const renderIndex = async (): Promise<string> =>
    ctx.webServer.renderIndex(await readFile(distIndex, 'utf8'))
  ctx.effect(() => ctx.webServer.registerFallback(async (req, res) => {
    // Non-GET/HEAD without a matching named route is 405 (fallback-only
    // semantics: named routes own their method handling).
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      res.end()
      return
    }
    /* v8 ignore next -- node:http always sets url on server requests */
    const rawPath = new URL(req.url ?? '/', 'http://x').pathname
    await serveStatic(decodeURIComponent(rawPath), res, distRoot, distIndex, renderIndex, req.headers.accept)
  }), 'frontend-static: fallback seat')
}
