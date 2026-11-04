/** upload_media's view (GROKCHAT-20): what a bot is told for each answer and refusal. */
import { describe, expect, it } from "vitest";
import { stagedMediaId } from "../../../../src/entities/identity/ids";
import * as views from "../../../../src/interface_adapters/mcp/tool_views";

describe("upload_media view", () => {
  it("upload_media: a staged file, an upload still missing parts (GROKCHAT-20)", () => {
    expect(
      views.uploadMediaView({
        ok: true,
        complete: true,
        mediaId: stagedMediaId("m-1"),
        kind: "PHOTO",
        size: 9,
        uploadId: null,
      }),
    ).toStrictEqual({
      ok: true,
      body: { complete: true, media_id: "m-1", kind: "PHOTO", size_bytes: 9, upload_id: null },
    });
    expect(
      views.uploadMediaView({ ok: true, complete: false, uploadId: "u-1", missing: [1, 2] }),
    ).toStrictEqual({
      ok: true,
      body: { complete: false, upload_id: "u-1", missing_parts: [1, 2] },
    });
  });

  it("upload_media refusals: hash mismatches name the part and both hashes; others say what to do", () => {
    expect(
      views.uploadMediaView({
        ok: false,
        code: "part_hash_mismatch",
        part: 2,
        expected: "aa",
        actual: "bb",
      }),
    ).toStrictEqual({
      ok: false,
      code: "part_hash_mismatch",
      part: 2,
      message:
        "Part 2 decodes to bytes whose SHA-256 is bb, not the part_sha256 you sent (aa). Resend only part 2, with the same upload_id.",
    });
    expect(
      views.uploadMediaView({
        ok: false,
        code: "file_hash_mismatch",
        part: null,
        expected: "aa",
        actual: "bb",
      }),
    ).toStrictEqual({
      ok: false,
      code: "file_hash_mismatch",
      part: null,
      message:
        "Every part arrived, but the file they make has SHA-256 bb, not the sha256 you sent (aa). The upload was discarded: check the parts' order and the file's hash, then start again without upload_id.",
    });
    const messages = {
      bad_base64:
        "data_base64 is not standard base64 (A-Z, a-z, 0-9, +, /, = padding at the end; line breaks are ignored). Resend this part.",
      part_too_large:
        "A part may hold at most 262144 bytes once decoded: split the file into more parts.",
      part_out_of_range: "part_index runs from 0 to part_count - 1, and part_count from 1 to 60.",
      upload_not_found: "No such upload for this account: start again without upload_id.",
      upload_expired:
        "The upload expired (an hour after its first part) and its parts were deleted: start again without upload_id.",
      upload_mismatch:
        "This upload_id was opened with another sha256 or part_count: send the same values on every part.",
    } as const;
    for (const [code, message] of Object.entries(messages)) {
      expect(
        views.uploadMediaView({ ok: false, code: code as keyof typeof messages }),
      ).toStrictEqual({ ok: false, code, part: null, message });
    }
    expect(views.uploadMediaView({ ok: false, code: "scope" })).toStrictEqual({
      ok: false,
      code: "scope",
      part: null,
    });
  });
});
