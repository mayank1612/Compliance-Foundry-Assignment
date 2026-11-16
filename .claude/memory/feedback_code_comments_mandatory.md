---
name: code-comments-mandatory
description: ALWAYS write detailed code comments on all code written or modified - covering what, why, which, where, how, when, who dimensions as relevant.
type: feedback
---

ALWAYS write detailed code comments on all code you write or modify. Every comment must address the relevant dimensions: **what** (what the code does), **why** (the reason/intent), **which** (which components/systems are involved), **where** (where in the pipeline/flow this runs), **how** (how it works), **when** (when/under what conditions it executes), **who** (who calls it / who is affected). Not every comment needs all 7 dimensions - use the ones relevant to that code. But never write uncommented code.

**Why:** The user requires thorough documentation in code for maintainability and team collaboration. Uncommented code is not acceptable under any circumstances.

**How to apply:** Before finishing any code change, review every new or modified line/block and ensure it has appropriate comments. This applies across ALL repos and sessions, not just the current project.
