# Formatting raw exports before using the Tracing Explorer

Raw RotatingTrace exports come in different layouts depending on the build (summer per-task files, the
October unified Trials/Samples files). Run this once on a folder of raw files; it pulls out what the explorer
needs and writes one layout for every build.

```bash
python3 tools/format_tracing_data.py "path/to/raw folder" "path/to/raw folder/Formatted"
```

Python 3.8 or later, no extra packages. Add `--recursive` to also read subfolders.

Output:

| Path | What it holds |
|---|---|
| `Calibration/` | Cube and Trefoil 3D (and the summer static 2D trefoil), per session: `_Calib_Trials_`, `_Calib_Samples_`, `_Calib_SessionInfo_` |
| `MainExperiment/` | Sphere, Ellipse and main 2D Trefoil, per session: `_Main_Trials_`, `_Main_Samples_`, `_Main_SessionInfo_` |
| `manifest.csv` | One row per session: participant, session number, date, build, trials per task, geometry, HMD log, source files |
| `skipped.csv` | Every file that was not formatted, with the reason |
| `README.txt` | The formatting rules |

Then drop `Formatted` (or just `Calibration` or `MainExperiment`) onto the explorer's Datasets card.
Sessions from different builds always become separate datasets.

The rules are at the top of `format_tracing_data.py` and are copied into `README.txt` in every output folder.
