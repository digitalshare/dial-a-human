import VapiImport from '@vapi-ai/web';

// The package is CommonJS; depending on the bundler the class is the import itself or its `default`.
type VapiClass = typeof VapiImport;
const Vapi: VapiClass =
  (VapiImport as unknown as { default?: VapiClass }).default ?? VapiImport;

export interface WebCallHandlers {
  onStart: () => void;
  onEnd: () => void;
  onError: (message: string) => void;
}

/** Browser-side Vapi call: the robot "phones" the operator through the laptop's mic and speakers. */
export class WebCall {
  private vapi: InstanceType<VapiClass>;

  constructor(publicKey: string, handlers: WebCallHandlers) {
    this.vapi = new Vapi(publicKey);
    this.vapi.on('call-start', handlers.onStart);
    this.vapi.on('call-end', handlers.onEnd);
    this.vapi.on('error', (err: unknown) => handlers.onError(describe(err)));
  }

  async start(assistant: Record<string, unknown>): Promise<void> {
    // The assistant is built on the server from the incident; its shape is Vapi's CreateAssistantDTO.
    await this.vapi.start(assistant as never);
  }

  stop(): void {
    void this.vapi.stop();
  }
}

function describe(err: unknown): string {
  if (typeof err === 'string') return err;
  const e = err as { message?: unknown; error?: { message?: unknown; msg?: unknown }; errorMsg?: unknown };
  const candidate = e?.error?.message ?? e?.error?.msg ?? e?.errorMsg ?? e?.message;
  if (typeof candidate === 'string') return candidate;
  if (Array.isArray(candidate)) return candidate.join('; ');
  try {
    return JSON.stringify(err).slice(0, 300);
  } catch {
    return 'Unknown call error';
  }
}
