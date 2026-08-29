import net from "node:net";

/**
 * The address a browser should load a running preview at.
 *
 * With a `template` (`RuntimeConfig.previewUrlTemplate`, e.g.
 * `https://p{port}.preview.example.com`) `{port}` is substituted and the result
 * used as-is — for a deployment that reverse-proxies each preview over one
 * HTTPS origin. Without one, the raw `http://<host>:<port>`.
 */
export function previewUrl(template: string | undefined, host: string, port: number): string {
  return template ? template.replaceAll("{port}", String(port)) : `http://${host}:${port}`;
}

/**
 * Preview servers need a port nobody else is using. Binding to test is the only
 * check that is not a race, and even then we track handed-out ports in-process
 * so two projects starting at once cannot be given the same one.
 */
const reserved = new Set<number>();

export async function allocatePort([min, max]: [number, number]): Promise<number> {
  for (let port = min; port <= max; port++) {
    if (reserved.has(port)) continue;
    if (await isFree(port)) {
      reserved.add(port);
      return port;
    }
  }
  throw new Error(`No free port available in range ${min}-${max}`);
}

export function releasePort(port: number): void {
  reserved.delete(port);
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

/** Poll until a dev server answers, so "running" means actually reachable. */
export async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ port, host: "127.0.0.1" });
      socket.setTimeout(1000);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (open) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
