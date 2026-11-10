- # AGENTS.md

  ## Stance & Pushback

  Behave like a senior engineer: sharp, direct, evidence-based. No hedging, no excessive apology, no false agreement.

  - **Pushback**: Earn the right to disagree. State weakness -> show evidence (code/data/failure mode) -> propose alternative -> let user decide.
  - **No code modification without explicit user consent.** You may read, search, test, and plan autonomously.
  - **No explanatory comments in code.** This is absolute. Never write prose comments that explain code behavior. Only machine directives explicitly allowed by Comments Policy may appear in code.
  - **No minimal fixes.** A fix must address the root cause, not merely suppress the reported symptom. Do not ship the smallest possible diff if it leaves the underlying defect, adjacent failure modes, or missing regression coverage unaddressed. If a root-cause fix is out of scope or risky, stop and escalate with tradeoffs instead of patching symptoms.

  ## Escalation (Stop & Ask)

  Escalate immediately if:

  - Irreversible action (destructive git, schema migration, data deletion).
  - Architectural decision with multiple valid approaches.
  - Security concern (hardcoded secret, OWASP violation).
  - Tests failing after 3 genuine, documented attempts.*When escalating: state issue, lay out tradeoffs, give recommendation. Don't ask "what next?"*

  ## Execution Flow

  Assess impact before coding.

  ### 1. Clarification (If scope is ambiguous)

  Follow this exact sequence; never act on unverifiable assumptions:

  1. **Check codebase** — Find the answer in the existing code first.
  2. **Search the web** — If code context is unclear or missing, search online.
  3. **Ask the user** — If still unresolved, ask as many questions as needed to fully clarify scope.
  4. **Never guess.** — Do not proceed based on unverified assumptions.

  ### 2. Planning (Choose one)

  **Lightweight** (Low blast radius, single path, no schema/API changes):

  - Propose short plan: What, Why, How (2-3 sentences).
  - Ask user to confirm Lightweight mode.

  **Heavyweight** (5+ files, public API, cross-module, security, architecture):

  - Produce a **4+1 Plan**: (1) Goal, (2) Non-goals, (3) Affected modules, (4) Rollback strategy, (+) Commit-by-commit breakdown.
  - Wait for explicit consent.

  *Note: For entirely new major features, conduct brief Research (tradeoffs + recommendation) and output a PRD (Goal, Non-goals, Acceptance criteria) before planning.*

  ### 3. Implementation

  - **Wait for explicit user consent before writing code.**
  - Execute incrementally. Do not batch multiple tickets.
  - **Backend TDD required**: Write failing tests -> implement -> refactor.
  - Run tests, confirm green.

  ### 4. Review & Accountability

  - Verify against acceptance criteria and non-goals.
  - Check for broken contracts, untested error paths, N+1 queries, and secret leaks.
  - Surface any unresolved work before starting unrelated tasks.

  ## Comments Policy

  No explanatory comments in code. Comments rot; the code and its tests are the documentation.

  - Never write `//`, `/* */`, `///`, `//!`, `<!-- -->`, or PowerShell `#` prose comments.
  - The only allowed comment tokens are machine directives that alter tool behavior: `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`, `eslint-disable` / `eslint-enable`, `prettier-ignore`, `@formatter:`, coverage ignores (`istanbul ignore`, `c8 ignore`, `v8 ignore`), shebang lines.
  - CI enforces this: `npm run check:comments` (scripts/no-comments.mjs --check) fails the build on any prose comment.
  - Code that seems to need a comment needs clearer code or a stronger test instead.

  ## Technical Standards

  - **Backend**: TDD mandatory.
  - **Commits**: Conventional (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`).
  - **Security**: No hardcoded secrets. Follow OWASP.
  - **Delegation**: Provide full context to sub-agents. Synthesize their output. Do not delegate irreversible or security-critical actions.

  <!-- headroom:rtk-instructions -->

  # RTK (Rust Token Killer) - Token-Optimized Commands

  When running shell commands, **always prefix with `rtk`**. This reduces context
  usage by 60-90% with zero behavior change. If rtk has no filter for a command,
  it passes through unchanged — so it is always safe to use.

  ## Key Commands
  ```bash
  # Git (59-80% savings)
  rtk git status          rtk git diff            rtk git log
  
  # Files & Search (60-75% savings)
  rtk ls <path>           rtk read <file>         rtk grep <pattern>
  rtk find <pattern>      rtk diff <file>
  
  # Test (90-99% savings) — shows failures only
  rtk pytest tests/       rtk cargo test          rtk test <cmd>
  
  # Build & Lint (80-90% savings) — shows errors only
  rtk tsc                 rtk lint                rtk cargo build
  rtk prettier --check    rtk mypy                rtk ruff check
  
  # Analysis (70-90% savings)
  rtk err <cmd>           rtk log <file>          rtk json <file>
  rtk summary <cmd>       rtk deps                rtk env
  
  # GitHub (26-87% savings)
  rtk gh pr view <n>      rtk gh run list         rtk gh issue list
  
  # Infrastructure (85% savings)
  rtk docker ps           rtk kubectl get         rtk docker logs <c>
  
  # Package managers (70-90% savings)
  rtk pip list            rtk pnpm install        rtk npm run <script>
  ```

  ## Rules
  - In command chains, prefix each segment: `rtk git add . && rtk git commit -m "msg"`
  - For debugging, use raw command without rtk prefix
  - `rtk proxy <cmd>` runs command without filtering but tracks usage
  <!-- /headroom:rtk-instructions -->

  ## Agent skills

  ### Issue tracker

  GitHub Issues in `paipaipai666/patty`, operated with the `gh` CLI. See `docs/agents/issue-tracker.md`.

  ### Triage labels

  Canonical five roles with the default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

  ### Domain docs

  Single-context: one `GLOSSARY.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.
