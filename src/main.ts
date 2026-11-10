import type {
  AppConfig,
  ClientWsMessage,
  Incident,
  IncidentResponse,
  ServerWsMessage,
} from '../shared/types';
import { WebCall } from './call/webCall';
import { cellFromEvent, draw, setupCanvas } from './render';
import { Sim } from './sim/robot';
import { startRinging, stopRinging, ui } from './ui';

const sim = new Sim();
const canvas = document.getElementById('floor') as HTMLCanvasElement;
const ctx = setupCanvas(canvas);

let config: AppConfig = { mode: 'web', publicKey: null, tunnelReady: false };
let webCall: WebCall | null = null;
/** True from the moment the robot starts calling until the call is over. */
let callActive = false;
let queued: Incident | null = null;
let socket: WebSocket | null = null;

sim.onLog = (text, tone) => ui.log(text, tone);
sim.onIncident = (incident) => void raise(incident);

// ---- calling ------------------------------------------------------------

async function raise(incident: Incident): Promise<void> {
  if (callActive) {
    queued = incident; // one call at a time; ring again once this one is over
    return;
  }
  callActive = true;
  ui.clearTranscript();
  ui.showCall('plain', 'R-7 is calling the operator…', incident.problem);

  let data: IncidentResponse;
  try {
    const res = await fetch('/api/incident', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(incident),
    });
    data = (await res.json()) as IncidentResponse;
  } catch {
    data = { error: 'Could not reach the local server. Is `pnpm dev` running?' };
  }

  if ('error' in data) return callFailed(data.error);

  if (data.mode === 'phone') {
    ui.log("Calling the operator's phone.", 'warn');
    ui.showCall('ringing', "Ringing the operator's phone…", incident.problem);
    return;
  }

  const assistant = data.assistant;
  ui.log('Calling the operator.', 'warn');
  startRinging();
  ui.showCall('ringing', 'Incoming call from Robot R-7', incident.problem, [
    {
      label: 'Answer',
      kind: 'primary',
      onClick: () => {
        stopRinging();
        ui.showCall('plain', 'Connecting…', 'Allow microphone access if the browser asks.');
        if (!webCall) return callFailed('Browser calling is not set up.');
        webCall.start(assistant).catch((err: unknown) => callFailed(String((err as Error)?.message ?? err)));
      },
    },
    { label: 'Decline', kind: 'danger', onClick: () => callEnded('declined') },
  ]);
}

function callConnected(): void {
  if (!callActive) return;
  stopRinging();
  const buttons =
    config.mode === 'web'
      ? [{ label: 'Hang up', kind: 'danger' as const, onClick: () => webCall?.stop() }]
      : [];
  ui.showCall('live', 'On the call with Robot R-7', 'Tell it what to do.', buttons);
}

function callFailed(message: string): void {
  stopRinging();
  callActive = false;
  ui.log(`Call failed: ${message}`, 'warn');
  sim.park();
  showParked(`Call failed: ${message}`, 'error');
}

function callEnded(reason?: string): void {
  if (!callActive) return;
  callActive = false;
  stopRinging();
  ui.log(`Call ended${reason ? ` (${reason})` : ''}.`);

  if (sim.state === 'awaiting_human') {
    sim.park();
    showParked('The call ended before the robot got an instruction.', 'plain');
  } else {
    ui.hideCall();
  }

  if (queued) {
    const next = queued;
    queued = null;
    if (sim.incident?.id === next.id) void raise(next);
  }
}

function showParked(sub: string, look: 'error' | 'plain'): void {
  if (sim.state !== 'parked') return ui.hideCall();
  ui.showCall(look, 'R-7 is parked and waiting', sub, [
    { label: 'Call again', kind: 'primary', onClick: () => sim.retryCall() },
  ]);
}

// ---- server link --------------------------------------------------------

function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.addEventListener('message', (e) => {
    const msg = JSON.parse(String(e.data)) as ServerWsMessage;
    if (msg.type === 'command') {
      const { action, target } = msg.command;
      if (sim.incident?.id === msg.command.incidentId && sim.applyCommand(msg.command)) {
        ui.log(`Operator decision: ${action.replace(/_/g, ' ')}${target ? ` → ${target}` : ''}.`, 'good');
        if (!callActive) ui.hideCall();
      }
    } else if (msg.type === 'transcript') {
      ui.addTranscript(msg.role, msg.text);
      if (msg.role === 'assistant') sim.say(msg.text);
    } else if (msg.type === 'call') {
      if (msg.status === 'in-progress') callConnected();
      if (msg.status === 'ended') callEnded(msg.detail);
    }
  });
  socket.addEventListener('close', () => window.setTimeout(connect, 1000));
}

function send(msg: ClientWsMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

async function loadConfig(): Promise<void> {
  try {
    config = (await (await fetch('/api/config')).json()) as AppConfig;
  } catch {
    ui.log('Local server is not reachable. Start it with `pnpm dev`.', 'warn');
    return;
  }
  ui.setMode(config.mode === 'phone' ? 'Phone' : 'Browser call');
  if (config.mode === 'web') {
    if (!config.publicKey) {
      ui.log('VAPI_API_PUBLIC_KEY is missing, so calls cannot start.', 'warn');
    } else if (!webCall) {
      try {
        webCall = new WebCall(config.publicKey, {
          onStart: callConnected,
          onEnd: () => callEnded(),
          onError: (message) => {
            if (callActive && sim.state === 'awaiting_human') callFailed(message);
            else ui.log(`Call error: ${message}`, 'warn');
          },
        });
      } catch (err) {
        ui.log(`Could not set up browser calling: ${(err as Error).message}`, 'warn');
      }
    }
  }
  if (!config.tunnelReady) window.setTimeout(loadConfig, 2000);
  else ui.log('Ready. Vapi can reach this machine.', 'good');
}

// ---- presenter controls -------------------------------------------------

canvas.addEventListener('click', (e) => {
  const cell = cellFromEvent(canvas, e);
  if (!sim.toggleObstacle(cell)) ui.log('Cannot place an obstacle there.');
});

document.getElementById('btn-spill')!.addEventListener('click', () => {
  sim.spillArmed = !sim.spillArmed;
  if (sim.spillArmed) ui.log('Presenter: a pallet will spill the next time R-7 is deep in an aisle.', 'warn');
});
document.getElementById('btn-unlabelled')!.addEventListener('click', () => sim.armUnlabelled());
document.getElementById('btn-clear')!.addEventListener('click', () => {
  sim.clearObstacles();
  ui.log('Presenter: obstacles cleared.');
});

// ---- main loop ----------------------------------------------------------

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  sim.update(dt);
  draw(ctx, sim, now);
  ui.setStatus(sim.state, sim.delivered, sim.battery);
  ui.setArmed('btn-spill', sim.spillArmed);
  ui.setArmed('btn-unlabelled', sim.unlabelledArmed || Boolean(sim.job?.unlabelled));
  requestAnimationFrame(frame);
}

window.setInterval(() => send({ type: 'status', text: sim.statusText() }), 1000);

// Lets a test or the console drive the simulation directly.
(window as unknown as { sim: Sim }).sim = sim;

connect();
void loadConfig();
requestAnimationFrame(frame);
