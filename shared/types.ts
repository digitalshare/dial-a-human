export interface Cell {
  x: number;
  y: number;
}

export type Action =
  | 'reroute'
  | 'wait'
  | 'skip_job'
  | 'deliver_to'
  | 'set_aside'
  | 'return_to_base';

export const ALL_ACTIONS: Action[] = [
  'reroute',
  'wait',
  'skip_job',
  'deliver_to',
  'set_aside',
  'return_to_base',
];

export interface IncidentOption {
  action: Action;
  /** How the robot offers this option out loud, e.g. "take a detour that is 8 cells longer". */
  spoken: string;
  /** What the robot reports once the option is chosen. "{target}" is replaced by the chosen target. */
  effect: string;
  /** Allowed targets, when the action needs one (deliver_to). */
  targets?: string[];
}

export interface Incident {
  id: string;
  kind: 'blocked_path' | 'unlabelled_package';
  robotId: string;
  /** One or two spoken sentences describing the problem. */
  problem: string;
  location: string;
  options: IncidentOption[];
}

export interface RobotCommand {
  incidentId: string;
  action: Action;
  target?: string;
}

export type CallStatus = 'dialing' | 'in-progress' | 'ended';

/** Server -> browser */
export type ServerWsMessage =
  | { type: 'command'; command: RobotCommand }
  | { type: 'transcript'; role: 'assistant' | 'user'; text: string }
  | { type: 'call'; status: CallStatus; detail?: string };

/** Browser -> server */
export type ClientWsMessage = { type: 'status'; text: string };

export type IncidentResponse =
  | { mode: 'web'; assistant: Record<string, unknown> }
  | { mode: 'phone'; callId: string }
  | { error: string };

export interface AppConfig {
  mode: 'web' | 'phone';
  publicKey: string | null;
  tunnelReady: boolean;
}
