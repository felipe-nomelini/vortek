import { getMlListingResponse } from '@/services/ml-listings-query';

export async function GET(request: Request) {
  return getMlListingResponse(request);
}
