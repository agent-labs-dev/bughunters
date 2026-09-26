import { ExitCode, type ExitCodeValue } from './exit-codes.js';

export class BughuntersError extends Error {
  readonly exitCode: ExitCodeValue;
  constructor(message: string, exitCode: ExitCodeValue, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.exitCode = exitCode;
  }
}

export class ConfigError extends BughuntersError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, ExitCode.Usage, options);
  }
}

/**
 * Anything that means "Bughunters could not test". Deliberately a distinct class,
 * because it must never be reported as a product failure.
 */
export class InfrastructureError extends BughuntersError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, ExitCode.Infrastructure, options);
  }
}

export class ReconRequiredError extends BughuntersError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, ExitCode.ReconRequired, options);
  }
}
