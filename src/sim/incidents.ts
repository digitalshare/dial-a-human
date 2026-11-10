import type { Incident, IncidentOption } from '../../shared/types';

let counter = 0;
const nextId = () => `inc-${Date.now().toString(36)}-${++counter}`;

export function blockedIncident(p: {
  robotId: string;
  where: string;
  destination: string;
  /** Extra cells the detour costs, or null when there is no way round at all. */
  extraCells: number | null;
  carrying: boolean;
}): Incident {
  const options: IncidentOption[] = [];
  if (p.extraCells !== null) {
    options.push({
      action: 'reroute',
      spoken: `take a detour of about ${p.extraCells} extra metres`,
      effect: `Rerouting now. The detour adds about ${p.extraCells} metres.`,
    });
  }
  options.push({
    action: 'wait',
    spoken: 'wait here until someone clears it',
    effect: 'Holding position. I will carry on as soon as the path is clear.',
  });
  if (!p.carrying) {
    options.push({
      action: 'skip_job',
      spoken: 'skip this pickup and move to the next job',
      effect: 'Skipping this pickup and moving to the next job.',
    });
  }
  options.push({
    action: 'return_to_base',
    spoken: p.carrying ? 'bring the package back to base' : 'return to base',
    effect: p.carrying ? 'Bringing the package back to base.' : 'Returning to base.',
  });

  const way =
    p.extraCells === null
      ? 'and I cannot find any other way through'
      : 'and the only way round is a long detour';
  return {
    id: nextId(),
    kind: 'blocked_path',
    robotId: p.robotId,
    location: p.where,
    problem: `Something is blocking ${p.where} on my way to ${p.destination}, ${way}.`,
    options,
  };
}

export function unlabelledIncident(p: {
  robotId: string;
  where: string;
  /** Speakable name, e.g. "package 101". */
  packageId: string;
  docks: string[];
}): Incident {
  return {
    id: nextId(),
    kind: 'unlabelled_package',
    robotId: p.robotId,
    location: p.where,
    problem: `I just picked up ${p.packageId} in ${p.where}, but its label is missing, so I don't know where it goes.`,
    options: [
      {
        action: 'deliver_to',
        spoken: `take it to ${listOut(p.docks)}`,
        effect: 'Taking the package to {target}.',
        targets: p.docks,
      },
      {
        action: 'set_aside',
        spoken: 'set it aside in quarantine for inspection',
        effect: 'Setting the package aside in quarantine for inspection.',
      },
      {
        action: 'return_to_base',
        spoken: 'bring it back to base',
        effect: 'Bringing the package back to base.',
      },
    ],
  };
}

function listOut(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}
