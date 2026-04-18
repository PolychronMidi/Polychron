# fx/stutter

Beat-synchronized stutter effects engine. `StutterManager` is a static-class singleton — all state is held in static fields, initialized once at boot via `StutterManager.init()`. Never construct instances.

Texture coupling enters exclusively via the `TEXTURE_CONTRAST` eventBus event — `StutterManagerAttachTextureListener()` subscribes once via `feedbackAccumulator`, which manages the EMA and section-boundary resets. Never read drum texture metrics directly from stutter modules; route through this listener.

`variants/` contains 20 self-registering variant implementations. Each registers itself into `stutterRegistry` at load time. Never call variant functions directly — always dispatch through `StutterManager` so plan scheduling, channel tracking, and metric recording stay coherent.

<!-- HME-DIR-INTENT
rules:
  - StutterManager is a static-class singleton — never construct instances; all state lives in static fields
  - Texture coupling enters only via TEXTURE_CONTRAST eventBus; never read drum metrics directly from stutter modules
  - Variants self-register at load time; always dispatch through StutterManager, never call variant functions directly
-->
