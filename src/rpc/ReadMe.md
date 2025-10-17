This is a custom CBOR-based framed RPC;

The [Transport](transport.ts) has the `parseFrame` and `makeFrame` methods that pre-pend a frame before the CBOR-payload, which helps the receiver route the payload without having to decode the whole message;

This has support for streamed-responses, fire-and-forget, req-res, req + job-query etc. patterns.

This also uses [FramePool](frame-pool.ts) a pooled memory system that pre-allocates buffers of some fixed sizes;

Other alternatives to this are: JSON-RPC V3 with CBOR, or GRPC etc.