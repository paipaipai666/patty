/**
 * IIP (iTerm2 inline image, OSC 1337) header stream patcher.
 *
 * Used by TerminalPane to fix chafa's IIP output so @xterm/addon-image renders it.
 * Kept in its own module so the logic is unit-testable without importing React.
 */

// Why: @xterm/addon-image's IIPHandler treats the `size` field as mandatory and
// aborts when it is missing (IIPHandler.ts:69 `!this._header.size`). chafa emits
// IIP headers without `size` (legal per the iTerm2 spec — size is optional and
// only used for the progress indicator), so its images are silently dropped.
// We inject `size=0;` into the header before the colon so the addon accepts it.
// `size=0` is safe: the base64 decoder allocates a minimal buffer in init(0) and
// grows on demand; the value only gates the abort check, not decoding.
//
// Bounded state machine — never a naive cross-chunk string replace:
// - Non-IIP data passes through with zero buffering and zero latency.
// - Only buffers while scanning for the `\x1b]1337;File=` prefix; once matched or
//   ruled out, the buffer flushes. Capped at IIP_HEADER_SCAN_LIMIT bytes so a
//   malformed stream can never accumulate unbounded memory.
const IIP_HEADER_SCAN_LIMIT = 1024

/**
 * Returns a stream-patcher closure. Call it once per terminal instance and run
 * every PTY → xterm data chunk through the returned function.
 */
export function createIIPStreamPatcher(): (data: string) => string {
  // `buf` holds a pending prefix starting at a `\x1b` that has not yet been
  // resolved — either a partial `\x1b]1337` marker split across chunks, or a
  // partial IIP header whose terminating `:` has not arrived. Empty most of the
  // time: non-IIP chunks never enter this path, and base64 payloads never
  // contain the `\x1b]1337` marker (base64 alphabet excludes ESC), so only the
  // short IIP header / marker is ever buffered.
  let buf = ''
  const marker = '\x1b]1337'

  return (data: string): string => {
    if (buf === '' && data.indexOf(marker) === -1 && partialMarkerSuffixLen(data) === 0) {
      // Fast path: no IIP marker, and the chunk doesn't end with a partial
      // marker prefix (a trailing `\x1b`, `\x1b]`, `\x1b]1`, ... that could
      // continue as `\x1b]1337` in the next chunk). Zero-cost passthrough.
      return data
    }

    const combined = buf + data
    let out = ''
    let pos = 0 // scan cursor within `combined`

    while (pos < combined.length) {
      const markerPos = combined.indexOf(marker, pos)
      if (markerPos === -1) {
        // No more markers. Emit the remaining tail, but hold back a possible
        // partial marker prefix at the very end (a trailing `\x1b`, `\x1b]`,
        // ... that could continue as `\x1b]1337` in the next chunk).
        const tail = combined.slice(pos)
        const hold = partialMarkerSuffixLen(tail)
        if (hold > 0 && hold < tail.length) {
          out += tail.slice(0, tail.length - hold)
          buf = tail.slice(tail.length - hold)
        } else if (hold === tail.length) {
          // The whole remaining tail is a possible marker prefix; hold it all.
          buf = tail
        } else {
          out += tail
          buf = ''
        }
        break
      }

      // Emit text before the marker unchanged.
      out += combined.slice(pos, markerPos)

      // We are at a marker. Find the `:` ending the header.
      const colon = combined.indexOf(':', markerPos)
      if (colon === -1) {
        // Header not terminated in this chunk. Hold from the marker onward,
        // capped to avoid unbounded growth on malformed streams.
        const held = combined.slice(markerPos)
        if (held.length > IIP_HEADER_SCAN_LIMIT) {
          out += held // give up: emit raw, stop trying to patch this one
          buf = ''
        } else {
          buf = held
        }
        break
      }

      const header = combined.slice(markerPos + marker.length, colon)
      // Inject `size=0;` right after `File=` when no size field is present.
      if (/(^|;)size=/.test(header)) {
        out += marker + header
      } else {
        const fileIdx = header.indexOf('File=')
        const injectAt = fileIdx + 'File='.length
        out += marker + header.slice(0, injectAt) + 'size=0;' + header.slice(injectAt)
      }
      out += ':' // the colon itself

      // The payload (base64 + terminator) follows. It cannot contain another
      // `\x1b]1337` (base64 alphabet excludes ESC), so scan for the next marker
      // and emit the gap verbatim, then loop to patch it too.
      const payloadStart = colon + 1
      const nextMarker = combined.indexOf(marker, payloadStart)
      if (nextMarker === -1) {
        // No further marker; but hold back a possible partial-marker suffix.
        const tail = combined.slice(payloadStart)
        const hold = partialMarkerSuffixLen(tail)
        if (hold > 0 && hold < tail.length) {
          out += tail.slice(0, tail.length - hold)
          buf = tail.slice(tail.length - hold)
        } else if (hold === tail.length) {
          buf = tail
        } else {
          out += tail
          buf = ''
        }
        break
      }
      out += combined.slice(payloadStart, nextMarker)
      pos = nextMarker
    }

    if (buf === '') return out
    return out
  }
}

/**
 * If `tail` ends with a prefix of the IIP marker `\x1b]1337` (e.g. a trailing
 * `\x1b`, `\x1b]`, `\x1b]1`, ...), return the length of that partial prefix so
 * the caller can hold it for the next chunk. Returns 0 if the tail does not end
 * with a marker prefix.
 *
 * Example: tail ending in `...\x1b]1` returns 3 (the `\x1b]1` could become
 * `\x1b]1337`). A tail ending in `...x\x1b` returns 1.
 */
function partialMarkerSuffixLen(tail: string): number {
  const marker = '\x1b]1337'
  // Check the longest possible partial first so we return the maximal hold.
  for (let len = Math.min(marker.length - 1, tail.length); len >= 1; len--) {
    if (marker.startsWith(tail.slice(tail.length - len))) {
      return len
    }
  }
  return 0
}
