import { DurableObject } from "cloudflare:workers";
export { default, AccountPublisher } from "../../../src/main";
export class TestAccountPublisher extends DurableObject {}
