import { unzipSync, zipSync } from "fflate";
import type { BundleArchiveReader, BundleArchiveWriter } from "@owogg/core";

/**
 * The zip half of the publish pipeline. Lives here, with the other infrastructure adapters, so
 * `@owogg/core` keeps zero runtime library dependencies — the publisher only sees the
 * `BundleArchiveReader` port.
 *
 * fflate is used rather than `DecompressionStream`: the Workers runtime's built-in decompression
 * handles gzip/deflate streams, not the zip *container* format (central directory, per-entry
 * headers), which is what an uploaded game bundle is.
 *
 * Whole-archive and synchronous, which is fine because `read()` only ever runs at publish time,
 * and only after `readMetadata()` has already bounded what it's about to decompress — never on a
 * player's request path.
 *
 * On "what if the declared uncompressed size lies" (2026-08-18, pre-production review): checked
 * against fflate's actual inflate implementation, not assumed. `unzipSync`'s real (non-metadata)
 * pass allocates each entry's output buffer as `new Uint8Array(declaredSize)` — the exact value
 * `readMetadata` already read and `validateBundleEntryMetadata` already summed and capped. If the
 * compressed bytes decode to more than that, the excess writes land at indexes past the
 * TypedArray's length, which JavaScript silently drops — they are not written anywhere, and the
 * buffer is never grown to fit them (fflate only grows a buffer it allocated itself for
 * *unknown*-length output; here it did not — it was given a fixed size up front). So the maximum
 * amount of memory `read()` can ever retain is provably the same sum `readMetadata` already
 * checked; a lying declared size cannot smuggle extra bytes into memory. What a lying declared
 * size (or an entry with a deliberately absurd compression ratio) *can* still do is waste CPU
 * cycles running the decode loop against a large compressed stream for no retained result — bounded
 * defense in depth against that: `validateBundleEntryMetadata`'s compression-ratio check, and the
 * hard ceiling that is `MAX_BUNDLE_BYTES` on the compressed upload itself (DEFLATE's realistic
 * maximum single-stream expansion ratio is documented at roughly ~1032:1, so a 20MiB compressed
 * upload bounds worst-case decode work regardless of anything an entry's header claims).
 */
export class FflateBundleArchiveReader implements BundleArchiveReader, BundleArchiveWriter {
  readMetadata(
    archive: ArrayBuffer,
  ): Array<{ path: string; declaredSize: number; compressedSize: number }> {
    const entries: Array<{ path: string; declaredSize: number; compressedSize: number }> = [];
    // fflate's `filter` runs once per central-directory entry, before that entry's compressed
    // bytes are ever touched — returning `false` for every entry means unzipSync parses only the
    // central directory (proportional to entry *count*, not to any entry's size) and never calls
    // into its inflate path at all. That is what makes this safe to run before any size decision:
    // the cost here can't scale with how big the archive claims (or turns out) to decompress to.
    unzipSync(new Uint8Array(archive), {
      filter: (file) => {
        entries.push({
          path: file.name,
          declaredSize: file.originalSize,
          compressedSize: file.size,
        });
        return false;
      },
    });
    return entries;
  }

  read(archive: ArrayBuffer): Record<string, Uint8Array> {
    return unzipSync(new Uint8Array(archive));
  }

  write(entries: Readonly<Record<string, Uint8Array>>): ArrayBuffer {
    const archive = zipSync({ ...entries }, { level: 6 });
    return archive.buffer.slice(
      archive.byteOffset,
      archive.byteOffset + archive.byteLength,
    ) as ArrayBuffer;
  }
}
