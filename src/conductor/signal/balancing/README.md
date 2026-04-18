# conductor/signal/balancing

Coupling-energy redistribution layer. `axisEnergyEquilibrator` is the hypermeta controller facade — it reads coupling totals and axis energy shares, then nudges gain targets to prevent any single axis pair from monopolizing output energy. `phaseFloorController` enforces a minimum phase-energy floor.

**Load order is a hard dependency:** `coupling/` and `coupling/homeostasis/` must initialize before the equilibrator modules because they expose the gain state the equilibrator reads. The order in `index.js` is authoritative.

`axisEnergyEquilibratorAxisAdjustments.js` is the file most likely to attract manual floor/cap additions — resist. When an axis is suppressed or dominant, diagnose the responsible controller instead of adding a SpecialCap here.

<!-- HME-DIR-INTENT
rules:
  - Load order in index.js is a hard dependency — coupling/ and homeostasis/ must initialize before equilibrator modules
  - Never add manual axis floors/caps to axisEnergyEquilibratorAxisAdjustments.js — diagnose the responsible controller instead
-->
