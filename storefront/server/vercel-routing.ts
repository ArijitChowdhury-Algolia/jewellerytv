/** Vercel adds its catch-all capture to the query; it is routing metadata, not an API argument. */
export function normalizeVercelRequestURL(input:string):string {
  const url=new URL(input,'https://local.invalid');
  url.searchParams.delete('path');
  url.searchParams.delete('...path');
  return url.pathname+(url.searchParams.size?'?'+url.searchParams.toString():'');
}
