import { completeCompanyProfile,companyReturn } from '../account-utils';
export async function companyProfileReady(client,userId) {
  const result=await client.from('account_profiles').select('display_name,whatsapp').eq('user_id',userId).maybeSingle();
  if(result.error)throw result.error;
  return completeCompanyProfile(result.data);
}
export function companyProfileSetupUrl(companyId,currentPath='/cloud') {
  return `/settings?setup=company&next=${encodeURIComponent(companyReturn(currentPath,companyId))}`;
}
