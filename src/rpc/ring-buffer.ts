import { gFramePool } from "./frame-pool";

const INITIAL_BUFFER_SIZE = 64 * 1024; // 64KB

export class RingBuffer {
  private buffer: Uint8Array;
  private readPos = 0;
  private writePos = 0;
  private size = 0;

  constructor(capacity = INITIAL_BUFFER_SIZE) {
    // Allocate from pool instead of directly creating
    this.buffer = gFramePool.alloc(capacity);
  }

  write(data: Uint8Array): void {
    const needed = this.size + data.length;
    if (needed > this.buffer.length) {
      this.grow(Math.max(needed, this.buffer.length * 2));
    }

    const remaining = this.buffer.length - this.writePos;
    if (data.length <= remaining) {
      this.buffer.set(data, this.writePos);
      this.writePos += data.length;
    } else {
      this.buffer.set(data.subarray(0, remaining), this.writePos);
      this.buffer.set(data.subarray(remaining), 0);
      this.writePos = data.length - remaining;
    }
    this.size += data.length;
  }

  // peek(length: number): Uint8Array | null {
  //   if (this.size < length) return null;

  //   // Allocate from pool instead of directly creating
  //   const result = gFramePool.alloc(length);
  //   if (this.readPos + length <= this.buffer.length) {
  //     result.set(this.buffer.subarray(this.readPos, this.readPos + length));
  //   } else {
  //     const firstPart = this.buffer.length - this.readPos;
  //     result.set(this.buffer.subarray(this.readPos));
  //     result.set(this.buffer.subarray(0, length - firstPart), firstPart);
  //   }
  //   return result;
  // }

  // Add a method to release peek buffers back to the pool
  // releasePeekBuffer(buffer: Uint8Array): void {
  //   gFramePool.release(buffer);
  // }

  // consume(length: number): void {
  //   if (length > this.size) throw new Error("Cannot consume more than available");
  //   this.readPos = (this.readPos + length) % this.buffer.length;
  //   this.size -= length;
  // }

  // return a sub-array view WITHOUT advancing read pointer
  peekView(len: number): Uint8Array | null {
    if (this.size < len) return null;
    const { buffer, readPos } = this;
    const cap = buffer.length;
    if (readPos + len <= cap) return buffer.subarray(readPos, readPos + len);
    // wrapped case – for simplicity we copy once here; if you want
    // absolute zero-copy even when wrapped, return a two-piece view object.
    const tmp = new Uint8Array(len);
    const first = cap - readPos;
    tmp.set(buffer.subarray(readPos, cap));
    tmp.set(buffer.subarray(0, len - first), first);
    return tmp;
  }
  
  // return a view AND advance read pointer
  readView(len: number): Uint8Array {
    const v = this.peekView(len)!;   // caller already checked size
    this.readPos = (this.readPos + len) % this.buffer.length;
    this.size -= len;
    return v;
  }

  get available(): number {
    return this.size;
  }

  private grow(newCapacity: number): void {
    // Allocate from pool instead of directly creating
    const newBuffer = gFramePool.alloc(newCapacity);
    if (this.readPos + this.size <= this.buffer.length) {
      newBuffer.set(this.buffer.subarray(this.readPos, this.readPos + this.size));
    } else {
      const firstPart = this.buffer.length - this.readPos;
      newBuffer.set(this.buffer.subarray(this.readPos));
      newBuffer.set(this.buffer.subarray(0, this.size - firstPart), firstPart);
    }
    
    // Release old buffer back to the pool
    gFramePool.release(this.buffer);
    
    this.buffer = newBuffer;
    this.readPos = 0;
    this.writePos = this.size;
  }

  // Add a method to properly clean up resources
  destroy(): void {
    gFramePool.release(this.buffer);
    this.buffer = null as any;
    this.size = 0;
    this.readPos = 0;
    this.writePos = 0;
  }
}
