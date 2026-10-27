export interface TickView {
  readonly line: string;
}

/** Holds what the presenter produced for one tick; built per tick by the composition root. */
export class TickViewModel {
  private view: TickView | undefined;

  update(view: TickView): void {
    this.view = view;
  }

  /** Null when the tick presented nothing (it failed before its summary). */
  current(): TickView | null {
    return this.view ?? null;
  }
}
