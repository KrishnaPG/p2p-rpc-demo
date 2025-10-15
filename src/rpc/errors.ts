
export class RpcError extends Error {
  constructor(
    public code: number,
    message: string,
    public data?: any,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export class TransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportError";
  }
}
