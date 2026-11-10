import { ALL_ACTIONS, type Incident } from '../shared/types';

const VAPI_API = 'https://api.vapi.ai';

function listOut(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}

function systemPrompt(incident: Incident): string {
  const options = incident.options
    .map((o) => {
      const targets = o.targets ? ` (target must be one of: ${o.targets.join(', ')})` : '';
      return `- ${o.action}${targets}: ${o.spoken}`;
    })
    .join('\n');

  return `You are the voice of ${incident.robotId}, an autonomous warehouse robot. You have hit a problem you are not allowed to resolve alone, so you are phoning the human operator on duty to get a decision.

The problem: ${incident.problem}

The only actions you can take right now:
${options}

How to handle the call:
- This is a phone call. Speak in short, plain sentences. No lists, no symbols, never more than two sentences at a time.
- You have already explained the problem and the options in your opening line. Do not repeat them unless asked.
- As soon as the operator's instruction clearly matches one of the actions, call send_robot_command straight away. Do not ask them to confirm.
- If the instruction is unclear, or asks for something that is not in the list, say you cannot do that and offer the available options again in one sentence.
- If the operator asks how you are doing, where you are, or about battery or deliveries, call get_robot_status and answer from it.
- After send_robot_command succeeds, tell the operator what you are doing in one sentence, thank them, and end the call with the endCall tool.
- If the operator says they cannot decide now or tells you to stand by, say you will stay parked and end the call.
- You are a robot at work: calm, brief, a little dry. Never invent actions, locations or facts.`;
}

/** Inline (transient) assistant for one incident. Used for both phone and web calls. */
export function buildAssistant(incident: Incident, webhookUrl: string): Record<string, unknown> {
  const server = { url: webhookUrl };
  const opening = `Hi, this is robot ${incident.robotId.replace('-', ' ')} on the warehouse floor. ${incident.problem} I can ${listOut(
    incident.options.map((o) => o.spoken),
  )}. What should I do?`;

  return {
    name: `Robot ${incident.robotId}`,
    firstMessage: opening,
    firstMessageMode: 'assistant-speaks-first',
    maxDurationSeconds: 180,
    backgroundSound: 'off',
    metadata: { incidentId: incident.id },
    server,
    serverMessages: ['tool-calls', 'transcript', 'status-update', 'end-of-call-report'],
    model: {
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      temperature: 0.3,
      maxTokens: 300,
      messages: [{ role: 'system', content: systemPrompt(incident) }],
      tools: [
        {
          type: 'function',
          server,
          function: {
            name: 'send_robot_command',
            description:
              "Carry out the operator's decision. Only use an action that is currently available for this incident.",
            parameters: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ALL_ACTIONS.filter((a) => incident.options.some((o) => o.action === a)),
                  description: 'The action the operator chose.',
                },
                target: {
                  type: 'string',
                  description:
                    'Destination name, only for deliver_to. For example "Dock B".',
                },
              },
              required: ['action'],
            },
          },
        },
        {
          type: 'function',
          server,
          function: {
            name: 'get_robot_status',
            description:
              "Get the robot's live status: what it is doing, where it is, battery level and deliveries so far.",
            parameters: { type: 'object', properties: {} },
          },
        },
        { type: 'endCall' },
      ],
    },
  };
}

/** Ring a real phone. Needs a number imported into Vapi (free Vapi numbers are inbound only). */
export async function startPhoneCall(p: {
  apiKey: string;
  phoneNumberId: string;
  operatorNumber: string;
  assistant: Record<string, unknown>;
}): Promise<string> {
  const res = await fetch(`${VAPI_API}/call`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${p.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      phoneNumberId: p.phoneNumberId,
      customer: { number: p.operatorNumber },
      assistant: p.assistant,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; message?: unknown };
  if (!res.ok || !body.id) {
    const reason = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    throw new Error(`Vapi refused the call (${res.status}): ${reason ?? 'no details'}`);
  }
  return body.id;
}
