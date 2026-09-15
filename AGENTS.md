# Agent Guidance

## Repository orientation

- Before editing, inspect the relevant implementation and adjacent tests. Reuse established patterns; do not introduce a second convention beside an existing one.

## Development environment

- Prefer `nix develop` for an interactive shell.
- Prefer `nix develop -c <command>` for one command in the repository toolchain.
- Change `flake.nix` or `flake.lock` only when the development toolchain itself intentionally changes.

## Implementation rules

- Keep changes narrowly scoped to the task.
- Favor straightforward existing abstractions over speculative generalization.
- Preserve public behavior unless the task intentionally changes it.
- During intentional cutovers, remove obsolete code instead of adding compatibility shims.
- Use type annotations for new or changed code.
- Document all modules, fields, methods, functions, classes, data types, interfaces, and other public caller-facing entities with docstrings.
- Prefer documentation on individual members to documenting at the class level, and avoid duplication. 
- Docstrings must describe behavior relevant to users and callers of the entity, not implementation details.
- Docstrings should briefly describe any special values.
- Make error behavior explicit. Do not swallow exceptions or suppress warnings/failures instead of fixing them.
- Avoid unrelated formatting churn.
- Do not add a dependency without demonstrated task-related need.

## Testing and completion

- Every behavior change needs a focused test.
- Every bug fix needs a regression test that fails before the fix.
- Test observable behavior, boundaries, and error cases rather than implementation details.
- Follow Arrange / Act / Assert and comment these phases in each unit test.
- Keep one logical action per test.
- While iterating, run the narrowest relevant test command.
- Treat formatter, linter, type-checker, test warnings, and failures as work to resolve rather than suppress.