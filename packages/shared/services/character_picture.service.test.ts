import { mock } from "bun:test";

// Mocks must be declared before the import they affect.
const mockToBuffer = mock(async () => Buffer.from("processed-webp"));
const mockWebp = mock(() => ({ toBuffer: mockToBuffer }));
const mockResize = mock(() => ({ webp: mockWebp }));
const mockSharp = mock(() => ({ resize: mockResize }));
mock.module("sharp", () => ({ default: mockSharp }));

const mockUpload = mock(async () => ({ data: {}, error: null }));
const mockGetPublicUrl = mock((path: string) => ({
  data: { publicUrl: `https://storage.test/${path}` },
}));
const mockStorageFrom = mock(() => ({ upload: mockUpload, getPublicUrl: mockGetPublicUrl }));
mock.module("@supabase/supabase-js", () => ({
  createClient: mock(() => ({ storage: { from: mockStorageFrom } })),
}));

import { describe, test, expect, beforeEach } from "bun:test";
import { processAndStorePictures } from "./character_picture.service";

const mockUpsert = mock(async (_args: unknown) => ({
  id: "pic-id",
  size: 512,
  url: "https://storage.test/uid/cid/512.webp",
  storagePath: "uid/cid/512.webp",
}));

const prismaLike = {
  characterPicture: { upsert: mockUpsert },
};

const config = {
  supabaseUrl: "https://test.supabase.co",
  supabaseServiceRoleKey: "test-service-key",
};

const imageResponse = {
  ok: true,
  headers: { get: (h: string) => (h === "content-type" ? "image/jpeg" : null) },
  arrayBuffer: async () => new ArrayBuffer(8),
};

beforeEach(() => {
  mockUpsert.mockClear();
  mockUpload.mockClear();
  mockToBuffer.mockClear();
  mockSharp.mockClear();
});

describe("processAndStorePictures", () => {
  test("throws if fetch returns non-ok status", async () => {
    global.fetch = mock(async () => ({
      ok: false,
      status: 404,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    })) as unknown as typeof fetch;

    await expect(
      processAndStorePictures(prismaLike, "https://example.com/img.jpg", "uid", "cid", config)
    ).rejects.toThrow("Image fetch failed: HTTP 404");
  });

  test("throws if content-type is not an image", async () => {
    global.fetch = mock(async () => ({
      ok: true,
      headers: { get: () => "text/html" },
      arrayBuffer: async () => new ArrayBuffer(8),
    })) as unknown as typeof fetch;

    await expect(
      processAndStorePictures(prismaLike, "https://example.com/page", "uid", "cid", config)
    ).rejects.toThrow("Not an image: text/html");
  });

  test("processes 3 sizes and returns picture array", async () => {
    global.fetch = mock(async () => imageResponse) as unknown as typeof fetch;

    const result = await processAndStorePictures(
      prismaLike,
      "https://example.com/img.jpg",
      "uid",
      "cid",
      config
    );

    expect(result).toHaveLength(3);
    expect(result.map((p) => p.size)).toEqual([48, 128, 512]);
    expect(mockSharp).toHaveBeenCalledTimes(3);
    expect(mockUpload).toHaveBeenCalledTimes(3);
    expect(mockUpsert).toHaveBeenCalledTimes(3);
  });

  test("storage path follows {userId}/{characterId}/{size}.webp pattern", async () => {
    global.fetch = mock(async () => imageResponse) as unknown as typeof fetch;

    await processAndStorePictures(prismaLike, "https://example.com/img.jpg", "user-1", "char-1", config);

    const uploadPaths = mockUpload.mock.calls.map((call) => (call as unknown[])[0]);
    expect(uploadPaths).toEqual(["user-1/char-1/48.webp", "user-1/char-1/128.webp", "user-1/char-1/512.webp"]);
  });

  test("throws if storage upload fails", async () => {
    global.fetch = mock(async () => imageResponse) as unknown as typeof fetch;
    mockUpload.mockResolvedValueOnce({ data: null, error: { message: "quota exceeded" } });

    await expect(
      processAndStorePictures(prismaLike, "https://example.com/img.jpg", "uid", "cid", config)
    ).rejects.toThrow("Storage upload failed for size 48: quota exceeded");
  });

  test("center-crops to square (cover fit) for each size", async () => {
    global.fetch = mock(async () => imageResponse) as unknown as typeof fetch;

    await processAndStorePictures(prismaLike, "https://example.com/img.jpg", "uid", "cid", config);

    const resizeCalls = mockResize.mock.calls as unknown[][];
    expect(resizeCalls[0]).toEqual([48, 48, { fit: "cover" }]);
    expect(resizeCalls[1]).toEqual([128, 128, { fit: "cover" }]);
    expect(resizeCalls[2]).toEqual([512, 512, { fit: "cover" }]);
  });
});
