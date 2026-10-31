# Forward candidates 9–12

Authorized October 30, 2026. These supplement original leads 1–8 without changing them.

- 9: Any WR; his last three same-season offensive appearances each graded Over
  their receiving-yards pregame line; next receiving-yards Under. Missing prior
  quote or a push breaks the streak.
- 10: Any WR; receptions in the last three offensive appearances strictly increase
  (three observations, two increases); next receptions Under.
- 11/12: Frozen additive / interaction logistic models from the October 30 context
  comparison, C=0.01, trained through 2025 week 10. Exact coefficients, imputation,
  missingness indicators and scaling are in `pipeline/frozen_models.json`.
  Four-market/nine-position-group universe; select the better side only when its
  estimated return at the saved odds is >=10%. No retraining.

Frozen at `2026-10-31T01:14:12Z` (October 30 in Chicago). No prior games or
pre-freeze captures are backfilled. All quoted players, including extras, are
eligible for the new candidates, matching the research universe. The original
eight remain slotted-player rules.

Decisions are made at the first eligible pregame capture observed during a build
before kickoff. The same capture convention as the app is used (DK primary, FD
fallback, approximately three hours before kickoff). Earlier monitoring captures
do not qualify. Features, prices, selected direction and nonqualifying model
decisions are appended to `data/frozen_leads.json`; subsequent builds never revise
these. The model-configuration digest prevents silent parameter changes. Publishing
excludes feature snapshots, and no 2025 observations or retrospective ROI are added
to site data. Learned coefficients are inference parameters, not training rows.

The site displays upcoming locked matches and grades the exact saved price/line
once the game is final and the player played. Voids and ungraded games do not enter
ROI. One unit risked per candidate bet. Leads Analysis shows each candidate's
separate forward record. All-leads totals retain the existing convention that
overlapping candidates count separately; they are not an independent portfolio.

Inference is standard-library only. The research source-position/missing-history
rules are preserved so a new runtime does not silently change the models. Prior
designed-run denominators are computed by the existing public PBP downloader, with
scrambles, kneels and no-plays excluded. No additional Odds API requests are added.

Changing definitions, source transforms, coefficients, preprocessing or thresholds
requires new candidate/version identifiers and a separate ledger. Do not reset the
ledger to incorporate an outcome that was not predicted before kickoff.

Implementation audit identified a date-only boundary defect in two 2026 historical
evaluation rows (Emmett Johnson receiving yards/receptions, week 7, late capture
00:00:17Z before 00:20Z kickoff). Prior research could include that same game's
statistics after the UTC date rolled over. Neither training nor validation has this
case, so pinned weights and selected thresholds are unaffected. Production history
is restricted by actual kickoff timestamps; it never reproduces that leakage.
The historical model-return estimates remain provisional pending a separate audit;
they are not displayed as the new leads' forward performance.

## Provisional early-week watchlist

Latest available weekly snapshots populate a changing watchlist for upcoming games,
including snapshots captured before the freeze. Previews never enter the audit ledger
or Leads Analysis returns. A new eligible pregame quote replaces the preview with
an immutable decision, including nonqualifying decisions. Once locked, a later
weekly snapshot cannot make the prop reappear as a preview. Model parameters and
10% thresholds are identical in both stages.
