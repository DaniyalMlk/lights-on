# Data notes

## What CoStar said (Discord #costar-group, Fri 8:29 pm)

- The CoStar data is a raw dump of real estate records that can be **linked to Matterport spaces and Vexcel regions**.
- Matterport **API** keys: data about spaces from imagery, down to room sizes and classifiers.
- Matterport **SDK** keys: the 3D viewer in the browser.
- Vexcel API keys: aerial capture data over large regions.
- Keys come from `/costar-keys`. Quick answers come from `/ask-costar`.
- The data is only available for the duration of the hackathon, so it stays out of git.

## Data spike (H0–2): 1801 Smith, 1021 Main, 1415 Louisiana

| Question | Answer |
|---|---|
| CoStar fields: class, year, stories, RBA, typical floor SF, vacancy, rent, owner, sale/assessed value | |
| Multifamily comps + concessions downtown? | |
| Vexcel: footprint polygon + roof height, by lat/lon or ID? | |
| Matterport: which buildings have scans? Room sizes / core / ceiling? | |
| Join key across the three | |
| Quotas, MCP server URLs | |
| What can appear in the public repo / video / Devpost? | |

## H2 decision

GO / LITE / NO-GO: ______ (see spec §9)
