export interface IAuctioneerAPI {
  /** Places a bid in the auction */
  placeBid(bid: number): Promise<void>;
  /** Listens for real-time updates on the highest bid */
  on(event: 'highestBidUpdate', listener: (bid: number) => void): void;
}