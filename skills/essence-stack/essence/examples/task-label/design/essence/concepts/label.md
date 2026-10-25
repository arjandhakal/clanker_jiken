# Concept: Label
Status: accepted teaching contract

## Purpose
Retrieve items by overlapping categories without requiring a single placement.

## Parameters
Item and Tag are opaque nonempty immutable strings. Label knows nothing about whether an item is a Task.

## Operational principle
After affix(a, urgent), find(urgent) includes a. After clear(a), find(urgent) excludes a; tags on unrelated items remain. Affixing a second tag preserves the first.

## State
pairs: set of (Item, Tag). find(tag) is the derived set of items paired with tag.

## Initial state
pairs is empty.

## Invariants
Each pair occurs at most once; an item can have many tags and a tag many items.

## Actions
### affix
Signature affix(item: Item, tag: Tag) returns new Label state. Enabled for all valid opaque inputs. Insert the pair; all other pairs unchanged. Existing pair is a successful no-op.

### clear
Signature clear(item: Item) returns new Label state. Enabled for every valid item, even when no labels exist. Remove all pairs whose item matches; every unrelated pair remains. Clearing an unlabeled item is a successful no-op.

### find
Signature find(tag: Tag) returns an immutable set of Item. Always enabled for a valid tag. No state changes; returns exactly matching items.

## Boundaries
No dependence on Task or global entity schema. Application wiring restricts affix to live Task IDs; this is not a hidden requirement of the generic Label concept.

## Misfits and variants
No user-defined label rename, per-tag detach, permissions or tag hierarchy. A product needing those must extend the contract deliberately. Public raw IDs would need boundary validation/security in production.

## Evidence
label-is-independent uses opaque items without Task; remove-cleanup and projection replay exercise composition. find is a side-effect-free observation and is not recorded in the transition event log.
