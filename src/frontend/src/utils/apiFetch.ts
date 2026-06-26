export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, { redirect: 'manual', ...init });
  if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) {
    location.reload();
    throw new Error(`auth redirect – reloading`);
  }
  return res;
}
