/**
 * A D1 binding that counts what goes through it: each `first`, `all`, `run` and `batch` is one
 * Cloudflare-service call (U16), and `rowsRead` sums `meta.rows_read` of the calls that report it.
 * `failBatches` makes batches throw before they reach D1 (a store failing mid-publish), after
 * `passBatches` more have gone through; `broken` makes every statement fail to prepare.
 */
export interface Meter {
  readonly db: D1Database;
  calls: number;
  rowsRead: number;
  failBatches: number;
  passBatches: number;
  broken: boolean;
}

type Statement = D1PreparedStatement;

function meteredStatement(statement: Statement, meter: Meter): Statement {
  return new Proxy(statement, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") {
        return value;
      }
      if (property === "bind") {
        return (...values: unknown[]) => meteredStatement(target.bind(...values), meter);
      }
      if (property === "first" || property === "raw") {
        return (...args: unknown[]) => {
          meter.calls += 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      if (property === "all" || property === "run") {
        return async () => {
          meter.calls += 1;
          const result = await (property === "all" ? target.all() : target.run());
          meter.rowsRead += result.meta.rows_read;
          return result;
        };
      }
      return (value as (...a: unknown[]) => unknown).bind(target);
    },
  });
}

export function metered(db: D1Database): Meter {
  const meter: Meter = {
    db,
    calls: 0,
    rowsRead: 0,
    failBatches: 0,
    passBatches: 0,
    broken: false,
  };
  const proxy = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (sql: string) => {
          if (meter.broken) {
            throw new Error("D1 unavailable (test)");
          }
          return meteredStatement(target.prepare(sql), meter);
        };
      }
      if (property === "batch") {
        return async (statements: Statement[]) => {
          meter.calls += 1;
          if (meter.passBatches > 0) {
            meter.passBatches -= 1;
          } else if (meter.failBatches > 0) {
            meter.failBatches -= 1;
            throw new Error("D1 unavailable (test)");
          }
          const results = await target.batch(statements);
          meter.rowsRead += results.reduce((sum, result) => sum + result.meta.rows_read, 0);
          return results;
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? (value as () => unknown).bind(target) : value;
    },
  });
  return Object.assign(meter, { db: proxy });
}
