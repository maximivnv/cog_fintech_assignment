export type PlatformErrorCode =
  | "permission_denied"
  | "invalid_input"
  | "not_found"
  | "invalid_state"
  | "separation_of_duties";

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;

  constructor(code: PlatformErrorCode, message: string) {
    super(message);
    this.name = "PlatformError";
    this.code = code;
  }
}

export class PermissionDeniedError extends PlatformError {
  constructor(message = "Permission denied") {
    super("permission_denied", message);
    this.name = "PermissionDeniedError";
  }
}

export class InvalidInputError extends PlatformError {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super("invalid_input", `Invalid input: ${issues.join("; ")}`);
    this.name = "InvalidInputError";
    this.issues = issues;
  }
}

export class NotFoundError extends PlatformError {
  constructor(message = "Not found") {
    super("not_found", message);
    this.name = "NotFoundError";
  }
}

export class InvalidStateError extends PlatformError {
  constructor(message: string) {
    super("invalid_state", message);
    this.name = "InvalidStateError";
  }
}

export class SeparationOfDutiesError extends PlatformError {
  constructor(message = "You cannot decide your own request") {
    super("separation_of_duties", message);
    this.name = "SeparationOfDutiesError";
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
