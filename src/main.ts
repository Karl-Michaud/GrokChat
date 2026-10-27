/**
 * The composition root (plan §3, Agents/CLAUDE.md §7.1): the Worker's handlers and the account's
 * Durable Object class. The graphs themselves are assembled by the factories in
 * frameworks/composition/; this module picks them, builds them once per env, and exports the
 * entry points. In production every surface runs on D1, the account Durable Objects (with the real
 * X drivers) and R2; the in-memory stubs are reached only by tests.
 */
import {
  accountRuntime,
  buildAccountServices,
  productionX,
} from "./frameworks/composition/account_graph";
import { cronJobs } from "./frameworks/composition/cron_jobs";
import { dashboardControllers } from "./frameworks/composition/dashboard_controllers";
import { mcpTools } from "./frameworks/composition/mcp_tools";
import { workerGraph } from "./frameworks/composition/worker_graph";
import { dispatchScheduled, type CronJobs } from "./frameworks/cron/dispatch";
import { AccountPublisherObject } from "./frameworks/durable_objects/account_publisher";
import type { AccountServices } from "./frameworks/durable_objects/account_services";
import { SystemClock } from "./frameworks/durable_objects/system_clock";
import type { Env } from "./frameworks/env";
import { buildHttpApp } from "./frameworks/http/app";
import { mcpRoute } from "./frameworks/mcp/mcp_route";
import { buildWebApp } from "./frameworks/web/web_app";
import { HealthController } from "./interface_adapters/health/health_controller";
import { HealthPresenter } from "./interface_adapters/health/health_presenter";
import { HealthViewModel, type HealthView } from "./interface_adapters/health/health_view_model";
import { GetHealthInteractor } from "./use_cases/get_health/interactor";
import type { PublishingCount } from "./use_cases/ports/publishing_count";

async function handleHealth(posts: PublishingCount): Promise<HealthView> {
  const viewModel = new HealthViewModel();
  const interactor = new GetHealthInteractor(posts, new HealthPresenter(viewModel));
  await new HealthController(interactor).health();
  return viewModel.current();
}

interface EnvEntry {
  readonly app: ReturnType<typeof buildHttpApp>;
  readonly jobs: CronJobs;
  readonly clock: SystemClock;
}

const entries = new WeakMap<Env, EnvEntry>();

/**
 * Everything the Worker serves over this env's bindings, built on its first request or tick and
 * kept per isolate: one graph for the MCP tools and the dashboard, so they share their data.
 */
function entryFor(env: Env): EnvEntry {
  let entry = entries.get(env);
  if (entry === undefined) {
    const graph = workerGraph(env);
    const tools = mcpTools(graph);
    const app = buildHttpApp({
      health: () => handleHealth(graph.reader),
      mcp: mcpRoute(() => tools),
      web: buildWebApp(dashboardControllers(graph)),
    });
    const clock = new SystemClock();
    const jobs = cronJobs({ db: env.DB, accounts: env.ACCOUNT, bucket: env.MEDIA, clock });
    entry = { app, jobs, clock };
    entries.set(env, entry);
  }
  return entry;
}

export default {
  fetch: (request, env, ctx) => entryFor(env).app.fetch(request, env, ctx),
  scheduled: (controller, env) => {
    const { jobs, clock } = entryFor(env);
    return dispatchScheduled(controller.cron, jobs, clock);
  },
} satisfies ExportedHandler<Env>;

/** The account's Durable Object, bound as ACCOUNT, on the real X drivers. */
export class AccountPublisher extends AccountPublisherObject {
  protected build(): AccountServices {
    return buildAccountServices(
      accountRuntime(this.ctx, this.env, productionX(this.ctx, this.env)),
    );
  }
}
