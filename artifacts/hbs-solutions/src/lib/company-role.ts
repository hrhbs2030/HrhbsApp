import { getGetPortalMeQueryKey, useGetPortalMe, type PortalUserCompanyRole } from '@workspace/api-client-react';

// What a company member may do in the customer portal. The API enforces the
// same matrix (viewer: read only; finance: billing only; hr and owner:
// everything); hiding the controls here spares the person a request that
// would only answer 403. A plain customer (no company role) is the owner of
// their own data.
export type CompanyAbility = { canCreate: boolean; canPay: boolean; readOnly: boolean };
export function abilitiesOf(role: PortalUserCompanyRole | undefined): CompanyAbility {
  if (role === 'viewer') return { canCreate: false, canPay: false, readOnly: true };
  if (role === 'finance') return { canCreate: false, canPay: true, readOnly: false };
  return { canCreate: true, canPay: true, readOnly: false };
}
export const readOnlyNotice = 'صلاحيتك للعرض فقط؛ اطلب من مالك المنشأة ترقيتها.';
export const financeNotice = 'صلاحيتك مالية: يمكنك سداد الفواتير ومتابعة الاشتراك، ولا يمكنك إرسال طلبات أو رسائل.';

// Shares the cached /portal/me the route guard already loaded.
export function useCompanyRole(): CompanyAbility & { role: PortalUserCompanyRole | undefined; actingFor: { companyUserId: string; companyName: string | null } | null } {
  const me = useGetPortalMe({ query: { queryKey: getGetPortalMeQueryKey(), staleTime: 60_000 } });
  const role = me.data?.companyRole ?? undefined;
  return { ...abilitiesOf(role), role, actingFor: me.data?.actingFor ?? null };
}
