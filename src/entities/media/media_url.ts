import { ALLOWED, refuse, type Decision } from "../decision";

export type MediaUrlRefusal = "not_https" | "bad_url" | "literal_ip" | "host_not_allowed";

const SCHEME = /^https:\/\//i;
const PORT = /:\d*$/;
const IPV4ISH = /^[\d.]+$|^0x/i;

/** The URL's host as `checkMediaUrl` reads it: lower case, without the port. */
export function urlHost(url: string): string {
  const rest = url.replace(SCHEME, "");
  const end = rest.search(/[/?#]/);
  return (end === -1 ? rest : rest.slice(0, end)).toLowerCase().replace(PORT, "");
}

/**
 * The SSRF policy for `stage_media_from_url` (plan §3.5, U18): https only, no credentials, no
 * literal IP host, and the host must be on the allowlist. Workers cannot resolve DNS, so the
 * allowlist is the guard; the driver re-checks every redirect hop with this same function.
 */
export function checkMediaUrl(
  url: string,
  allowedHosts: readonly string[],
): Decision<MediaUrlRefusal> {
  if (!SCHEME.test(url)) {
    return refuse("not_https");
  }
  const host = urlHost(url);
  if (host.startsWith("[") || IPV4ISH.test(host)) {
    return refuse("literal_ip");
  }
  if (host.length === 0 || host.includes("@") || host.includes(":")) {
    return refuse("bad_url");
  }
  const allowed = allowedHosts.map((allowedHost) => allowedHost.toLowerCase());
  return allowed.includes(host) ? ALLOWED : refuse("host_not_allowed");
}
