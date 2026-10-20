'use client';

import { useController, useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { Alert, Button, Dialog, RadioGroup, useToast } from '@/components/ui';
import { FormTextarea, applyServerErrors } from '@/components/forms';
import { apiSend } from '@/lib/api';
import { FeedbackInput } from '@/schemas/feedback';
import { offerKeys } from './offer-utils';

type FormIn = z.input<typeof FeedbackInput>;
type FormOut = z.output<typeof FeedbackInput>;

const RATING_OPTIONS = [
  { value: '5', label: '5 of 5', description: 'Excellent' },
  { value: '4', label: '4 of 5', description: 'Good' },
  { value: '3', label: '3 of 5', description: 'Okay' },
  { value: '2', label: '2 of 5', description: 'Poor' },
  { value: '1', label: '1 of 5', description: 'Very poor' },
];

export interface RateCourseDialogProps {
  open: boolean;
  onClose: () => void;
  enrollmentId: string;
  courseTitle: string;
}

/** POST /api/feedback: one rating (1–5) and an optional comment per accepted enrollment. */
export function RateCourseDialog({ open, onClose, enrollmentId, courseTitle }: RateCourseDialogProps) {
  const toast = useToast();
  const qc = useQueryClient();
  const { control, handleSubmit, setError, formState, reset } = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(FeedbackInput) as Resolver<FormIn, unknown, FormOut>,
    defaultValues: { enrollmentId, rating: undefined as unknown as number, comment: '' },
  });
  const rating = useController({ control, name: 'rating' });

  const close = () => {
    reset();
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      await apiSend('POST', '/api/feedback', values);
      await qc.invalidateQueries({ queryKey: offerKeys.feedback });
      toast.success('Rating sent');
      close();
    } catch (err) {
      applyServerErrors(setError, err);
    }
  });
  const rootError = (formState.errors.root as { server?: { message?: string } } | undefined)?.server?.message;
  const ratingError = rating.fieldState.error ? 'Choose a rating from 1 to 5.' : undefined;

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Rate Course"
      description={`How was ${courseTitle}? The course provider sees your rating and comment without your name.`}
      dismissible={!formState.isSubmitting}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={formState.isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" icon="star" onClick={() => void onSubmit()} loading={formState.isSubmitting}>
            Send Rating
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
        noValidate
        className="flex flex-col gap-4"
      >
        {rootError ? <Alert tone="danger">{rootError}</Alert> : null}
        <div className="flex flex-col gap-1.5">
          <RadioGroup
            name={`rating-${enrollmentId}`}
            legend="Your rating"
            options={RATING_OPTIONS}
            value={rating.field.value ? String(rating.field.value) : undefined}
            onValueChange={(v) => rating.field.onChange(Number(v))}
            invalid={Boolean(ratingError)}
            describedBy={ratingError ? `rating-${enrollmentId}-error` : undefined}
          />
          {ratingError ? (
            <p id={`rating-${enrollmentId}-error`} className="m-0 text-body-sm text-danger-ink">
              {ratingError}
            </p>
          ) : null}
        </div>
        <FormTextarea control={control} name="comment" label="Comment" optional rows={4} maxLength={2000} placeholder="What worked well, and what could be better" />
      </form>
    </Dialog>
  );
}
