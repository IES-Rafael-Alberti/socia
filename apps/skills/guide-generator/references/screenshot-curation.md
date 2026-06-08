# Screenshot curation

A MENTORA recording captures a screenshot on every significant click, so the number of raw images is much larger than the number of figures the guide should show. Your job is to pick a representative subset — one figure per meaningful step — and skip everything else. Dumping all screenshots is worse than having too few, because noise hides the signal.

The right size of that subset depends entirely on the case: a short triage exercise may need just a handful of figures, while a full N1→N2 incident response with investigation, containment and closure will need many more. Let the natural steps of the case decide the count, not a target number.

## The rule of one step = one figure

Each step in the guide explains one conceptual action (log in, create case, fill form, run analyzers, apply filter). Pick the **single screenshot that best visualises the final state of that action** — not the click that initiated it, and not transitional states.

Examples:

- Step "Fill the case creation form and confirm" → screenshot of the form **fully filled** just before clicking Confirm. Not the blank form.
- Step "Run analyzers on the attacker IP" → screenshot of the analyzer selection dialog, or the observable view showing the coloured result tags. Not the empty observable.
- Step "Verify drops in firewall Live View" → screenshot of Live View with the drop entries visible. Not the navigation to get there.

## How to find the right screenshot from the recording

MENTORA names screenshots with timestamps and associates them with the action that triggered them in `activity-log.json`. To locate the best one for a step:

1. Identify the approximate **time range** of the step from the activity log (the clicks that correspond to performing the action).
2. Look for the screenshot taken **right after the last action of the step** — this captures the completed state.
3. If the state is only visible after an async response (e.g. waiting for analyzer results), use the screenshot taken after the response arrived.
4. When in doubt, open the screenshot and check: does it clearly show *what the student should see if they did this step correctly*?

## Screenshots to skip

- **Empty/blank states** where the meaningful content hasn't loaded yet.
- **Intermediate mouse hovers** or tooltip expansions that aren't central to the action.
- **Duplicate views** (same screen, minor variations) — pick the clearest one.
- **Screenshots mid-scroll** where content is cut off.
- **Error/loading dialogs** unless they're part of the teaching point.

## Ordering

The screenshots in the final PDF must follow the narrative order of the steps, not the filesystem order. MENTORA's timestamps give you that ordering naturally, but if you re-number the images when copying them into the guide's `images/` folder (recommended), use a scheme like `paso-01-login.png`, `paso-02-alerts.png` so the correspondence is obvious.

## Captions

Each figure gets a one-line italic caption in Spanish, describing *what the reader is seeing*, not what they're doing. Good captions:

- "Lista de alertas en TheHive. La alerta #311 aparece en la parte superior."
- "Formulario de creación del caso completado, con severidad LOW, TLP/PAP AMBER y tag SSH."
- "Observables con etiquetas de resultados: AbuseIPDB (0 records), VT (0/94 detecciones)."

Bad captions (they describe the action, not the image):

- "Hacer clic en Crear caso" — this is step text, not a caption.
- "Paso 4" — uninformative.

## Sanity check

Before finalising, open every screenshot one by one and match it to its step number. A common mistake (especially with similar-looking screens) is **swapping adjacent screenshots** — for example putting the Malcolm homepage where the Arkime view should go. If the tool name in the caption doesn't match the tool visible in the screenshot, fix it.
