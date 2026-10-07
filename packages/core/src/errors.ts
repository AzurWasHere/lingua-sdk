export class LinguaError extends Error {
  code: string;
  details?: unknown;

  constructor(message: string, code = "lingua", details?: unknown) {
    super(message);
    this.name = "LinguaError";
    this.code = code;
    this.details = details;
  }
}

export class ConfigError extends LinguaError {
  constructor(message: string, details?: unknown) {
    super(message, "config", details);
    this.name = "ConfigError";
  }
}
