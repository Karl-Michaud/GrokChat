/**
 * The composition root: the only module that names concrete classes and wires them together
 * (plan §3, Agents/CLAUDE.md §7.1). It exports the Worker's handlers and the Durable Object class.
 */
import { dispatchScheduled } from "./frameworks/cron/dispatch";
import type { Env } from "./frameworks/env";
import { buildHttpApp } from "./frameworks/http/app";
import { HealthController } from "./interface_adapters/health/health_controller";
import { HealthPresenter } from "./interface_adapters/health/health_presenter";
import { HealthViewModel, type HealthView } from "./interface_adapters/health/health_view_model";
import { GetHealthInteractor } from "./use_cases/get_health/interactor";

export { AccountPublisher } from "./frameworks/durable_objects/account_publisher";

function handleHealth(): HealthView {
  const viewModel = new HealthViewModel();
  new HealthController(new GetHealthInteractor(new HealthPresenter(viewModel))).health();
  return viewModel.current();
}

const app = buildHttpApp({ health: handleHealth });

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled: () => dispatchScheduled(),
} satisfies ExportedHandler<Env>;
