import { describe, it } from "node:test";
import assert from "node:assert";
import { crc32, dosDateTime, createZipBuffer } from "../scripts/zip.js";

describe("crc32", () => {
  it("returns 0 for an empty buffer", () => {
    assert.strictEqual(crc32(Buffer.alloc(0)), 0);
  });

  it("matches the standard CRC-32 check value for the ASCII digits '123456789'", () => {
    // The canonical CRC-32/ISO-HDLC (poly 0xEDB88320) check value.
    assert.strictEqual(crc32(Buffer.from("123456789", "ascii")), 0xcbf43926);
  });
});

describe("dosDateTime", () => {
  it("encodes a normal date/time into DOS bit-packed date and time", () => {
    // Local-time constructor args, not an ISO string — dosDateTime() reads
    // local getHours()/getMonth()/etc., so this stays deterministic
    // regardless of the machine's timezone.
    const date = new Date(2024, 0, 15, 13, 45, 30);
    assert.deepStrictEqual(dosDateTime(date), { dosTime: 28079, dosDate: 22575 });
  });

  it("encodes the DOS epoch (1980-01-01 00:00:00) as all-zero time and minimal date", () => {
    const date = new Date(1980, 0, 1, 0, 0, 0);
    assert.deepStrictEqual(dosDateTime(date), { dosTime: 0, dosDate: 33 });
  });

  it("encodes a late date/time near the top of the DOS field ranges", () => {
    const date = new Date(2107, 11, 31, 23, 59, 58);
    assert.deepStrictEqual(dosDateTime(date), { dosTime: 49021, dosDate: 65439 });
  });
});

describe("createZipBuffer", () => {
  it("produces a zip whose embedded CRC32 matches the standalone crc32() of the same data", () => {
    const data = Buffer.from("123456789", "ascii");
    const zip = createZipBuffer([{ name: "digits.txt", data }]);
    const expectedCrc = crc32(data);

    // Local file header's CRC-32 field is 4 bytes starting at offset 14.
    assert.strictEqual(zip.readUInt32LE(14), expectedCrc);
  });

  it("starts and ends with the expected zip signatures", () => {
    const zip = createZipBuffer([{ name: "a.txt", data: Buffer.from("hello") }]);
    assert.strictEqual(zip.readUInt32LE(0), 0x04034b50); // local file header signature
    assert.strictEqual(zip.readUInt32LE(zip.length - 22), 0x06054b50); // end-of-central-directory signature
  });
});
