import type { RunResult } from "../../../scripts/deploy/wrangler_secrets.mjs";

export interface Put {
  readonly name: string;
  readonly value: string;
}

/** A fake `wrangler secret` for the scripts: records puts, lists the names it was given. */
export class FakeSecrets {
  readonly puts: Put[] = [];
  listed = 0;

  constructor(private readonly set: readonly string[] = []) {}

  names(): Set<string> {
    this.listed += 1;
    return new Set(this.set);
  }

  put(name: string, value: string): void {
    this.puts.push({ name, value });
  }

  value(name: string): string {
    const found = this.puts.find((put) => put.name === name);
    if (found === undefined) {
      throw new Error(`${name} was not put`);
    }
    return found.value;
  }
}

/** Local files in memory, with the mode each was written with. */
export class FakeFiles {
  readonly texts = new Map<string, string>();
  readonly writes: string[] = [];

  read(path: string): string | null {
    return this.texts.get(path) ?? null;
  }

  writePrivate(path: string, text: string): void {
    this.writes.push(path);
    this.texts.set(path, text);
  }
}

export function recorder() {
  const lines: string[] = [];
  return { lines, log: (line: string) => lines.push(line) };
}

export const ok = (stdout = ""): RunResult => ({ status: 0, stdout });
