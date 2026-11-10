# Dial-a-Human

A simulated warehouse robot that runs deliveries on its own and phones a human (via Vapi) when it hits a decision it is not allowed to make alone. The human answers, says what to do, and the robot carries on.

## Run

```bash
pnpm install
pnpm dev          # app on http://localhost:5173, server on :3001
```

The server reads `VAPI_API_PRIVATE_KEY` and `VAPI_API_PUBLIC_KEY` from the environment or `.env` (see `.env.example`) and opens a `cloudflared` quick tunnel so Vapi can reach the webhook.

## Demo

- **Spill a pallet ahead**: blocks the aisle once the robot is deep inside it. Small detours it handles itself; a long one makes it call.
- **Unlabelled package**: the robot picks up a package with no destination and calls to ask where it goes.
- Click any floor cell to drop or remove an obstacle.

By default the robot calls you in the browser (click **Answer**). To ring a real phone, import a Twilio/Telnyx/Vonage number into Vapi and set `VAPI_PHONE_NUMBER_ID` and `OPERATOR_PHONE`; free Vapi numbers cannot place outbound calls.

## How it works

- `src/sim/` runs the warehouse, pathfinding and the robot in the browser and builds an incident when the robot is stuck.
- `server/vapi.ts` turns the incident into a Vapi assistant with two tools, `send_robot_command` and `get_robot_status`.
- `server/index.ts` receives Vapi's tool calls and transcripts on a webhook, checks the command against what the robot can actually do, and relays it to the browser over a WebSocket.
