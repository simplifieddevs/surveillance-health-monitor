import { createHash, randomBytes } from "node:crypto";

/**
 * WS-Security UsernameToken with PasswordDigest.
 * Digest = Base64(SHA1(nonce_bytes + created_utf8 + password_utf8))
 */
export function buildWsSecurity(username: string, password: string): string {
  const nonce = randomBytes(16);
  const created = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const digest = createHash("sha1")
    .update(nonce)
    .update(Buffer.from(created, "utf8"))
    .update(Buffer.from(password, "utf8"))
    .digest("base64");

  return `<Security xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
    <UsernameToken>
      <Username>${escapeXml(username)}</Username>
      <Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password>
      <Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString("base64")}</Nonce>
      <Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created>
    </UsernameToken>
  </Security>`;
}

/** Wrap a SOAP body fragment in a SOAP 1.2 envelope. */
export function soapEnvelope(bodyContent: string, security?: string): string {
  const header = security ? `<s:Header>${security}</s:Header>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope
  xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:tds="http://www.onvif.org/ver10/device/wsdl"
  xmlns:trt="http://www.onvif.org/ver10/media/wsdl"
  xmlns:trv="http://www.onvif.org/ver10/receiver/wsdl"
  xmlns:tt="http://www.onvif.org/ver10/schema">
  ${header}
  <s:Body>${bodyContent}</s:Body>
</s:Envelope>`;
}

/**
 * Extract the text content of the first matching tag, ignoring namespace prefix.
 * Works for simple scalar values (strings, numbers). Not suitable for
 * arbitrarily nested XML — use extractAllElements for repeated/complex nodes.
 */
export function extractTag(xml: string, localName: string): string | undefined {
  const re = new RegExp(
    `<[\\w-]*:?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)</[\\w-]*:?${localName}>`,
    "i",
  );
  return xml.match(re)?.[1]?.trim();
}

/**
 * Extract all element blocks that match localName, returning each as
 * { attrs, content } so callers can access both attributes and children.
 */
export function extractAllElements(
  xml: string,
  localName: string,
): Array<{ attrs: string; content: string }> {
  const re = new RegExp(
    `<[\\w-]*:?${localName}((?:\\s[^>]*)?)>([\\s\\S]*?)</[\\w-]*:?${localName}>`,
    "gi",
  );
  const results: Array<{ attrs: string; content: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    results.push({ attrs: match[1] ?? "", content: (match[2] ?? "").trim() });
  }
  return results;
}

/** Minimal XML character escaping for values we inject into SOAP envelopes. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
