# electronica negotiation (Luminovo app)

A Luminovo tenant app (module `design`) for face-to-face supplier negotiations at electronica 2026 in Munich.

- **Floor plan**: a 3D hall plan of Messe München; each supplier with a stand gets a spend pillar sized by the project's selected spend. Fly-in on load, top-down hall plan, and a guided "walk the route" tour.
- **Battle plan**: an AI-ranked walking route with one battle card per stand (objective, why, ask, minutes).
- **Supplier view**: project and cross-project selected spend, a live news ticker (Bing News RSS) with an AI conversation opener, and the negotiation tab:
  - concession simulator: award volume if the supplier cuts prices by x% and we award every line where they become cheapest (across the board, or only on lines they don't hold yet), with the give-back on held lines and the best move for them;
  - gap buckets (already cheapest / within 5% / 5–10% / 10–20% / over 20%);
  - price-match asks (lines they hold where a competitor is cheaper) and thin leads to defend;
  - a line table with the next best alternative and the move needed per line;
  - an AI negotiation brief.

## Layout

- `app.json`: the app document (manifest)
- `worker/index.ts`: the app backend (`worker.js`), handlers `projects`, `project`, `competition`, `portfolioScenarios`, `portfolio`, `news`, `plan`, `brief`
- `src/`: React widget built against `@luminovo/widget-sdk`
- `src/fair.ts`: hall geometry and the booth directory (sources and confidence per stand)
- `scripts/bundle.sh app.json`: builds the complete bundle into `bundle.tgz`
- `release/bundle.tgz`: the last uploaded bundle

## Data

- Selected offers: `POST /sourcing/calculation/read-selection` (live)
- Competing offers: `GET /sourcing-line-item/:id/solutions` per line, resolved to suppliers with the public `POST /offers/bulk`
- Cross-project spend: one scenario for each of the 60 most recent active projects (warehouse picks the scenarios, the selection is read live)
- Booths: exhibitor announcements for electronica 2026; `confirmed: false` marks a stand carried over from 2024
