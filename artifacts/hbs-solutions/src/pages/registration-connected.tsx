import { useState } from 'react';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetPortalMeQueryKey,
  getGetPortalRegistrationQueryKey,
  getListOfficeRegistrationsQueryKey,
  useGetPortalRegistration,
  useListOfficeRegistrations,
  useReviewOfficeRegistration,
  useSubmitPortalRegistration,
} from '@workspace/api-client-react';
import { PortalLayout, ErrorBlock } from '@/components/portal-ui';
import {
  OfficeRegistrationsPage,
  RegistrationRequestPage,
  type Registration,
  type RegistrationFormValues,
  type RegistrationStatus,
} from './registration';

export function CustomerRegistration() {
  const { user } = useUser();
  const email = user?.emailAddresses.find(entry => entry.verification?.status === 'verified')?.emailAddress ?? '';
  const queryClient = useQueryClient();
  const registration = useGetPortalRegistration({
    query: { queryKey: getGetPortalRegistrationQueryKey(), refetchInterval: 20_000 },
  });
  const submitRegistration = useSubmitPortalRegistration();
  const [values, setValues] = useState<RegistrationFormValues>({ fullName: '', contactPhone: '', note: '' });
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function submit(form: RegistrationFormValues) {
    setSubmitError(null);
    try {
      await submitRegistration.mutateAsync({
        data: {
          fullName: form.fullName.trim(),
          contactPhone: form.contactPhone.trim(),
          ...(form.note.trim() ? { note: form.note.trim() } : {}),
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetPortalRegistrationQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetPortalMeQueryKey() }),
      ]);
    } catch {
      setSubmitError('تعذّر إرسال طلب التسجيل. تحقق من البيانات وحاول مرة أخرى.');
    }
  }

  if (registration.isError) {
    return <PortalLayout registrationOnly><ErrorBlock retry={() => registration.refetch()} /></PortalLayout>;
  }

  const request = registration.data
    ? { ...registration.data, email } satisfies Registration
    : null;

  return <PortalLayout registrationOnly>
    <RegistrationRequestPage
      email={email}
      values={values}
      onChange={(field, value) => setValues(current => ({ ...current, [field]: value }))}
      onSubmit={submit}
      registration={request}
      loading={registration.isLoading}
      submitting={submitRegistration.isPending}
      error={submitError || (!email && !registration.isLoading ? 'يجب تأكيد بريدك الإلكتروني قبل إرسال طلب التسجيل.' : null)}
      onRetry={() => { setSubmitError(null); void registration.refetch(); }}
    />
  </PortalLayout>;
}

export function OfficeRegistrations() {
  const queryClient = useQueryClient();
  const registrations = useListOfficeRegistrations({
    query: { queryKey: getListOfficeRegistrationsQueryKey(), refetchInterval: 20_000 },
  });
  const review = useReviewOfficeRegistration();
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RegistrationStatus | 'all'>('pending');

  async function decide(id: number, status: 'approved' | 'rejected', reason?: string) {
    setActionError(null);
    setProcessingId(id);
    try {
      await review.mutateAsync({ id, data: { status, ...(reason ? { reason } : {}) } });
      await queryClient.invalidateQueries({ queryKey: getListOfficeRegistrationsQueryKey() });
    } catch {
      setActionError('تعذّر حفظ قرار المراجعة. تحقق من حالة الطلب وحاول مرة أخرى.');
    } finally {
      setProcessingId(null);
    }
  }

  return <PortalLayout staff>
    <OfficeRegistrationsPage
      registrations={(registrations.data ?? []).map(record => ({
        ...record,
        email: record.email ?? 'بريد غير متحقق حاليًا',
      }))}
      loading={registrations.isLoading}
      error={registrations.isError ? 'تعذّر تحميل طلبات التسجيل.' : null}
      onRetry={() => registrations.refetch()}
      processingId={processingId}
      actionError={actionError}
      filter={filter}
      onFilterChange={setFilter}
      onApprove={id => decide(id, 'approved')}
      onReject={(id, reason) => decide(id, 'rejected', reason)}
    />
  </PortalLayout>;
}