"""Real XTop `summarize_gba_violations` output, verbatim.

From the old serial flow's server run `xtop-timing-closure-20260922-090023-5357`,
`flow/iterations/g002/XTOP/report/` (read-only copy in the controller's
`notes/real-summarize-sample.txt`):

- `pre_opt.rpt`: `summarize_gba_violations -exclude_path -as_reference -setup` then `-hold`;
- `post_opt.rpt`: `summarize_eco_actions`, then
  `summarize_gba_violations -exclude_path -with_reference -with_delta -setup` then `-hold`.

Each constant is one command's own output (the toolkit captures one command per
`redirect -variable`); `POST_OPT_FULL` is the whole report file, `summarize_eco_actions`
table included. Do not edit these texts: they pin `atcs.contributions.parse_gain_summary`.
"""

PRE_OPT_SETUP = (
    '### setup summary ###\n'
    'Scenario                  Count      Worst        TNS\n'
    '------------------------------------------------------\n'
    'total                        12    -0.0387    -0.1160\n'
    '  func_ffg_cbest_125          0     0.0000     0.0000\n'
    '  func_ffg_cbest_m40          0     0.0000     0.0000\n'
    '  func_ssg_rcworst_125        0     0.0000     0.0000\n'
    '  func_ssg_rcworst_m40       12    -0.0387    -0.1160\n'
)

PRE_OPT_HOLD = (
    '### hold summary ###\n'
    'Scenario                  Count      Worst        TNS\n'
    '------------------------------------------------------\n'
    'total                        70    -0.1542    -3.9661\n'
    '  func_ffg_cbest_125         44    -0.0764    -0.7568\n'
    '  func_ffg_cbest_m40         55    -0.0704    -0.7199\n'
    '  func_ssg_rcworst_125       49    -0.1398    -2.9593\n'
    '  func_ssg_rcworst_m40       48    -0.1542    -3.8962\n'
)

POST_OPT_ECO_ACTIONS = (
    '### design: swerv_wrapper ###\n'
    'Name                      Count     D_Area     Density    D_Density\n'
    '--------------------------------------------------------------------\n'
    'total                         -    +2.8980    73.0145%     +0.0007%\n'
    '  inserted                    4    +2.8980           -     +0.0007%\n'
    '    DEL025D1BWP30P140         3    +1.1340           -     +0.0003%\n'
    '    DEL100MD1BWP30P140        1    +1.7640           -     +0.0004%\n'
    '  sized                       0    +0.0000           -     +0.0000%\n'
    '  removed                     0    +0.0000           -     +0.0000%\n'
    '  moved                       0    +0.0000           -     +0.0000%\n'
)

POST_OPT_SETUP = (
    '### setup summary ###\n'
    'Scenario                  Count    Count0    D_Count           Worst     Worst0    D_Worst             TNS       TNS0      D_TNS\n'
    '---------------------------------------------------------------------------------------------------------------------------------\n'
    'total                        12        12         +0    |    -0.0387    -0.0387    +0.0000    |    -0.1160    -0.1160    +0.0000\n'
    '  func_ffg_cbest_125          0         0         +0    |     0.0000     0.0000    +0.0000    |     0.0000     0.0000    +0.0000\n'
    '  func_ffg_cbest_m40          0         0         +0    |     0.0000     0.0000    +0.0000    |     0.0000     0.0000    +0.0000\n'
    '  func_ssg_rcworst_125        0         0         +0    |     0.0000     0.0000    +0.0000    |     0.0000     0.0000    +0.0000\n'
    '  func_ssg_rcworst_m40       12        12         +0    |    -0.0387    -0.0387    +0.0000    |    -0.1160    -0.1160    +0.0000\n'
)

POST_OPT_HOLD = (
    '### hold summary ###\n'
    'Scenario                  Count    Count0    D_Count           Worst     Worst0    D_Worst             TNS       TNS0      D_TNS\n'
    '---------------------------------------------------------------------------------------------------------------------------------\n'
    'total                        66        70         -4    |    -0.1542    -0.1542    +0.0000    |    -3.7707    -3.9661    +0.1954\n'
    '  func_ffg_cbest_125         42        44         -2    |    -0.0764    -0.0764    +0.0000    |    -0.6846    -0.7568    +0.0722\n'
    '  func_ffg_cbest_m40         52        55         -3    |    -0.0704    -0.0704    +0.0000    |    -0.6551    -0.7199    +0.0649\n'
    '  func_ssg_rcworst_125       46        49         -3    |    -0.1398    -0.1398    +0.0000    |    -2.7901    -2.9593    +0.1692\n'
    '  func_ssg_rcworst_m40       46        48         -2    |    -0.1542    -0.1542    +0.0000    |    -3.7009    -3.8962    +0.1953\n'
)

POST_OPT_FULL = POST_OPT_ECO_ACTIONS + POST_OPT_SETUP + POST_OPT_HOLD
PRE_OPT_FULL = PRE_OPT_SETUP + PRE_OPT_HOLD
