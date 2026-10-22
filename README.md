# Zili Tracing Explorer

Browser-based tracing inspection and pilot analysis.

## Unified session inspector

The feature branch includes `session.html`, which reads the current experiment's unified
`*_Trials_*.csv` + `*_Samples_*.csv` exports. A matching `*_HMD_*.csv` is optional.

Two scopes are supported:

- `session.html?scope=calibration` (also the default): exposes only **Cube**, **Trefoil3D**, and **Sphere**.
  Ellipse and Trefoil2D/Main rows are filtered out before the viewer builds its in-memory trial list.
- `session.html?scope=full`: exposes all recorded tasks and links back to the original main-trial analysis.

The calibration-only scope is a viewing restriction, not a security boundary. Anyone who possesses
the original full CSV files can inspect those files outside the web page.

The session viewer uses saved CSV values as its primary source of truth. It displays the recorded trace,
sample-aligned saved targets when available, target-error QC, HMD paths when supplied, and World versus
stimulus-relative/canonical views. The existing Minyoung main-trial correspondence analysis remains
unchanged in `index.html`.
