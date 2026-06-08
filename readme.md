<!-- @format -->

# The Other Wife — Backend

## Location-based meal & vendor search

Customers see meals and featured vendors filtered to vendors **near their saved
address**. The radius is configurable per request and falls back to a server
default.

### How it works

- Each `Address` stores a GeoJSON `location` point (kept in sync with
  `latitude`/`longitude`) and is indexed with a `2dsphere` index.
- For a request, the customer's active address is resolved, and a
  `$geoWithin` / `$centerSphere` query finds approved, available vendors whose
  address falls within the radius.
- Affected endpoints:
  - `GET /api/v1/meals`
  - `GET /api/v1/vendors/featured`

### Choosing the search width

Pass a `radius` query param (kilometers) to let the customer widen or narrow the
search, e.g. a 10 / 20 / 50 km control:

```
GET /api/v1/meals?radius=10
GET /api/v1/vendors/featured?radius=50
```

Resolution order: **request `radius` → `SEARCH_RADIUS_KM` env → 25 km default**.
The value is clamped to **1–100 km**.

### Response metadata

Both endpoints return a `searchRadius` block so the client can explain the
result set (e.g. "Showing meals within 10 km of Lekki"):

```json
"searchRadius": {
  "strategy": "radius",
  "radiusKm": 10,
  "customerAddress": {
    "id": "...",
    "city": "Lekki",
    "state": "Lagos",
    "country": "Nigeria",
    "latitude": 6.5005,
    "longitude": 3.3538
  }
}
```

- `strategy: "radius"` — location filtering applied. Zero results means no
  vendors are within the radius.
- `strategy: "none"` — no usable customer address (e.g. unauthenticated or no
  saved address); the unfiltered (all-vendors) result set is returned.

### Configuration

| Env var            | Default | Description                                                        |
| ------------------ | ------- | ------------------------------------------------------------------ |
| `SEARCH_RADIUS_KM` | `25`    | Default search radius (km) when no `radius` query param is passed. |

### Backfilling existing addresses

Addresses created before the `2dsphere` index existed have no `location` field
and are invisible to radius search until backfilled. Run once after deploying:

```
npm run backfill:address-location
```

New and edited addresses populate `location` automatically.
