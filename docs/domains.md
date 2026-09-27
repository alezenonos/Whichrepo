# Domains worth a which\* site

The shape fits any purchase where (a) there is a price, (b) buyers weigh several quantitative
dimensions differently, and (c) each dimension has a published, dated, per-item source. The third
condition is the one that fails. Ranked by how well the evidence exists today.

| Site               | Dimensions (candidates)                                                                              | Evidence that exists                                                                                | What will be hard                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **whichphone**     | Camera, battery life, screen, performance, build/repairability, software support years, value        | DXOMARK (camera, display, battery), GSMArena specs and battery tests, iFixit repairability, vendor support-life statements | Prices move weekly and per storage tier; the "priced variant" problem (which storage/RAM) is Whichcar's trim problem again |
| **whichlaptop**    | Performance, battery, display, keyboard/build, weight, ports, repairability, support                   | Notebookcheck (measured battery, display, noise), Geekbench/Cinebench, iFixit                         | Configurations explode; a model is a family, not an item                                                            |
| **whichproperty**  | Price per m², energy rating, commute time, schools, noise, flood risk, service charge, tenure        | EPC registers, land-registry transactions, flood maps, school ratings, transit APIs                    | Every item is unique and sold once; the "catalogue" is listings that expire. A different data lifecycle              |
| **whichappliance** | Energy use, capacity, noise, reliability, warranty, running cost                                     | EU energy label database (EPREL: measured energy, noise, capacity per model), consumer-survey reliability | Very strong: EPREL is dated, per-model, standards-stated. The best next instance on evidence quality                 |
| **whichbike**      | Weight, gearing, frame material, geometry, brakes, warranty (or for e-bikes: range, motor, battery)   | Manufacturer geometry charts, e-bike range tests (ebike-mtb), measured weights in reviews             | Sizing makes one model several items; geometry needs a standard                                                     |
| **whichcamera**    | Sensor, autofocus, video, stabilisation, weather sealing, lens ecosystem, weight                     | DXOMARK sensor scores, DPReview measured tests, manufacturer specs                                    | Body-only versus kit pricing; the lens system is half the purchase                                                  |
| **whichtv**        | Picture (contrast, HDR, colour), motion, input lag, brightness, viewing angle, OS                    | RTINGS measured tests (dated, per model and size)                                                     | Sizes are items; panel lottery within a model                                                                        |
| **whichmattress**  | Firmness, support, motion isolation, cooling, edge support, durability, trial/warranty terms          | RTINGS and Sleep Foundation measured tests                                                            | Fewer independent measured sources; heavy affiliate bias in reviews                                                  |
| **whichheadphones**| Frequency response accuracy, isolation/ANC, battery, comfort, microphone, codecs                      | RTINGS and Crinacle measured response, ANC attenuation                                               | Strong measured evidence; the "preference" dimension needs a stated target curve                                     |
| **whichschool**    | Results, progress, distance, class size, inspection grade, extracurricular                            | Government performance tables and inspection reports (dated, per school)                             | No price in the ordinary sense; the x-axis becomes catchment or fees. Ethically loaded; handle with care             |
| **whichpension**   | Fees, past performance, risk, ESG, provider strength                                                  | Fund factsheets, regulator data                                                                       | Regulated advice territory; the disclaimer becomes the product                                                       |
| **whichuniversity**| Fees, graduate outcomes, satisfaction, entry requirements, cost of living                            | National student surveys, graduate outcome data, league-table inputs                                  | Course, not institution, is the item                                                                                 |

Recommended order: **whichappliance** (best evidence, standards-stated, a database rather than a
crawl), then **whichphone** (largest audience, good measured sources, prices hardest), then
**whichtv** or **whichheadphones** (single measured source of high quality; low crawl cost).
**whichproperty** is the most valuable and needs a different catalogue lifecycle (listings expire);
plan it as a fork of the framework's data model, not as an instance of it, until the catalogue
lifecycle is generalised.

What every one of them inherits unchanged: the weight model, the frontier and its qualified claims,
shared ranks at the evidence's resolution, the price-basis discipline, the crawler contract, the
freshness audit shape, the validation gates, and the page's visitor-owned-state rules.
