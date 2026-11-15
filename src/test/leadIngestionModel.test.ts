import { describe, it, expect } from "vitest";
import {
  cleanPhone, decryptJson, encryptJson, extractApiKey, hmacSha256Hex, mapFields, maskPhone, newLeadEmail,
  normalizeGenericLead, normalizeGoogleLead, normalizeMetaLead, normalizeZohoLead, randomToken, safeEqual,
  validateLead, verifyMetaSignature,
} from "../../supabase/functions/_shared/leadIngestionModel";

describe("cleaning", () => {
  it("strips Meta's test prefix and punctuation but keeps a leading +", () => {
    expect(cleanPhone("p:+91 98765-43210")).toBe("+919876543210");
    expect(cleanPhone("(098) 765 43210")).toBe("09876543210");
    expect(cleanPhone("n/a")).toBeUndefined();
  });
  it("masks phones for logs", () => expect(maskPhone("9876543210")).toBe("•••••••210"));
});

describe("Meta lead normalisation", () => {
  const graphLead = {
    id: "444", created_time: "2026-11-01T10:00:00+0000", ad_id: "a1", form_id: "f9", campaign_id: "c7", platform: "ig",
    field_data: [
      { name: "full_name", values: ["Priya Sharma"] },
      { name: "email", values: ["Priya@Example.com"] },
      { name: "phone_number", values: ["p:+919876543210"] },
      { name: "child's_name", values: ["Aarav"] },
      { name: "which_class_is_your_child_applying_for?", values: ["Grade 5"] },
      { name: "city", values: ["Hyderabad"] },
      { name: "how_did_you_hear_about_us?", values: ["Instagram reel"] },
    ],
  };
  it("maps standard + custom questions", () => {
    const { lead, externalId } = normalizeMetaLead(graphLead);
    expect(externalId).toBe("444");
    expect(lead).toMatchObject({ parent_name: "Priya Sharma", email: "priya@example.com", phone: "+919876543210", student_name: "Aarav", grade: "Grade 5", address: "Hyderabad" });
    expect(lead.campaign).toMatchObject({ ad_id: "a1", form_id: "f9", campaign_id: "c7", platform: "ig" });
  });
  it("keeps unrecognised answers in the message so nothing the parent wrote is lost", () => {
    expect(normalizeMetaLead(graphLead).lead.message).toContain("Instagram reel");
  });
  it("honours an admin field mapping over heuristics", () => {
    const { lead } = normalizeMetaLead(graphLead, { grade: "how_did_you_hear_about_us?" });
    expect(lead.grade).toBe("Instagram reel");
  });
  it("copes with missing field_data", () => expect(normalizeMetaLead({ id: "1" }).lead).toEqual({ campaign: {} }));
});

describe("Google lead form", () => {
  const body = {
    lead_id: "G-1", form_id: "55", campaign_id: "9", gcl_id: "gclx", is_test: false, google_key: "k",
    user_column_data: [
      { column_id: "FULL_NAME", string_value: "Ravi Kumar" }, { column_id: "EMAIL", string_value: "ravi@x.com" },
      { column_id: "PHONE_NUMBER", string_value: "+91 90000 11111" },
      { column_id: "QUESTION_1", column_name: "Student Name", string_value: "Diya" },
      { column_id: "QUESTION_2", column_name: "Class applying for", string_value: "LKG" },
    ],
  };
  it("maps system + custom columns", () => {
    const r = normalizeGoogleLead(body);
    expect(r.externalId).toBe("G-1");
    expect(r.lead).toMatchObject({ parent_name: "Ravi Kumar", email: "ravi@x.com", phone: "+919000011111", student_name: "Diya", grade: "LKG" });
    expect(r.lead.campaign).toMatchObject({ campaign_id: "9", gcl_id: "gclx" });
    expect(r.isTest).toBe(false);
  });
  it("flags Google's test leads and never leaks the key into the message", () => {
    const r = normalizeGoogleLead({ ...body, is_test: true });
    expect(r.isTest).toBe(true);
    expect(r.lead.message ?? "").not.toContain("google_key");
  });
});

describe("Zoho", () => {
  it("uses First/Last name as the parent and Mobile as phone fallback", () => {
    const { lead, externalId } = normalizeZohoLead({ id: "z1", First_Name: "Anita", Last_Name: "Rao", Email: "a@x.com", Mobile: "9111122222",
      Student_Name: "Kabir", Grade: "Grade 2", Description: "Call after 5pm", Lead_Source: "Advertisement", Owner: { name: "Staff", id: "1" } });
    expect(externalId).toBe("z1");
    expect(lead).toMatchObject({ parent_name: "Anita Rao", email: "a@x.com", phone: "9111122222", student_name: "Kabir", grade: "Grade 2" });
    expect(lead.message).toContain("Call after 5pm");
    expect(lead.campaign).toEqual({ zoho_lead_source: "Advertisement" });
  });
});

describe("website / Zapier / Make", () => {
  it("normalises flat form posts and keeps utm tags", () => {
    const { lead, externalId } = normalizeGenericLead({ name: "Meena", child_name: "Tara", phone: "9222233333", class: "Nursery", utm_source: "newsletter", id: "sub-1" });
    expect(lead).toMatchObject({ parent_name: "Meena", student_name: "Tara", phone: "9222233333", grade: "Nursery" });
    expect(lead.campaign).toEqual({ utm_source: "newsletter" });
    expect(externalId).toBe("sub-1");
  });
  it("trims, collapses whitespace, strips control chars and caps length", () => {
    const { lead } = normalizeGenericLead({ name: "  A\u0000  B  ", phone: "9222233333", message: "x".repeat(5000) });
    expect(lead.parent_name).toBe("A B");
    expect(lead.message!.length).toBe(2000);
  });
  it("is not fooled by prototype pollution keys", () => {
    const evil = JSON.parse('{"__proto__":{"phone":"1"},"name":"X","phone":"9222233333"}');
    expect(() => normalizeGenericLead(evil)).not.toThrow();
    expect(({} as any).phone).toBeUndefined();
  });
});

describe("mapFields", () => {
  it("joins first_name + last_name into the parent name", () => {
    expect(mapFields({ first_name: "A", last_name: "B", phone: "9222233333" }).parent_name).toBe("A B");
  });
});

describe("validateLead", () => {
  it("needs a phone or an email", () => {
    expect(validateLead({ student_name: "x" }).ok).toBe(false);
    expect(validateLead({ phone: "9222233333" }).ok).toBe(true);
    expect(validateLead({ email: "a@b.co" }).ok).toBe(true);
  });
});

describe("authenticity", () => {
  it("verifies Meta's X-Hub-Signature-256 over the raw body", async () => {
    const body = '{"object":"page"}';
    const sig = "sha256=" + (await hmacSha256Hex("appsecret", body));
    expect(await verifyMetaSignature(body, sig, "appsecret")).toBe(true);
    expect(await verifyMetaSignature(body + " ", sig, "appsecret")).toBe(false);
    expect(await verifyMetaSignature(body, sig, "other")).toBe(false);
    expect(await verifyMetaSignature(body, null, "appsecret")).toBe(false);
    expect(await verifyMetaSignature(body, "sha256=zz", "appsecret")).toBe(false);
    expect(await verifyMetaSignature(body, sig, "")).toBe(false);
  });
  it("matches HMAC-SHA256 test vector (RFC 4231 #2)", async () => {
    expect(await hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });
  it("safeEqual is exact", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
  it("reads an API key from bearer, x-api-key or ?key=", () => {
    const u = new URL("https://x/y?key=q");
    expect(extractApiKey(new Headers({ authorization: "Bearer tok" }), u)).toBe("tok");
    expect(extractApiKey(new Headers({ "x-api-key": "hdr" }), u)).toBe("hdr");
    expect(extractApiKey(new Headers(), u)).toBe("q");
    expect(extractApiKey(new Headers(), new URL("https://x"))).toBeNull();
  });
  it("generates unguessable tokens", () => {
    expect(randomToken()).toMatch(/^[0-9a-f]{48}$/);
    expect(randomToken()).not.toBe(randomToken());
  });
});

describe("credential encryption", () => {
  const key = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));
  it("round-trips and never stores plaintext", async () => {
    const blob = await encryptJson({ app_secret: "s3cr3t-value" }, key, "secrets:1");
    expect(blob.startsWith("v1.")).toBe(true);
    expect(blob).not.toContain("s3cr3t");
    expect(await decryptJson(blob, key, "secrets:1")).toEqual({ app_secret: "s3cr3t-value" });
  });
  it("uses a fresh IV each time", async () => {
    expect(await encryptJson({ a: 1 }, key, "x")).not.toBe(await encryptJson({ a: 1 }, key, "x"));
  });
  it("is bound to its row: ciphertext copied to another integration will not decrypt", async () => {
    const blob = await encryptJson({ a: 1 }, key, "secrets:1");
    await expect(decryptJson(blob, key, "secrets:2")).rejects.toBeTruthy();
  });
  it("detects tampering and wrong keys", async () => {
    const blob = await encryptJson({ a: 1 }, key, "x");
    const parts = blob.split(".");
    const tampered = [parts[0], parts[1], parts[2].slice(0, -4) + (parts[2].endsWith("AAAA") ? "BBBB" : "AAAA")].join(".");
    await expect(decryptJson(tampered, key, "x")).rejects.toBeTruthy();
    await expect(decryptJson(blob, btoa("x".repeat(32)), "x")).rejects.toBeTruthy();
  });
  it("rejects a key that is not 32 bytes", async () => {
    await expect(encryptJson({}, btoa("short"), "x")).rejects.toThrow(/32 random bytes/);
  });
});

describe("alert email", () => {
  it("has a useful subject and no phone number", () => {
    const m = newLeadEmail({ provider: "meta", integration: "Meta – Spring", student: "Aarav", grade: "Grade 5", parent: "Priya" });
    expect(m.subject).toBe("New admission enquiry – Aarav");
    expect(m.body).not.toMatch(/\d{10}/);
    expect(newLeadEmail({ provider: "x", integration: "y", repeat: true }).subject).toMatch(/^Repeat enquiry/);
  });
});
