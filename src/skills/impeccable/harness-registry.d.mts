export const HARNESS_ALIASES: Readonly<Record<string, string>>;
export const HARNESS_COMMANDS: ReadonlySet<string>;
export function resolveHarnessCommand(cmd: string): string | null;
export function listHarnessCommandNames(): string[];
export function isHarnessCommandName(cmd: string): boolean;
