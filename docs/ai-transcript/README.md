# AI Transcript and Prompting Strategy

_The commentary below was drafted by Claude at the author's request, from the actual course of the sessions recorded here._

## The logs

| Log                                                                            | What it covers                                                                                                                     | Complete raw log                                                                                                                                                       | Readable `/export`                                                                    |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Main Claude Code session                                                       | Every phase: reading the brief, tech stack, schema, docs, critique verification, API, board, RFC, and this page                    | [`raw/13bf4539-ab88-417f-9f03-71d2a332ad4a.jsonl`](raw/13bf4539-ab88-417f-9f03-71d2a332ad4a.jsonl)                                                                     | [`main-session.md`](main-session.md) (final step only, see below)                     |
| Side session                                                                   | Choosing the database runtime and query layer: what PGlite is, then Kysely vs Drizzle vs Sequelize, with spikes run against PGlite | [`raw/1921b779-40c4-401a-8765-e61cbc3674be.jsonl`](raw/1921b779-40c4-401a-8765-e61cbc3674be.jsonl)                                                                     | [`side-session-query-layer-spikes.md`](side-session-query-layer-spikes.md) (complete) |
| Independent critique agent (a subagent of the main session, no shared context) | The Task 1.3 critique of schema v1                                                                                                 | [`raw/13bf4539-ab88-417f-9f03-71d2a332ad4a/subagents/agent-a3fad4d3df25c5357.jsonl`](raw/13bf4539-ab88-417f-9f03-71d2a332ad4a/subagents/agent-a3fad4d3df25c5357.jsonl) | Prompt and output, verbatim: [`../part1/ai-critique.md`](../part1/ai-critique.md)     |
| Docs lookup agent (a subagent of the main session)                             | Checked in the Claude Code docs how `/export` treats a compacted session                                                           | [`raw/13bf4539-ab88-417f-9f03-71d2a332ad4a/subagents/agent-aa1ddf081746c7b08.jsonl`](raw/13bf4539-ab88-417f-9f03-71d2a332ad4a/subagents/agent-aa1ddf081746c7b08.jsonl) | —                                                                                     |

**The raw logs are the complete record.** They are Claude Code's own session files, copied byte for byte and laid out as Claude Code stores them. Each line is one JSON event: a prompt, a reply, a tool call or a tool result. The format is Claude Code's internal one. Nothing was edited or removed, including local file paths, the author's git email, and the assessment brief, which appears in full where the assistant read it. The main session's log was copied just before it was committed, so it ends a few messages before that commit.

**The main session's `/export` is partial.** Claude Code compacted that session once, replacing the earlier conversation with a summary. `/export` renders only what is still loaded, so `main-session.md` covers just the final step. Both exports show tool calls collapsed ("Read 2 files, ran 3 shell commands"), not their full output.

## Prompting strategy

**1. Doubts before code.** The first prompt asked the assistant to read the whole brief and list its open questions before anything else. Each question came with a recommended default, so the author could accept a batch in one reply ("All defaults fine") and spend time only on the ones that mattered, such as whether organization and workspace are the same thing.

**2. Decide the stack in the open.** The author chose the main tools (PGlite, Kysely, Yoga, Apollo) and asked for the reasoning to be written down, including the options turned down. The author's PostGraphile experience at work went into that document as a deliberate rejection, not an omission. The query layer was settled by running spikes in a separate session rather than by argument.

**3. Phase by phase, with a gate.** Work went one task at a time from the brief, with a commit per phase. Nothing new started without a go-ahead, so every phase got a human review while it was still small.

**4. An unanchored critic.** The Task 1.3 critique came from a fresh subagent that saw only the six schema files and a fixed prompt, both recorded. The assistant that wrote the schema didn't write its critique.

**5. Verify the AI, including the critic.** Each critique claim was checked against the running database, with probes, query plans and tests: 16 confirmed, 3 partly correct, 0 wrong. That check caught a fix the critique suggested that doesn't work (per-schema `ALTER DEFAULT PRIVILEGES`), and four wrong comments in the original migrations. Generally, claims about performance were measured, not asserted: the RFC numbers come from the prototype at 2,500 and 20,000 tasks.

**6. Corrections that only running the code found.** Some examples:

- an `= ANY ((SELECT …))` policy that parsed as the wrong form until cast to `uuid[]`;
- a cascade delete that failed on an activity insert;
- `DATE` values shifting a day in the IST timezone;
- graphql 17 loading twice under Vitest, which masked every expected error.

Each became a test or a rule in `CLAUDE.md`.

**7. Rules the assistant must follow.** `CLAUDE.md` and a mandatory-comments rule kept conventions stable across a long session: forward-only migrations, "organization" everywhere, and `npm run check` before anything is called done.

**8. The author's judgment stayed in the loop.** The author's review of the first schema draft added the many-to-many reasoning (one person can belong to several organizations of the Compliance Foundry group) and questioned `task_counter`. The author asked for the technical document to be trimmed and for the critique to be verified point by point. Where the author asked the assistant to draft their own writing (the 1.3 analysis, this commentary), the file says so.
