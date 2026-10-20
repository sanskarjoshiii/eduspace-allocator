'use client';

import { useMemo } from 'react';
import { Badge, EmptyState, KeyValueList, PageHeader, Panel, PanelGrid, StatusBadge, Tag } from '@/components/ui';
import { MapView, type MapData } from '@/components/map';
import { useLookups } from '@/hooks/use-lookups';
import { formatNumber, formatWindow } from '@/lib/format';
import type { SpaceDto } from '@/server/dto/space';
import { lookupCategories, lookupFacilityTypes, nameMap } from './lookup-helpers';
import { PhotoGrid } from './photo-uploader';

/** Read-only space detail for viewers who do not own the space (public fields only). */
export function SpaceDetail({ space }: { space: SpaceDto }) {
  const lookups = useLookups();
  const facilityNames = useMemo(() => nameMap(lookupFacilityTypes(lookups.data)), [lookups.data]);
  const categoryNames = useMemo(() => nameMap(lookupCategories(lookups.data)), [lookups.data]);
  const openSlots = [...space.slots]
    .filter((s) => !s.isBlocked)
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
  const mapData = useMemo<MapData>(
    () => ({
      spaces: [{ id: space.id, name: space.name, status: space.isActive ? 'available' : 'inactive', location: { type: 'Point', coordinates: space.location }, seats: space.seatCapacity, areaName: space.areaName ?? undefined }],
    }),
    [space],
  );

  return (
    <>
      <PageHeader
        title={space.name}
        description={space.description || 'A registered space that can host classes.'}
        meta={
          <>
            <StatusBadge status={space.isActive ? 'Active' : 'Inactive'} />
            {space.areaName ? <Tag tone="info" icon="map-pin">{space.areaName}</Tag> : null}
          </>
        }
      />
      <PanelGrid columns={2}>
        <Panel title="Overview" description="Where the space is and how many it seats.">
          <KeyValueList
            items={[
              { label: 'Area', value: space.areaName ?? '—' },
              { label: 'Address', value: space.address || '—' },
              { label: 'Seats', value: formatNumber(space.seatCapacity), mono: true },
            ]}
          />
        </Panel>
        <Panel title="Location" description="The venue entrance on the map.">
          <MapView data={mapData} showControls={false} showLegend={false} height={240} zoom={15} center={{ type: 'Point', coordinates: space.location }} label={`${space.name} on the map`} />
        </Panel>
        <Panel title="Facilities" description="Equipment listed by the space giver, with how many are working.">
          {space.facilities.length === 0 ? (
            <EmptyState icon="list-checks" description="No facilities listed for this space." size="compact" />
          ) : (
            <KeyValueList
              items={space.facilities.map((f) => ({
                label: facilityNames[f.facilityTypeId] ?? 'Facility',
                value: `${formatNumber(f.workingQuantity)} of ${formatNumber(f.quantity)} working`,
                mono: true,
              }))}
            />
          )}
        </Panel>
        <Panel title="Open Weekly Slots" description="Times the space can host classes.">
          {openSlots.length === 0 ? (
            <EmptyState icon="calendar" description="No open slots listed right now." size="compact" />
          ) : (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {openSlots.map((s, i) => (
                <li key={s.id ?? i}>
                  <Badge tone="neutral" className="font-mono tabular-nums">{formatWindow(s)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Who Can Use It" description="Course categories and audiences this space accepts.">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="font-mono text-label uppercase text-ink-muted">Categories</span>
              {space.policy.allowedCategoryIds.length === 0 ? (
                <p className="m-0 text-body-sm text-ink">All categories</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {space.policy.allowedCategoryIds.map((id) => (
                    <Tag key={id} tone="accent">{categoryNames[id] ?? 'Category'}</Tag>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-mono text-label uppercase text-ink-muted">Audiences</span>
              <p className="m-0 text-body-sm text-ink">{space.policy.allowedAudiences.length ? space.policy.allowedAudiences.join(', ') : 'Everyone'}</p>
            </div>
          </div>
        </Panel>
        <Panel title="Photos" description="Pictures shared by the space giver.">
          {space.photos.length === 0 ? (
            <EmptyState icon="image" description="No photos yet." size="compact" />
          ) : (
            <PhotoGrid photos={space.photos} />
          )}
        </Panel>
      </PanelGrid>
    </>
  );
}
