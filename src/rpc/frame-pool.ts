import { TransportError } from "./errors";

// Slab pool sizes
const SLAB_SMALL = 64 * 1024; // 64KB - covers 95% of frames
const SLAB_MEDIUM = 512 * 1024; // 512KB
const SLAB_LARGE = 4 * 1024 * 1024; // 4MB

const POOL_MAX_SMALL = 100;
const POOL_MAX_MEDIUM = 20;
const POOL_MAX_LARGE = 5;

export const MAX_FRAME_SIZE = 16 * 1024 * 1024; // 16MB

export class FramePool {
  private small: Uint8Array[] = [];
  private medium: Uint8Array[] = [];
  private large: Uint8Array[] = [];

  alloc(size: number): Uint8Array {
    if (size > MAX_FRAME_SIZE) {
      throw new TransportError(`Frame size ${size} exceeds maximum ${MAX_FRAME_SIZE}`);
    }

    // Match to appropriate slab size
    if (size <= SLAB_SMALL) {
      const buf = this.small.pop();
      return buf || new Uint8Array(SLAB_SMALL);
    }
    
    if (size <= SLAB_MEDIUM) {
      const buf = this.medium.pop();
      return buf || new Uint8Array(SLAB_MEDIUM);
    }
    
    if (size <= SLAB_LARGE) {
      const buf = this.large.pop();
      return buf || new Uint8Array(SLAB_LARGE);
    }
    
    // Don't pool very large frames (>4MB) - rare and wasteful to keep
    return new Uint8Array(size);
  }

  release(buf: Uint8Array): void {
    // Return to appropriate pool if not full
    if (buf.length === SLAB_SMALL && this.small.length < POOL_MAX_SMALL) {
      this.small.push(buf);
    } else if (buf.length === SLAB_MEDIUM && this.medium.length < POOL_MAX_MEDIUM) {
      this.medium.push(buf);
    } else if (buf.length === SLAB_LARGE && this.large.length < POOL_MAX_LARGE) {
      this.large.push(buf);
    }
    // Else: let GC collect it
  }

  // Get pool statistics for monitoring
  stats() {
    return {
      small: this.small.length,
      medium: this.medium.length,
      large: this.large.length,
    };
  }
}

// Global pool instance (one per process)
export const gFramePool = new FramePool();
