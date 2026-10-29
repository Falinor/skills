# Review

How a human reviewer reads and understands a change with an agent's help, without handing the judgement to the agent.

## Language

### The tour

**Change**:
The diff under review: a GitHub pull request, or a local branch measured against its merge-base.
_Avoid_: changeset, CL, patch

**Tour**:
An ordered path through one change that a human reviewer follows to understand it.
_Avoid_: walkthrough, guided review, review canvas

**Step**:
One stop on a tour: the files that together express one concept, with their explanation.
_Avoid_: section, stage

**Tour plan**:
The agent's description of a tour: which files each step holds, with its explanation, callouts and reviewer questions. It never contains diff text.
_Avoid_: tour data, walkthrough JSON

**Intent**:
The opening of a tour: why the change exists, one visual of its shape, and its merge danger.
_Avoid_: summary, overview, description

**Stale tour**:
A tour built from a head that no longer matches the change's current head.
_Avoid_: outdated tour

**Follow-up tour**:
A tour of only the commits pushed since an earlier tour's head.
_Avoid_: re-review, interdiff

### Tiers

**Tier**:
The importance band a step belongs to. A tour presents core logic first, then wiring, then mechanical.
_Avoid_: bucket, category

**Core logic**:
Changes that create or alter behaviour: new rules, state transitions, API surface.
_Avoid_: domain change, business logic

**Wiring**:
Changes that connect core logic into the system without adding behaviour of their own.
_Avoid_: glue, plumbing, integration

**Mechanical**:
Changes that carry a mechanical proof that they preserve behaviour.
_Avoid_: boilerplate, noise, trivial

**Mechanical proof**:
Tool evidence, not model judgement, that a change preserves behaviour.
_Avoid_: mechanical check, heuristic

**Declared generated**:
A file the repository marks as generated. A tour lists it apart from mechanical changes, as declared rather than proven.
_Avoid_: generated code, codegen output

**Unproven mechanical**:
A change the agent believes is mechanical but cannot prove. It stays in core logic, flagged.
_Avoid_: probably mechanical, likely safe

### Reviewer aids

**Callout**:
A short tagged warning attached to one hunk, pointing at something tricky the reviewer could miss.
_Avoid_: finding, issue, comment

**Reviewer question**:
A question the tour hands the reviewer to answer from their own knowledge of the domain. Never a verdict.
_Avoid_: check, finding
