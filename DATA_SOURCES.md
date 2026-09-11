# Catalog provenance

Checked on **2026-09-11**. This is a curated starter snapshot of **24 Trekkers and 30 Discs**, not a complete roster or a claim about the latest meta.

- [StellaBase Trekker catalog](https://stella.ennead.cc/trekkers)
- [StellaBase Disc catalog](https://stella.ennead.cc/discs)
- [Official Stella Sora site](https://stellasora.global/)

The public StellaBase records were inspected through the same endpoints used by its frontend: `/api/stella/characters?lang=en`, `/api/stella/character/{id}?lang=en`, `/api/stella/discs?lang=en`, and `/api/stella/disc/{id}?lang=en`. Individual records in `src/data.js` link to the corresponding readable detail page. Exact game names, element, role, rarity, skill names, potential names, and effect conditions come from those records. StellaBase is a community database, not the game operator. The snapshot should be reviewed against the in-game client when updating it.

The character portraits and Disc thumbnails in `public/images` are game assets downloaded from StellaBase's public image host, `https://api.ennead.cc/stella/assets/`. Character portraits use the catalog's `portrait` field; Disc thumbnails use each detail record's `icon` field. These assets are not original artwork of this project; underlying rights remain with their owners. No generated replacement portraits are used.

Build focus, stat priorities, selected potential routes, qualitative tags, and matchup scores are **app-authored recommendations**, not extracted official builds. Each suggested potential name was checked against the Trekker record. Potential choices describe one usable route rather than all routes or a universal optimum. The default `build` and `buildPosition` use main for Vanguard and support for Versatile/Support. `builds.main` and `builds.support` provide position-specific recommendations: all seven Versatile Trekkers have a researched main alternative, and all eleven Vanguards have a researched support alternative. Each build carries its own damage tags because a position change can change its damage focus. Support-role Trekkers currently have no curated main route, and the interface should show explicitly generic positional guidance if one is placed in main.

Disc tags cover both the Melody and possible Harmony benefits. Harmony benefits are not guaranteed active: the game requires the appropriate Notes, and several effects also require a certain position, element, Mark, HP state, or action. This prototype does not calculate Note thresholds, exact damage multipliers, or expected DPS. The visible summaries and notes preserve major effect conditions rather than inventing exact values.

Examples of conditions deliberately preserved:

- Flora's heal requires **Backstage Support** and a friendly critical hit.
- Ann's suggested shield requires **Warm Wind Guard** and moving through the wall.
- Tilia's shield requires **Knight Oath: Chalk Armor** and an Ultimate hit.
- Minova's shield requires **Oath Satellite**.
- Nazuna's heal depends on a full-heart raffle result; her Heart potential route increases its likelihood without making healing unconditional.
- **Seed Alike** requires a Lux Versatile Trekker accumulating Light Particle on the battlefield.
- **Claw the Claw** can reward healing through Harmony; it does not itself heal.
- **Meowing Cat God** provides damage reduction, which is distinct from a shield.

Future updates should change the snapshot date, verify each added record and condition, and avoid calling a recommendation a latest-meta ranking without a separately maintained, evidence-based evaluation.
