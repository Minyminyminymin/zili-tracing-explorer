#!/usr/bin/env python3
"""Format raw RotatingTrace exports for the Tracing Explorer.

Usage:
    python3 format_tracing_data.py RAW_FOLDER OUTPUT_FOLDER [--recursive]

What it does
    Reads every CSV in RAW_FOLDER, sorts the files into participants and sessions, and writes one
    standard set of files per session, split into two folders:

        OUTPUT_FOLDER/Calibration/     Cube, Trefoil 3D (and the summer static 2D trefoil)
        OUTPUT_FOLDER/MainExperiment/  Sphere, Ellipse, main 2D Trefoil
        OUTPUT_FOLDER/manifest.csv     one row per session: who, when, which build, trials per task
        OUTPUT_FOLDER/skipped.csv      every file that was not formatted, with the reason
        OUTPUT_FOLDER/README.txt       these rules, for whoever opens the folder

    Each session gets, in each folder that has data for it:
        {PID}_S{NN}_{Calib|Main}_Trials_{YYYYMMDD}_{HHMMSS}.csv   one row per trial
        {PID}_S{NN}_{Calib|Main}_Samples_{YYYYMMDD}_{HHMMSS}.csv  one row per recorded sample
        {PID}_S{NN}_{Calib|Main}_SessionInfo_{YYYYMMDD}_{HHMMSS}.csv

    Drop the OUTPUT_FOLDER (or either subfolder) onto the Tracing Explorer.

Accepted inputs
    Current build (October 2026 on):  {PID}_S{NN}_Trials_*.csv + _Samples_*.csv (+ _SessionInfo_)
    Older per-task exports:          RotatingTrace_Calib_{PID}_{DATE}_S{n}.csv, RotatingTrace_{PID}_{DATE}_S{n}.csv,
                                     EllipseCircle_{PID}_{DATE}_S{n}.csv + EllipseCircle_Traj_{PID}_{DATE}_S{n}.csv
    A current-build session also writes the per-task copies; those copies are skipped, because the same
    data is in its Samples file.

Rules (also written to README.txt)
    * Participant ID and date come from the file name; current-build files also have SessionInfo.
    * Files without a participant ID, and sessions labelled Test / FinalTest / InverseColor / NoFeedback /
      90Degree (or a participant ID starting with "test"), are skipped and listed in skipped.csv.
    * Session numbers are re-counted per participant in date order (then by the S label), across every
      build in RAW_FOLDER. The original label is kept in SessionInfo and manifest.csv.
    * Build: "current" for unified Trials/Samples files; "summer" for older exports dated up to 31 Aug 2026;
      "autumn-legacy" for older exports dated from 1 Sep 2026. Builds must not be compared with each other.
    * Geometry is written into every Trials row so the explorer never has to guess:
        summer          README_Summer_RotatingTrace (Aug 24 version): centre (0, 1, 0.65) m, cube edge 0.24 m,
                        trefoil scale 0.08.
        autumn-legacy   assumed from the Unity scene defaults: centre (0, 1, 0.5) m, cube edge 0.24 m,
                        trefoil scale 0.08. Unverified; the explorer checks cube trials against the logged distance.
        current         derived from the session itself: centre = saved sphere centre, scale from the static
                        Trefoil 3D targets, main/ellipse centre from the ellipse samples (same method as
                        session-geometry.mjs).
      The ellipse centre is recovered from the ellipse samples (world minus rotated local position) whenever
      local coordinates exist.
    * Values are copied, never invented. An empty cell stays empty (for example TargetError in rotating
      Trefoil 3D). TimeSec is the time since the trial's first sample; TimeStamp keeps the raw Unity time.
"""
import argparse, csv, math, re, statistics, sys
from collections import defaultdict, OrderedDict
from pathlib import Path

CALIB_TASKS = {'Cube', 'Trefoil3D', 'Trefoil2DStatic'}
MAIN_TASKS = {'Sphere', 'Ellipse', 'Trefoil2D'}
SKIP_LABEL = re.compile(r'test|finaltest|inversecolor|nofeedback|90degree', re.I)
SUMMER_END = '20260831'

TRIAL_COLS = ['ParticipantID', 'SessionNumber', 'SessionDate', 'Build', 'TrialID', 'Task', 'Condition', 'TrialIndex',
              'Repetition', 'Direction', 'Block', 'TrialInBlock', 'ExpectedDuration', 'ActualDuration', 'NumSamples',
              'StimulusViewingMode', 'CursorViewingMode', 'RotationSpeed', 'R1', 'R2', 'Amplitude', 'SphereRadius',
              'SphereCenterX', 'SphereCenterY', 'SphereCenterZ', 'CameraX', 'CameraY', 'CameraZ', 'ViewX', 'ViewY', 'ViewZ',
              'EllipseConfigId', 'EllipseAspectRatio', 'EllipseWorldDiameter', 'EllipsePredictedDepth',
              'EllipseImpliedSlantDeg', 'DisplayRefreshRateHz', 'MeasuredFrameRateHz',
              'CalibCenterX', 'CalibCenterY', 'CalibCenterZ', 'CubeEdgeM', 'Trefoil3DScale',
              'MainCenterX', 'MainCenterY', 'MainCenterZ', 'MainTrefoilScale',
              'EllipseCenterX', 'EllipseCenterY', 'EllipseCenterZ', 'GeometrySource', 'SourceFile']
SAMPLE_COLS = ['ParticipantID', 'SessionNumber', 'TrialID', 'Task', 'SampleIndex', 'TimeSec', 'TimeStamp',
               'WorldX', 'WorldY', 'WorldZ', 'TargetX', 'TargetY', 'TargetZ', 'TargetError', 'TargetPhi',
               'StimulusAngleDeg', 'LocalX', 'LocalY', 'LocalZ']
INFO_COLS = ['ParticipantID', 'SessionNumber', 'SessionDate', 'Build', 'DominantEye', 'DominantHand',
             'OriginalLabel', 'SourceFiles']


def num(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def read_csv(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))


def header(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        return next(csv.reader(f), [])


def kind_of(name, h):
    has = lambda *k: all(x in h for x in k)
    if has('TrialID', 'Task', 'ExpectedDuration'): return 'trials'
    if has('TrialID', 'Task', 'SampleIndex'): return 'samples'
    if has('ParticipantID', 'SessionNumber'): return 'info'
    if has('TrialID', 'HMDFrameIndex'): return 'hmd_trial'
    if has('TimeSeconds', 'IsTracked', 'HMDWorldX'): return 'hmd_log'
    if has('TrialType', 'DistanceToCurve'): return 'calib_legacy'
    if has('TrialIndex', 'TrialInBlock', 'TrefoilAngleDeg'): return 'main_legacy'
    if has('TrialIndex', 'ConfigId', 'AspectRatio'): return 'ellipse_summary'
    if has('TrialIndex', 'PointIndex', 'WorldX', 'DiskAngleDeg'): return 'ellipse_traj'
    if name.startswith('EllipseCircle_Traj') and has('TrialIndex', 'PointIndex', 'WorldX'): return 'ellipse_traj'  # oldest layout: no disk angle or local coordinates
    if has('TrialIndex', 'Task', 'Repetition', 'SphereCenterX'): return 'sphere_legacy'
    return None


def name_info(name):
    """Participant, date, time and label from a file name; None fields when absent."""
    b = re.sub(r'\.csv$', '', name, flags=re.I)
    m = re.match(r'^([A-Za-z][A-Za-z.]*)_S(\d+)_([A-Za-z_]+?)_(\d{8})_(\d{6})', b)
    if m:
        return {'format': 'current', 'pid': m.group(1).upper(), 'session': int(m.group(2)), 'date': m.group(4),
                'time': m.group(5), 'label': f'S{int(m.group(2))}'}
    m = re.match(r'^(?:RotatingTrace_Calib|RotatingTrace|EllipseCircle_Traj|EllipseCircle)_+(?:([A-Za-z][A-Za-z.]*)_)?(\d{8})_?(.*)$', b)
    if m:
        rest = m.group(3) or ''
        t = rest if re.fullmatch(r'\d{6}', rest) else None
        return {'format': 'legacy', 'pid': m.group(1).upper() if m.group(1) else None, 'session': None,
                'date': m.group(2), 'time': t, 'label': rest}
    m = re.match(r'^HMD_Verification_(\d{8})_(\d{6})$', b)
    if m:
        return {'format': 'hmd', 'pid': None, 'session': None, 'date': m.group(1), 'time': m.group(2), 'label': ''}
    return {'format': None, 'pid': None, 'session': None, 'date': None, 'time': None, 'label': ''}


def rz(p, deg):
    a = math.radians(deg); c, s = math.cos(a), math.sin(a)
    return [c * p[0] - s * p[1], s * p[0] + c * p[1], p[2]]


def ellipse_center(samples):
    pts = [[], [], []]
    for r in samples:
        w = [num(r.get('WorldX')), num(r.get('WorldY')), num(r.get('WorldZ'))]
        l = [num(r.get('LocalX')), num(r.get('LocalY')), num(r.get('LocalZ'))]
        a = num(r.get('StimulusAngleDeg'))
        if None in w or None in l or a is None: continue
        q = rz(l, a)
        for k in range(3): pts[k].append(w[k] - q[k])
    return [statistics.median(v) for v in pts] if pts[0] else None


def current_geometry(trials, samples):
    """Same derivation as session-geometry.mjs (deriveSessionGeometry)."""
    g = {'source': 'derived from this session'}
    sph = next((t for t in trials if t.get('Task') == 'Sphere' and num(t.get('SphereCenterX')) is not None), None)
    c = [num(sph['SphereCenterX']), num(sph['SphereCenterY']), num(sph['SphereCenterZ'])] if sph else None
    g['calib'] = c
    if c:
        static = {t['TrialID']: t for t in trials if t.get('Task') == 'Trefoil3D' and t.get('Condition', '').lower() == 'static'}
        ratios = []
        for r in samples:
            t = static.get(r.get('TrialID'))
            if not t: continue
            phi, ty = num(r.get('TargetPhi')), num(r.get('TargetY'))
            if phi is None or ty is None: continue
            r1, r2 = num(t.get('R1')) or 1, num(t.get('R2')) or 1.5
            y = r1 * math.sin(phi) - r2 * math.sin(2 * phi)
            if abs(y) >= .2: ratios.append((ty - c[1]) / y)
        s = statistics.median(ratios) if ratios else None
        g['t3dScale'] = s if s and s > 0 else None
        g['cube'] = .3 * .8 * (s / .072) if g['t3dScale'] else None
    ell = ellipse_center([r for r in samples if r.get('Task') == 'Ellipse'])
    g['ellipse'] = ell; g['main'] = ell
    ds = [num(t.get('EllipseWorldDiameter')) for t in trials if t.get('Task') == 'Ellipse']
    ds = [d for d in ds if d]
    g['mainScale'] = .08 * statistics.median(ds) / .4 if ds else None
    return g


def legacy_geometry(build):
    if build == 'summer':
        return {'source': 'summer README (Aug 24 version)', 'calib': [0, 1, .65], 'cube': .24, 't3dScale': .08,
                'main': [0, 1, .65], 'mainScale': .08, 'ellipse': None}
    return {'source': 'assumed: Unity scene defaults (unverified)', 'calib': [0, 1, .5], 'cube': .24, 't3dScale': .08,
            'main': [0, 1, .5], 'mainScale': .08, 'ellipse': None}


def geo_cols(g):
    f = lambda v: '' if v is None else f'{v:.6f}'
    p = lambda v, k: '' if not v else f(v[k])
    return {'CalibCenterX': p(g.get('calib'), 0), 'CalibCenterY': p(g.get('calib'), 1), 'CalibCenterZ': p(g.get('calib'), 2),
            'CubeEdgeM': f(g.get('cube')), 'Trefoil3DScale': f(g.get('t3dScale')),
            'MainCenterX': p(g.get('main'), 0), 'MainCenterY': p(g.get('main'), 1), 'MainCenterZ': p(g.get('main'), 2),
            'MainTrefoilScale': f(g.get('mainScale')),
            'EllipseCenterX': p(g.get('ellipse'), 0), 'EllipseCenterY': p(g.get('ellipse'), 1), 'EllipseCenterZ': p(g.get('ellipse'), 2),
            'GeometrySource': g.get('source', '')}


def rel_times(rows, key='TimeStamp'):
    t0 = num(rows[0].get(key)) if rows else None
    return [('' if t0 is None or num(r.get(key)) is None else f'{num(r.get(key)) - t0:.4f}') for r in rows]


LEGACY_TYPES = {'cube_static': ('Cube', 'Static', 'CUBE_STATIC'), 'cube_rotating': ('Cube', 'Rotating', 'CUBE_ROT'),
                'trefoil3d_static': ('Trefoil3D', 'Static', 'T3D_STATIC'), 'trefoil3d_rotating': ('Trefoil3D', 'Rotating', 'T3D_ROT'),
                'trefoil2d_static': ('Trefoil2DStatic', 'Static', 'T2D_STATIC')}


def from_legacy(files):
    """Older per-task exports -> (trials, samples) in the unified layout."""
    trials, samples = [], []
    if 'calib_legacy' in files:
        path = files['calib_legacy']; by = OrderedDict()
        for r in read_csv(path):
            if r['TrialType'] in LEGACY_TYPES: by.setdefault((r['TrialType'], r['TrialIndex']), []).append(r)
        for (ty, ti), rows in by.items():
            task, cond, pre = LEGACY_TYPES[ty]; tid = f'{pre}_{int(ti) + 1:02d}'; trefoil = task == 'Trefoil3D'
            trials.append({'TrialID': tid, 'Task': task, 'Condition': cond, 'TrialIndex': int(ti) + 1, 'ExpectedDuration': 30,
                           'ActualDuration': rows[0].get('TrialDuration', ''), 'NumSamples': len(rows),
                           'RotationSpeed': 30 if cond == 'Rotating' else 0, 'R1': 1 if 'Trefoil' in task else '',
                           'R2': 1.5 if 'Trefoil' in task else '', 'Amplitude': 1 if trefoil else '', 'SourceFile': path.name})
            for i, (r, ts) in enumerate(zip(rows, rel_times(rows))):
                tgt = trefoil and any(num(r.get(k)) for k in ('NearestCurveX', 'NearestCurveY', 'NearestCurveZ'))
                samples.append({'TrialID': tid, 'Task': task, 'SampleIndex': r.get('PointIndex', i), 'TimeSec': ts,
                                'TimeStamp': r.get('TimeStamp', ''), 'WorldX': r['WorldX'], 'WorldY': r['WorldY'], 'WorldZ': r['WorldZ'],
                                'TargetX': r.get('NearestCurveX', '') if tgt else '', 'TargetY': r.get('NearestCurveY', '') if tgt else '',
                                'TargetZ': r.get('NearestCurveZ', '') if tgt else '', 'TargetError': r.get('DistanceToCurve', ''),
                                'TargetPhi': r.get('NearestPhi', '') if tgt else '',
                                'StimulusAngleDeg': r.get('ModelRotYDeg', '') if trefoil and cond == 'Rotating' else ''})
    if 'main_legacy' in files:
        path = files['main_legacy']; by = OrderedDict()
        for r in read_csv(path): by.setdefault(r['TrialIndex'], []).append(r)
        for ti, rows in by.items():
            tid = f'MAIN_{int(ti) + 1:03d}'; r0 = rows[0]
            trials.append({'TrialID': tid, 'Task': 'Trefoil2D', 'Condition': 'Rotating', 'TrialIndex': int(ti) + 1,
                           'Direction': r0.get('RotationDirection', ''), 'Block': r0.get('Block', ''), 'TrialInBlock': r0.get('TrialInBlock', ''),
                           'ExpectedDuration': 30, 'ActualDuration': r0.get('TrialDuration', ''), 'NumSamples': len(rows),
                           'RotationSpeed': r0.get('RotationSpeed', ''), 'R1': r0.get('R1', ''), 'R2': r0.get('R2', ''),
                           'DisplayRefreshRateHz': r0.get('DisplayRefreshRateHz', ''), 'MeasuredFrameRateHz': r0.get('MeasuredFrameRateHz', ''),
                           'SourceFile': path.name})
            for i, (r, ts) in enumerate(zip(rows, rel_times(rows))):
                samples.append({'TrialID': tid, 'Task': 'Trefoil2D', 'SampleIndex': r.get('PointIndex', i), 'TimeSec': ts,
                                'TimeStamp': r.get('TimeStamp', ''), 'WorldX': r['WorldX'], 'WorldY': r['WorldY'], 'WorldZ': r['WorldZ'],
                                'StimulusAngleDeg': r.get('TrefoilAngleDeg', '')})
    if 'ellipse_traj' in files:
        path = files['ellipse_traj']; summ = {r['TrialIndex']: r for r in read_csv(files['ellipse_summary'])} if 'ellipse_summary' in files else {}
        by = OrderedDict()
        for r in read_csv(path): by.setdefault(r['TrialIndex'], []).append(r)
        for ti, rows in by.items():
            tid = f'ELL_{int(ti) + 1:03d}'; s = summ.get(ti, {}); ar = num(s.get('AspectRatio'))
            trials.append({'TrialID': tid, 'Task': 'Ellipse', 'Condition': f'AspectRatio_{ar:.2f}' if ar is not None else '',
                           'TrialIndex': int(ti) + 1, 'Repetition': s.get('RepetitionNumber', ''), 'Direction': s.get('Direction', ''),
                           'ExpectedDuration': '', 'ActualDuration': s.get('TraceDuration', ''), 'NumSamples': len(rows),
                           'RotationSpeed': s.get('RotationSpeed', ''), 'EllipseConfigId': s.get('ConfigId', ''),
                           'EllipseAspectRatio': s.get('AspectRatio', ''), 'EllipseWorldDiameter': s.get('WorldDiameter', ''),
                           'EllipsePredictedDepth': s.get('PredictedDepth', ''), 'EllipseImpliedSlantDeg': s.get('ImpliedSlantDeg', ''),
                           'DisplayRefreshRateHz': s.get('DisplayRefreshRateHz', ''), 'MeasuredFrameRateHz': s.get('MeasuredFrameRateHz', ''),
                           'SourceFile': path.name + (f'; {files["ellipse_summary"].name}' if 'ellipse_summary' in files else '')})
            for i, (r, ts) in enumerate(zip(rows, rel_times(rows))):
                samples.append({'TrialID': tid, 'Task': 'Ellipse', 'SampleIndex': r.get('PointIndex', i), 'TimeSec': ts,
                                'TimeStamp': r.get('TimeStamp', ''), 'WorldX': r['WorldX'], 'WorldY': r['WorldY'], 'WorldZ': r['WorldZ'],
                                'StimulusAngleDeg': r.get('DiskAngleDeg', ''), 'LocalX': r.get('LocalX', ''), 'LocalY': r.get('LocalY', ''),
                                'LocalZ': r.get('LocalZ', '')})
    return trials, samples


def secs(t): return int(t[:2]) * 3600 + int(t[2:4]) * 60 + int(t[4:6])


def hmd_for(s, logs):
    """HMD logs name no participant. With a save time, take the log that started last before the session was saved
    (within 3 h); otherwise list every log from the same day."""
    day = [(p, n) for p, n in logs if n['date'] == s['date']]
    if s.get('time') and s['format'] == 'current':
        c = [(secs(s['time']) - secs(n['time']), p) for p, n in day if n['time'] and 0 < secs(s['time']) - secs(n['time']) <= 3 * 3600]
        return [min(c)[1].name] if c else []
    return [p.name for p, n in day]


def write_csv(path, cols, rows):
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction='ignore'); w.writeheader()
        for r in rows: w.writerow({k: ('' if r.get(k) is None else r.get(k)) for k in cols})


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('raw'); ap.add_argument('out'); ap.add_argument('--recursive', action='store_true', help='also read subfolders')
    a = ap.parse_args()
    raw, out = Path(a.raw).expanduser().resolve(), Path(a.out).expanduser().resolve()
    files = [p for p in (raw.rglob('*.csv') if a.recursive else raw.glob('*.csv')) if out not in p.parents]
    if not files: sys.exit(f'No CSV files in {raw}')
    skipped, sessions, hmd_logs = [], OrderedDict(), []
    for p in sorted(files):
        k = kind_of(p.name, header(p)); n = name_info(p.name)
        if k is None: skipped.append((p.name, 'header not recognised')); continue
        if k == 'hmd_log': hmd_logs.append((p, n)); continue
        if n['format'] == 'current' and k not in ('trials', 'samples', 'info'):
            skipped.append((p.name, 'per-task copy of a current-build session; the same data is in its Samples file')); continue
        if k in ('hmd_trial', 'sphere_legacy'): skipped.append((p.name, 'per-trial HMD export; not formatted yet' if k == 'hmd_trial' else 'older sphere export; not formatted')); continue
        if not n['pid']: skipped.append((p.name, 'no participant ID in the file name')); continue
        if n['pid'].lower().startswith('test') or SKIP_LABEL.search(n['label'] or ''):
            skipped.append((p.name, f'test or special session ({n["label"] or n["pid"]})')); continue
        key = (n['pid'], n['date'], n['time'] if n['format'] == 'current' else n['label'], n['format'])
        s = sessions.setdefault(key, {'pid': n['pid'], 'date': n['date'], 'time': n['time'], 'label': n['label'], 'format': n['format'], 'files': {}})
        if k in s['files']: skipped.append((p.name, f'duplicate {k} file for this session')); continue
        s['files'][k] = p
    # Session numbers: per participant, by date then label.
    order = defaultdict(list)
    for s in sessions.values(): order[s['pid']].append(s)
    lab = lambda s: (int(re.sub(r'\D', '', s['label']) or 0) if re.fullmatch(r'S\d+', s['label'] or '') else 0, s['time'] or '')
    for lst in order.values():
        lst.sort(key=lambda s: (s['date'], lab(s)))
        for i, s in enumerate(lst, 1): s['number'] = i
    out.mkdir(parents=True, exist_ok=True)
    (out / 'Calibration').mkdir(exist_ok=True); (out / 'MainExperiment').mkdir(exist_ok=True)
    manifest = []
    for s in sessions.values():
        f = s['files']; note = []
        if s['format'] == 'current':
            if 'trials' not in f or 'samples' not in f:
                skipped.append((', '.join(p.name for p in f.values()), 'current build: needs both Trials and Samples')); continue
            trials, samples = read_csv(f['trials']), read_csv(f['samples'])
            build, geo = 'current', current_geometry(trials, samples)
            info = (read_csv(f['info']) or [{}])[0] if 'info' in f else {}
            for t in trials: t['SourceFile'] = f['trials'].name
            for r in samples: r.setdefault('TimeStamp', '')
        else:
            if not any(k in f for k in ('calib_legacy', 'main_legacy', 'ellipse_traj')):
                skipped.append((', '.join(p.name for p in f.values()), 'older export without trajectories')); continue
            build = 'summer' if s['date'] <= SUMMER_END else 'autumn-legacy'
            trials, samples = from_legacy(f); geo = legacy_geometry(build); info = {}
            ec = ellipse_center([r for r in samples if r['Task'] == 'Ellipse'])
            if ec: geo['ellipse'] = ec
        if not samples: skipped.append((', '.join(p.name for p in f.values()), 'no samples')); continue
        hhmmss = s['time'] or f'{lab(s)[0]:06d}'
        common = {'ParticipantID': s['pid'], 'SessionNumber': s['number']}
        gc = geo_cols(geo)
        for t in trials: t.update(common, SessionDate=s['date'], Build=build, **gc)
        for r in samples: r.update(common)
        counts = {}
        for part, tasks, folder in (('Calib', CALIB_TASKS, 'Calibration'), ('Main', MAIN_TASKS, 'MainExperiment')):
            tr = [t for t in trials if t['Task'] in tasks]
            if not tr: continue
            ids = {t['TrialID'] for t in tr}; sm = [r for r in samples if r['TrialID'] in ids]
            stem = f'{s["pid"]}_S{s["number"]:02d}_{part}_{{}}_{s["date"]}_{hhmmss}.csv'
            write_csv(out / folder / stem.format('Trials'), TRIAL_COLS, tr)
            write_csv(out / folder / stem.format('Samples'), SAMPLE_COLS, sm)
            write_csv(out / folder / stem.format('SessionInfo'), INFO_COLS, [{**common, 'SessionDate': s['date'], 'Build': build,
                      'DominantEye': info.get('DominantEye', ''), 'DominantHand': info.get('DominantHand', ''),
                      'OriginalLabel': s['label'], 'SourceFiles': '; '.join(p.name for p in f.values())}])
            for t in tr: counts[t['Task']] = counts.get(t['Task'], 0) + 1
        empty = sorted({r['Task'] for r in samples if r['Task'] in ('Cube', 'Trefoil3D', 'Sphere') and r.get('TargetError', '') == ''})
        if empty: note.append('TargetError empty in some ' + ', '.join(empty) + ' samples')
        same_day = hmd_for(s, hmd_logs)
        manifest.append({'ParticipantID': s['pid'], 'SessionNumber': s['number'], 'SessionDate': s['date'], 'Build': build,
                         'OriginalLabel': s['label'], **{f'{t}_trials': counts.get(t, 0) for t in ('Cube', 'Trefoil3D', 'Trefoil2DStatic', 'Sphere', 'Ellipse', 'Trefoil2D')},
                         'Samples': len(samples), 'Geometry': geo['source'], 'HMDLog': '; '.join(same_day),
                         'SourceFiles': '; '.join(p.name for p in f.values()), 'Notes': '; '.join(note)})
    mcols = ['ParticipantID', 'SessionNumber', 'SessionDate', 'Build', 'OriginalLabel', 'Cube_trials', 'Trefoil3D_trials',
             'Trefoil2DStatic_trials', 'Sphere_trials', 'Ellipse_trials', 'Trefoil2D_trials', 'Samples', 'Geometry',
             'HMDLog', 'SourceFiles', 'Notes']
    write_csv(out / 'manifest.csv', mcols, sorted(manifest, key=lambda r: (r['ParticipantID'], r['SessionNumber'])))
    for p, n in hmd_logs:
        if not any(m['SessionDate'] == n['date'] for m in manifest): skipped.append((p.name, 'HMD log with no formatted session that day'))
    write_csv(out / 'skipped.csv', ['File', 'Reason'], [{'File': a_, 'Reason': b_} for a_, b_ in skipped])
    (out / 'README.txt').write_text('Formatted by format_tracing_data.py\n\n' + __doc__.split('Rules (also written to README.txt)')[1].strip() + '\n')
    by_build = defaultdict(int)
    for m in manifest: by_build[m['Build']] += 1
    print(f'{len(manifest)} sessions from {len({m["ParticipantID"] for m in manifest})} participants '
          f'({", ".join(f"{k}: {v}" for k, v in sorted(by_build.items()))}); {len(skipped)} files skipped. Output: {out}')


if __name__ == '__main__':
    main()
