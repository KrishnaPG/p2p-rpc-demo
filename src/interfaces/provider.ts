export interface Service {
  service: string;
  rate: string;
}

export interface IProviderAPI {
  /** Returns the provider's catalog of services */
  getCatalog(): Promise<Service[]>;
  /** Negotiates a specific request with the provider */
  negotiate(request: string): Promise<string>;
}