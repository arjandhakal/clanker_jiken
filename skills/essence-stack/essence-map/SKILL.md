---
name: essence-map
description: Map concept actions and observable state to UI, API, or CLI interactions without misleading users. Use for concept-based interface design, ambiguous commands, hidden state, recovery flows, and auditing whether an interface preserves its conceptual model.
---

# Map concepts to interactions

Read [shared contract](../essence/references/contract.md) and [mapping template](../essence/assets/mapping.md). Read relevant concept and synchronization contracts. Apply the same action/state mapping discipline to graphical interfaces, APIs and CLIs.

1. For each exposed action identify the entry point, actor, argument sources, selection scope, enabled/disabled conditions, and visible outcome.
2. Map observations separately from actions. Explain which concept/instance owns a displayed value, when it was sampled, and what completion guarantees the display makes.
3. Walk entire operational principles through the interface—not only one-click happy paths. Include undo, retry, finding prior versions, clearing/unsetting values and recovery from mistaken selections.
4. Test aggregation traps: displayed labels on a group versus labels actually attached to members; counts versus unique actors; cached versus current state; links versus copies; absent versus false/zero.
5. Resolve ambiguity explicitly: remove from this collection, remove from all selected collections, and delete the object are different actions. Do not infer destructive intent from an ambiguous gesture.
6. Reveal automation and loss of flexibility caused by synchronization. Give opt-outs when policy allows. Check that actors understand who is notified and what becomes public.
7. For live filtering, preserve a reasonable recovery route when an edit makes the selected item stop matching; label stale/retained items honestly.
8. Check consistency of names and accessibility. Do not polish layout as a substitute for fixing a broken concept.

Deliver a mapping matrix and a walkthrough demonstrating each selected principle. Gate: every required action is reachable by its intended actor, relevant state is intelligible, and completion/error messages correspond to actual guarantees. Route conceptual problems upstream; do not paper over them with warning dialogs.
