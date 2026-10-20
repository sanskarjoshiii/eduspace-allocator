'use client';

import Image from 'next/image';
import { useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, IconButton, Skeleton } from '@/components/ui';
import { ApiError, apiSend } from '@/lib/api';

export type UploadKind = 'space-photo' | 'course-cover';

interface UploadSignature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  uploadUrl: string;
}

export interface UploadedPhoto {
  url: string;
  publicId: string;
}

const MAX_BYTES = 10 * 1024 * 1024;

const sign = (kind: UploadKind) => apiSend<UploadSignature>('POST', '/api/uploads/sign', { kind });

/**
 * Whether uploads are configured: probes POST /api/uploads/sign once. A 503 means the
 * Cloudinary keys are not set, so the uploader is hidden.
 */
export function useUploadsAvailable(kind: UploadKind) {
  const q = useQuery({ queryKey: ['upload-sign-probe', kind], queryFn: () => sign(kind), retry: false, staleTime: 10 * 60_000 });
  const unavailable = q.error instanceof ApiError && q.error.status === 503;
  return { checking: q.isPending, unavailable };
}

/** Signs on the server, then uploads the file straight from the browser to Cloudinary. */
export async function uploadImage(kind: UploadKind, file: File): Promise<UploadedPhoto> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file (JPG, PNG or WebP).');
  if (file.size > MAX_BYTES) throw new Error('Images must be 10 MB or smaller.');
  const s = await sign(kind);
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', s.apiKey);
  form.append('timestamp', String(s.timestamp));
  form.append('signature', s.signature);
  form.append('folder', s.folder);
  const url = s.uploadUrl || `https://api.cloudinary.com/v1_1/${s.cloudName}/image/upload`;
  const res = await fetch(url, { method: 'POST', body: form });
  const body = (await res.json().catch(() => ({}))) as { secure_url?: string; public_id?: string; error?: { message?: string } };
  if (!res.ok || !body.secure_url) throw new Error(body.error?.message ? `Upload failed: ${body.error.message}` : 'Upload failed. Try again.');
  return { url: body.secure_url, publicId: body.public_id ?? '' };
}

function Unavailable() {
  return <Alert tone="neutral">Photo uploads are not set up yet.</Alert>;
}

function FilePicker({ kind, onUploaded, label, disabled }: { kind: UploadKind; onUploaded: (p: UploadedPhoto) => void; label: string; disabled?: boolean }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <input
        id={id}
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            onUploaded(await uploadImage(kind, file));
          } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Upload failed. Try again.');
          } finally {
            setBusy(false);
          }
        }}
      />
      <div>
        <Button size="sm" icon="upload" loading={busy} disabled={disabled} onClick={() => input.current?.click()}>
          {label}
        </Button>
      </div>
      {error ? <p className="m-0 text-body-sm text-danger-ink">{error}</p> : null}
    </div>
  );
}

/** Editable photo list for a space (Cloudinary). */
export function PhotoUploader({
  value, onChange, max = 20, disabled,
}: { value: UploadedPhoto[]; onChange: (next: UploadedPhoto[]) => void; max?: number; disabled?: boolean }) {
  const { checking, unavailable } = useUploadsAvailable('space-photo');
  return (
    <div className="flex flex-col gap-3">
      {value.length > 0 ? <PhotoGrid photos={value} onRemove={disabled ? undefined : (i) => onChange(value.filter((_, j) => j !== i))} /> : null}
      {checking ? (
        <Skeleton className="h-control-sm w-32" />
      ) : unavailable ? (
        <Unavailable />
      ) : (
        <FilePicker kind="space-photo" label="Add Photo" disabled={disabled || value.length >= max} onUploaded={(p) => onChange([...value, p])} />
      )}
    </div>
  );
}

/** Single cover image (course). Stores only the URL. */
export function CoverUploader({ value, onChange, disabled }: { value: string; onChange: (url: string) => void; disabled?: boolean }) {
  const { checking, unavailable } = useUploadsAvailable('course-cover');
  return (
    <div className="flex flex-col gap-3">
      {value ? (
        <div className="flex items-start gap-3">
          <div className="relative aspect-video w-48 overflow-hidden rounded-lg border border-border bg-surface-sunken">
            <Image src={value} alt="Course cover" fill unoptimized className="object-cover" sizes="192px" />
          </div>
          {!disabled ? <IconButton icon="trash-2" label="Remove cover image" onClick={() => onChange('')} /> : null}
        </div>
      ) : null}
      {checking ? (
        <Skeleton className="h-control-sm w-32" />
      ) : unavailable ? (
        <Unavailable />
      ) : (
        <FilePicker kind="course-cover" label={value ? 'Replace Cover' : 'Upload Cover'} disabled={disabled} onUploaded={(p) => onChange(p.url)} />
      )}
    </div>
  );
}

/** Read-only or removable photo grid. */
export function PhotoGrid({ photos, onRemove }: { photos: UploadedPhoto[]; onRemove?: (index: number) => void }) {
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4">
      {photos.map((p, i) => (
        <li key={`${p.publicId || p.url}-${i}`} className="relative aspect-4/3 overflow-hidden rounded-lg border border-border bg-surface-sunken">
          <Image src={p.url} alt={`Photo ${i + 1}`} fill unoptimized className="object-cover" sizes="(min-width: 1024px) 25vw, 50vw" />
          {onRemove ? (
            <IconButton icon="trash-2" label={`Remove photo ${i + 1}`} className="absolute top-2 right-2 bg-surface" onClick={() => onRemove(i)} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
