// Serves site/ for a local look, or the folder SITE names (SITE=.build/site
// for the copy GitHub Pages gets). HOST and PORT come from the environment;
// it never listens on every address.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)), process.env.SITE || "site") + sep;
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 8931);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, path.endsWith("/") ? path + "index.html" : path);
  if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
}).listen(port, host, () => console.log(`http://${host}:${port}`));
