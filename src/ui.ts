import type { RobotState } from './sim/robot';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const STATE_LABEL: Record<RobotState, string> = {
  idle: 'Idle',
  to_pick: 'Heading to pickup',
  to_drop: 'Delivering',
  returning: 'Returning to base',
  awaiting_human: 'Stuck: needs a human',
  waiting_clear: 'Waiting for the path to clear',
  parked: 'Parked: no instruction',
};
const STATE_COLOR: Record<RobotState, string> = {
  idle: '#8b98a8',
  to_pick: '#2dd4bf',
  to_drop: '#2dd4bf',
  returning: '#60a5fa',
  awaiting_human: '#f87171',
  waiting_clear: '#fbbf24',
  parked: '#fbbf24',
};

export interface CallButton {
  label: string;
  kind?: 'primary' | 'danger';
  onClick: () => void;
}

export const ui = {
  setStatus(state: RobotState, delivered: number, battery: number): void {
    $('status-text').textContent = STATE_LABEL[state];
    $('status-dot').style.background = STATE_COLOR[state];
    $('stat-delivered').textContent = String(delivered);
    $('stat-battery').textContent = `${Math.round(battery)}%`;
  },

  setMode(text: string): void {
    $('stat-mode').textContent = text;
  },

  setArmed(id: 'btn-spill' | 'btn-unlabelled', armed: boolean): void {
    $(id).classList.toggle('armed', armed);
  },

  /** Show the call card. `look` drives the border and the ringing pulse. */
  showCall(
    look: 'ringing' | 'live' | 'error' | 'plain',
    title: string,
    sub: string,
    buttons: CallButton[] = [],
  ): void {
    const card = $('call');
    card.className = `card show ${look}`;
    $('call-title').textContent = title;
    $('call-sub').textContent = sub;
    const actions = $('call-actions');
    actions.replaceChildren(
      ...buttons.map((b) => {
        const el = document.createElement('button');
        el.textContent = b.label;
        if (b.kind) el.className = b.kind;
        el.addEventListener('click', b.onClick);
        return el;
      }),
    );
  },

  hideCall(): void {
    $('call').className = 'card';
  },

  clearTranscript(): void {
    $('transcript').replaceChildren();
  },

  addTranscript(role: 'assistant' | 'user', text: string): void {
    const list = $('transcript');
    list.querySelector('.empty')?.remove();
    // Speech arrives in fragments; keep one bubble per speaker turn.
    const lastLine = list.lastElementChild;
    if (lastLine?.classList.contains(role)) {
      lastLine.append(` ${text}`);
      list.scrollTop = list.scrollHeight;
      return;
    }
    const el = document.createElement('div');
    el.className = `line ${role}`;
    const who = document.createElement('small');
    who.textContent = role === 'assistant' ? 'Robot R-7' : 'Operator';
    el.append(who, text);
    list.append(el);
    list.scrollTop = list.scrollHeight;
  },

  log(text: string, tone: 'info' | 'warn' | 'good' = 'info'): void {
    const list = $('log');
    const el = document.createElement('div');
    el.className = `log ${tone === 'info' ? '' : tone}`;
    const time = new Date().toLocaleTimeString([], { hour12: false });
    el.textContent = `${time}  ${text}`;
    list.append(el);
    while (list.childElementCount > 200) list.firstElementChild?.remove();
    list.scrollTop = list.scrollHeight;
  },
};

// ---- ringtone ---------------------------------------------------------------

let audio: AudioContext | null = null;
let ringTimer: number | null = null;

function beep(): void {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    for (const [freq, at] of [
      [880, 0],
      [1100, 0.18],
    ] as const) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + at);
      gain.gain.exponentialRampToValueAtTime(0.12, t + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.16);
      osc.connect(gain).connect(audio.destination);
      osc.start(t + at);
      osc.stop(t + at + 0.18);
    }
  } catch {
    // audio is a nicety; never let it break the demo
  }
}

export function startRinging(): void {
  stopRinging();
  beep();
  ringTimer = window.setInterval(beep, 1400);
}

export function stopRinging(): void {
  if (ringTimer !== null) window.clearInterval(ringTimer);
  ringTimer = null;
}
