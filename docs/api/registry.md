# Identity and Registry API

Endpoints for accounts, lookups, spaces, courses, offerings, learning requests, users and uploads.
Zod schemas live in `src/schemas/{auth,lookups,space,course,offering,request,user}.ts`. Use the same schema with `zodResolver` in forms. DTO types live in `src/server/dto/*.ts`.

## Conventions

- Success: `{ data: T }`. Error: `{ error: { code, message, details? } }`.
- Status codes:
  - `401` signed out.
  - `403` wrong role, not the owner, or account not Active.
  - `404` not found, or not visible to you.
  - `409` conflict.
  - `422` validation failed. `details` is `{ formErrors: string[], fieldErrors: Record<string, string[]> }`, the same shape as `z.flattenError`.
  - `503` the service is not configured.
- Ids are 24-character hex strings. Coordinates are GeoJSON `[lng, lat]`. Points are `{ type: 'Point', coordinates: [lng, lat] }`.
- Window: `{ dayOfWeek: 0..6 (0 = Sunday), startTime: 'HH:mm', endTime: 'HH:mm' }`, where end is after start. Windows on the same day cannot overlap.
- Paged lists take `?page=1&pageSize=25` (max 200) and return `{ items: T[], total, page, pageSize, pages }`.
- Lookup lists (facility types, categories, areas) are not paged. They return `{ items: T[], total }`.
- **Service area rule:** when a location is used to pick an area, the nearest area centre is chosen. If that centre is more than 25 km away, the request fails with `422` and `message: "This location is outside the service area"` (field `location`).
- Every create, update and delete writes an audit log entry. Saves that affect allocation also write a domain event (listed per endpoint).
- `canEdit` on a DTO tells the UI whether to show edit and delete actions for the current viewer.

---

## Auth and me

### POST /api/auth/register (public)

- **Body:** `RegisterInput` (`src/schemas/auth.ts`)

  ```ts
  {
    role: 'Learner' | 'SpaceGiver' | 'CourseProvider';   // Administrator is rejected (422)
    name: string; email: string; password: string;       // password: 10+ chars, a letter and a number
    contactPhone?: string;
    // Learner
    ageBand?: 'Under 13'|'13-17'|'18-24'|'25-40'|'41-60'|'60+';  // required for learners
    areaId?: string; accessibilityNeeds?: string[];
    consent?: boolean;                                   // must be true for learners
    // Space Giver / Course Provider
    partnerType?: 'SpaceGiverOrg'|'ProviderOrg'|'IndividualTutor'; // required; space givers cannot be IndividualTutor
    organisationName?: string;                           // required unless IndividualTutor
  }
  ```
- **Response:** `201` with `AccountDto`.

  ```ts
  AccountDto = { user: UserDto; profile?: LearnerProfileDto; partner?: PartnerDto }
  UserDto = { id, email, name, role, status: 'Active'|'PendingApproval'|'Suspended', ownerRefId, emailNotifications, lastLoginAt, createdAt }
  LearnerProfileDto = { id, userId, name, ageBand, contactPhone, contactEmail, areaId, accessibilityNeeds, consentAt }
  PartnerDto = { id, userId, type, name, logoUrl, contactPhone, about }
  ```
- **Behaviour:**
  - Space givers and providers start as `PendingApproval` when the `requirePartnerApproval` setting is on. Everyone else starts `Active`.
  - Learners get `consentAt = now`.
  - Administrators are notified with `account.created`.
- **Errors:**
  - `409` duplicate email.
  - `422` validation, missing consent, Administrator role, or unknown `areaId`.

### GET /api/me (any signed-in user)

- **Response:** `AccountDto`. Learners get `profile`, partners get `partner`, administrators get only `user`.

### PATCH /api/me (any signed-in user)

- **Body:** `MeUpdate`

  ```ts
  { name?, contactPhone?, emailNotifications?: boolean, accessibilityNeeds?: string[] /* learner */, areaId?: string|null /* learner */ }
  ```
- **Response:** `AccountDto`.
- **Notes:** `contactPhone` updates the learner profile or the partner record.
- **Errors:** `422` when learner-only fields are sent by another role, or when `areaId` is unknown.

### GET /api/me/menu (any signed-in user)

- **Response:** `{ items: MenuItem[] }`.

  ```ts
  MenuItem = { label, href, icon /* lucide kebab name */, children?: { label, href }[] }
  ```

---

## Lookups

All lookup `GET`s are **public**, because the registration form needs areas. Writes are **Administrator only**: other signed-in roles get `403` and signed-out callers get `401`.

### GET /api/lookups

- **Response:** `{ facilityTypes: FacilityTypeDto[], categories: CategoryDto[], areas: AreaDto[] }`.

### GET /api/facility-types, POST /api/facility-types, PATCH and DELETE /api/facility-types/[id]

- `FacilityTypeDto = { id, name, unit, description }`
- **POST body:** `{ name, unit?, description? }`. **PATCH body:** any subset.
- **DELETE:** returns `{ id, deleted: true }`. Fails with `409` while the type is used by spaces, course requirements, requests or facility issues. `details.usedBy` lists what uses it.

### GET /api/categories?parentId=<id|null>, POST /api/categories, PATCH and DELETE /api/categories/[id]

- `CategoryDto = { id, name, parentId: string|null }`
- **POST body:** `{ name, parentId?: string|null }`. **PATCH body:** any subset.
- **Errors:**
  - `422` for an unknown parent, a category set as its own parent, or a parent loop.
  - `409` on delete while the category has child categories or is used by courses, offerings, requests, space policies, demand baselines or insights.

### GET /api/areas?near=lng,lat&q=&limit=, GET /api/areas/[id], POST /api/areas, PATCH and DELETE /api/areas/[id]

- `AreaDto = { id, name, city, center: [lng,lat], population, studentCount, literacyRate, incomeScore, incomeGroup, demandLevel, clusterId, demandIndex, distanceKm? }`
- **`?near=lng,lat`:** returns areas ordered by distance, each with `distanceKm`. Default `limit` is 5. Use `limit=1` to get the nearest area.
- **POST body:** `{ name, city?, center: Point, population, studentCount, literacyRate (0-100), incomeScore (0-100), incomeGroup: 'Low'|'Medium'|'High' }`
- **DELETE:** `409` while the area is used by spaces, requests, offerings, learner profiles, demand baselines or insights.

---

## Spaces

| Method | Path | Roles |
|---|---|---|
| GET | /api/spaces | any signed-in user |
| POST | /api/spaces | SpaceGiver, Administrator |
| GET | /api/spaces/[id] | any signed-in user |
| PATCH | /api/spaces/[id] | owner (SpaceGiver) or Administrator |
| DELETE | /api/spaces/[id] | owner (SpaceGiver) or Administrator |

**POST body** (`SpaceInput`):

```ts
{
  name: string; description?: string; address?: string;
  location: Point;                 // [lng, lat]
  areaId?: string;                 // omitted → nearest area (25 km rule)
  isActive?: boolean;              // default true
  seatCapacity: number;            // >= 1
  photos?: { url: string; publicId: string }[];
  facilities?: { facilityTypeId: string; quantity: number; workingQuantity: number }[]; // workingQuantity <= quantity; each type once
  slots?: { id?: string; dayOfWeek: 0..6; startTime: 'HH:mm'; endTime: 'HH:mm'; isBlocked?: boolean }[]; // no overlap per day
  policy?: { allowedCategoryIds?: string[]; allowedAudiences?: ('Children'|'Teens'|'Adults'|'Seniors')[];
             rentPerHour?: number; approvalMode?: 'auto'|'manual'; rules?: string };
  ownerUserId?: string;            // Administrator only: create for this Space Giver
}
```

**PATCH body** (`SpaceUpdate`):

- Any subset of the POST body except `ownerUserId`.
- Arrays (`photos`, `facilities`, `slots`) replace the stored array. Send `slots[].id` to keep a slot's identity.
- `policy` merges field by field.
- A changed `location` without an `areaId` re-snaps the area.

**Response:** `SpaceDto`, chosen by viewer.

```ts
SpacePublicDto = {             // learners, providers, other space givers
  visibility: 'public'; canEdit: false;
  id, partnerId, name, description, address, location: [lng,lat], areaId, areaName, isActive, seatCapacity,
  photos, facilities: { facilityTypeId, quantity, workingQuantity }[],
  slots: { id, dayOfWeek, startTime, endTime, isBlocked }[],
  policy: { allowedCategoryIds: string[]; allowedAudiences: Audience[] },   // no rent, approvalMode or rules
  createdAt, updatedAt
}
SpaceFullDto = SpacePublicDto & {   // owner and Administrator
  visibility: 'full'; canEdit: true; ownerUserId: string;
  policy: { allowedCategoryIds, allowedAudiences, rentPerHour, approvalMode, rules }
}
```

**List filters:** `?mine=1`, `?areaId=`, `?q=` (matches name, address or description), plus paging. Non-owners never see inactive spaces. `GET /api/spaces/[id]` returns `404` for an inactive space you do not own.

**Events:** each create or update emits `space.saved`. A delete emits `space.deleted`.

**Errors:**
- `422`:
  - overlapping slots
  - `workingQuantity` greater than `quantity`
  - an unknown facility type, category or area
  - a location outside the service area
  - a non-admin sending `ownerUserId`
- `403` when you are not the owner.
- `409` on delete while an allocation in a booking status (ApprovedBySpace, ConfirmedByProvider, Scheduled, Active or NeedsReallocation) uses the space.

---

## Courses

| Method | Path | Roles |
|---|---|---|
| GET | /api/courses, /api/courses/[id] | any signed-in user (catalogue) |
| POST | /api/courses | CourseProvider, Administrator |
| PATCH and DELETE | /api/courses/[id] | owner (CourseProvider) or Administrator |

- **POST body:** `{ title, description?, categoryId, requirements?: { facilityTypeId, minQuantity >= 1 }[], coverUrl?: url|'', providerUserId? /* admin only */ }`. PATCH takes any subset except `providerUserId`.
- **Response:**

  ```ts
  CourseDto = { id, providerUserId, partnerId, providerName, title, description, categoryId, categoryName, requirements, coverUrl, canEdit, createdAt, updatedAt }
  ```
- **List filters:** `?mine=1`, `?categoryId=`, `?q=` (matches title or description), plus paging.
- **Notes:** changing `title` or `categoryId` copies the new value to the course's offerings and emits `offering.saved` for each one.
- **Errors:**
  - `422` unknown category or facility type.
  - `403` not the owner.
  - `409` on delete while the course has offerings.

---

## Offerings

| Method | Path | Roles |
|---|---|---|
| GET | /api/offerings, /api/offerings/[id] | any signed-in user |
| POST | /api/offerings | CourseProvider (own course), Administrator |
| PATCH and DELETE | /api/offerings/[id] | owner (CourseProvider) or Administrator |

**POST body** (`OfferingInput`):

```ts
{
  courseId: string;                // title and categoryId are copied from the course; the course owner becomes the provider
  audience?: Audience;             // default 'Adults'
  batchSize: number;               // 1-1000
  sessionMinutes: number;          // 30-480; must fit inside at least one window when windows are given
  durationWeeks: number;           // 1-104
  startDate: string;               // ISO date
  targetAreaId?: string | null;
  windows?: Window[];              // no overlap
  maxRentPerHour?: number | null;  // null = no limit
  feePerMonth?: number | null;     // null or 0 = free
  status?: 'Draft'|'Open'|'Cancelled';  // default 'Open'. Providers may only set these three; Administrators may set any status
}
```

**PATCH:** any subset except `courseId`.
- The session-fits-a-window check runs on the merged values.
- A provider cannot change the status of a Completed offering (`409`).
- Once an offering is Allocated or Active, the provider can only set it to Cancelled (`409` otherwise).

**Response:**

```ts
OfferingDto = { id, courseId, providerUserId, providerName, title, categoryId, categoryName, audience, batchSize, sessionMinutes,
  durationWeeks, startDate, targetAreaId, targetAreaName, status, windows, feePerMonth,
  maxRentPerHour?,   // owner and Administrator only
  canEdit, createdAt, updatedAt }
```

**List filters:** `?mine=1`, `?status=`, `?categoryId=`, `?areaId=` (target area), `?courseId=`, `?q=` (matches title), plus paging. Drafts are visible only to their provider and to Administrators (`404` for others).

**Events:** each create or update emits `offering.saved`. A delete emits `offering.deleted`.

**Errors:**
- `422` for a system status set by a provider, overlapping windows, a session that does not fit any window, or an unknown course or area.
- `403` when the course or offering is not yours.
- `409` on delete while the offering has an allocation in a booking status (cancel the offering instead).

---

## Learning requests

| Method | Path | Roles |
|---|---|---|
| POST | /api/requests | Learner |
| GET | /api/requests | any signed-in user (scoped, see below) |
| GET | /api/requests/mine | Learner |
| GET | /api/requests/matched | CourseProvider, SpaceGiver |
| GET | /api/requests/[id] | any signed-in user (scoped) |
| PATCH | /api/requests/[id] | owner Learner or Administrator |
| POST | /api/requests/[id]/cancel | owner Learner or Administrator |

**POST body** (`RequestInput`):

```ts
{
  categoryId: string;
  location: Point;                 // exact point, private; the area is snapped from it (25 km rule)
  maxDistanceKm: number;           // 0.5-50
  startMonth: 'YYYY-MM';
  durationMonths: number;          // 1-24
  consentShared: true;             // false → 422, fieldErrors.consentShared = ['Consent is required']
  windows?: Window[];              // empty = flexible
  requiredFacilityTypeIds?: string[];
  budgetPerMonth?: number | null;
  notes?: string;
}
```

The server sets `audience` from the learner's age band, `consentAt = now` and `status = 'Submitted'`. It emits `request.saved` and notifies the learner with `request.received`.

**Visibility.** Exact learner coordinates only ever appear in `RequestFullDto`.

```ts
RequestFullDto = {                     // the learner themself and Administrators
  visibility: 'full';
  id, learnerUserId, learnerProfileId, learnerName, categoryId, categoryName, areaId, areaName, areaCenter: [lng,lat],
  location: [lng,lat],                 // exact
  audience, maxDistanceKm, startMonth, durationMonths, consentShared, consentAt, status: RequestStatus,
  windows, requiredFacilityTypeIds, budgetPerMonth, notes,
  suggestions: { offeringId, categoryId, areaId, score, reasons }[], lastRunId, createdAt, updatedAt,
  statusTimeline?: { status, at, source: 'request'|'enrollment', note, offeringId }[]   // GET /api/requests/[id] only
}
MatchedRequestDto = {                  // Course Providers and Space Givers with a matched enrollment
  visibility: 'matched';
  requestId, relation: 'provider'|'spaceGiver', stage: 'proposed'|'accepted',
  enrollmentId, enrollmentStatus, offeringId, offeringTitle,
  learner:
    | { visibility: 'cohort', requestId, areaName, areaCenter, windows }                       // proposed stage (Proposed, Offered, Waitlisted)
    | { visibility: 'provider-accepted', requestId, name, ageBand, contactPhone, contactEmail,
        accessibilityNeeds, areaName, areaCenter, categoryName, windows, startMonth, durationMonths } // provider, after Accepted
    | { visibility: 'roster', requestId, name }                                                // space giver, after Accepted (never contact)
}
```

**Matching rules:**
- A request is matched to a provider through an enrollment on one of the provider's offerings.
- It is matched to a space giver through an enrollment on an allocation at one of their spaces.
- When a request has several enrollments, the most advanced stage wins.
- Requests whose only enrollments are Declined, Expired or Cancelled are not disclosed.

**What each role gets back:**
- **GET /api/requests**
  - Administrators: all requests as `RequestFullDto`. Filters: `?status`, `?categoryId`, `?areaId`, `?q` (learner name or notes).
  - Learners: their own requests as `RequestFullDto`, same filters.
  - Providers and space givers: `MatchedRequestDto`. Filters: `?status` (enrollment or request status) and `?q` (offering title or learner name when visible).
  - All responses are paged.
- **GET /api/requests/[id]**
  - Owner or Administrator: `RequestFullDto` with `statusTimeline`.
  - Matched partner: `MatchedRequestDto`.
  - Everyone else: `404`.

**PATCH:**
- **Body:** any subset of the POST body. `consentShared`, when sent, must be `true`.
- **When:** only while the status is Submitted, Analysed or Unmatched (`409` otherwise).
- **Effects:** a changed location re-snaps the area. The update emits `request.saved`.
- **Errors:** `403` for anyone other than the owner or an Administrator.

**Cancel:**
- Sets the status to `Cancelled` and releases held enrollments (`releaseEnrollmentsForRequest`).
- Emits `request.cancelled` and writes an audit entry with action `cancel`.
- **Response:** `RequestFullDto`.
- **Errors:** `409` if the request is already Completed, Declined, Expired or Cancelled. `403` for anyone other than the owner or an Administrator.

---

## Users (Administrator only)

| Method | Path | Body or query | Response |
|---|---|---|---|
| GET | /api/users | `?role&status&q` (name or email) plus paging | paged `UserDto` |
| POST | /api/users | `CreateUserInput` | `201 AccountDto` |
| GET | /api/users/[id] | — | `AccountDto` |
| PATCH | /api/users/[id] | `{ name?, status?: 'Active'|'Suspended' }` | `UserDto` |

- **POST body:** `CreateUserInput` takes any role, including `Administrator`: `{ role, name, email, password, status?: 'Active'|'PendingApproval', contactPhone?, ageBand? (Learner, required), areaId?, accessibilityNeeds?, partnerType? (partners, required), organisationName? }`.
- **PATCH status:** setting `Active` approves a pending account or reactivates a suspended one. `Suspended` locks the user out, and every API call they make returns `403`.
- **Errors:**
  - `422` when you try to suspend yourself, or when the status is not Active or Suspended.
  - `409` duplicate email.
- **Audit actions:** `create`, `update`, `approve`, `suspend`, `reactivate`.
- No response ever includes `passwordHash`.

---

## Uploads

### POST /api/uploads/sign (any signed-in user)

- **Body:** `{ kind: 'space-photo' | 'logo' | 'course-cover' | 'facility-evidence' }`
- **Response:** `{ cloudName, apiKey, timestamp, signature, folder, uploadUrl }`
- **Client upload:** POST a multipart form with `file`, `api_key`, `timestamp`, `signature` and `folder` to `uploadUrl`. Store the returned `secure_url` and `public_id`, for example in `photos[]`.
- **Errors:**
  - `503` (`code: 'uploads_unavailable'`) when the Cloudinary keys are not set.
  - `422` unknown kind.
  - The API secret is never returned.
