import type { HumanActor } from "../../entities/identity/actor";

/** The dashboard has one user, the owner, behind the admin password (plan §3.5). */
export const ADMIN: HumanActor = { kind: "human", name: "admin" };
