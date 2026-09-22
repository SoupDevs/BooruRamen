import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'
import http from 'http'
import https from 'https'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// --- Custom-booru dev proxy helpers -----------------------------------------
// Requests look like /api/custom/<base64url(origin)>/rest/of/path. The origin is
// encoded rather than inline so query strings and paths on the target are
// preserved exactly as the adapter built them.
function decodeCustomTarget(rawUrl) {
  const value = String(rawUrl || '').replace(/^\/api\/custom/, '')
  const match = value.match(/^\/([^/?]+)(\/[^?]*)?(\?.*)?$/)
  if (!match) return null
  try {
    const origin = Buffer.from(match[1], 'base64url').toString('utf8')
    const parsed = new URL(origin)
    return {
      origin: `${parsed.protocol}//${parsed.host}`,
      host: parsed.host,
      path: match[2] || '/',
      query: match[3] || ''
    }
  } catch {
    return null
  }
}

// Shared trailing labels of two hostnames, minus the trap where the only match
// is a compound public suffix such as "co.uk". Used to keep the media proxy to
// one site without hardcoding a host list.
function hostsShareSite(a, b) {
  const left = String(a || '').toLowerCase().split('.').filter(Boolean)
  const right = String(b || '').toLowerCase().split('.').filter(Boolean)
  let shared = 0
  while (
    shared < left.length && shared < right.length &&
    left[left.length - 1 - shared] === right[right.length - 1 - shared]
  ) shared += 1
  if (shared < 2) return false
  const tail = left.slice(left.length - shared, left.length - shared + 2)
  if (shared === 2 && tail[1].length === 2 &&
      ['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'].includes(tail[0])) return false
  return true
}
// ---------------------------------------------------------------------------

const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'))

// https://vite.dev/config/
const config = {
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  // Tauri CLI expects a fixed port, fail if that port is not available.
  // PORT overrides it so extra dev servers can run alongside a Tauri one.
  server: {
    host: true,
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    proxy: {
      '/api/safebooru': {
        target: 'https://safebooru.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/safebooru/, ''),
        secure: false,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            proxyReq.removeHeader('referer');
            proxyReq.removeHeader('origin');
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            proxyReq.removeHeader('cookie');
          });
        }
      },
      '/api/gelbooru': {
        target: 'https://gelbooru.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gelbooru/, ''),
        secure: false,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            proxyReq.setHeader('Referer', 'https://gelbooru.com/');
            proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            proxyReq.removeHeader('cookie');
          });
        }
      },
      '/api/konachan': {
        target: 'https://konachan.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/konachan/, ''),
      },
      '/api/yande': {
        target: 'https://yande.re',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/yande/, ''),
      },
      '/api/danbooru': {
        target: 'https://danbooru.donmai.us',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/danbooru/, ''),
      },
    }
  },
  // to make use of `TAURI_PLATFORM`, `TAURI_ARCH`, `TAURI_FAMILY`, `TAURI_PLATFORM_VERSION`, `TAURI_PLATFORM_TYPE` and `TAURI_DEBUG`
  // env variables
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // Tauri supports es2021
    target: process.env.TAURI_PLATFORM == 'windows' ? 'chrome105' : 'safari13',
    // don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },
  configureServer(server) {
    // Custom boorus: the user can point the app at any booru URL, so the dev
    // server cannot know the host list ahead of time. The app requests
    // /api/custom/<base64url(origin)>/<path> and this streams the response from
    // that booru, which keeps custom sources working in the browser where CORS
    // would otherwise block them (the packaged app uses the Tauri HTTP plugin).
    // Redirects are followed here as well: boorus commonly 301 their API to a
    // dedicated host, and the browser must not be left to chase that cross-
    // origin on its own.
    server.middlewares.use('/api/custom', async (req, res) => {
      const target = decodeCustomTarget(req.url)
      if (!target) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Invalid custom booru target')
        return
      }

      const requestOnce = (urlObject) => new Promise((resolve, reject) => {
        const client = urlObject.protocol === 'https:' ? https : http
        const proxyReq = client.request(urlObject, {
          method: req.method || 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': req.headers.accept || 'application/json, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Host': urlObject.host,
          },
          rejectUnauthorized: false,
        }, (proxyRes) => resolve({ proxyRes, urlObject }))
        proxyReq.on('error', reject)
        proxyReq.end()
      })

      try {
        let hop = await requestOnce(new URL(`${target.path}${target.query}`, target.origin))
        const visited = new Set([hop.urlObject.href])
        for (let redirects = 0; redirects < 5; redirects++) {
          const { statusCode, headers } = hop.proxyRes
          if (statusCode < 300 || statusCode >= 400 || !headers.location) break
          const nextUrl = new URL(headers.location, hop.urlObject)
          hop.proxyRes.resume()
          if (visited.has(nextUrl.href)) break
          visited.add(nextUrl.href)
          hop = await requestOnce(nextUrl)
        }

        const { proxyRes, urlObject } = hop
        const responseHeaders = { ...proxyRes.headers }
        delete responseHeaders['content-security-policy']
        delete responseHeaders['cross-origin-resource-policy']
        delete responseHeaders['x-frame-options']
        // Lets the app learn the address the API really lives on, so it can
        // save that origin instead of repeating the redirect on every call.
        responseHeaders['x-booru-final-origin'] = `${urlObject.protocol}//${urlObject.host}`
        res.writeHead(proxyRes.statusCode || 502, responseHeaders)
        proxyRes.pipe(res)
      } catch (error) {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' })
        res.end(`Custom booru proxy error: ${error.message}`)
      }
    })

    // Some boorus reject media hotlinks unless requests identify the booru as
    // the referring site, and browser code cannot set that header. Development
    // therefore streams such media through this same-origin proxy, which is
    // open to any site the user configured but only when the media lives on the
    // same site as the referer the app supplies.
    server.middlewares.use('/booru-media', async (req, res) => {
      const requestUrl = new URL(req.url, 'http://localhost')
      const mediaUrl = requestUrl.searchParams.get('url')
      const refererUrl = requestUrl.searchParams.get('referer')

      let parsedMediaUrl
      let parsedReferer
      try {
        parsedMediaUrl = new URL(mediaUrl)
        parsedReferer = new URL(refererUrl)
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Invalid media URL')
        return
      }

      const hostname = parsedMediaUrl.hostname.toLowerCase()
      const refererHost = parsedReferer.hostname.toLowerCase()
      if (parsedMediaUrl.protocol !== 'https:' || parsedReferer.protocol !== 'https:') {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end('Only HTTPS media URLs are allowed')
        return
      }
      if (!hostsShareSite(hostname, refererHost)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end("Media URL must belong to the booru's own site")
        return
      }

      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': req.headers.accept || '*/*',
        'Referer': parsedReferer.href,
      }
      if (req.headers.range) headers.Range = req.headers.range

      const proxyReq = https.request(parsedMediaUrl, { method: req.method, headers }, (proxyRes) => {
        const responseHeaders = { ...proxyRes.headers }
        delete responseHeaders['content-security-policy']
        delete responseHeaders['cross-origin-resource-policy']
        delete responseHeaders['x-frame-options']
        res.writeHead(proxyRes.statusCode || 502, responseHeaders)
        proxyRes.pipe(res)
      })

      proxyReq.on('error', () => {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' })
        res.end('Media proxy error')
      })
      proxyReq.end()
    })

    // Custom middleware to proxy video requests from Danbooru CDN
    // This bypasses CORP/CORS restrictions by fetching server-side
    server.middlewares.use('/video-proxy', async (req, res) => {
      // Get the encoded URL from path (e.g., /video-proxy/https%3A%2F%2F...)
      const pathname = req.url.split('?')[0]
      const prefix = '/video-proxy/'
      if (!pathname.startsWith(prefix)) {
        res.writeHead(400)
        res.end('Invalid path')
        return
      }
      
      const encodedUrl = pathname.slice(prefix.length)
      const decodedUrl = decodeURIComponent(encodedUrl)
      
      // Only allow danbooru/video CDN URLs
      if (!decodedUrl.startsWith('https://cdn.donmai.us/') && 
          !decodedUrl.startsWith('https://video-cdn')) {
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end('Only Danbooru CDN URLs are allowed')
        return
      }

      const client = decodedUrl.startsWith('https:') ? https : http
      
      const proxyReq = client.request(decodedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'video/mp4,video/webm,video/*;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://danbooru.donmai.us/',
        },
        rejectUnauthorized: false,
      }, (proxyRes) => {
        // Check if we got video content or a Cloudflare challenge page
        const contentType = proxyRes.headers['content-type'] || '';
        if (!contentType.startsWith('video/') && !contentType.startsWith('application/octet-stream')) {
          // CDN returned non-video content (likely Cloudflare challenge)
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('CDN blocked request');
          return;
        }
        // Forward response headers, overriding CORS
        const headers = { ...proxyRes.headers }
        headers['Access-Control-Allow-Origin'] = '*'
        headers['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS'
        headers['Access-Control-Allow-Headers'] = 'Range, Content-Type'
        headers['Access-Control-Expose-Headers'] = 'Content-Length, Content-Range, Accept-Ranges'
        delete headers['cross-origin-resource-policy']
        delete headers['cross-origin-opener-policy']
        delete headers['x-frame-options']
        delete headers['content-security-policy']
        
        res.writeHead(proxyRes.statusCode, headers)
        proxyRes.pipe(res, { end: true })
      })

      proxyReq.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(502)
          res.end('Proxy error')
        }
      })

      proxyReq.end()
    })
  }
}

// configureServer is a Vite plugin hook, not a top-level config hook.
config.plugins.push({
  name: 'booruramen-media-proxies',
  configureServer: config.configureServer,
})
delete config.configureServer

export default defineConfig(config)
