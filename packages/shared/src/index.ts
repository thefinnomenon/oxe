export type Brand<T, B extends string> = T & { readonly __brand: B };

export const notNullish = <T>(value: T | null | undefined): value is T => value != null;
