export interface HealthView {
  readonly httpStatus: 200;
  readonly body: { readonly service: string; readonly status: string };
}

/** Holds what the presenter produced for one request; built per request by the composition root. */
export class HealthViewModel {
  private view: HealthView | undefined;

  update(view: HealthView): void {
    this.view = view;
  }

  current(): HealthView {
    if (this.view === undefined) {
      throw new Error("HealthViewModel was read before a presenter wrote it");
    }
    return this.view;
  }
}
