/** What a controller calls to ask for the service's health. The use case takes no input. */
export interface GetHealthInputBoundary {
  execute(): Promise<void>;
}
