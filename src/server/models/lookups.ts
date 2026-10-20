import { Schema } from 'mongoose';
import { DEMAND_LEVELS, INCOME_GROUPS } from '@/lib/domain';
import { PointSchema, defineModel } from './common';

const FacilityTypeSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    unit: { type: String, default: 'units' },
    description: { type: String, default: '' },
  },
  { timestamps: true },
);
export const FacilityType = defineModel('FacilityType', FacilityTypeSchema);

const CourseCategorySchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    /** Parent drives similarity for suggestions (same parent = similar). */
    parentId: { type: Schema.Types.ObjectId, ref: 'CourseCategory', default: null },
  },
  { timestamps: true },
);
export const CourseCategory = defineModel('CourseCategory', CourseCategorySchema);

const AreaSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    city: { type: String, default: 'Pune' },
    center: { type: PointSchema, required: true },
    population: { type: Number, min: 0, required: true },
    studentCount: { type: Number, min: 0, required: true },
    literacyRate: { type: Number, min: 0, max: 100, required: true },
    incomeScore: { type: Number, min: 0, max: 100, required: true },
    incomeGroup: { type: String, enum: INCOME_GROUPS, required: true },
    // Written by each allocation run.
    demandLevel: { type: String, enum: [...DEMAND_LEVELS, null], default: null },
    clusterId: { type: Number, default: null },
    demandIndex: { type: Number, default: null },
  },
  { timestamps: true },
);
AreaSchema.index({ center: '2dsphere' });
export const Area = defineModel('Area', AreaSchema);

const StudentDemandSchema = new Schema(
  {
    areaId: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'CourseCategory', required: true },
    baseline: { type: Number, min: 0, required: true },
  },
  { timestamps: true },
);
StudentDemandSchema.index({ areaId: 1, categoryId: 1 }, { unique: true });
export const StudentDemand = defineModel('StudentDemand', StudentDemandSchema);
