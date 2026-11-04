import { currentHealth } from "../../entities/health";
import type { PublishingCount } from "../ports/publishing_count";
import type { GetHealthInputBoundary } from "./input_boundary";
import type { GetHealthOutputBoundary } from "./output_boundary";

export class GetHealthInteractor implements GetHealthInputBoundary {
  constructor(
    private readonly posts: PublishingCount,
    private readonly presenter: GetHealthOutputBoundary,
  ) {}

  async execute(): Promise<void> {
    const health = currentHealth();
    const publishing = await this.posts.publishingCount();
    this.presenter.present({ service: health.service, status: health.status, publishing });
  }
}
