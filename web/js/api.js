/** JSON API client. Mutations carry the custom header the server requires. */
export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (method !== 'GET') headers['x-explainer'] = '1';
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new Error(data?.error ?? `${res.status} ${res.statusText}`);
  return data;
}
