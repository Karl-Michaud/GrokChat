/**
 * The workers test project's entry (vitest.workers.config.ts): the Worker and its Durable Object
 * exactly as deployed, plus `TestAccountPublisher` (binding TEST_ACCOUNT), the production object
 * class built over the test harness's scripted X ports and clock.
 */
import { AccountPublisherObject } from "../../../src/frameworks/durable_objects/account_publisher";
import type { AccountServices } from "../../../src/frameworks/durable_objects/account_services";
import { buildAccountServices } from "../../../src/frameworks/composition/account_graph";
import { testRuntime } from "./harness";

export { default, AccountPublisher } from "../../../src/main";

export class TestAccountPublisher extends AccountPublisherObject {
  protected build(): AccountServices {
    return buildAccountServices(testRuntime(this.ctx));
  }

  /** The object's own services, for tests that call inside it (`runInDurableObject`). */
  graph(): AccountServices {
    return this.services();
  }
}
