# Workspace Bootstrap Read First

This is a cross-workspace startup discipline for Codex threads. It prevents a
new thread from acting in the wrong workspace, relying on stale thread memory,
or loading excessive context before the actual task is identified.

Use this together with HANES_CONTEXT_LOADING.md:

- Workspace Bootstrap decides which workspace and startup files are authoritative.
- HANES decides how much of those files should be loaded into context.

## When To Use

Use this when:

- a startup prompt says the thread is a continuation
- the visible workspace may be old, deprecated, or wrong
- the user says to inherit workspace context first
- a workspace contains .agent-context
- a task depends on prior project decisions, deployment state, or handoff facts

Do not use this as a broad repo-exploration excuse after the workspace is already
clear and the user asks a narrow self-contained question.

## Startup Order

1. Confirm the intended workspace path from the user message, startup prompt, or
   handoff text.
2. If .agent-context exists, read .agent-context/PROJECT_CONTEXT.md first in a
   bounded slice, normally the first 80-120 lines.
3. Read .agent-context/HANDOFF.md next, normally the latest tail, not the full
   historical file.
4. If a source-thread handoff is named, treat it as the highest-priority source
   for prior-thread facts, but read only the exact file or section needed.
5. Run git status when code changes, commits, or deployment are likely.
6. State the key loaded facts briefly before substantial action.

## Continuation Threads

For explicit continuation/bootstrap threads:

- source-thread handoff has priority over workspace handoff for prior-thread
  facts
- workspace PROJECT_CONTEXT/HANDOFF provide current local rules and state
- do not assume shell state, approvals, hidden UI state, or old thread memory
  carries over
- stay read-only unless the user gives a new task in the continuation thread

## Wrong Workspace Or Rebinding

If Codex appears bound to the wrong workspace:

1. Answer narrow identity questions directly if that is all the user asked.
2. Inspect durable context before broad repo exploration.
3. If state repair is needed, prefer existing workspace repair helpers when
   available.
4. Use dry-run first and avoid destructive state edits.
5. Verify a fresh thread opens in the expected workspace after repair.

High-value local state files for Codex workspace binding diagnosis:

- C:\Users\xuxin\.codex\.codex-global-state.json
- C:\Users\xuxin\.codex\state_5.sqlite

## Context Budget Rule

Startup files are authoritative but should not be loaded in full by default.
Use HANES:

- read bounded slices first
- use indexes before full docs
- load skill bodies only when their trigger is met
- load archives only for history, rollback, provenance, or old regressions
- stop expanding context once the workspace and task boundary are clear

## What To Report

At startup, report only the facts that matter:

- active workspace path
- source-thread or handoff file used, if any
- current repo cleanliness when relevant
- key constraints such as no push, no production deploy, or read-only mode
- next immediate action

Avoid reciting unrelated README, public release, private repo, or old history
rules unless they affect the user's current task.

## Verification Checklist

- Intended workspace identified.
- .agent-context/PROJECT_CONTEXT.md checked when present.
- .agent-context/HANDOFF.md checked when present.
- Continuation-only/read-only status honored when applicable.
- Git status checked before code changes when relevant.
- No broad historical context loaded without a specific reason.