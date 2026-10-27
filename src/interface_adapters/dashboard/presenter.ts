/**
 * The dashboard's presenters: each implements a use case's output boundary by mapping the output
 * data to a view model with a pure function, and holds it for the one request it was built for.
 */
export class Presenter<Output, View> {
  private view: { readonly value: View } | undefined;

  constructor(private readonly map: (output: Output) => View) {}

  present(output: Output): void {
    this.view = { value: this.map(output) };
  }

  result(): View {
    if (this.view === undefined) {
      throw new Error("the use case presented nothing");
    }
    return this.view.value;
  }
}

/** A use case as a controller drives it: built per request around its presenter. */
export type UseCaseFactory<Input, Output> = (presenter: { present(output: Output): void }) => {
  execute(input: Input): Promise<void>;
};

/** Runs one use case with a fresh presenter and returns the view model it produced. */
export async function runUseCase<Input, Output, View>(
  factory: UseCaseFactory<Input, Output>,
  input: Input,
  map: (output: Output) => View,
): Promise<View> {
  const presenter = new Presenter(map);
  await factory(presenter).execute(input);
  return presenter.result();
}
