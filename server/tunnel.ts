import { spawn } from 'node:child_process';

/**
 * Open a Cloudflare quick tunnel to the local server so Vapi can reach the webhook.
 * Resolves with the public https URL.
 */
export function openTunnel(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    const onData = (chunk: Buffer) => {
      const match = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !settled) {
        settled = true;
        resolve(match[0]);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      if (!settled) reject(new Error(`Could not start cloudflared: ${err.message}`));
    });
    child.on('exit', (code) => {
      if (!settled) reject(new Error(`cloudflared exited early (code ${code})`));
      else console.error(`[tunnel] cloudflared exited (code ${code}). Restart the server to get a new tunnel.`);
    });
    const stop = () => child.kill();
    process.on('exit', stop);
    process.on('SIGINT', () => {
      stop();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      stop();
      process.exit(0);
    });
  });
}
