# Weekly expanding-history interaction challenger

Authorized November 1, 2026. This is a separate learning experiment, lead 13;
original leads 1–12 and their model configurations/records are not modified.

## Fixed learning procedure

Tuesday around 15:00 America/Chicago, rebuild all eligible four-market training
rows from the 2025 archive and completed 2026 games available at the training
cutoff. Use the same Features/augment transforms and interaction columns as the
frozen interaction model, logistic C=0.01, fixed 10% estimated-return trigger,
training-only imputation/scaling, no weighting/tuning or new qualitative inputs.
Do not include same-game outcomes in features; use real kickoff timestamps.
Only historical labels train the model; historical training scores never count
as challenger forward results. Publication-time corrections in source statistics
cannot be fully reconstructed and remain a limitation.

The first successful version pins feature and training code hashes in policy.json.
Subsequent changes to architecture, code, features, regularization or threshold
must be a new experiment, not a silent change. Retraining on unchanged inputs is
skipped. No challenger automatically replaces a frozen model.

Versions are immutable ISO-week directories with portable inference parameters,
input hashes, training cutoff, activation time, feature/code hashes and coverage.
The active pointer changes only after coverage and inference-parity checks pass.
Failure preserves the old pointer and records status. An existing weekly version
is never overwritten. Source inputs/diagnostics are retained as Actions artifacts
for 90 days; hashes/versions persist in the repository. No raw 2025 inputs are
published in site/data. Training uses only free public statistics and archived
quotes; no Odds API requests or new keys.

## Forward predictions

The normal updater uses the active version for weekly snapshot previews and saves
pregame decisions to that version's separate ledger. All graded results retain
the exact prediction version, selected side, price and feature snapshot. A later
version cannot overwrite a previously locked opportunity, including a skipped bet.
Existing frozen decisions are not backfilled or changed. Site payload strips
feature snapshots; the new lead follows the existing signed-in visibility policy.

## Schedule

The Challenger learning and scorecard workflow runs Tuesday afternoons and makes
a Wednesday 07:00 Central scorecard for the ChatGPT Wednesday-morning delivery.
Both UTC offsets are scheduled and guarded using America/Chicago; weekly version
idempotence prevents duplicate fits around daylight saving. It shares the existing
`update` concurrency group and syncs main before generating any data.

The report task delivers around Wednesday 08:00 Central. The workflow can also be
manually dispatched with `report` (default) or `train`. It grants contents:write
only and does not receive API keys. Training dependencies are isolated from the
normal standard-library prediction pipeline.

## Scorecard and decision rules

data/challenger/weekly_report.json and .md contain weekly/cumulative paper returns,
pending and void counts, probability error vs the no-vig market, calibration bins,
price degradation, concentration, leave-best-week-out results and matched
challenger-minus-frozen profits (skips zero) on identical quotes. Probability
changes between versions are diagnostic rescoring of saved feature snapshots,
not replacement predictions or credited performance.

Report observations separately from explanations; missing injury context cannot
justify a causal narrative. Bootstrap intervals are nominal, require at least
four week clusters, and do not correct repeated monitoring/multiple comparisons.
Weekly reports do not authorize a significance claim or performance-based stopping.
Formal reviews occur after eight activated versions and at regular-season end;
promotion requires a separate decision and enough evidence, not a winning week.

Run `python -m pipeline.challenger report` to rebuild the report offline. Training
uses `python -m pipeline.challenger train` with numpy, pandas, scipy, scikit-learn.
All repository tests: `python -m unittest discover -s tests`.
