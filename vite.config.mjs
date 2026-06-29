import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'
import http from 'http'
import https from 'https'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  // Tauri CLI expects a fixed port, fail if that port is not available
  server: {
    port: 5173,
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
})
