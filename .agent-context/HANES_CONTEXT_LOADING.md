# HANES Context Loading Discipline

HANES means Harness And Normalized Evidence Scope.

This is a cross-workspace Codex context-loading rule. It is designed to keep
harness quality without turning every thread into a large repeated cached-input
load.

## Why

Long-running workspaces can repeatedly carry stable text such as system rules,
AGENTS.md, .agent-context files, source handoffs, skill bodies, documentation
preflights, harness matrices, and prior tool-result summaries.

Even when this text is cached, it still occupies context and may still count
against quota. The correct response is not to delete harnesses; it is to load
harness evidence by risk boundary.

## Core Rule

Permanent startup rules should be short. Detailed rules should live in files and
be loaded only when the current task actually needs them.

Do not treat "read durable context" as "load every durable file in full".
Prefer bounded slices, search hits, document indexes, and exact sections.

## Loading Tiers

### Tier 0: Always Resident

Keep only the shortest invariant rules in the live prompt:

- workspace identity
- privacy and secret handling
- git/deployment boundaries
- read compact project context and current handoff before substantive work
- load detailed skills, docs, and harness matrices only by trigger

### Tier 1: Startup Snapshot

At the beginning of substantive work in a workspace:

- read the first 80-120 lines of .agent-context/PROJECT_CONTEXT.md when present
- read the tail of .agent-context/HANDOFF.md when present
- read the workspace documentation index when present
- run git status when code changes are likely

Do not open archives, old rollout summaries, or full historical handoffs unless
the user asks about history, rollback, provenance, or an old regression.

### Tier 2: Task-Specific Evidence

Load only the smallest source set needed for the current task:

- UI/PWA change: relevant UI files, focused UI tests, matching module doc
- route/service change: relevant route/service files, boundary doc, structural context
- deployment: deployment doc and current production status
- plugin behavior: plugin contract and target plugin/host files
- file preview: preview module doc and focused preview harness

### Tier 3: Skill Bodies

Skill bodies are not always-resident context. Read a skill only when its trigger
is actually met. If several skills seem relevant, load the minimum set.

A small static hotfix should not automatically expand into every discipline
layer.

### Tier 4: Full Harness Matrix

The full harness matrix is a reference, not a default preflight blob.

Use it when:

- changing high-risk H1/H2 flows
- adding or changing a harness requirement
- deciding whether a risky flow lacks coverage
- the user explicitly asks for harness policy

For ordinary focused fixes, prefer the module doc's validation section and the
nearest existing test.

## Stop Rules

Stop loading more context when:

- the likely failing file or function is already identified
- the bug is local or static-only and the matching module doc/test is loaded
- the next source would be historical or cross-module but the problem is local
- the user narrows or corrects scope

If more context could materially change the fix, state the exact missing fact and
load only that source.

## Tool Output Budget

Tool output is part of the context budget. A fresh continuation thread can become
large again if a command prints a full assertion input, concatenated frontend
bundle, broad grep context, full diff, or long log.

Before running tests that may fail with large source text:

- prefer focused tests or harness checks that print only the failing contract;
- bound failure output to the first useful error block when practical;
- for regex-contract tests over concatenated frontend source, inspect and patch
  the nearby assertion directly instead of repeatedly dumping the whole source;
- if a full log is necessary, write it to a temporary ignored file and read only
  the relevant line range.

Before searching or reading files:

- use exact files and exact patterns before broad repo-wide searches;
- avoid large context windows such as broad `Select-String -Context` unless the
  surrounding lines are necessary;
- read explicit line ranges, heads, tails, or small slices instead of whole large
  files;
- inspect `git diff --stat` before reading full hunks;
- do not store or preserve long logs, full generated bundles, full assertion
  inputs, raw private data, or repeated historical context in handoffs.

If a command unexpectedly emits a large result, switch to a narrower command and
summarize only the actionable lines.

## Handoff Rules

Workspace handoffs should record current rollout state, not become full release
archives.

Record compactly:

- user-facing issue
- root cause summary
- changed files
- validation commands
- deployment status
- remaining risk

Avoid long logs, repeated timelines, full command output, duplicated docs,
secrets, private content, and raw prompts.

## Future Thread Instruction

Future Codex threads in this workspace should:

1. Load Tier 1 only.
2. Identify the task class.
3. Load the smallest Tier 2 source.
4. Load Tier 3 or Tier 4 only when the risk boundary requires it.
5. Update only compact current handoff facts before finishing substantial work.

If a continuation prompt already contains the needed fact, do not re-open the
same large handoff unless exact prior state is needed.
