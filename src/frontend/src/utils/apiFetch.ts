export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401 || res.status === 403) {
    location.reload();
    throw new Error(`${res.status} – reloading`);
  }
  return res;
}
