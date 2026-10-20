/** Facility types (PLAN 2.1). Names are stable keys: the generator refers to them by name. */
export const FACILITY_TYPES = [
  { name: 'Computers', unit: 'workstations', description: 'Working desktop or laptop workstations for learners.' },
  { name: 'Projector', unit: 'units', description: 'Projector or large display for presentations.' },
  { name: 'Wi-Fi', unit: 'connections', description: 'Internet access usable by the class.' },
  { name: 'Dance floor', unit: 'sq m', description: 'Sprung or smooth floor area suitable for dance.' },
  { name: 'Mirrors', unit: 'wall panels', description: 'Full-length wall mirrors for dance and movement classes.' },
  { name: 'Music system', unit: 'units', description: 'Speakers and player for music and dance classes.' },
  { name: 'Wheelchair access', unit: 'entrances', description: 'Step-free entrance and accessible route to the room.' },
  { name: 'Whiteboard', unit: 'boards', description: 'Whiteboard or blackboard for teaching.' },
  { name: 'Air conditioning', unit: 'units', description: 'Air-conditioned room.' },
  { name: 'Musical instruments', unit: 'keyboards', description: 'Keyboards or other instruments learners can use.' },
] as const;

export type FacilityName = (typeof FACILITY_TYPES)[number]['name'];
export const FACILITY_NAMES: readonly FacilityName[] = FACILITY_TYPES.map((f) => f.name);
