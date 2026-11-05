# OSC 7501 program status plan

Approved: 2026-11-04. Updated: 2026-11-05.

The user approved separate program records with Hook priority. Native Windows notification activation, the first prerequisite, is complete and passed actual notification clicking and warm/cold application activation on 2026-11-05. OSC 7501 implementation has not started.

## Product requirement

Programs can report running, waiting, finished, and failed work using OSC 7501. A user can find the affected terminal through the existing indicators and notifications. Terminal output remains the main work area.

The first implementation accepts revision 0.4 of the [Program Status Protocol](https://www.superlogical.com/rex/docs/build/program-status). [Otty's implementation](https://docs.otty.sh/vt/osc/osc-7501) provides a presentation reference. Protocol state is display metadata and never authorizes input or execution.

Acceptance criteria:

- Completed prerequisite: Windows activation is exercised through its native COM callback using an isolated build, including an existing process, cold startup, a missing target, rejected targets, and an actual notification click. The real frontend reports the selected workspace, pane, and terminal focus.
- Local and SSH output accept split BEL/ST-terminated status reports and answer capability queries. Output is not rewritten.
- Records replace completely. Hierarchical clear, inherited application identity, urgency selection, full reset, shell prompt cleanup, exit cleanup, and process replacement obey the protocol.
- Payload, text, key, identifier, record-count, and resource limits are enforced before state changes. Text stays plain and cannot include control characters or conceal direction with formatting characters.
- Existing authenticated Hook state wins whenever present. Program reports do not change AI tool identity or Hook ownership.
- Program status appears in session details, existing attention indicators, and notification navigation. No permanent terminal header or new sidebar section is introduced.
- Backend tests start red. Tests include real ConPTY output, the SSH output adapter, real xterm, source conflicts, process replacement, malformed input, and keyboard navigation.

## 4+1 implementation plan

1. Goal: finish native notification activation verification, then implement OSC 7501 for ordinary programs.
2. Non-goals: AI resume/history, agent animation changes, queued input, command execution from reports, renderer replacement, other shell integrations, and new persisted session data.
3. Affected modules: dedicated native verification configuration and driver; local PTY and SSH output handling; a bounded protocol parser and per-run registry; typed snapshots/events and frontend status state; existing session details, previews, attention selection, and notifications. Agent Hook contracts stay intact.
4. Rollback: each commit can be reverted independently. Test registrations and temporary directories belong only to the dedicated test identity. The normal executable and installed Patty configuration are preserved.
5. Commits:
   - Native activation verification and any reproduced activation defect, with an isolated repeatable test.
   - OSC 7501 parsing, lifecycle, local/SSH transport, typed snapshots, and session-details display.
   - Existing attention and Windows-notification integration, using Hook-first source selection and existing rate limits.

## Source selection decision

Approved: keep program records separate from authenticated Agent Hook records. Select Hook state first for display and attention whenever it exists. Use program status for sessions without a current Hook record. This preserves current Agent semantics and avoids turning arbitrary terminal output into an Agent identity.

Alternative: merge program and Hook events into a single last-writer stream. This could expose a child program's blocked state during an Agent run, but would need a new cross-source ownership contract and could allow ordinary output to replace a genuine Agent state.

The user explicitly approved this route under AGENTS.md's architectural-decision and cross-module planning rules. The implementation may proceed without reconfirming the source-selection decision.
