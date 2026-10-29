# Rewrite the review tour from ideas, under MIT, rather than fork Trail of Bits

Trail of Bits' `review-walkthrough` is the closest existing skill, but it is licensed CC-BY-SA-4.0: any adaptation, however heavily changed, must stay CC-BY-SA, which blocks contributing to MIT projects (Matt Pocock's skills, Zéro Logement Vacant) and suits software poorly (no patent terms). Our design also diverges from it: tiers, an intent block, callouts instead of findings, mechanical proofs, GitHub "Viewed" ticking, and a tour plan that never carries diff text. So we write our own code and prose from our own decisions, under MIT, and never paste theirs. Trail of Bits' `review-walkthrough` and Cursor's `pr-review-canvas` are credited as inspiration in the README.

## Consequences

We re-solve what their fork would have given us for free: HTML escaping, diff fidelity and anchor validation. Their test ideas (not their tests) are fair game.
