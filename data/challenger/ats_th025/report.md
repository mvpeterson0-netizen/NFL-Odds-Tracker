# TH-025 ATS state vs player props

**Exploratory data, not a validated signal.**

Graded 10543 props across 12083 lines. {'unmatched_quotes': 503, 'no_prior_ATS': 923, 'pushes': 0}

## Overall prior-game ATS combinations

| ATS | Market | Position | Side | Bets | Wins | Hit % | ROI % | Lift | 2025 / 2026 |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| NC/C |  |  | over | 2705 | 1265 | 46.77 | -10.85 |  | 1761 / 944 |
| NC/C |  |  | under | 2705 | 1440 | 53.23 | -0.38 |  | 1761 / 944 |
| C/NC |  |  | over | 2681 | 1312 | 48.94 | -7.04 |  | 1780 / 901 |
| C/NC |  |  | under | 2681 | 1369 | 51.06 | -4.25 |  | 1780 / 901 |
| C/C |  |  | over | 2348 | 1146 | 48.81 | -7.06 |  | 1642 / 706 |
| C/C |  |  | under | 2348 | 1202 | 51.19 | -3.62 |  | 1642 / 706 |
| NC/NC |  |  | over | 2379 | 1115 | 46.87 | -10.82 |  | 1597 / 782 |
| NC/NC |  |  | under | 2379 | 1264 | 53.13 | -0.47 |  | 1597 / 782 |
| NC/P |  |  | over | 112 | 52 | 46.43 | -12.09 |  | 26 / 86 |
| NC/P |  |  | under | 112 | 60 | 53.57 | 2.08 |  | 26 / 86 |
| P/NC |  |  | over | 103 | 45 | 43.69 | -16.61 |  | 33 / 70 |
| P/NC |  |  | under | 103 | 58 | 56.31 | 6.27 |  | 33 / 70 |
| C/P |  |  | over | 110 | 44 | 40.0 | -24.71 |  | 0 / 110 |
| C/P |  |  | under | 110 | 66 | 60.0 | 11.58 |  | 0 / 110 |
| P/C |  |  | over | 105 | 44 | 41.9 | -21.47 |  | 0 / 105 |
| P/C |  |  | under | 105 | 61 | 58.1 | 6.32 |  | 0 / 105 |

## Top market-position sample-qualified combinations

| ATS | Market | Position | Side | Bets | Wins | Hit % | ROI % | Lift | 2025 / 2026 |
|---|---|---|---|---:|---:|---:|---:|---:|---|
| NC/C | rec | RB | under | 235 | 137 | 58.3 | 6.16 | 4.48 | 150 / 85 |
| C/NC | rush_yds | RB | under | 323 | 180 | 55.73 | 5.48 | 3.43 | 219 / 104 |
| NC/NC | rec | WR | under | 460 | 262 | 56.96 | 3.78 | 3.29 | 319 / 141 |
| C/NC | rush_yds | QB | under | 182 | 100 | 54.95 | 3.09 | 0.65 | 122 / 60 |
| NC/C | rec_yds | TE | under | 237 | 129 | 54.43 | 3.02 | 2.28 | 151 / 86 |
| C/C | pass_yds | QB | over | 166 | 90 | 54.22 | 2.65 | 2.32 | 120 / 46 |
| NC/NC | rec_yds | WR | under | 473 | 256 | 54.12 | 2.47 | 2.68 | 332 / 141 |
| NC/C | rush_yds | QB | under | 178 | 97 | 54.49 | 2.13 | 0.19 | 119 / 59 |
| NC/NC | rec_yds | RB | under | 212 | 114 | 53.77 | 1.74 | 0.82 | 136 / 76 |
| C/NC | pass_yds | QB | over | 190 | 102 | 53.68 | 1.59 | 1.78 | 131 / 59 |
| NC/C | rec_yds | RB | under | 244 | 131 | 53.69 | 1.47 | 0.74 | 157 / 87 |
| C/C | rush_yds | RB | under | 287 | 153 | 53.31 | 0.91 | 1.01 | 202 / 85 |
| NC/NC | rec | RB | under | 203 | 110 | 54.19 | 0.74 | 0.37 | 129 / 74 |
| NC/NC | rush_yds | QB | under | 157 | 84 | 53.5 | 0.46 | -0.8 | 107 / 50 |
| NC/C | rec | WR | under | 530 | 286 | 53.96 | 0.16 | 0.29 | 348 / 182 |
| NC/C | rec_yds | WR | under | 543 | 287 | 52.85 | 0.06 | 1.41 | 361 / 182 |
| C/NC | rec | TE | under | 241 | 130 | 53.94 | -0.49 | 2.18 | 161 / 80 |
| NC/NC | rec_yds | TE | under | 214 | 112 | 52.34 | -1.0 | 0.19 | 139 / 75 |
| NC/C | rec | TE | under | 233 | 126 | 54.08 | -1.24 | 2.32 | 147 / 86 |
| C/NC | rec_yds | WR | over | 539 | 281 | 52.13 | -1.34 | 3.57 | 355 / 184 |
| NC/NC | pass_yds | QB | under | 166 | 86 | 51.81 | -2.0 | 3.71 | 116 / 50 |
| C/C | rec_yds | WR | under | 450 | 233 | 51.78 | -2.01 | 0.34 | 324 / 126 |
| C/C | rec | WR | under | 436 | 230 | 52.75 | -2.09 | -0.92 | 310 / 126 |
| C/NC | rec_yds | RB | under | 221 | 114 | 51.58 | -2.39 | -1.37 | 145 / 76 |
| C/C | rec | TE | over | 214 | 108 | 50.47 | -2.51 | 2.23 | 141 / 73 |
| NC/C | rush_yds | RB | over | 317 | 163 | 51.42 | -2.82 | 3.72 | 199 / 118 |
| NC/NC | rec | TE | over | 213 | 110 | 51.64 | -2.87 | 3.4 | 138 / 75 |
| NC/NC | rush_yds | RB | over | 281 | 144 | 51.25 | -2.94 | 3.55 | 181 / 100 |
| C/C | rec_yds | RB | under | 215 | 110 | 51.16 | -3.16 | -1.79 | 148 / 67 |
| C/C | rush_yds | QB | under | 153 | 79 | 51.63 | -3.6 | -2.67 | 109 / 44 |

All tested rows: all_buckets.csv. No multiple-comparison-adjusted or prospective EV claim.
