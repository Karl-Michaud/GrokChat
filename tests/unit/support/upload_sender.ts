/** Sends `upload_media` parts straight to its interactor, over the unit world (GROKCHAT-20). */
import type { PartUpload } from "../../../src/use_cases/media/part_upload";
import type { UploadMediaInputData } from "../../../src/use_cases/upload_media/input_data";
import { UploadMediaInteractor } from "../../../src/use_cases/upload_media/interactor";
import type { UploadMediaOutputData } from "../../../src/use_cases/upload_media/output_data";
import { ACCOUNT, botActor, T0 } from "./builders";
import { Capture, makeWorld, type World } from "./world";

export const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  13, 14,
]);
export const PARTS = [JPEG.slice(0, 8), JPEG.slice(8, 16), JPEG.slice(16)];
export const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

export interface Sent {
  readonly world: World;
  readonly bytes: Uint8Array;
  readonly input?: Partial<UploadMediaInputData>;
  readonly parts?: PartUpload;
}

export async function send({ world, bytes, input = {}, parts = world.parts }: Sent) {
  const presenter = new Capture<UploadMediaOutputData>();
  const ports = { accounts: world.accounts, guard: world.guard, hasher: world.hasher, parts };
  await new UploadMediaInteractor(ports, presenter).execute({
    actor: botActor(),
    accountId: ACCOUNT,
    label: "",
    fileSha256: await world.hasher.sha256Hex(JPEG),
    data: b64(bytes),
    partSha256: await world.hasher.sha256Hex(bytes),
    uploadId: null,
    partIndex: 0,
    partCount: 1,
    ...input,
  });
  return presenter.last;
}

/** Part `index` of the three-part JPEG upload. */
export const part = (world: World, index: number, uploadId: string | null, extra = {}) =>
  send({
    world,
    bytes: PARTS[index] ?? new Uint8Array(),
    input: { uploadId, partIndex: index, partCount: 3, ...extra },
  });

export async function world0(): Promise<World> {
  const world = makeWorld();
  await world.seedAccount();
  return world;
}

export const usageAt = (world: World) => world.usage.current(T0);
