export function validateApiKey(request: Request): boolean {
  const apiKey = request.headers.get('x-api-key');
  if (!apiKey) return false;
  return apiKey === process.env.API_SECRET_KEY;
}
