// Deliberate violation: a port whose signature names a vendor type (plan §6).
import type { Context } from "hono";

export interface VendorPort {
  handle(context: Context): Promise<void>;
}
