# Interaction mapping
Status: accepted teaching contract

## Action mapping
(execute! app request-id command & args) is the teaching API. Commands :add/:complete/:remove route to the corresponding Task transition. :affix routes to label-affix only if the item is currently live; this application lifetime gate participates in the same atomic state update. Arguments are nonempty strings. This is not a production authenticated API.

## State mapping
snapshot dereferences the application atom once and returns immutable Task/Label state. Callers may derive label-find results from that snapshot. An old held snapshot remains an honest historical value, not a promise of current state.

## Operational-principle walkthroughs
Create a task, label it, complete it, confirm it remains findable, then remove it and confirm it is no longer findable. See the registered trace.

## Ambiguity and automation
:remove means permanent task deletion and automatic label cleanup, not merely removing one tag. There is no undo. Repeated request IDs mean retries, not new intent. Returned events certify in-process publication only, not durable storage.

## Evidence
remove-cleanup and rejection/duplicate tests check this API. No actual graphical interface or user usability study is included.
