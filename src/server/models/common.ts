import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/** GeoJSON Point, coordinates in [lng, lat] order. */
export const PointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (v: number[]) => v.length === 2 && v[0]! >= -180 && v[0]! <= 180 && v[1]! >= -90 && v[1]! <= 90,
        message: 'coordinates must be [lng, lat]',
      },
    },
  },
  { _id: false },
);

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A weekly window: day 0 (Sun) to 6 (Sat), times as "HH:mm", end after start. */
export const WindowSchema = new Schema(
  {
    dayOfWeek: { type: Number, min: 0, max: 6, required: true },
    startTime: { type: String, match: HHMM, required: true },
    endTime: { type: String, match: HHMM, required: true },
  },
  { _id: false },
);

export const StatusHistorySchema = new Schema(
  {
    status: { type: String, required: true },
    at: { type: Date, required: true, default: () => new Date() },
    by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, default: '' },
  },
  { _id: false },
);

/** Reuses a compiled model across hot reloads, keeping the schema's inferred types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineModel<S extends Schema<any>>(name: string, schema: S): Model<InferSchemaType<S>> {
  type M = Model<InferSchemaType<S>>;
  // Via the default export: under tsx's native ESM, mongoose's named `models` export is missing.
  return (mongoose.models[name] as M | undefined) ?? (mongoose.model(name, schema) as unknown as M);
}
