import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  AppConfig,
  ClientWsMessage,
  Incident,
  IncidentResponse,
  RobotCommand,
  ServerWsMessage,
} from '../shared/types';
import { openTunnel } from './tunnel';
import { buildAssistant, startPhoneCall } from './vapi';

const PORT = Number(process.env.PORT ?? 3001);
const env = process.env;
const privateKey = env.VAPI_API_PRIVATE_KEY ?? env.VAPI_API_KEY ?? '';
const publicKey = env.VAPI_API_PUBLIC_KEY ?? env.VAPI_PUBLIC_KEY ?? '';
const phoneNumberId = env.VAPI_PHONE_NUMBER_ID ?? '';
const operatorPhone = env.OPERATOR_PHONE ?? '';
const phoneReady = Boolean(privateKey && phoneNumberId && operatorPhone);
const mode: 'web' | 'phone' =
  env.CALL_MODE === 'web' ? 'web' : env.CALL_MODE === 'phone' || phoneReady ? 'phone' : 'web';

/** Unguessable webhook path, so only Vapi calls we started can drive the robot. */
const webhookToken = randomBytes(12).toString('hex');
let publicUrl = env.PUBLIC_URL?.replace(/\/$/, '') ?? '';

let incident: Incident | null = null;
let resolved = false;
let callOver = true;
/** Vapi id of the call for the current incident, so late webhooks from an older call are ignored. */
let callId: string | null = null;
let robotStatus = 'Status is not available yet.';

const app = express();
app.use(express.json({ limit: '5mb' }));
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(msg: ServerWsMessage): void {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as ClientWsMessage;
      if (msg.type === 'status' && typeof msg.text === 'string') robotStatus = msg.text;
    } catch {
      // ignore malformed frames
    }
  });
});

app.get('/api/config', (_req, res) => {
  const config: AppConfig = { mode, publicKey: publicKey || null, tunnelReady: Boolean(publicUrl) };
  res.json(config);
});

app.post('/api/incident', async (req, res) => {
  const reply = (body: IncidentResponse, status = 200) => res.status(status).json(body);
  const body = req.body as Incident;
  if (!body?.id || !Array.isArray(body.options)) return reply({ error: 'Bad incident.' }, 400);
  if (!publicUrl) return reply({ error: 'The public tunnel is not ready yet. Try again in a few seconds.' }, 503);

  incident = body;
  resolved = false;
  callOver = false;
  callId = null;
  const assistant = buildAssistant(body, `${publicUrl}/api/vapi/webhook/${webhookToken}`);
  console.log(`[incident] ${body.kind} at ${body.location} -> ${mode} call`);

  if (mode === 'web') {
    if (!publicKey) return reply({ error: 'VAPI_API_PUBLIC_KEY is not set, so the browser cannot start a call.' }, 500);
    return reply({ mode: 'web', assistant });
  }
  if (!phoneReady) {
    return reply({ error: 'Phone mode needs VAPI_API_PRIVATE_KEY, VAPI_PHONE_NUMBER_ID and OPERATOR_PHONE.' }, 500);
  }
  try {
    callId = await startPhoneCall({
      apiKey: privateKey,
      phoneNumberId,
      operatorNumber: operatorPhone,
      assistant,
    });
    broadcast({ type: 'call', status: 'dialing' });
    return reply({ mode: 'phone', callId });
  } catch (err) {
    callOver = true;
    return reply({ error: (err as Error).message }, 502);
  }
});

interface ToolCall {
  id: string;
  function?: { name?: string; arguments?: unknown };
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/** Check the operator's decision against what the robot can actually do, then pass it on. */
function runCommand(args: Record<string, unknown>): { result: string } | { error: string } {
  if (!incident) return { error: 'There is no open incident.' };
  if (resolved) return { error: 'A decision has already been carried out for this incident.' };

  const available = incident.options.map((o) => o.action).join(', ');
  const option = incident.options.find((o) => o.action === args.action);
  if (!option) return { error: `That action is not possible right now. Available actions: ${available}.` };

  let target: string | undefined;
  if (option.targets) {
    const said = String(args.target ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    target = option.targets.find((t) => {
      const name = t.toLowerCase().replace(/[^a-z0-9]/g, '');
      return said !== '' && (name === said || name.endsWith(said) || said.endsWith(name));
    });
    if (!target) return { error: `Unknown target. Valid targets: ${option.targets.join(', ')}.` };
  }

  const command: RobotCommand = { incidentId: incident.id, action: option.action, target };
  resolved = true;
  broadcast({ type: 'command', command });
  console.log(`[command] ${command.action}${target ? ` -> ${target}` : ''}`);
  return { result: option.effect.replace('{target}', target ?? '') };
}

function endCall(detail?: string): void {
  if (callOver) return;
  callOver = true;
  broadcast({ type: 'call', status: 'ended', detail });
}

app.post('/api/vapi/webhook/:token', (req, res) => {
  if (req.params.token !== webhookToken) return res.status(404).end();
  const message = req.body?.message as Record<string, any> | undefined;
  const type = String(message?.type ?? '');
  const fromCall: string | undefined = message?.call?.id;
  const ending = type === 'end-of-call-report' || (type === 'status-update' && message?.status === 'ended');
  if (fromCall && !callId && !ending) callId = fromCall;
  if (fromCall && fromCall !== callId) return res.json({}); // a webhook from an earlier call

  if (type === 'tool-calls') {
    const calls = (message?.toolCallList ?? []) as ToolCall[];
    const results = calls.map((call) => {
      const name = call.function?.name;
      if (name === 'send_robot_command') {
        return { toolCallId: call.id, ...runCommand(parseArgs(call.function?.arguments)) };
      }
      if (name === 'get_robot_status') return { toolCallId: call.id, result: robotStatus };
      return { toolCallId: call.id, error: `Unknown tool ${name}.` };
    });
    return res.json({ results });
  }

  if (type.startsWith('transcript')) {
    const text = String(message?.transcript ?? '').trim();
    const role = message?.role === 'user' ? 'user' : 'assistant';
    if (message?.transcriptType === 'final' && text) broadcast({ type: 'transcript', role, text });
  } else if (type === 'status-update') {
    if (message?.status === 'in-progress') broadcast({ type: 'call', status: 'in-progress' });
    if (message?.status === 'ended') endCall(message?.endedReason);
  } else if (type === 'end-of-call-report') {
    endCall(message?.endedReason);
  }
  return res.json({});
});

server.listen(PORT, async () => {
  console.log(`[server] listening on http://localhost:${PORT} (call mode: ${mode})`);
  if (!privateKey && mode === 'phone') console.warn('[server] VAPI_API_PRIVATE_KEY is not set.');
  if (!publicKey && mode === 'web') console.warn('[server] VAPI_API_PUBLIC_KEY is not set.');
  if (publicUrl) {
    console.log(`[tunnel] using PUBLIC_URL ${publicUrl}`);
    return;
  }
  try {
    publicUrl = await openTunnel(PORT);
    console.log(`[tunnel] ${publicUrl}`);
  } catch (err) {
    console.error(`[tunnel] ${(err as Error).message}. Set PUBLIC_URL in .env to a tunnel you run yourself.`);
  }
});
