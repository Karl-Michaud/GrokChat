# Architecture fixtures

Deliberate violations. Each one must be caught by the gate named below; the tests in
`tests/architecture/` run the gate on the fixture and fail if it is not caught. They are excluded
from the normal typecheck, lint and dependency-cruiser runs.

| Fixture                         | Gate                             | Must                                                                                                                                       |
| ------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ambient/`                      | `tsc` with `tsconfig.inner.json` | fail: `D1Database`, `Response` and `fetch` do not exist in the inner layers (A5)                                                           |
| `ambient/tsconfig.control.json` | `tsc` with workers-types         | pass, so the failure above is about ambient types only                                                                                     |
| `lint/`                         | ESLint                           | flag triple-slash `types`, `path` and `lib` references in the inner layers, mutable module state in entities, and a function over 40 lines |
| `layers/`                       | dependency-cruiser               | flag every rule in `.dependency-cruiser.cjs`                                                                                               |
| `ports/`                        | the port-signature scan          | flag a port signature that names a vendor type (`hono`'s `Context`)                                                                        |
